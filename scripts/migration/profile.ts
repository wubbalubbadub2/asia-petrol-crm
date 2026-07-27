/**
 * profile.ts — Pre-M2 migration profiling runner (MIGRATION-PLAN.md §1).
 *
 * Runs scripts/migration/profile.sql STRICTLY READ-ONLY against a COPY of the
 * production database and writes a markdown report to docs/reports/.
 *
 * Safety model (defence in depth):
 *   1. Copy-only gate: refuses to run unless PROFILE_TARGET_IS_COPY=true.
 *   2. Static check: every SQL block must start with SELECT or WITH and must not
 *      contain a data-modifying CTE (INSERT/UPDATE/DELETE INTO/FROM).
 *   3. Server guarantee: everything runs inside a single READ ONLY transaction;
 *      PostgreSQL rejects any write. Per-block SAVEPOINTs isolate failures so one
 *      schema mismatch does not abort the rest of the run (it is reported).
 *
 * Connection string comes from PROFILE_DATABASE_URL (env only, never committed).
 *
 * Run:  npx tsx scripts/migration/profile.ts
 */
import { Client } from "pg";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, ".env") });

type Block = { id: string; q: number | null; kind: string; title: string; sql: string };
type Result = { block: Block; rows: Record<string, unknown>[]; error?: string };

const HERE = __dirname;
const SQL_PATH = path.join(HERE, "profile.sql");
const REPO_ROOT = path.resolve(HERE, "..", "..");
const REPORTS_DIR = path.join(REPO_ROOT, "docs", "reports");

const WRITE_KEYWORDS = /\b(insert|update|delete)\s+(into|from)\b/i;

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// ── Parse profile.sql into tagged blocks ────────────────────────────────────
function parseBlocks(sql: string): Block[] {
  const lines = sql.split("\n");
  const blocks: Block[] = [];
  let cur: { id: string; title: string; body: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const body = cur.body.join("\n").trim();
    const m = /^q(\d+)\.([a-z]+)\./.exec(cur.id);
    blocks.push({
      id: cur.id,
      q: m ? Number(m[1]) : null,
      kind: m ? m[2] : cur.id.split(".")[0], // meta.* → "meta"
      title: cur.title,
      sql: body,
    });
    cur = null;
  };
  for (const line of lines) {
    const mb = /^--\s*@block\s+(\S+)\s*\|\s*(.*)$/.exec(line);
    if (mb) { flush(); cur = { id: mb[1], title: mb[2].trim(), body: [] }; continue; }
    if (/^--\s*={5,}/.test(line)) { flush(); continue; } // banner ends a block
    if (cur) cur.body.push(line);
  }
  flush();
  return blocks;
}

// strip comments so we can inspect the leading keyword
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
}

function assertReadOnly(blocks: Block[]) {
  for (const b of blocks) {
    const bare = stripComments(b.sql);
    if (!/^(select|with)\b/i.test(bare)) fail(`Block ${b.id} does not start with SELECT/WITH — refusing (read-only guard).`);
    if (WRITE_KEYWORDS.test(bare)) fail(`Block ${b.id} contains a data-modifying statement — refusing (read-only guard).`);
  }
}

function redactDsn(dsn: string): string {
  try {
    const u = new URL(dsn);
    return `${u.protocol}//***@${u.host}${u.pathname}`;
  } catch { return "<unparseable DSN>"; }
}

// ── Markdown helpers ────────────────────────────────────────────────────────
const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function maskRows(rows: Record<string, unknown>[], cp: Map<string, string>): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k.startsWith("cp__")) {
        const code = isUuid(v) ? cp.get(String(v)) ?? "C-???" : v == null ? null : "C-???";
        out[k.slice(4)] = code;
      } else if (isUuid(v) && cp.has(String(v))) {
        out[k] = cp.get(String(v)); // defensive: any exposed counterparty id
      } else {
        out[k] = v;
      }
    }
    return out;
  });
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  return String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function mdTable(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "_(нет строк)_\n";
  const cols = Object.keys(rows[0]);
  const head = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

const Q_TITLES: Record<number, string> = {
  1: "Quotation shape",
  2: "Pricing lines",
  3: "Natural keys (wagon / waybill)",
  4: "Money",
  5: "Dates",
  6: "Payment TEXT dates",
  7: "Audit",
  8: "Flags",
  9: "Users",
  10: "Volumes",
};

async function main() {
  const dsn = process.env.PROFILE_DATABASE_URL;
  if (!dsn) fail("PROFILE_DATABASE_URL is not set (see scripts/migration/.env.example).");
  if (process.env.PROFILE_TARGET_IS_COPY !== "true")
    fail("PROFILE_TARGET_IS_COPY must be exactly 'true' — this script only runs against a COPY, never live production.");

  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const blocks = parseBlocks(sql);
  assertReadOnly(blocks);
  console.log(`Parsed ${blocks.length} read-only blocks. Target: ${redactDsn(dsn!)}`);

  const client = new Client({ connectionString: dsn });
  await client.connect();

  const results: Result[] = [];
  const cpMap = new Map<string, string>();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '180000'");

    // counterparty mask map first
    const metaCp = blocks.find((b) => b.id === "meta.counterparties");
    if (metaCp) {
      try {
        const r = await client.query(metaCp.sql);
        r.rows.forEach((row: { id: string }, i) => cpMap.set(String(row.id), `C-${String(i + 1).padStart(3, "0")}`));
        console.log(`Built counterparty mask map: ${cpMap.size} entries.`);
      } catch (e) {
        console.warn("Could not build counterparty map:", (e as Error).message);
      }
    }

    for (const b of blocks) {
      if (b.kind === "meta") continue;
      await client.query("SAVEPOINT sp");
      try {
        const r = await client.query(b.sql);
        results.push({ block: b, rows: r.rows });
        await client.query("RELEASE SAVEPOINT sp");
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT sp");
        results.push({ block: b, rows: [], error: (e as Error).message });
      }
    }

    await client.query("ROLLBACK"); // never commit — read-only anyway
  } finally {
    await client.end();
  }

  // ── Assemble report ───────────────────────────────────────────────────────
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const discrepancies = results.filter((r) => r.error).map((r) => `- \`${r.block.id}\` — ${r.error}`);
  const assertFails = results.filter((r) => r.block.kind === "assert" && !r.error && r.rows.length > 0)
    .map((r) => `- \`${r.block.id}\` — **${r.rows.length} row(s) returned** (expected 0): ${r.block.title}`);

  const out: string[] = [];
  out.push(`# Migration profiling report — ${date}`);
  out.push("");
  out.push(`> Generated by \`scripts/migration/profile.ts\` against **${redactDsn(dsn!)}** (READ ONLY transaction; ${blocks.length} blocks).`);
  out.push(`> Counts are exact. Counterparty identities in sample rows are masked as \`C-NNN\`. Nothing else is anonymized.`);
  out.push("");
  out.push("## Summary");
  out.push("");
  out.push(`- Blocks executed: **${results.length}** · errored/discrepant: **${discrepancies.length}** · failed asserts: **${assertFails.length}**`);
  out.push("");
  if (assertFails.length) { out.push("### ⚠️ Assertion failures (halt conditions)"); out.push(...assertFails); out.push(""); }
  else { out.push("_No assertion failures._"); out.push(""); }
  if (discrepancies.length) {
    out.push("### ⚠️ Schema / AS-BUILT discrepancies (block could not run — reported, not guessed)");
    out.push(...discrepancies); out.push("");
  } else { out.push("_No schema discrepancies — every block ran._"); out.push(""); }

  for (let q = 1; q <= 10; q++) {
    const qr = results.filter((r) => r.block.q === q);
    if (!qr.length) continue;
    out.push(`---`);
    out.push(`## Q${q}. ${Q_TITLES[q] ?? ""}`);
    out.push("");

    // machine-readable counts at the top of the section
    const machine: Record<string, unknown> = {};
    for (const r of qr) {
      if (r.error) { machine[r.block.id] = { error: r.error }; continue; }
      if (r.block.kind === "count" || r.block.kind === "assert" || r.block.kind === "note") {
        machine[r.block.id] = r.rows.length === 1 ? r.rows[0] : r.rows;
      }
    }
    out.push("```json");
    out.push(JSON.stringify(machine, null, 2));
    out.push("```");
    out.push("");

    for (const r of qr) {
      const label = `${r.block.id} — ${r.block.title}`;
      if (r.error) { out.push(`**${label}**`); out.push(""); out.push(`> ⚠️ DISCREPANCY: ${r.error}`); out.push(""); continue; }
      if (r.block.kind === "assert") {
        const ok = r.rows.length === 0;
        out.push(`**${label}** — ${ok ? "✅ PASS (0 rows)" : `⚠️ FAIL (${r.rows.length} rows)`}`);
        out.push("");
        if (!ok) out.push(mdTable(r.rows));
        continue;
      }
      if (r.block.kind === "note") {
        out.push(`**${label}**`); out.push("");
        out.push(r.rows.length === 0
          ? "> ⚠️ AS-BUILT DISCREPANCY: no matching columns found — see report notes for this question."
          : mdTable(r.rows));
        out.push("");
        continue;
      }
      // count / sample
      const rows = r.block.kind === "sample" ? maskRows(r.rows, cpMap).slice(0, 20) : r.rows;
      out.push(`**${label}**${r.block.kind === "sample" ? " _(≤20 rows, masked)_" : ""}`);
      out.push("");
      out.push(mdTable(rows));
    }

    // per-question footnotes for the known AS-BUILT expectations that need judgement
    if (q === 4) {
      out.push("> **Note (stored-converted values):** the old schema stores money in native currency only — `q4.note.stored_converted_columns` lists any persisted converted column. If it is empty, there are **no stored converted values** to reconcile against `fx_rates` (conversion is computed at report time), so this half of §1.4 has no source rows in the old system. Reported, not guessed.");
      out.push("");
    }
    if (q === 10) {
      out.push("> **Note (baseline drift):** these are current counts. The AS-BUILT baseline figures are not present in this repo (`docs/` has no AS-BUILT-DATA); diff these against the AS-BUILT-DATA extraction externally to get drift-since-extraction.");
      out.push("");
    }
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const outPath = path.join(REPORTS_DIR, `profiling-${date}.md`);
  fs.writeFileSync(outPath, out.join("\n"));
  console.log(`\n✓ Report written: ${path.relative(REPO_ROOT, outPath)}`);
  console.log(`  discrepancies: ${discrepancies.length} · assert failures: ${assertFails.length}`);
}

main().catch((e) => fail(e.stack || e.message));

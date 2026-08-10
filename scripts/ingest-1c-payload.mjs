// scripts/ingest-1c-payload.mjs
//
// Загрузка выгрузки фискальных документов 1С (СНТ и ЭСФ) в Supabase:
// integration_1c_payload → fiscal_document → fiscal_document_line.
// Схема — supabase/migrations/00138_fiscal_documents_1c.sql.
// Разбор и правила отклонения — scripts/lib/ingest-1c-transform.mjs.
//
// Запуск (файл на 96 МБ не влезает в дефолтную кучу без запаса):
//   node --max-old-space-size=6144 scripts/ingest-1c-payload.mjs .data/payload-5.json
//   node --max-old-space-size=6144 scripts/ingest-1c-payload.mjs .data/payload-5.json --dry
//
// Ключи берутся из .env.local (NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY) либо из окружения.
//
// ── Идемпотентность ───────────────────────────────────────────────
// Повторный запуск на том же файле не создаёт ни одной новой строки:
//   * landing дедуплицируется по sha256 канонического JSON документа;
//   * документ, чей payload_id уже указывает на тот же landing-хеш,
//     считается неизменным — двигается только last_seen_at, строки
//     не трогаются вообще;
//   * изменившийся документ переписывается целиком: строки удаляются
//     и вставляются заново (поэтому ключ строки (document_id, line_no)
//     не обязан быть стабильным между выгрузками);
//   * is_superseded пересчитывается по всей таблице и пишется только
//     туда, где значение реально меняется.
//
// ── Отклонение документов ─────────────────────────────────────────
// Отклонённый документ всё равно попадает в landing со статусом
// rejected и причиной — иначе о нём никто никогда не узнает. Причины
// перечислены в rejectReason().

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  chunk,
  contentHash,
  docKey,
  rejectReason,
  str,
  supersededKeys,
  toDocumentRow,
  toLandingRow,
  toLineRows,
} from "./lib/ingest-1c-transform.mjs";

// ── Аргументы и окружение ─────────────────────────────────────────
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const filePath = args.find((a) => !a.startsWith("--"));

if (!filePath) {
  console.error("Usage: node --max-old-space-size=6144 scripts/ingest-1c-payload.mjs <payload.json> [--dry]");
  process.exit(2);
}

/** Читает .env.local без зависимостей — dotenv в скриптах не используется. */
function loadEnvLocal() {
  try {
    const raw = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch {
    /* нет файла — работаем на голом окружении */
  }
}

loadEnvLocal();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (.env.local или окружение).");
  process.exit(2);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const RUN_ID = randomUUID();
const NOW = new Date().toISOString();
const PAYLOAD_BATCH = 100; // payload в среднем 7 КБ, максимум 100 КБ
const DOC_BATCH = 200;
const LINE_BATCH = 500;
const ID_BATCH = 200;

const die = (msg, err) => {
  console.error(`\n✗ ${msg}${err ? `: ${err.message || err}` : ""}`);
  process.exit(1);
};

/** Читает таблицу целиком: PostgREST отдаёт максимум 1000 строк за раз. */
async function fetchAll(table, columns, filter) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) die(`чтение ${table}`, error);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// ── 1. Чтение файла ───────────────────────────────────────────────
const t0 = Date.now();
console.log(`Читаю ${filePath}${DRY ? " (dry-run, записи не будет)" : ""}`);

let file;
try {
  file = JSON.parse(readFileSync(filePath, "utf8"));
} catch (e) {
  die("не удалось разобрать файл", e);
}
if (!Array.isArray(file?.documents)) die("в файле нет массива documents");

const source = file.source || {};
console.log(
  `Файл: org=${source.org_code ?? "—"} base_ref=${source.base_ref ?? "—"} ` +
    `конфигурация=${source.config_version ?? "—"} обработка=${source.processing_version ?? "—"}`,
);
console.log(`Окно: ${file.window?.from ?? "—"} → ${file.window?.to ?? "—"} (${file.window?.mode ?? "—"})`);
console.log(`Документов в файле: ${file.documents.length}`);

// ── 2. Классификация и хеширование ────────────────────────────────
const prepared = [];
const rejectStats = new Map();
const seenSha = new Set();
let duplicateInFile = 0;

for (const doc of file.documents) {
  const hash = contentHash(doc);
  if (seenSha.has(hash)) {
    // Один и тот же документ дважды в одном файле: landing его не
    // задвоит (UNIQUE по хешу), но и считать дважды не нужно.
    duplicateInFile++;
    continue;
  }
  seenSha.add(hash);

  const reason = rejectReason(doc);
  if (reason) rejectStats.set(reason, (rejectStats.get(reason) || 0) + 1);
  prepared.push({
    doc,
    hash,
    reason,
    landing: toLandingRow(doc, hash, reason, source, RUN_ID, NOW),
  });
}

const accepted = prepared.filter((p) => !p.reason);
console.log(
  `Принято: ${accepted.length}, отклонено: ${prepared.length - accepted.length}` +
    (duplicateInFile ? `, дублей внутри файла: ${duplicateInFile}` : ""),
);
for (const [reason, n] of [...rejectStats.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(5)}  ${reason}`);
}

const keyOf = (p) => docKey(str(p.doc.own_party.identifier), p.doc.doc_kind, str(p.doc.registration_number));

if (DRY) {
  const orgs = new Set(accepted.map((p) => str(p.doc.own_party.identifier)));
  const lines = accepted.reduce((a, p) => a + (p.doc.lines || []).length, 0);
  const targets = supersededKeys(
    accepted.map((p) => ({
      source_org_code: str(p.doc.own_party.identifier),
      doc_kind: p.doc.doc_kind,
      related_registration_number: str(p.doc.related_registration_number),
    })),
  );
  const keys = new Set(accepted.map(keyOf));
  const resolvable = [...targets].filter((k) => keys.has(k)).length;
  console.log(
    `\nDry-run: организаций ${orgs.size}, товарных строк ${lines}, ` +
      `ссылок на исправляемые документы ${targets.size} (в этом файле разрешились ${resolvable})`,
  );
  console.log("Записи не было.");
  process.exit(0);
}

// ── 3. Landing ────────────────────────────────────────────────────
console.log("\nlanding…");
const landingIdByHash = new Map();
let landingDone = 0;
for (const batch of chunk(prepared, PAYLOAD_BATCH)) {
  const { data, error } = await sb
    .from("integration_1c_payload")
    .upsert(
      batch.map((p) => p.landing),
      { onConflict: "content_sha256" },
    )
    .select("id, content_sha256");
  if (error) die("запись integration_1c_payload", error);
  for (const row of data) landingIdByHash.set(row.content_sha256, row.id);
  landingDone += batch.length;
  process.stdout.write(`\r   ${landingDone}/${prepared.length}`);
}
console.log(`\r   ${prepared.length}/${prepared.length} готово`);

// ── 4. Что реально изменилось ─────────────────────────────────────
const orgCodes = [...new Set(accepted.map((p) => str(p.doc.own_party.identifier)))];
const existing = await fetchAll(
  "fiscal_document",
  "id, source_org_code, doc_kind, registration_number, payload_id",
  (q) => q.in("source_org_code", orgCodes),
);
const existingByKey = new Map(
  existing.map((r) => [docKey(r.source_org_code, r.doc_kind, r.registration_number), r]),
);

const changed = [];
const unchangedIds = [];
for (const p of accepted) {
  const prev = existingByKey.get(keyOf(p));
  const landingId = landingIdByHash.get(p.hash);
  if (prev && prev.payload_id === landingId) unchangedIds.push(prev.id);
  else changed.push({ ...p, landingId });
}
console.log(`\nБез изменений: ${unchangedIds.length}, новых или изменившихся: ${changed.length}`);

// ── 5. Неизменившиеся: только отметка, что документ снова видели ──
for (const batch of chunk(unchangedIds, ID_BATCH)) {
  const { error } = await sb.from("fiscal_document").update({ last_seen_at: NOW }).in("id", batch);
  if (error) die("обновление last_seen_at", error);
}

// ── 6. Изменившиеся: upsert документа ─────────────────────────────
const docIdByKey = new Map();
if (changed.length) {
  console.log("fiscal_document…");
  let done = 0;
  for (const batch of chunk(changed, DOC_BATCH)) {
    const { data, error } = await sb
      .from("fiscal_document")
      .upsert(
        batch.map((p) => toDocumentRow(p.doc, p.landingId, NOW)),
        { onConflict: "source_org_code,doc_kind,registration_number" },
      )
      .select("id, source_org_code, doc_kind, registration_number");
    if (error) die("запись fiscal_document", error);
    for (const row of data) {
      docIdByKey.set(docKey(row.source_org_code, row.doc_kind, row.registration_number), row.id);
    }
    done += batch.length;
    process.stdout.write(`\r   ${done}/${changed.length}`);
  }
  console.log(`\r   ${changed.length}/${changed.length} готово`);
}

// ── 7. Строки: полная замена у изменившихся документов ────────────
// Замена, а не точечный upsert: 1С может переставить строки табличной
// части местами, и тогда апдейт по (document_id, line_no) лёг бы не на
// ту строку.
let linesInserted = 0;
if (changed.length) {
  console.log("fiscal_document_line…");
  const changedIds = changed.map((p) => docIdByKey.get(keyOf(p))).filter(Boolean);

  for (const batch of chunk(changedIds, ID_BATCH)) {
    const { error } = await sb.from("fiscal_document_line").delete().in("document_id", batch);
    if (error) die("удаление старых строк", error);
  }

  const allLines = [];
  for (const p of changed) {
    const id = docIdByKey.get(keyOf(p));
    if (!id) die(`не получен id документа ${p.doc.registration_number}`);
    allLines.push(...toLineRows(p.doc, id));
  }
  for (const batch of chunk(allLines, LINE_BATCH)) {
    const { error } = await sb.from("fiscal_document_line").insert(batch);
    if (error) die("вставка строк", error);
    linesInserted += batch.length;
    process.stdout.write(`\r   ${linesInserted}/${allLines.length}`);
  }
  console.log(`\r   ${linesInserted}/${allLines.length} готово`);
}

// ── 8. Supersession ───────────────────────────────────────────────
// Пересчёт по всей таблице, а не только по пачке: исправляющий документ
// мог приехать в прошлой выгрузке, а исправляемый — в этой.
console.log("\nis_superseded…");
const all = await fetchAll(
  "fiscal_document",
  "id, source_org_code, doc_kind, registration_number, related_registration_number, is_superseded",
);
const targets = supersededKeys(all);
const toSet = [];
const toClear = [];
for (const r of all) {
  const desired = targets.has(docKey(r.source_org_code, r.doc_kind, r.registration_number));
  if (desired === r.is_superseded) continue;
  (desired ? toSet : toClear).push(r.id);
}
for (const [ids, value] of [
  [toSet, true],
  [toClear, false],
]) {
  for (const batch of chunk(ids, ID_BATCH)) {
    const { error } = await sb.from("fiscal_document").update({ is_superseded: value }).in("id", batch);
    if (error) die("обновление is_superseded", error);
  }
}
const supersededTotal = all.filter((r) =>
  targets.has(docKey(r.source_org_code, r.doc_kind, r.registration_number)),
).length;
console.log(`   помечено ${supersededTotal}, изменено в этом запуске: +${toSet.length} / −${toClear.length}`);

// ── 9. Итог ───────────────────────────────────────────────────────
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(
  `\nГотово за ${elapsed}s. run_id=${RUN_ID}` +
    `\n   landing: ${prepared.length} (принято ${accepted.length}, отклонено ${prepared.length - accepted.length})` +
    `\n   документов: ${changed.length} записано, ${unchangedIds.length} без изменений` +
    `\n   строк: ${linesInserted} вставлено` +
    `\n   is_superseded: ${supersededTotal}`,
);
console.log("Документы, которых нет в файле, не удаляются: выгрузка может быть за окно, а не за всю историю.");

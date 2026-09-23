// scripts/registry-rounding-audit.mjs
//
// READ-ONLY разбор расхождения «сумма по реестру ≠ сумма в акте
// экспедитора». Ничего не пишет и ничего не меняет.
//
// Повод — клиент 2026-09-22: по выгрузке registry-kg-full сумма вышла
// 247 303,560, а в подписанном акте отдела экспедирования — 247 384,22.
// Обе суммы делятся на тариф 80,66 без остатка:
//     247 384,22 ÷ 80,66 = 3067 т   (акт)
//     247 303,56 ÷ 80,66 = 3066 т   (CRM)
// То есть расхождение — РОВНО ОДНА ТОННА округлённого тоннажа на всю
// выборку, а не копейки округления в каждой строке. Скрипт ищет строку,
// которая эту тонну даёт.
//
// ЧТО ПЕЧАТАЕТ. По каждой строке — обе возможные базы рядом:
//   • CEIL(исходящее СНТ)  — по нему считает акт экспедитора;
//   • CEIL(входящее СНТ)   — с 00165 система берёт его, когда он есть;
//   • «округл.» как он сейчас в системе (ручной override / round_volume);
//   • тариф и сумма, плюс проверка «сумма = округл × тариф».
// Внизу — итоги по каждой базе. Если итог по исходящему даёт 3067, а
// текущий — 3066, причина в базе (входящее ≠ исходящее хотя бы в одной
// строке). Если оба дают 3066 — расходятся сами объёмы: в акте у какой-то
// строки тоннаж выше, чем в системе.
//
// Запуск (нужен .env.local с SUPABASE_SERVICE_ROLE_KEY):
//   node scripts/registry-rounding-audit.mjs --deal=КГ/26/541
//   node scripts/registry-rounding-audit.mjs --type=KG --year=2026 \
//        --forwarder="PTC - Operator" --month=август --expect=247384.22
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const i = a.indexOf("=");
      return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
    }),
);

const ENV_PATH = args.env || ".env.local";
const env = { ...process.env };
try {
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* переменные могут прийти из окружения */ }

const URL = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (обычно в .env.local)");
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const n = (v) => (v == null ? null : Number(v));
const f = (v, d = 3) =>
  v == null ? "—" : Number(v).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

// PostgREST режет выдачу на 1000 строк.
async function all(table, select, apply) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    let q = sb.from(table).select(select).range(i, i + 999);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// ── Выбор строк ──────────────────────────────────────────────────────
const SELECT = "id, deal_id, registry_type, wagon_number, waybill_number, date, " +
  "loading_volume, shipment_volume, rounded_volume_override, round_volume, " +
  "railway_tariff, railway_tariff_override, shipped_tonnage_amount, " +
  "shipped_tonnage_amount_override, shipment_month, forwarder_id, destination_station_id";

let dealFilter = null;
if (args.deal) {
  const { data, error } = await sb.from("deals").select("id, deal_code").eq("deal_code", args.deal);
  if (error) throw new Error(`deals: ${error.message}`);
  if (!data.length) {
    console.error(`Сделка ${args.deal} не найдена. Код пишется как в интерфейсе, например КГ/26/541.`);
    process.exit(1);
  }
  dealFilter = data[0].id;
}

let forwarderId = null;
if (args.forwarder) {
  const { data, error } = await sb.from("counterparties").select("id, full_name, short_name")
    .or(`full_name.eq.${args.forwarder},short_name.eq.${args.forwarder}`);
  if (error) throw new Error(`counterparties: ${error.message}`);
  if (!data.length) {
    console.error(`Экспедитор «${args.forwarder}» не найден в справочнике.`);
    process.exit(1);
  }
  forwarderId = data[0].id;
}

const rows = await all("shipment_registry", SELECT, (q) => {
  let x = q;
  if (dealFilter) x = x.eq("deal_id", dealFilter);
  if (args.type) x = x.eq("registry_type", args.type);
  if (forwarderId) x = x.eq("forwarder_id", forwarderId);
  if (args.month) x = x.eq("shipment_month", args.month);
  return x.order("date", { ascending: true }).order("wagon_number", { ascending: true });
});

if (!rows.length) {
  console.error("Под фильтр не попало ни одной строки реестра.");
  process.exit(1);
}

// Коды сделок для печати.
const dealIds = [...new Set(rows.map((r) => r.deal_id).filter(Boolean))];
const dealCodes = new Map();
for (let i = 0; i < dealIds.length; i += 200) {
  const { data, error } = await sb.from("deals").select("id, deal_code, year").in("id", dealIds.slice(i, i + 200));
  if (error) throw new Error(`deals: ${error.message}`);
  for (const d of data) dealCodes.set(d.id, d);
}
const yearFiltered = args.year
  ? rows.filter((r) => String(dealCodes.get(r.deal_id)?.year ?? "") === String(args.year))
  : rows;

// ── Разбор ───────────────────────────────────────────────────────────
const ceil = (v) => (v == null ? null : Math.ceil(v));

let sumOut = 0, sumIn = 0, sumCeilOut = 0, sumCeilIn = 0, sumCurrent = 0, sumAmount = 0;
const flagged = [];

console.log(
  pad("сделка", 12) + pad("вагон", 11) + pad("дата", 11) +
  padL("входящее", 11) + padL("исходящее", 11) +
  padL("⌈вход⌉", 8) + padL("⌈исход⌉", 9) + padL("округл", 9) +
  padL("тариф", 10) + padL("сумма", 14) + "  флаги",
);
console.log("─".repeat(125));

for (const r of yearFiltered) {
  const inV = n(r.loading_volume);
  const outV = n(r.shipment_volume);
  const tariff = n(r.railway_tariff);
  const amount = n(r.shipped_tonnage_amount);

  // База как её считает система с 00165: входящее, если есть, иначе исходящее.
  const base = inV ?? outV;
  const current = r.rounded_volume_override != null
    ? n(r.rounded_volume_override)
    : base == null ? null : (r.round_volume === false ? base : Math.ceil(base));

  sumOut += outV ?? 0;
  sumIn += inV ?? 0;
  sumCeilOut += ceil(outV) ?? 0;
  sumCeilIn += ceil(inV ?? outV) ?? 0;
  sumCurrent += current ?? 0;
  sumAmount += amount ?? 0;

  const flags = [];
  if (inV != null && outV != null && ceil(inV) !== ceil(outV)) flags.push("БАЗА≠ИСХОД");
  if (r.rounded_volume_override != null) flags.push("округл вручную");
  if (r.round_volume === false) flags.push("без округления");
  if (r.railway_tariff_override) flags.push("тариф вручную");
  if (tariff == null) flags.push("НЕТ ТАРИФА");
  if (r.shipped_tonnage_amount_override) flags.push("СУММА ВРУЧНУЮ");
  if (amount != null && current != null && tariff != null
      && Math.abs(amount - current * tariff) > 0.005) flags.push("СУММА≠ОКРУГЛ×ТАРИФ");
  if (flags.length) flagged.push({ r, flags });

  console.log(
    pad(dealCodes.get(r.deal_id)?.deal_code ?? "—", 12) +
    pad(r.wagon_number ?? "—", 11) +
    pad(r.date ?? "—", 11) +
    padL(f(inV), 11) + padL(f(outV), 11) +
    padL(ceil(inV) ?? "—", 8) + padL(ceil(outV) ?? "—", 9) + padL(current ?? "—", 9) +
    padL(f(tariff), 10) + padL(f(amount, 2), 14) +
    (flags.length ? "  " + flags.join(", ") : ""),
  );
}

// ── Итоги ────────────────────────────────────────────────────────────
console.log("─".repeat(125));
console.log(`строк: ${yearFiltered.length}`);
console.log(`Σ входящее СНТ:            ${f(sumIn)}`);
console.log(`Σ исходящее СНТ:           ${f(sumOut)}`);
console.log(`Σ ⌈исходящее⌉ (как в акте): ${sumCeilOut}`);
console.log(`Σ ⌈база⌉ (входящее, иначе исходящее): ${sumCeilIn}`);
console.log(`Σ «округл.» как в системе: ${sumCurrent}`);
console.log(`Σ сумма по строкам:        ${f(sumAmount, 2)}`);

const tariffs = [...new Set(yearFiltered.map((r) => n(r.railway_tariff)).filter((t) => t != null))];
if (tariffs.length === 1) {
  const t = tariffs[0];
  console.log(`\nтариф один на всю выборку: ${f(t)}`);
  console.log(`  по акту (Σ⌈исход⌉ × тариф):   ${f(sumCeilOut * t, 2)}`);
  console.log(`  по системе (Σокругл × тариф): ${f(sumCurrent * t, 2)}`);
  const dt = sumCeilOut - sumCurrent;
  if (dt !== 0) {
    console.log(`  расхождение: ${dt > 0 ? "+" : ""}${dt} т = ${f(dt * t, 2)} — ищите строки с флагом БАЗА≠ИСХОД или «округл вручную»`);
  }
} else if (tariffs.length > 1) {
  console.log(`\nв выборке ${tariffs.length} разных тарифа — сверяйте суммы по группам, а не одним умножением`);
}

if (args.expect) {
  const want = Number(String(args.expect).replace(",", "."));
  const diff = want - sumAmount;
  console.log(`\nожидалось: ${f(want, 2)}; по системе: ${f(sumAmount, 2)}; разница: ${f(diff, 2)}`);
  if (tariffs.length === 1 && tariffs[0]) {
    const tons = diff / tariffs[0];
    console.log(`разница в тоннах округлённого тоннажа: ${f(tons, 3)}`);
  }
}

if (flagged.length) {
  console.log(`\nстрок с особенностями: ${flagged.length}`);
  for (const { r, flags } of flagged) {
    console.log(`  ${dealCodes.get(r.deal_id)?.deal_code ?? "—"} вагон ${r.wagon_number ?? "—"}: ${flags.join(", ")} [id ${r.id}]`);
  }
} else {
  console.log("\nстрок с ручным округлением, отключённым округлением и расхождением базы нет");
}

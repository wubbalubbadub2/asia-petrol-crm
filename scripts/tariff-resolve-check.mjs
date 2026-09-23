// scripts/tariff-resolve-check.mjs
//
// READ-ONLY разбор «тариф не подтянулся». Ничего не пишет и не меняет.
//
// Повод — клиент 2026-09-22: по КГ/26/434 в справочнике на маршрут
// ст. Белкол → ст. Карабалта, TS Logistics, Печное топливо, август
// стоит 42,00, а в строках реестра 44,000 и две строки вовсе пустые.
//
// ЗАЧЕМ СКРИПТ. Подбор ставки идёт по ключу из ШЕСТИ ПОЛЕЙ, и сравнение
// в нём — по идентификаторам, а не по названиям:
//     departure_station_id, destination_station_id, fuel_type_id,
//     forwarder_id, month (текст), year (год СДЕЛКИ)
// Поля строки, если пустые, берутся со сделки (COALESCE). Поэтому
// «в справочнике же есть такая ставка» на экране и «ставка не найдена»
// в триггере — не противоречие: совпадать должны идентификаторы.
// Скрипт печатает ключ каждой строки в идентификаторах И в названиях,
// рядом — что нашёл справочник, и отдельно все ставки, похожие ПО
// НАЗВАНИЯМ. Двойники станций с одинаковым именем и разной ролью
// (их в базе хватает, см. миграцию 00163) видно сразу.
//
// Запуск (нужен .env.local с SUPABASE_SERVICE_ROLE_KEY):
//   node scripts/tariff-resolve-check.mjs --deal=КГ/26/434
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
if (!args.deal) {
  console.error("Укажите сделку: node scripts/tariff-resolve-check.mjs --deal=КГ/26/434");
  process.exit(1);
}

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

const pad = (s, w) => String(s ?? "—").padEnd(w);
const padL = (s, w) => String(s ?? "—").padStart(w);
const short = (id) => (id ? String(id).slice(0, 8) : "—");
const f = (v, d = 3) =>
  v == null ? "—" : Number(v).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });

// ── Сделка ───────────────────────────────────────────────────────────
const { data: deals, error: dErr } = await sb
  .from("deals")
  .select("id, deal_code, year, month, logistics_shipment_month, planned_tariff, actual_tariff, " +
          "supplier_departure_station_id, buyer_destination_station_id, fuel_type_id, forwarder_id")
  .eq("deal_code", args.deal);
if (dErr) throw new Error(`deals: ${dErr.message}`);
if (!deals.length) {
  console.error(`Сделка ${args.deal} не найдена. Код пишется как в интерфейсе, например КГ/26/434.`);
  process.exit(1);
}
const deal = deals[0];

// ── Строки реестра ───────────────────────────────────────────────────
const { data: rows, error: rErr } = await sb
  .from("shipment_registry")
  .select("id, wagon_number, date, shipment_month, railway_tariff, railway_tariff_override, " +
          "shipped_tonnage_amount, departure_station_id, destination_station_id, fuel_type_id, forwarder_id")
  .eq("deal_id", deal.id)
  .order("date", { ascending: true })
  .order("wagon_number", { ascending: true });
if (rErr) throw new Error(`shipment_registry: ${rErr.message}`);

// ── Справочники ──────────────────────────────────────────────────────
const { data: stations } = await sb.from("stations").select("id, name, type");
const { data: fuels } = await sb.from("fuel_types").select("id, name");
const { data: forwarders } = await sb.from("forwarders").select("id, name");
const stById = new Map((stations ?? []).map((s) => [s.id, s]));
const fuelById = new Map((fuels ?? []).map((x) => [x.id, x.name]));
const fwById = new Map((forwarders ?? []).map((x) => [x.id, x.name]));

const { data: tariffs, error: tErr } = await sb
  .from("tariffs")
  .select("id, departure_station_id, destination_station_id, fuel_type_id, forwarder_id, " +
          "factory_id, month, year, planned_tariff, created_at, updated_at");
if (tErr) throw new Error(`tariffs: ${tErr.message}`);

// Подбор ровно как в SQL: равенство по шести полям, при нескольких
// совпадениях — минимальная ставка (ORDER BY planned_tariff LIMIT 1).
function resolve(key) {
  const hits = tariffs.filter((t) =>
    t.departure_station_id === key.dep &&
    t.destination_station_id === key.dest &&
    t.fuel_type_id === key.fuel &&
    t.forwarder_id === key.fwd &&
    t.month === key.month &&
    t.year === key.year &&
    t.planned_tariff != null);
  hits.sort((a, b) => Number(a.planned_tariff) - Number(b.planned_tariff));
  return hits;
}

console.log(`\nСделка ${deal.deal_code}: год ${deal.year}, месяц «${deal.month}», ` +
  `мес. отгрузки логистики «${deal.logistics_shipment_month ?? "—"}»`);
console.log(`  ключ сделки: отпр ${short(deal.supplier_departure_station_id)} (${stById.get(deal.supplier_departure_station_id)?.name ?? "—"}` +
  `/${stById.get(deal.supplier_departure_station_id)?.type ?? "—"}), ` +
  `назн ${short(deal.buyer_destination_station_id)} (${stById.get(deal.buyer_destination_station_id)?.name ?? "—"}` +
  `/${stById.get(deal.buyer_destination_station_id)?.type ?? "—"}), ` +
  `ГСМ ${fuelById.get(deal.fuel_type_id) ?? "—"}, эксп. ${fwById.get(deal.forwarder_id) ?? "—"}`);
console.log(`  «Тариф план» в паспорте (deals.planned_tariff): ${f(deal.planned_tariff)} ` +
  `— пишется ОДИН РАЗ при создании сделки и из справочника не обновляется НИКОГДА`);
console.log(`  «Тариф факт» (deals.actual_tariff): ${f(deal.actual_tariff)} — это сумма ÷ объём, не ставка справочника\n`);

console.log(
  pad("вагон", 11) + pad("дата", 11) + pad("мес.отгр", 10) +
  padL("тариф", 9) + pad("  ручной", 9) + padL("справочник", 11) + "  вердикт",
);
console.log("─".repeat(104));

let manual = 0, missing = 0, stale = 0, ok = 0;
for (const r of rows) {
  const key = {
    dep: r.departure_station_id ?? deal.supplier_departure_station_id,
    dest: r.destination_station_id ?? deal.buyer_destination_station_id,
    fuel: r.fuel_type_id ?? deal.fuel_type_id,
    fwd: r.forwarder_id ?? deal.forwarder_id,
    month: r.shipment_month ?? deal.month,
    year: deal.year,
  };
  const hits = resolve(key);
  const ref = hits.length ? Number(hits[0].planned_tariff) : null;
  const cur = r.railway_tariff == null ? null : Number(r.railway_tariff);

  let verdict;
  if (r.railway_tariff_override) {
    verdict = cur == null
      ? "РУЧНАЯ И ПУСТАЯ — ячейку стёрли, справочник её больше не трогает"
      : "ручная — справочник эту строку не трогает";
    manual++;
  } else if (ref == null) {
    verdict = "СТАВКИ ПО КЛЮЧУ НЕТ — подбор молча вышел, сумма не считается";
    missing++;
  } else if (cur == null || Math.abs(cur - ref) > 0.00005) {
    verdict = `РАСХОДИТСЯ со справочником (${f(ref)}) — пропагация до строки не дошла`;
    stale++;
  } else {
    verdict = "совпадает со справочником";
    ok++;
  }
  if (hits.length > 1) verdict += ` [в справочнике ${hits.length} подходящих ставки, берётся минимальная]`;

  console.log(
    pad(r.wagon_number, 11) + pad(r.date, 11) + pad(r.shipment_month ?? `(${deal.month})`, 10) +
    padL(f(cur), 9) + pad(r.railway_tariff_override ? "  да" : "  нет", 9) +
    padL(f(ref), 11) + "  " + verdict,
  );
}

console.log("─".repeat(104));
console.log(`строк: ${rows.length}; совпадает: ${ok}; ручных: ${manual}; без ставки в справочнике: ${missing}; расходится: ${stale}`);

// ── Что вообще есть в справочнике по этим названиям ──────────────────
// Сравниваем по ИМЕНАМ станций/ГСМ/экспедитора — так видно ставки,
// которые оператор считает «той самой», а подбор их не берёт: другой
// идентификатор станции (двойник с той же надписью, но другой ролью),
// другой год или другой месяц.
const depName = stById.get(rows[0]?.departure_station_id ?? deal.supplier_departure_station_id)?.name;
const destName = stById.get(rows[0]?.destination_station_id ?? deal.buyer_destination_station_id)?.name;
const fuelName = fuelById.get(rows[0]?.fuel_type_id ?? deal.fuel_type_id);
const fwName = fwById.get(rows[0]?.forwarder_id ?? deal.forwarder_id);

const byName = tariffs.filter((t) =>
  stById.get(t.departure_station_id)?.name === depName &&
  stById.get(t.destination_station_id)?.name === destName &&
  fuelById.get(t.fuel_type_id) === fuelName &&
  fwById.get(t.forwarder_id) === fwName);

console.log(`\nСтавки справочника по НАЗВАНИЯМ «${depName ?? "—"}» → «${destName ?? "—"}», ${fuelName ?? "—"}, ${fwName ?? "—"}:`);
if (!byName.length) {
  console.log("  ни одной — оператор смотрит на другой маршрут, либо в ставке пустое поле ключа");
} else {
  const usedDep = rows[0]?.departure_station_id ?? deal.supplier_departure_station_id;
  const usedDest = rows[0]?.destination_station_id ?? deal.buyer_destination_station_id;
  for (const t of byName) {
    const flags = [];
    if (t.departure_station_id !== usedDep) flags.push("ДРУГАЯ запись ст. отправления (двойник по названию)");
    if (t.destination_station_id !== usedDest) flags.push("ДРУГАЯ запись ст. назначения (двойник по названию)");
    if (t.year !== deal.year) flags.push(`другой год (${t.year} вместо ${deal.year})`);
    console.log(
      `  ${f(t.planned_tariff)}  ${pad(t.month, 10)} ${t.year}  ` +
      `отпр ${short(t.departure_station_id)}/${stById.get(t.departure_station_id)?.type ?? "—"}  ` +
      `назн ${short(t.destination_station_id)}/${stById.get(t.destination_station_id)?.type ?? "—"}  ` +
      `создана ${String(t.created_at).slice(0, 10)}, правлена ${String(t.updated_at).slice(0, 10)}` +
      (flags.length ? `\n      ⚠ ${flags.join("; ")}` : ""),
    );
  }
  console.log("\n  Подсказка: если ставка правилась ПОСЛЕ появления строк и правили в ней не сумму,");
  console.log("  а месяц/станцию/экспедитора/ГСМ — распространение не запускается вовсе (00117:81),");
  console.log("  и строки остаются со старым значением. Сумму тронуть достаточно, чтобы оно пошло.");
}

// ── Станции-двойники по названию ─────────────────────────────────────
const byStationName = new Map();
for (const s of stations ?? []) {
  const arr = byStationName.get(s.name) ?? [];
  arr.push(s);
  byStationName.set(s.name, arr);
}
for (const nm of [depName, destName]) {
  const dup = nm ? byStationName.get(nm) ?? [] : [];
  if (dup.length > 1) {
    console.log(`\n⚠ станция «${nm}» заведена ${dup.length} раза: ` +
      dup.map((s) => `${short(s.id)}/${s.type}`).join(", "));
    console.log("  Ставка и строка реестра могли выбрать РАЗНЫЕ записи — для подбора это разные станции.");
  }
}
console.log();

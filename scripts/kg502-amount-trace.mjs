// scripts/kg502-amount-trace.mjs
//
// READ-ONLY поиск источника конкретного числа в сделке. Ничего не пишет.
//
// Повод — КГ 502 (клиент 2026-09-18): «откуда взялась сумма 1 808 297,863?».
//
// Как ищем, чтобы это был РАСЧЁТ, а не подгонка:
//   1. печатаем ВСЕ числовые поля самой сделки и отмечаем совпадения
//      с искомым числом;
//   2. печатаем суммы по каждой числовой колонке каждой дочерней
//      таблицы (строки триггерных цен, реестр, оплаты, цепочка групп) —
//      это ровно те величины, из которых триггеры собирают роллапы;
//   3. только если прямого совпадения нет — перебираем пары
//      «кандидат ± кандидат» и печатаем их КАК ГИПОТЕЗЫ, которые надо
//      сверить с формулой триггера, а не как ответ.
//
// Запуск: node scripts/kg502-amount-trace.mjs [число] [код сделки] [env]
//   node scripts/kg502-amount-trace.mjs 1808297.863 KG/26/502
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const TARGET = Number(process.argv[2] ?? 1808297.863);
const CODE = process.argv[3] || "KG/26/502";
const ENV_PATH = process.argv[4] || ".env.local";
const EPS = 0.0011; // ищем совпадение до третьего знака — числа в UI с 3 знаками

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

const n = (v) => Number(v ?? 0);
const f = (v, d = 3) => n(v).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
const pad = (s, w) => String(s).padEnd(w);
const hit = (v) => Math.abs(n(v) - TARGET) <= EPS;

async function all(table, select, eq) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    let q = sb.from(table).select(select).range(i, i + 999);
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// ── сделка ───────────────────────────────────────────────────────────
let { data: deals, error } = await sb.from("deals").select("*").eq("deal_code", CODE);
if (error) { console.error(error.message); process.exit(1); }
if (!deals?.length) {
  // Код мог быть записан иначе — ищем по номеру и типу.
  const num = Number(String(CODE).replace(/\D+/g, "").slice(-3));
  ({ data: deals } = await sb.from("deals").select("*").eq("deal_type", "KG").eq("deal_number", num));
}
if (!deals?.length) { console.error(`Сделка ${CODE} не найдена`); process.exit(1); }

const candidates = []; // { label, value }

for (const d of deals) {
  console.log(`\n═══ ${d.deal_code}  (id ${d.id}, год ${d.year}, месяц ${d.month}) ═══`);
  console.log(`ищем: ${f(TARGET)}\n`);

  console.log("── числовые поля самой сделки ──");
  for (const [k, v] of Object.entries(d)) {
    if (typeof v !== "number") continue;
    candidates.push({ label: `deals.${k}`, value: v });
    console.log(`${hit(v) ? "★ " : "  "}${pad(k, 34)} ${f(v)}`);
  }
  console.log(`\nвалюты: поставщик ${d.supplier_currency}, покупатель ${d.buyer_currency}, логистика ${d.logistics_currency}`);
  console.log(`цены: поставщик ${d.supplier_price}, покупатель ${d.buyer_price}`);
  console.log(`галочки: railway_in_price=${d.railway_in_price}, additional_expenses_in_price=${d.additional_expenses_in_price}`);

  // ── дочерние таблицы ──────────────────────────────────────────────
  const prices = await all("deal_shipment_prices", "*", { deal_id: d.id });
  const reg = await all("shipment_registry", "*", { deal_id: d.id });
  const pays = await all("deal_payments", "*", { deal_id: d.id });
  const groups = await all("deal_company_groups", "*", { deal_id: d.id });

  const tables = [
    ["deal_shipment_prices", prices],
    ["shipment_registry", reg],
    ["deal_payments", pays],
    ["deal_company_groups", groups],
  ];

  for (const [name, rows] of tables) {
    if (!rows.length) { console.log(`\n── ${name}: строк нет ──`); continue; }
    console.log(`\n── ${name}: ${rows.length} строк, суммы по колонкам ──`);
    const cols = new Set();
    for (const r of rows) for (const [k, v] of Object.entries(r)) if (typeof v === "number") cols.add(k);

    // Разрезы: всё, и по стороне/типу, если такие колонки есть.
    const slices = [["все", rows]];
    if (rows.some((r) => r.side)) {
      for (const side of [...new Set(rows.map((r) => r.side))]) {
        slices.push([`side=${side}`, rows.filter((r) => r.side === side)]);
      }
    }
    if (rows.some((r) => r.payment_type)) {
      for (const t of [...new Set(rows.map((r) => r.payment_type))]) {
        slices.push([`type=${t}`, rows.filter((r) => r.payment_type === t)]);
        for (const side of [...new Set(rows.map((r) => r.side))]) {
          slices.push([`${side}/${t}`, rows.filter((r) => r.payment_type === t && r.side === side)]);
        }
      }
    }

    for (const [sliceName, sliceRows] of slices) {
      for (const col of cols) {
        const sum = sliceRows.reduce((a, r) => a + n(r[col]), 0);
        if (sum === 0) continue;
        const label = `SUM(${name}.${col})${sliceName === "все" ? "" : ` [${sliceName}]`}`;
        candidates.push({ label, value: sum });
        if (hit(sum)) console.log(`★ ${pad(label, 60)} ${f(sum)}`);
      }
    }
    // Произведения «объём × цена» по строкам триггерных цен — их же
    // складывает роллап 00030, полезно видеть и пересчёт.
    if (name === "deal_shipment_prices") {
      for (const [sliceName, sliceRows] of slices) {
        const prod = sliceRows.reduce((a, r) => a + n(r.volume) * n(r.calculated_price), 0);
        if (!prod) continue;
        const label = `SUM(volume × calculated_price) [${sliceName}]`;
        candidates.push({ label, value: prod });
        if (hit(prod)) console.log(`★ ${pad(label, 60)} ${f(prod)}`);
      }
    }
    if (name === "shipment_registry") {
      for (const base of ["loading_volume", "shipment_volume"]) {
        for (const price of [n(d.supplier_price), n(d.buyer_price)]) {
          if (!price) continue;
          const v = sliceSum(rows, base) * price;
          const label = `SUM(${base}) × ${price}`;
          candidates.push({ label, value: v });
          if (hit(v)) console.log(`★ ${pad(label, 60)} ${f(v)}`);
        }
      }
    }
  }

  // ── построчная печать источников ──────────────────────────────────
  console.log(`\n── deal_shipment_prices построчно ──`);
  console.log(pad("сторона", 10) + pad("дата", 12) + pad("объём", 16) + pad("цена", 14) + pad("сумма", 16) + "накопительно");
  for (const side of ["supplier", "buyer"]) {
    let run = 0;
    for (const r of prices.filter((x) => x.side === side).sort((a, b) => (a.shipment_date ?? "").localeCompare(b.shipment_date ?? ""))) {
      run += n(r.amount);
      console.log(pad(side, 10) + pad(r.shipment_date ?? "—", 12) + pad(f(r.volume, 6), 16) + pad(f(r.calculated_price, 4), 14) + pad(f(r.amount, 4), 16) + f(run, 3) + (hit(run) ? "  ★ совпало" : ""));
    }
  }

  console.log(`\n── shipment_registry построчно ──`);
  console.log(pad("дата", 12) + pad("вагон", 14) + pad("вход. СНТ", 14) + pad("исход. СНТ", 14) + pad("Сумма 1", 16) + pad("Сумма 3", 14) + "Сумма 2");
  for (const r of reg.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))) {
    console.log(
      pad(r.date ?? "—", 12) + pad(r.wagon_number ?? "—", 14) +
      pad(f(r.loading_volume, 3), 14) + pad(f(r.shipment_volume, 3), 14) +
      pad(f(r.shipped_tonnage_amount, 3), 16) + pad(f(r.additional_expenses, 3), 14) + f(r.supplier_railway_amount, 3));
  }

  console.log(`\n── deal_payments построчно ──`);
  for (const r of pays.sort((a, b) => (a.payment_date ?? "").localeCompare(b.payment_date ?? ""))) {
    console.log(pad(r.payment_date ?? "—", 12) + pad(r.side, 10) + pad(r.payment_type, 10) + pad(f(r.amount, 3), 18) + (r.currency ?? "—") + " " + (r.description ?? ""));
  }
}

function sliceSum(rows, col) {
  return rows.reduce((a, r) => a + n(r[col]), 0);
}

// ── прямые совпадения ────────────────────────────────────────────────
const exact = candidates.filter((c) => hit(c.value));
console.log(`\n═══ прямые совпадения с ${f(TARGET)} ═══`);
if (exact.length === 0) console.log("нет — ни одно поле и ни одна сумма по колонке не равны искомому числу");
for (const c of exact) console.log(`★ ${pad(c.label, 60)} ${f(c.value)}`);

// ── гипотезы: пара кандидатов ────────────────────────────────────────
if (exact.length === 0) {
  console.log(`\n═══ пары «A ± B» (ГИПОТЕЗЫ — сверять с формулой триггера) ═══`);
  const uniq = [];
  for (const c of candidates) {
    if (!c.value) continue;
    if (!uniq.some((u) => u.label === c.label)) uniq.push(c);
  }
  let shown = 0;
  for (let i = 0; i < uniq.length && shown < 40; i++) {
    for (let j = 0; j < uniq.length && shown < 40; j++) {
      if (i === j) continue;
      const plus = uniq[i].value + uniq[j].value;
      const minus = uniq[i].value - uniq[j].value;
      if (hit(plus)) { console.log(`  ${uniq[i].label} + ${uniq[j].label} = ${f(plus)}`); shown++; }
      else if (hit(minus)) { console.log(`  ${uniq[i].label} − ${uniq[j].label} = ${f(minus)}`); shown++; }
    }
  }
  if (shown === 0) console.log("  пар не нашлось");
}

console.log("\nГотово. Скрипт ничего не менял.");

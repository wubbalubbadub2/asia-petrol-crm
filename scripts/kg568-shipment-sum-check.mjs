// scripts/kg568-shipment-sum-check.mjs
//
// READ-ONLY разбор расхождения «цена × объём ≠ сумма отгрузки». Ничего
// не пишет и ничего не меняет.
//
// Повод — КГ 568 (клиент 2026-09-08 и 2026-09-14): цена 226,156,
// отгружено 2 425,900 т, 226,156 × 2425,9 = 548 631,84, а паспорт и
// выгрузка показывают 548 632,447.
//
// Что проверяем. В паспорте объём и сумма приезжают ИЗ РАЗНЫХ ТАБЛИЦ:
//   deals.buyer_shipped_volume  = SUM(shipment_registry.shipment_volume)   (00027)
//   deals.buyer_shipped_amount  = SUM(deal_shipment_prices.amount)         (00030)
// Если наборы строк разошлись — сумма перестаёт биться с объёмом. Ровно
// такой рассинхрон уже чинили в 00131 для KG/26/191. Скрипт показывает
// обе стороны построчно и печатает разницу.
//
// Запуск: node scripts/kg568-shipment-sum-check.mjs [код сделки] [путь к env]
//   node scripts/kg568-shipment-sum-check.mjs KG/26/568
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const CODE = process.argv[2] || "KG/26/568";
const ENV_PATH = process.argv[3] || ".env.local";

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
const f = (v, d = 6) => n(v).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
const pad = (s, w) => String(s).padEnd(w);

// PostgREST режет выдачу на 1000 строк.
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

const { data: deals, error } = await sb
  .from("deals")
  .select("id, deal_code, buyer_price, supplier_price, buyer_shipped_volume, buyer_shipped_amount, supplier_shipped_volume, supplier_shipped_amount, actual_shipped_volume")
  .eq("deal_code", CODE);
if (error) { console.error(error.message); process.exit(1); }
if (!deals?.length) { console.error(`Сделка ${CODE} не найдена. Проверьте код, например KG/26/568.`); process.exit(1); }

for (const d of deals) {
  console.log(`\n═══ ${d.deal_code} ═══`);
  console.log(`deals.buyer_price            = ${d.buyer_price}`);
  console.log(`deals.buyer_shipped_volume   = ${f(d.buyer_shipped_volume)}   ← SUM(shipment_registry.shipment_volume)`);
  console.log(`deals.buyer_shipped_amount   = ${f(d.buyer_shipped_amount, 4)}   ← SUM(deal_shipment_prices.amount)`);

  const reg = await all("shipment_registry", "id, date, wagon_number, shipment_volume, loading_volume", { deal_id: d.id });
  const prices = await all("deal_shipment_prices", "id, side, shipment_date, volume, calculated_price, amount", { deal_id: d.id });

  for (const side of ["buyer", "supplier"]) {
    const rows = prices.filter((r) => r.side === side);
    if (!rows.length) continue;
    console.log(`\n── deal_shipment_prices, сторона ${side}: ${rows.length} строк ──`);
    console.log(pad("дата", 12) + pad("объём", 16) + pad("цена", 14) + pad("сумма", 16) + "объём × цена");
    let sv = 0, sa = 0, recomputed = 0;
    for (const r of rows.slice().sort((a, b) => (a.shipment_date ?? "").localeCompare(b.shipment_date ?? ""))) {
      const prod = n(r.volume) * n(r.calculated_price);
      sv += n(r.volume); sa += n(r.amount); recomputed += prod;
      const flag = Math.abs(prod - n(r.amount)) > 0.005 ? "  ⚠ строка не сходится" : "";
      console.log(pad(r.shipment_date ?? "—", 12) + pad(f(r.volume), 16) + pad(f(r.calculated_price, 4), 14) + pad(f(r.amount, 4), 16) + f(prod, 4) + flag);
    }
    console.log("-".repeat(74));
    console.log(`${pad("ИТОГО", 12)}${pad(f(sv), 16)}${pad("", 14)}${pad(f(sa, 4), 16)}${f(recomputed, 4)}`);

    const uniq = [...new Set(rows.map((r) => String(r.calculated_price)))];
    console.log(`\nразных цен в строках: ${uniq.length}${uniq.length > 1 ? "  ← сумма НЕ обязана равняться «одна цена × общий объём»" : ""}`);
    if (uniq.length <= 8) console.log(`  ${uniq.join(", ")}`);

    const price = uniq.length === 1 ? n(uniq[0]) : null;
    if (price != null) {
      console.log(`\nсверка «одна цена × общий объём»:`);
      console.log(`  ${f(sv)} × ${price} = ${f(sv * price, 4)}`);
      console.log(`  разница с суммой строк: ${f(sa - sv * price, 4)}`);
    }

    // Главная проверка: объёмы из двух таблиц.
    const regVol = reg.reduce((a, r) => a + n(side === "buyer" ? r.shipment_volume : r.loading_volume), 0);
    const delta = sv - regVol;
    console.log(`\nобъём в deal_shipment_prices : ${f(sv)}`);
    console.log(`объём в shipment_registry     : ${f(regVol)}   (строк: ${reg.length})`);
    console.log(`расхождение                   : ${f(delta)}${Math.abs(delta) > 1e-6 ? "  ⚠ РОЛЛАПЫ РАЗОШЛИСЬ — это и есть причина" : "  — роллапы совпадают"}`);
    if (Math.abs(delta) > 1e-6 && price != null) {
      console.log(`в деньгах это ${f(delta * price, 4)} — сравните с разницей, которую видит клиент`);
    }
  }
}
console.log("\nГотово. Скрипт ничего не менял.");

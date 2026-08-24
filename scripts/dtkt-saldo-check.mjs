// scripts/dtkt-saldo-check.mjs
//
// READ-ONLY сверка сальдо ДТ-КТ Логистика по живой базе. Ничего не пишет.
// Печатает по каждой записи года: слагаемые, сальдо по действующей формуле
// UI и разбор, чтобы бухгалтерия могла сверить строку со своей таблицей.
//
// Запуск: node scripts/dtkt-saldo-check.mjs [year] [path-to-env]
//   node scripts/dtkt-saldo-check.mjs 2026
//
// Формула (клиент 2026-08-25):
//   Сальдо = Сальдо 1 янв + Возврат + Отгрузка + Штрафы + Сверхнорм + ОГЭМ − Оплата
//   плюс = мы должны экспедитору, минус = нам должны.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const YEAR = Number(process.argv[2] || new Date().getFullYear());
const ENV_PATH = process.argv[3] || ".env.local";

// Читаем URL/ключ из .env.local, если их нет в окружении. Значения нигде
// не печатаются.
const env = { ...process.env };
try {
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* переменные могут прийти из окружения */ }

const URL = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const n = (v) => Number(v ?? 0);
const f = (v) => n(v).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, w) => String(s).padStart(w);

// PostgREST режет выдачу на 1000 строк — реестр за год её перебирает.
async function all(fn) {
  const out = []; let i = 0;
  for (;;) {
    const { data, error } = await fn(i, i + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    i += 1000;
  }
  return out;
}

const { data: recs, error } = await sb.from("dt_kt_logistics")
  .select("id, forwarder_id, company_group_id, year, opening_balance, payment, refund, fines, surcharge_preliminary, ogem, forwarder:forwarders(name), company_group:company_groups(name)")
  .eq("year", YEAR).order("forwarder_id");
if (error) throw new Error(error.message);

// «Оплата» = сумма строк dt_kt_payments, как в UI; хранимая колонка —
// запасной вариант для записей без детальных оплат.
const pays = await all((a, b) => sb.from("dt_kt_payments").select("dt_kt_id, amount").range(a, b));
const payByRec = {};
for (const p of pays) (payByRec[p.dt_kt_id] ??= []).push(p);

// «Отгрузка» = shipped_tonnage_amount реестра по паре (экспедитор, группа).
const ship = await all((a, b) => sb.from("shipment_registry")
  .select("forwarder_id, company_group_id, shipment_volume, shipped_tonnage_amount")
  .gte("date", `${YEAR}-01-01`).lte("date", `${YEAR}-12-31`).range(a, b));
const sums = new Map();
for (const r of ship) {
  if (!r.forwarder_id) continue;
  const k = `${r.forwarder_id}::${r.company_group_id ?? ""}`;
  if (!sums.has(k)) sums.set(k, { vol: 0, amt: 0 });
  const s = sums.get(k);
  s.vol += n(r.shipment_volume);
  s.amt += n(r.shipped_tonnage_amount);
}

console.log(`\nДТ-КТ Логистика — сверка сальдо за ${YEAR} год (${recs.length} записей)`);
console.log(`Формула: Сальдо 1 янв + Возврат + Отгрузка + Штрафы + Сверхнорм + ОГЭМ − Оплата`);
console.log(`Знак: плюс = мы должны экспедитору, минус = нам должны\n`);

let total = 0;
for (const r of recs) {
  const s = sums.get(`${r.forwarder_id}::${r.company_group_id ?? ""}`) ?? { vol: 0, amt: 0 };
  const ps = payByRec[r.id] ?? [];
  const pay = ps.length ? ps.reduce((a, p) => a + n(p.amount), 0) : n(r.payment);
  const saldo = n(r.opening_balance) + n(r.refund)
    + s.amt + n(r.fines) + n(r.surcharge_preliminary) + n(r.ogem) - pay;
  total += saldo;
  console.log(`${r.forwarder?.name ?? "—"} / ${r.company_group?.name ?? "—"}`);
  console.log(`   1 янв ${pad(f(r.opening_balance), 16)}   оплата ${pad(f(pay), 16)}   возврат ${pad(f(r.refund), 14)}`);
  console.log(`   отгр  ${pad(f(s.amt), 16)}   штрафы ${pad(f(r.fines), 16)}   сверхн  ${pad(f(r.surcharge_preliminary), 14)}   ОГЭМ ${pad(f(r.ogem), 12)}`);
  console.log(`   САЛЬДО ${pad(f(saldo), 15)}   ${saldo > 0 ? "мы должны" : saldo < 0 ? "нам должны" : "закрыто"}\n`);
}
console.log(`ИТОГО по ${recs.length} записям: ${f(total)}`);

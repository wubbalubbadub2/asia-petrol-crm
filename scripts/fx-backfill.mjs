// scripts/fx-backfill.mjs
// Одноразовый backfill USD/KZT из НБ РК по историческим датам.
// Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/fx-backfill.mjs [--dry]
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY = process.argv.includes("--dry");
if (!URL || !KEY) { console.error("Need SUPABASE URL + SERVICE_ROLE_KEY"); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const fmt = (d) => `${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}.${d.getUTCFullYear()}`;
const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;

async function nbrk(d) {
  const res = await fetch(`https://nationalbank.kz/rss/get_rates.cfm?fdate=${fmt(d)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const m = xml.match(/<item>[\s\S]*?<title>\s*USD\s*<\/title>[\s\S]*?<description>\s*([\d.,]+)\s*<\/description>/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

// Самая ранняя дата события: min по отгрузкам и оплатам.
async function earliest() {
  const q1 = await sb.from("shipment_registry").select("date").not("date","is",null).order("date",{ascending:true}).limit(1);
  const q2 = await sb.from("deal_payments").select("payment_date").not("payment_date","is",null).order("payment_date",{ascending:true}).limit(1);
  if (q1.error) console.warn(`shipment_registry query error: ${q1.error.message}`);
  if (q2.error) console.warn(`deal_payments query error: ${q2.error.message}`);
  const dates = [q1.data?.[0]?.date, q2.data?.[0]?.payment_date].filter(Boolean).sort();
  return dates[0] ? new Date(dates[0] + "T00:00:00Z") : new Date(Date.UTC(2026,0,1));
}

const start = await earliest();
const end = new Date();
console.log(`Backfill USD/KZT ${iso(start)} → ${iso(end)}${DRY ? " (dry)" : ""}`);
let ok = 0, skip = 0;
for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
  try {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) { skip++; continue; }          // выходные — пропуск, покрываются fallback date<=X
    try {
      const rate = await nbrk(new Date(d));
      if (!rate) { skip++; continue; }
      if (!DRY) {
        const { error } = await sb.from("fx_rates").upsert(
          { date: iso(d), base_currency: "USD", quote_currency: "KZT", rate, source: "nbrk" },
          { onConflict: "date,base_currency,quote_currency" });
        if (error) throw new Error(error.message);
      }
      ok++;
      if (ok % 20 === 0) console.log(`  …${iso(d)} = ${rate}`);
    } catch (e) { console.warn(`  ${iso(d)}: ${e.message}`); skip++; }
  } finally {
    await new Promise((r) => setTimeout(r, 120));               // вежливо к серверу НБ РК — гарантия на каждой итерации
  }
}
console.log(`Готово: ${ok} курсов записано, ${skip} пропущено.`);

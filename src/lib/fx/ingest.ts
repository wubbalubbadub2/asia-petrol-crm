// Портируемое ядро загрузки курсов. НИКАКОЙ привязки к Vercel —
// вызывается из cron-роута (сейчас) и из любого другого шедулера
// потом. Запись через service-role (обходит RLS fx_rates).

import { createAdminClient } from "@/lib/supabase/admin";
import { parseNbrkUsdKzt, parseNbkrUsdKgs, formatKzDate } from "@/lib/fx/parse";

export const NBKR_URL = "https://www.nbkr.kg/XML/daily.xml";
export function nbrkUrl(d: Date): string {
  return `https://nationalbank.kz/rss/get_rates.cfm?fdate=${formatKzDate(d)}`;
}

async function getText(url: string, fetchFn: typeof fetch): Promise<string> {
  const res = await fetchFn(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FX fetch ${url} → HTTP ${res.status}`);
  return res.text();
}

/** KZT за 1 USD (НБ РК) на дату. */
export async function fetchNbrkRate(d: Date, fetchFn: typeof fetch = fetch): Promise<number> {
  return parseNbrkUsdKzt(await getText(nbrkUrl(d), fetchFn));
}

/** KGS за 1 USD (НБ КР) — только текущий день. */
export async function fetchNbkrRate(fetchFn: typeof fetch = fetch): Promise<number> {
  return parseNbkrUsdKgs(await getText(NBKR_URL, fetchFn));
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Тянет оба банка на дату (по умолчанию сегодня) и делает upsert в
 * fx_rates: (date, USD, KZT, nbrk) и (date, USD, KGS, nbkr).
 * НБ КР отдаёт только текущий курс — историю сюда не передаём.
 */
export async function ingestDailyRates(opts?: { date?: Date }): Promise<{ nbrk: number; nbkr: number; date: string }> {
  const d = opts?.date ?? new Date();
  const date = isoDate(d);
  const [nbrk, nbkr] = await Promise.all([fetchNbrkRate(d), fetchNbkrRate()]);
  const sb = createAdminClient();
  const rows = [
    { date, base_currency: "USD", quote_currency: "KZT", rate: nbrk, source: "nbrk" },
    { date, base_currency: "USD", quote_currency: "KGS", rate: nbkr, source: "nbkr" },
  ];
  const { error } = await (sb as unknown as {
    from: (t: string) => { upsert: (r: unknown, o: { onConflict: string }) => Promise<{ error: { message: string } | null }> };
  }).from("fx_rates").upsert(rows, { onConflict: "date,base_currency,quote_currency" });
  if (error) throw new Error(`fx_rates upsert: ${error.message}`);
  return { nbrk, nbkr, date };
}

/**
 * Загрузка событий сделок для отчёта «Сбор по валюте».
 *
 * ВСЁ идёт через fetchAllPaginated с tie-breaker'ом по id. Запрос без
 * .range() молча режется PostgREST'ом на 1000 строк — этот баг уже
 * стоил нам пропавших под-строк в выгрузке паспорта (KG/26/346,
 * 2026-07-20) и обрезанного отчёта по ценам.
 */
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";
import type { FxRateRow } from "@/lib/fx/rates";
import type { DealEvents, PriceRow, PaymentRow, LogisticsRow } from "@/lib/fx/convert-deal";

type PostgrestPage<T> = PromiseLike<{ data: T[] | null; error: PostgrestError | null }>;

const CHUNK = 150;   // PostgREST ограничивает длину URL — IN-лист чанкуем

/**
 * Батчевая выборка по deal_id: чанки по 150 id параллельно, каждый
 * чанк постранично. orderBy обязан заканчиваться на "id" — без
 * детерминированного порядка строки на границе страниц теряются.
 */
export async function fetchByDealIds<T>(opts: {
  table: string;
  select: string;
  dealIds: string[];
  orderBy: string[];
}): Promise<T[]> {
  if (opts.dealIds.length === 0) return [];
  if (opts.orderBy[opts.orderBy.length - 1] !== "id") {
    throw new Error(`fetchByDealIds(${opts.table}): последний ключ сортировки обязан быть "id"`);
  }
  const sb = createClient();
  const chunks: string[][] = [];
  for (let i = 0; i < opts.dealIds.length; i += CHUNK) chunks.push(opts.dealIds.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map((ids) =>
    fetchAllPaginated<T>((from, to) => {
      // opts.table приходит рантайм-строкой (сигнатура из брифа), поэтому
      // строгая литеральная узкая типизация Database<Table> здесь не
      // работает — тот же генерик-кейс, что в use-references.ts.
      // Важно вызывать .from как метод на sb, а не отрывать его в
      // переменную — иначе теряется this-binding supabase-js.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (sb as any).from(opts.table).select(opts.select).in("deal_id", ids);
      for (const col of opts.orderBy) q = q.order(col, { ascending: true });
      return q.range(from, to) as unknown as PostgrestPage<T>;
    }),
  ));
  const out: T[] = [];
  for (const res of results) {
    if (res.error) throw new Error(`${opts.table}: ${res.error.message}`);
    out.push(...res.data);
  }
  return out;
}

type RawPayment = PaymentRow & { payment_type: string | null };

/** Все события выбранных сделок, сгруппированные по deal_id. */
export async function fetchDealEvents(dealIds: string[]): Promise<Map<string, DealEvents>> {
  const [prices, payments, logistics] = await Promise.all([
    fetchByDealIds<PriceRow>({
      table: "deal_shipment_prices",
      select: "deal_id, side, amount, shipment_date, id",
      dealIds,
      orderBy: ["deal_id", "id"],
    }),
    fetchByDealIds<RawPayment>({
      table: "deal_payments",
      select: "deal_id, side, amount, payment_date, currency, payment_type, id",
      dealIds,
      orderBy: ["deal_id", "id"],
    }),
    fetchByDealIds<LogisticsRow>({
      table: "shipment_registry",
      select: "deal_id, loading_date, date, shipped_tonnage_amount, additional_expenses, currency, id",
      dealIds,
      orderBy: ["deal_id", "id"],
    }),
  ]);

  const out = new Map<string, DealEvents>();
  const bucket = (id: string): DealEvents => {
    let b = out.get(id);
    if (!b) { b = { prices: [], payments: [], logistics: [] }; out.set(id, b); }
    return b;
  };
  for (const p of prices) bucket(p.deal_id).prices.push(p);
  for (const p of payments) {
    // Знак задаётся типом платежа — та же конвенция, что в rollup 00062
    // и в выгрузке паспорта.
    const sign = p.payment_type === "refund" || p.payment_type === "offset" ? -1 : 1;
    bucket(p.deal_id).payments.push({
      deal_id: p.deal_id, side: p.side,
      amount: p.amount != null ? p.amount * sign : null,
      payment_date: p.payment_date, currency: p.currency,
    });
  }
  for (const r of logistics) bucket(r.deal_id).logistics.push(r);
  return out;
}

/**
 * Курсы за период. Таблица маленькая (≈2 строки в день), грузим целиком.
 * Сортировка по полному PK (date, base_currency, quote_currency) для
 * детерминизма пагинации.
 */
export async function fetchFxRatesRange(fromDate: string, toDate: string): Promise<FxRateRow[]> {
  const sb = createClient();
  // database.ts (генерённые типы) ещё не знает fx_rates (миграция 00122) —
  // тот же stale-types случай, что у user_prefs в use-user-pref.ts.
  // Вызываем .from как метод на sb, а не через оторванную переменную —
  // иначе теряется this-binding supabase-js.
  const { data, error } = await fetchAllPaginated<FxRateRow>((from, to) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sb as any).from("fx_rates")
      .select("date, base_currency, quote_currency, rate")
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date", { ascending: true })
      .order("base_currency", { ascending: true })
      .order("quote_currency", { ascending: true })
      .range(from, to) as unknown as PostgrestPage<FxRateRow>,
  );
  if (error) throw new Error(`Курсы валют: ${error.message}`);
  return data;
}

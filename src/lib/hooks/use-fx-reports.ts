"use client";
import { createClient } from "@/lib/supabase/client";

export type FlowRow = { metric: string; deal_type: string; year: number; month: number; usd: number | null; kzt: number | null };
export type PriceRow = {
  deal_code: string; deal_type: string; snt_date: string | null; loading_date: string | null;
  supplier_price_usd: number | null; supplier_price_kzt: number | null;
  buyer_price_usd: number | null; buyer_price_kzt: number | null;
};

export const FLOW_METRICS = [
  { key: "supply_in", label: "Приход (входящее СНТ)" },
  { key: "ship_out", label: "Исход (исходящее СНТ)" },
  { key: "pay_supplier", label: "Оплаты поставщикам" },
  { key: "pay_buyer", label: "Оплаты покупателям" },
] as const;

// database.ts не знает новых RPC (stale types) — узкий структурный каст,
// тот же приём, что в use-user-pref.ts. Вызываем .rpc КАК МЕТОД клиента
// (sb.rpc(...)), а не извлекаем метод в переменную — иначе теряется
// this-binding и supabase-js падает в рантайме.
type RpcResult = { data: unknown; error: { message: string } | null };
type RpcBuilder = PromiseLike<RpcResult> & { range: (from: number, to: number) => PromiseLike<RpcResult> };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => RpcBuilder };

// Постранично тянем весь результат RPC. PostgREST режет ответ табличной
// функции на дефолтном лимите 1000 строк — fx_report_price построчный по
// СНТ и легко превышает 1000, иначе отчёт молча обрезается.
async function callRpcAll<T>(name: string, args: Record<string, unknown>): Promise<T[]> {
  const sb = createClient() as unknown as RpcClient;
  const pageSize = 1000;
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.rpc(name, args).range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function fetchFlows(from: string, to: string): Promise<FlowRow[]> {
  return callRpcAll<FlowRow>("fx_report_flows", { p_from: from, p_to: to });
}

export async function fetchPrice(from: string, to: string): Promise<PriceRow[]> {
  return callRpcAll<PriceRow>("fx_report_price", { p_from: from, p_to: to });
}

export function groupFlows(rows: FlowRow[]): {
  byMetric: Record<string, FlowRow[]>;
  totals: Record<string, { usd: number; kzt: number }>;
} {
  const byMetric: Record<string, FlowRow[]> = {};
  const totals: Record<string, { usd: number; kzt: number }> = {};
  for (const r of rows) {
    (byMetric[r.metric] ??= []).push(r);
    const t = (totals[r.metric] ??= { usd: 0, kzt: 0 });
    t.usd += r.usd ?? 0;
    t.kzt += r.kzt ?? 0;
  }
  return { byMetric, totals };
}

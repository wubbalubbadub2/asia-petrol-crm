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
// тот же приём, что в use-user-pref.ts.
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
function rpc(): Rpc {
  return (createClient() as unknown as { rpc: Rpc }).rpc;
}

export async function fetchFlows(from: string, to: string): Promise<FlowRow[]> {
  const { data, error } = await rpc()("fx_report_flows", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? []) as FlowRow[];
}

export async function fetchPrice(from: string, to: string): Promise<PriceRow[]> {
  const { data, error } = await rpc()("fx_report_price", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? []) as PriceRow[];
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

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export type TriggerBasis = "shipment_date" | "border_crossing_date";

export type ShipmentPrice = {
  id: string;
  deal_id: string;
  side: "supplier" | "buyer";
  shipment_date: string | null;
  border_crossing_date: string | null;
  trigger_start_date: string | null;
  trigger_days: number;
  trigger_basis: TriggerBasis;
  quotation_product_type_id: string | null;
  quotation_avg: number | null;
  discount: number | null;
  calculated_price: number | null;
  volume: number | null;
  amount: number | null;
  notes: string | null;
  created_at: string;
};

export function useDealTriggerPrices(dealId: string, side: "supplier" | "buyer") {
  const [data, setData] = useState<ShipmentPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const sbRef = useRef(createClient());

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sbRef.current
      .from("deal_shipment_prices")
      .select("*")
      .eq("deal_id", dealId)
      .eq("side", side)
      .order("shipment_date", { ascending: true });
    if (error) {
      toast.error(`Ошибка загрузки цен: ${error.message}`);
    } else {
      setData((data ?? []) as ShipmentPrice[]);
    }
    setLoading(false);
  }, [dealId, side]);

  useEffect(() => { load(); }, [load]);

  async function insert(values: Partial<ShipmentPrice>) {
    const { error } = await sbRef.current
      .from("deal_shipment_prices")
      .insert({ ...values, deal_id: dealId, side });
    if (error) {
      toast.error(`Ошибка: ${error.message}`);
      return false;
    }
    await load();
    return true;
  }

  async function update(id: string, values: Partial<ShipmentPrice>) {
    const { error } = await sbRef.current
      .from("deal_shipment_prices")
      .update(values)
      .eq("id", id);
    if (error) {
      toast.error(`Ошибка: ${error.message}`);
      return false;
    }
    await load();
    return true;
  }

  async function remove(id: string) {
    const { error } = await sbRef.current
      .from("deal_shipment_prices")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error(`Ошибка: ${error.message}`);
      return false;
    }
    await load();
    return true;
  }

  return { data, loading, reload: load, insert, update, remove };
}

/**
 * Fetch quotation average for a date range (trigger window)
 */
export async function fetchTriggerQuotationAvg(
  productTypeId: string,
  startDate: string,
  days: number
): Promise<number | null> {
  const sb = createClient();
  const end = new Date(startDate + "T00:00:00");
  end.setDate(end.getDate() + days);
  const endStr = end.toISOString().split("T")[0];

  const { data } = await sb
    .from("quotations")
    .select("price, price_fob_med, price_fob_rotterdam, price_cif_nwe")
    .eq("product_type_id", productTypeId)
    .gte("date", startDate)
    .lte("date", endStr);

  if (!data || data.length === 0) return null;

  // Use first non-null price column
  const prices = data
    .map((q) => q.price ?? q.price_cif_nwe ?? q.price_fob_rotterdam ?? q.price_fob_med)
    .filter((p): p is number => p != null);

  if (prices.length === 0) return null;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

/**
 * Fetch the monthly average quotation for «Средний месяц» mode.
 * Calls the SQL helper `compute_monthly_quotation_avg(product_type_id, year, month)`
 * which averages COALESCE(price, price_cif_nwe, price_fob_rotterdam, price_fob_med)
 * over all quotations whose date falls in that calendar month.
 */
export async function fetchMonthlyQuotationAvg(
  productTypeId: string,
  year: number,
  month: number
): Promise<number | null> {
  const sb = createClient();
  // RPC not in generated types yet (migration 00067) — cast to keep TS happy.
  const { data, error } = await (
    sb.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: number | string | null; error: { message: string } | null }>
  )("compute_monthly_quotation_avg", {
    p_product_type_id: productTypeId,
    p_year: year,
    p_month: month,
  });
  if (error || data == null) return null;
  const n = typeof data === "number" ? data : parseFloat(String(data));
  return Number.isFinite(n) ? n : null;
}

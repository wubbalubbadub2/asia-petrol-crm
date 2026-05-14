"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TablesInsert } from "@/lib/types/database";
import { toast } from "sonner";

export type Deal = {
  id: string;
  deal_type: "KG" | "KZ" | "OIL";
  deal_number: number;
  year: number;
  deal_code: string;
  quarter: string | null;
  month: string;
  factory_id: string | null;
  fuel_type_id: string | null;
  sulfur_percent: string | null;
  supplier_id: string | null;
  supplier_contract: string | null;
  supplier_contracted_volume: number | null;
  supplier_contracted_amount: number | null;
  supplier_delivery_basis: string | null;
  supplier_quotation_comment: string | null;
  supplier_quotation: number | null;
  supplier_discount: number | null;
  supplier_price: number | null;
  supplier_price_condition: string | null;
  supplier_shipped_amount: number | null;
  supplier_shipped_volume: number | null;
  supplier_payment: number | null;
  supplier_payment_date: string | null;
  supplier_balance: number | null;
  supplier_departure_station_id: string | null;
  buyer_id: string | null;
  buyer_contract: string | null;
  buyer_delivery_basis: string | null;
  buyer_destination_station_id: string | null;
  buyer_contracted_volume: number | null;
  buyer_contracted_amount: number | null;
  buyer_quotation_comment: string | null;
  buyer_quotation: number | null;
  buyer_discount: number | null;
  buyer_price: number | null;
  buyer_price_condition: string | null;
  buyer_ordered_volume: number | null;
  buyer_remaining: number | null;
  buyer_shipped_volume: number | null;
  buyer_ship_date: string | null;
  buyer_shipped_amount: number | null;
  buyer_payment: number | null;
  buyer_payment_date: string | null;
  buyer_debt: number | null;
  forwarder_id: string | null;
  logistics_company_group_id: string | null;
  // Migration 00069 — overrides deal.month for tariff lookups when set.
  logistics_shipment_month?: string | null;
  planned_tariff: number | null;
  preliminary_tonnage: number | null;
  preliminary_amount: number | null;
  actual_tariff: number | null;
  actual_shipped_volume: number | null;
  invoice_volume: number | null;
  invoice_amount: number | null;
  logistics_notes: string | null;
  surcharge_amount: number | null;
  surcharge_reinvoiced_to: string | null;
  railway_in_price: boolean | null;
  buyer_multi_deal_payments: string | null;
  buyer_snt_written: string | null;
  supplier_manager_id: string | null;
  buyer_manager_id: string | null;
  trader_id: string | null;
  currency: string | null;
  supplier_currency: string;
  buyer_currency: string;
  logistics_currency: string;
  is_archived: boolean;
  created_at: string;
  // Variant counts — populated post-fetch from the embedded line arrays.
  supplier_lines_count?: number;
  buyer_lines_count?: number;
  // Joined fields
  factory?: { name: string } | null;
  fuel_type?: { name: string; color: string } | null;
  supplier?: { full_name: string; short_name: string | null } | null;
  buyer?: { full_name: string; short_name: string | null } | null;
  forwarder?: { name: string } | null;
  supplier_manager?: { full_name: string } | null;
  buyer_manager?: { full_name: string } | null;
  trader?: { full_name: string } | null;
  buyer_destination_station?: { name: string } | null;
  supplier_departure_station?: { name: string } | null;
  logistics_company_group?: { name: string } | null;
  deal_company_groups?: { id: string; position: number; company_group_id: string; price: number | null; contract_ref: string | null; company_group: { name: string } | null }[];
};

const DEAL_SELECT = `
  *,
  factory:factories(name),
  fuel_type:fuel_types(name, color),
  supplier:counterparties!supplier_id(full_name, short_name),
  buyer:counterparties!buyer_id(full_name, short_name),
  forwarder:forwarders(name),
  supplier_manager:profiles!supplier_manager_id(full_name),
  buyer_manager:profiles!buyer_manager_id(full_name),
  trader:profiles!trader_id(full_name),
  buyer_destination_station:stations!buyer_destination_station_id(name),
  supplier_departure_station:stations!supplier_departure_station_id(name),
  logistics_company_group:company_groups!logistics_company_group_id(name),
  deal_company_groups(id, position, company_group_id, price, contract_ref, company_group:company_groups(name)),
  supplier_lines:deal_supplier_lines(id),
  buyer_lines:deal_buyer_lines(id)
`;

// Annotate fetched deals with simple line counts so the passport table
// can render a "+N линий" badge without a second round trip.
type WithLines = { supplier_lines?: { id: string }[]; buyer_lines?: { id: string }[] };
function annotateLineCounts<T extends WithLines>(rows: T[]): (T & Deal)[] {
  return rows.map((r) => ({
    ...(r as unknown as Deal),
    supplier_lines_count: r.supplier_lines?.length ?? 0,
    buyer_lines_count: r.buyer_lines?.length ?? 0,
  })) as (T & Deal)[];
}

export function useDeals(filters?: {
  dealType?: "KG" | "KZ" | "OIL";
  year?: number;
  month?: string;
  isArchived?: boolean;
}) {
  const [data, setData] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabaseRef.current.from("deals").select(DEAL_SELECT);

    // Always filter out drafts
    query = query.or("is_draft.is.null,is_draft.eq.false");
    if (filters?.dealType) query = query.eq("deal_type", filters.dealType);
    if (filters?.year) query = query.eq("year", filters.year);
    if (filters?.month) query = query.eq("month", filters.month);
    if (filters?.isArchived !== undefined) query = query.eq("is_archived", filters.isArchived);

    query = query.order("deal_number", { ascending: true });

    const { data, error } = await query;
    if (error) {
      toast.error(`Ошибка загрузки сделок: ${error.message}`);
    } else {
      setData(annotateLineCounts((data ?? []) as unknown as WithLines[]) as unknown as Deal[]);
    }
    setLoading(false);
  }, [filters?.dealType, filters?.year, filters?.month, filters?.isArchived]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}

export function useDeal(id: string | null) {
  const [data, setData] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const supabaseRef2 = useRef(createClient());

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabaseRef2.current
      .from("deals")
      .select(DEAL_SELECT)
      .eq("id", id)
      .single();
    if (error) {
      toast.error(`Ошибка загрузки сделки: ${error.message}`);
    } else if (data) {
      const [annotated] = annotateLineCounts([data as unknown as WithLines]);
      setData(annotated as unknown as Deal);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}

export async function createDeal(values: Omit<TablesInsert<"deals">, "deal_number">) {
  const supabase = createClient();

  // Generate deal number
  const dealType = values.deal_type;
  const year = values.year;

  const { data: numData, error: numError } = await supabase
    .rpc("generate_deal_number", { p_type: dealType, p_year: year });

  if (numError) {
    toast.error(`Ошибка генерации номера: ${numError.message}`);
    return null;
  }

  const dealNumber = numData as number;

  const { data, error } = await supabase
    .from("deals")
    .insert({ ...values, deal_number: dealNumber })
    .select()
    .single();

  if (error) {
    toast.error(`Ошибка создания сделки: ${error.message}`);
    return null;
  }

  toast.success(
    `Сделка ${dealType}/${String(year % 100).padStart(2, "0")}/${String(dealNumber).padStart(3, "0")} создана`,
  );
  return data;
}

export async function updateDeal(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const { error } = await supabase.from("deals").update(values).eq("id", id);
  if (error) {
    toast.error(`Ошибка сохранения: ${error.message}`);
    throw error;
  }
  return true;
}

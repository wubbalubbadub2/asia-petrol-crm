"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export type ShipmentRecord = {
  id: string;
  registry_type: "KG" | "KZ";
  row_number: number | null;
  quarter: string | null;
  month: string | null;
  date: string | null;
  waybill_number: string | null;
  wagon_number: string | null;
  shipment_volume: number | null;
  destination_station_id: string | null;
  departure_station_id: string | null;
  fuel_type_id: string | null;
  deal_id: string | null;
  factory_id: string | null;
  supplier_id: string | null;
  forwarder_id: string | null;
  shipment_month: string | null;
  railway_tariff: number | null;
  buyer_id: string | null;
  rounded_tonnage_from_forwarder: number | null;
  shipped_tonnage_amount: number | null;
  // Migration 00050 — optional until applied + types regenerated
  shipped_tonnage_amount_override?: boolean | null;
  // Migration 00061 — manual override for the rolled-up volume («округл»)
  rounded_volume_override?: number | null;
  // Migration 00086 — per-row CEIL toggle. TRUE = CEIL(base) (current
  // behavior), FALSE = base as-is. KZ uses loading_volume as base; KG
  // uses shipment_volume. Optional until generated types catch up.
  round_volume?: boolean | null;
  // Migration 00072 — appendix labels per side. Free-text;
  // auto-resolves supplier_line_id / buyer_line_id when the registry
  // form matches them against the deal's variants.
  supplier_appendix?: string | null;
  buyer_appendix?: string | null;
  invoice_number: string | null;
  comment: string | null;
  loading_volume: number | null;
  company_group_id: string | null;
  additional_month: string | null;
  currency: string | null;
  created_at: string;
  // Joined
  destination_station?: { name: string } | null;
  departure_station?: { name: string } | null;
  fuel_type?: { name: string; color: string } | null;
  deal?: { deal_code: string; currency: string | null; year: number | null; month: string | null } | null;
  factory?: { name: string } | null;
  forwarder?: { name: string } | null;
  company_group?: { name: string } | null;
  supplier?: { short_name: string | null; full_name: string } | null;
  buyer?: { short_name: string | null; full_name: string } | null;
};

const REG_SELECT = `
  *,
  destination_station:stations!destination_station_id(name),
  departure_station:stations!departure_station_id(name),
  fuel_type:fuel_types(name, color),
  deal:deals(deal_code, currency, year, month),
  factory:factories(name),
  forwarder:forwarders(name),
  company_group:company_groups(name),
  supplier:counterparties!supplier_id(short_name, full_name),
  buyer:counterparties!buyer_id(short_name, full_name)
`;

export function useRegistry(type: "KG" | "KZ") {
  const [data, setData] = useState<ShipmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const load = useCallback(async () => {
    // PostgREST's default Max-Rows is 1000 and a hard `.limit(500)` here
    // was silently dropping every shipment past the 500th most-recent
    // date — entire deals would disappear from the table once the
    // registry crossed that threshold. Page through `.range()` until a
    // short page tells us we're done. Same fix as the quotation summary.
    setLoading(true);
    const all: ShipmentRecord[] = [];
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("shipment_registry")
        .select(REG_SELECT)
        .eq("registry_type", type)
        // Default null ordering for DESC in Postgres is NULLS FIRST,
        // so freshly created shipments without a date appear at the top
        // until the user fills the date in. The secondary sort on
        // created_at keeps that group itself in newest-first order.
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) {
        toast.error(`Ошибка загрузки реестра: ${error.message}`);
        break;
      }
      const rows = (data ?? []) as ShipmentRecord[];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    setData(all);
    setLoading(false);
  }, [supabase, type]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}

import type { TablesInsert, TablesUpdate } from "@/lib/types/database";

// Migration 00072 added supplier_appendix / buyer_appendix on
// shipment_registry. Until the generated database.ts is regenerated,
// the optional override here keeps inserts/updates type-clean.
type RegistryInsert = TablesInsert<"shipment_registry"> & {
  supplier_appendix?: string | null;
  buyer_appendix?: string | null;
};
// Override field is post-migration-00050; types here may run ahead of the
// generated database.ts until `npm run types:db` is rerun.
export type RegistryUpdate = TablesUpdate<"shipment_registry"> & {
  shipped_tonnage_amount_override?: boolean | null;
  rounded_volume_override?: number | null;
  round_volume?: boolean | null;
  supplier_appendix?: string | null;
  buyer_appendix?: string | null;
};

export async function createRegistryEntry(values: RegistryInsert) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shipment_registry")
    .insert(values)
    .select()
    .single();

  if (error) {
    toast.error(`Ошибка: ${error.message}`);
    return null;
  }
  toast.success("Запись добавлена в реестр");
  return data;
}

export async function updateRegistryEntry(id: string, values: RegistryUpdate) {
  const supabase = createClient();
  const { error } = await supabase
    .from("shipment_registry")
    .update(values)
    .eq("id", id);
  if (error) {
    toast.error(`Ошибка: ${error.message}`);
    throw error;
  }
  return true;
}

export async function bulkInsertRegistry(records: RegistryInsert[]) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shipment_registry")
    .insert(records)
    .select();

  if (error) {
    toast.error(`Ошибка импорта: ${error.message}`);
    return null;
  }
  toast.success(`Импортировано ${data?.length ?? 0} записей`);
  return data;
}

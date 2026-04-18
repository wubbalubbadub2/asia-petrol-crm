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
  deal?: { deal_code: string; currency: string | null } | null;
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
  deal:deals(deal_code, currency),
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
    setLoading(true);
    const { data, error } = await supabase
      .from("shipment_registry")
      .select(REG_SELECT)
      .eq("registry_type", type)
      .order("date", { ascending: false })
      .limit(500);

    if (error) {
      toast.error(`Ошибка загрузки реестра: ${error.message}`);
    } else {
      setData((data ?? []) as ShipmentRecord[]);
    }
    setLoading(false);
  }, [supabase, type]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}

import type { TablesInsert, TablesUpdate } from "@/lib/types/database";

type RegistryInsert = TablesInsert<"shipment_registry">;
type RegistryUpdate = TablesUpdate<"shipment_registry">;

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

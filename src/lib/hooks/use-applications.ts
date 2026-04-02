"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export type Application = {
  id: string;
  application_number: string | null;
  date: string;
  fuel_type_id: string | null;
  product_name: string | null;
  tonnage: number | null;
  destination_station_id: string | null;
  station_code: string | null;
  consignee_name: string | null;
  consignee_bin: string | null;
  consignor: string | null;
  carrier: string | null;
  is_ordered: boolean;
  assigned_manager_id: string | null;
  pdf_file_path: string | null;
  source_email: string | null;
  created_at: string;
  // Joined
  fuel_type?: { name: string; color: string } | null;
  destination_station?: { name: string } | null;
  assigned_manager?: { full_name: string } | null;
};

const APP_SELECT = `
  *,
  fuel_type:fuel_types(name, color),
  destination_station:stations!destination_station_id(name),
  assigned_manager:profiles!assigned_manager_id(full_name)
`;

export function useApplications() {
  const [data, setData] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("applications")
      .select(APP_SELECT)
      .order("date", { ascending: false });

    if (error) {
      toast.error(`Ошибка загрузки заявок: ${error.message}`);
    } else {
      setData((data ?? []) as Application[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}

export async function createApplication(values: Record<string, unknown>) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("applications")
    .insert(values)
    .select()
    .single();

  if (error) {
    toast.error(`Ошибка создания заявки: ${error.message}`);
    return null;
  }
  toast.success("Заявка создана");
  return data;
}

export async function updateApplication(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const { error } = await supabase.from("applications").update(values).eq("id", id);
  if (error) {
    toast.error(`Ошибка: ${error.message}`);
    return false;
  }
  return true;
}

export async function toggleOrdered(id: string, currentValue: boolean) {
  const supabase = createClient();
  const { error } = await supabase
    .from("applications")
    .update({ is_ordered: !currentValue })
    .eq("id", id);
  if (error) {
    toast.error(`Ошибка: ${error.message}`);
    return false;
  }
  toast.success(!currentValue ? "Заявка отмечена как заявлено" : "Заявка отмечена как не заявлено");
  return true;
}

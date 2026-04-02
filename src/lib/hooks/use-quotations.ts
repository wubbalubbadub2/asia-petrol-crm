"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export type QuotationProductType = {
  id: string;
  fuel_type_id: string;
  name: string;
  sub_name: string | null;
  basis: string | null;
  sort_order: number;
};

export type Quotation = {
  id: string;
  product_type_id: string;
  date: string;
  price: number | null;
  price_fob_med: number | null;
  price_fob_rotterdam: number | null;
  price_cif_nwe: number | null;
  comment: string | null;
};

export type MonthlyAverage = {
  id: string;
  product_type_id: string;
  year: number;
  month: number;
  avg_price: number | null;
  avg_fob_med: number | null;
  avg_fob_rotterdam: number | null;
  avg_cif_nwe: number | null;
  avg_combined: number | null;
};

export function useQuotationProductTypes() {
  const [data, setData] = useState<QuotationProductType[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("quotation_product_types")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      toast.error(`Ошибка загрузки типов котировок: ${error.message}`);
    } else {
      setData((data ?? []) as QuotationProductType[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}

export function useQuotations(year: number, month: number) {
  const [data, setData] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

    const { data, error } = await supabase
      .from("quotations")
      .select("*")
      .gte("date", startDate)
      .lt("date", endDate)
      .order("date", { ascending: true });

    if (error) {
      toast.error(`Ошибка загрузки котировок: ${error.message}`);
    } else {
      setData((data ?? []) as Quotation[]);
    }
    setLoading(false);
  }, [supabase, year, month]);

  useEffect(() => { load(); }, [load]);

  async function upsert(
    productTypeId: string,
    date: string,
    field: string,
    value: number | null
  ) {
    const existing = data.find(
      (q) => q.product_type_id === productTypeId && q.date === date
    );

    if (existing) {
      const { error } = await supabase
        .from("quotations")
        .update({ [field]: value })
        .eq("id", existing.id);
      if (error) {
        toast.error(`Ошибка сохранения: ${error.message}`);
        return;
      }
    } else {
      const { error } = await supabase
        .from("quotations")
        .insert({ product_type_id: productTypeId, date, [field]: value });
      if (error) {
        toast.error(`Ошибка добавления: ${error.message}`);
        return;
      }
    }
    await load();
  }

  return { data, loading, reload: load, upsert };
}

export function useMonthlyAverages(year: number) {
  const [data, setData] = useState<MonthlyAverage[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("quotation_monthly_averages")
      .select("*")
      .eq("year", year)
      .order("month", { ascending: true });

    if (error) {
      toast.error(`Ошибка загрузки средних: ${error.message}`);
    } else {
      setData((data ?? []) as MonthlyAverage[]);
    }
    setLoading(false);
  }, [supabase, year]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}

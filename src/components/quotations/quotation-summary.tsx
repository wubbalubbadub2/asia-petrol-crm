"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ProductType = { id: string; name: string; sub_name: string | null };
type MonthlyAvg = {
  product_type_id: string;
  year: number;
  month: number;
  avg_price: number | null;
};
type DailyQuotation = {
  product_type_id: string;
  date: string;
  price: number | null;
  price_fob_med: number | null;
  price_fob_rotterdam: number | null;
  price_cif_nwe: number | null;
};

export function QuotationSummary() {
  const sbRef = useRef(createClient());
  const [year, setYear] = useState(new Date().getFullYear());
  const [triggerDays, setTriggerDays] = useState(35);
  const [fixedDay, setFixedDay] = useState(15);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [averages, setAverages] = useState<MonthlyAvg[]>([]);
  const [dailyQuotes, setDailyQuotes] = useState<DailyQuotation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [{ data: types }, { data: avgs }, { data: daily }] = await Promise.all([
        sbRef.current
          .from("quotation_product_types")
          .select("id, name, sub_name")
          .eq("is_active", true)
          .order("sort_order"),
        sbRef.current
          .from("quotation_monthly_averages")
          .select("product_type_id, year, month, avg_price")
          .eq("year", year)
          .order("month"),
        sbRef.current
          .from("quotations")
          .select("product_type_id, date, price, price_fob_med, price_fob_rotterdam, price_cif_nwe")
          .gte("date", `${year}-01-01`)
          .lte("date", `${year}-12-31`)
          .order("date"),
      ]);
      setProductTypes((types ?? []) as ProductType[]);
      setAverages((avgs ?? []) as MonthlyAvg[]);
      setDailyQuotes((daily ?? []) as DailyQuotation[]);
      setLoading(false);
    }
    load();
  }, [year]);

  // Monthly average from pre-computed table
  const getAvg = useCallback((ptId: string, month: number): number | null => {
    return averages.find(
      (a) => a.product_type_id === ptId && a.month === month
    )?.avg_price ?? null;
  }, [averages]);

  // Fixed date price: quotation on the fixedDay of the month
  const getFixed = useCallback((ptId: string, month: number): number | null => {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(fixedDay).padStart(2, "0")}`;
    const q = dailyQuotes.find(
      (d) => d.product_type_id === ptId && d.date === dateStr
    );
    if (!q) return null;
    return q.price ?? q.price_cif_nwe ?? q.price_fob_rotterdam ?? q.price_fob_med;
  }, [dailyQuotes, year, fixedDay]);

  // Trigger: average over triggerDays starting from 1st of the month
  const getTrigger = useCallback((ptId: string, month: number): number | null => {
    const start = new Date(year, month - 1, 1);
    const end = new Date(start);
    end.setDate(end.getDate() + triggerDays);
    const startStr = start.toISOString().split("T")[0];
    const endStr = end.toISOString().split("T")[0];

    const prices = dailyQuotes
      .filter((d) => d.product_type_id === ptId && d.date >= startStr && d.date <= endStr)
      .map((d) => d.price ?? d.price_cif_nwe ?? d.price_fob_rotterdam ?? d.price_fob_med)
      .filter((p): p is number => p != null);

    if (prices.length === 0) return null;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }, [dailyQuotes, year, triggerDays]);

  function getYearAvg(ptId: string): number | null {
    const vals = averages
      .filter((a) => a.product_type_id === ptId && a.avg_price != null)
      .map((a) => a.avg_price!);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  function fmtNum(val: number | null): string {
    if (val == null) return "";
    return val.toFixed(2);
  }

  if (loading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Label className="text-[12px]">Год:</Label>
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-20 h-8 text-[13px]" />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-[12px]">Фикс день:</Label>
          <Input type="number" min={1} max={31} value={fixedDay} onChange={(e) => setFixedDay(Number(e.target.value))} className="w-16 h-8 text-[13px]" />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-[12px]">Тригер дней:</Label>
          <Input type="number" min={1} max={90} value={triggerDays} onChange={(e) => setTriggerDays(Number(e.target.value))} className="w-16 h-8 text-[13px]" />
        </div>
      </div>

      {productTypes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет типов котировок</p>
      ) : (
        <div className="overflow-x-auto border rounded-md bg-white">
          <table className="w-full border-collapse" style={{ fontSize: "10px" }}>
            <thead>
              {/* Month names row */}
              <tr className="bg-stone-50 border-b">
                <th rowSpan={2} className="sticky left-0 z-10 bg-stone-50 border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[140px]">
                  Продукт
                </th>
                {MONTHS_RU.map((m, i) => (
                  <th key={i} colSpan={3} className="border-r px-0.5 py-1 text-center font-medium text-stone-600">
                    {m.slice(0, 3)}
                  </th>
                ))}
                <th rowSpan={2} className="px-2 py-1.5 text-center font-medium text-amber-700 bg-amber-50/50 min-w-[50px]">
                  Год
                </th>
              </tr>
              {/* Sub-headers row */}
              <tr className="bg-stone-50/50 border-b">
                {Array.from({ length: 12 }).map((_, i) => (
                  <React.Fragment key={i}>
                    <th className="px-0.5 py-0.5 text-center font-normal text-stone-400 min-w-[42px] border-r border-stone-100">Ср</th>
                    <th className="px-0.5 py-0.5 text-center font-normal text-stone-400 min-w-[42px] border-r border-stone-100">Фикс</th>
                    <th className="px-0.5 py-0.5 text-center font-normal text-blue-400 min-w-[42px] border-r">Тр</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {productTypes.map((pt) => (
                <tr key={pt.id} className="border-b hover:bg-amber-50/20">
                  <td
                    className="sticky left-0 z-10 bg-white border-r px-2 py-1 font-medium text-stone-700"
                    title={pt.sub_name ? `${pt.name} — ${pt.sub_name}` : pt.name}
                  >
                    <div className="truncate max-w-[140px]">{pt.name}</div>
                  </td>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <React.Fragment key={m}>
                      <td className="px-0.5 py-1 text-right font-mono tabular-nums text-stone-600 border-r border-stone-100">
                        {fmtNum(getAvg(pt.id, m))}
                      </td>
                      <td className="px-0.5 py-1 text-right font-mono tabular-nums text-stone-500 border-r border-stone-100">
                        {fmtNum(getFixed(pt.id, m))}
                      </td>
                      <td className="px-0.5 py-1 text-right font-mono tabular-nums text-blue-600 border-r">
                        {fmtNum(getTrigger(pt.id, m))}
                      </td>
                    </React.Fragment>
                  ))}
                  <td className="px-1 py-1 text-right font-mono tabular-nums font-medium text-amber-800 bg-amber-50/30">
                    {fmtNum(getYearAvg(pt.id))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// React.Fragment needs React import
import React from "react";

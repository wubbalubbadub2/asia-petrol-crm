"use client";

import { useState, useEffect } from "react";
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

export function QuotationSummary() {
  const supabase = createClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [averages, setAverages] = useState<MonthlyAvg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [{ data: types }, { data: avgs }] = await Promise.all([
        supabase
          .from("quotation_product_types")
          .select("id, name, sub_name")
          .eq("is_active", true)
          .order("sort_order"),
        supabase
          .from("quotation_monthly_averages")
          .select("product_type_id, year, month, avg_price")
          .eq("year", year)
          .order("month"),
      ]);
      setProductTypes((types ?? []) as ProductType[]);
      setAverages((avgs ?? []) as MonthlyAvg[]);
      setLoading(false);
    }
    load();
  }, [year, supabase]);

  function getAvg(ptId: string, month: number): number | null {
    return averages.find(
      (a) => a.product_type_id === ptId && a.month === month
    )?.avg_price ?? null;
  }

  function getYearAvg(ptId: string): number | null {
    const vals = averages
      .filter((a) => a.product_type_id === ptId && a.avg_price != null)
      .map((a) => a.avg_price!);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  if (loading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-[12px]">Год:</Label>
        <Input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="w-24 h-8 text-[13px]"
        />
      </div>

      {productTypes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет типов котировок</p>
      ) : (
        <div className="overflow-x-auto border rounded-md bg-white">
          <table className="w-full border-collapse" style={{ fontSize: "11px" }}>
            <thead>
              <tr className="bg-stone-50 border-b">
                <th className="sticky left-0 z-10 bg-stone-50 border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[160px]">
                  Продукт
                </th>
                {MONTHS_RU.map((m, i) => (
                  <th
                    key={i}
                    className="border-r px-2 py-1.5 text-center font-medium text-stone-600 min-w-[65px]"
                  >
                    {m.slice(0, 3)}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-center font-medium text-amber-700 bg-amber-50/50 min-w-[65px]">
                  Год
                </th>
              </tr>
            </thead>
            <tbody>
              {productTypes.map((pt) => (
                <tr key={pt.id} className="border-b hover:bg-amber-50/20">
                  <td
                    className="sticky left-0 z-10 bg-white border-r px-2 py-1 font-medium text-stone-700"
                    title={pt.sub_name ? `${pt.name} — ${pt.sub_name}` : pt.name}
                  >
                    <div className="truncate max-w-[160px]">{pt.name}</div>
                  </td>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                    const avg = getAvg(pt.id, m);
                    return (
                      <td
                        key={m}
                        className="border-r px-1 py-1 text-right font-mono tabular-nums text-stone-600"
                      >
                        {avg != null ? avg.toFixed(2) : ""}
                      </td>
                    );
                  })}
                  <td className="px-1 py-1 text-right font-mono tabular-nums font-medium text-amber-800 bg-amber-50/30">
                    {getYearAvg(pt.id)?.toFixed(2) ?? ""}
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

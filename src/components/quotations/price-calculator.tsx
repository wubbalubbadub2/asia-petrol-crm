"use client";

import { useState, useEffect, useCallback } from "react";
import { Calculator } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  type PriceMode,
  calculatePrice,
  getDateRange,
} from "@/lib/calculations/price-formation";
import { MONTHS_RU } from "@/lib/constants/months-ru";

type ProductType = { id: string; name: string; sub_name: string | null };

const MODES: { value: PriceMode; label: string }[] = [
  { value: "average_month", label: "Средний месяц" },
  { value: "fixed", label: "Фикс цена на дату" },
  { value: "trigger", label: "Триггер" },
];

export function PriceCalculator() {
  const supabase = createClient();
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [mode, setMode] = useState<PriceMode>("average_month");
  const [discount, setDiscount] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [fixedDate, setFixedDate] = useState("");
  const [triggerDate, setTriggerDate] = useState("");
  const [triggerDays, setTriggerDays] = useState(35);

  // Result
  const [quotation, setQuotation] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    supabase
      .from("quotation_product_types")
      .select("id, name, sub_name")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        if (data) {
          setProductTypes(data);
          if (data.length > 0) setSelectedType(data[0].id);
        }
      });
  }, [supabase]);

  const calculate = useCallback(async () => {
    if (!selectedType) return;
    setCalculating(true);

    if (mode === "average_month") {
      const { data } = await supabase
        .from("quotation_monthly_averages")
        .select("avg_price")
        .eq("product_type_id", selectedType)
        .eq("year", year)
        .eq("month", month)
        .single();

      const result = calculatePrice({
        mode,
        discount,
        monthlyAverage: data?.avg_price ?? null,
      });
      setQuotation(result.quotation);
      setPrice(result.price);
    } else if (mode === "fixed") {
      if (!fixedDate) { setCalculating(false); return; }
      const { data } = await supabase
        .from("quotations")
        .select("price")
        .eq("product_type_id", selectedType)
        .eq("date", fixedDate)
        .single();

      const result = calculatePrice({
        mode,
        discount,
        fixedDatePrice: data?.price ?? null,
      });
      setQuotation(result.quotation);
      setPrice(result.price);
    } else if (mode === "trigger") {
      if (!triggerDate) { setCalculating(false); return; }
      const range = getDateRange(triggerDate, triggerDays);
      const { data } = await supabase
        .from("quotations")
        .select("price")
        .eq("product_type_id", selectedType)
        .gte("date", range.start)
        .lte("date", range.end)
        .not("price", "is", null);

      const prices = (data ?? []).map((d) => d.price).filter((p): p is number => p != null);
      const result = calculatePrice({
        mode,
        discount,
        triggerPrices: prices,
        triggerDays,
      });
      setQuotation(result.quotation);
      setPrice(result.price);
    }
    setCalculating(false);
  }, [selectedType, mode, discount, year, month, fixedDate, triggerDate, triggerDays, supabase]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="h-4 w-4 text-amber-600" />
          Формирование цены
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Product type */}
        <div>
          <Label className="text-[12px]">Тип котировки</Label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none"
          >
            {productTypes.map((pt) => (
              <option key={pt.id} value={pt.id}>
                {pt.name}{pt.sub_name ? ` — ${pt.sub_name}` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Mode */}
        <div>
          <Label className="text-[12px]">Условие фиксации</Label>
          <div className="flex gap-1 mt-1">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  mode === m.value
                    ? "bg-amber-100 text-amber-800 border border-amber-300"
                    : "bg-stone-50 text-stone-500 border border-stone-200 hover:bg-stone-100"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mode-specific inputs */}
        {mode === "average_month" && (
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-[12px]">Месяц</Label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px]"
              >
                {MONTHS_RU.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="w-20">
              <Label className="text-[12px]">Год</Label>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="h-8 text-[13px]"
              />
            </div>
          </div>
        )}

        {mode === "fixed" && (
          <div>
            <Label className="text-[12px]">Дата фиксации</Label>
            <Input
              type="date"
              value={fixedDate}
              onChange={(e) => setFixedDate(e.target.value)}
              className="h-8 text-[13px]"
            />
          </div>
        )}

        {mode === "trigger" && (
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-[12px]">Дата начала</Label>
              <Input
                type="date"
                value={triggerDate}
                onChange={(e) => setTriggerDate(e.target.value)}
                className="h-8 text-[13px]"
              />
            </div>
            <div className="w-20">
              <Label className="text-[12px]">Дней</Label>
              <Input
                type="number"
                value={triggerDays}
                onChange={(e) => setTriggerDays(Number(e.target.value))}
                className="h-8 text-[13px]"
                min={1}
                max={90}
              />
            </div>
          </div>
        )}

        {/* Discount */}
        <div>
          <Label className="text-[12px]">Скидка ($/тонна)</Label>
          <Input
            type="number"
            step="0.01"
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value))}
            className="h-8 text-[13px] font-mono"
          />
        </div>

        <Button onClick={calculate} disabled={calculating} size="sm" className="w-full">
          {calculating ? "Расчёт..." : "Рассчитать цену"}
        </Button>

        {/* Result */}
        {(quotation != null || price != null) && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
            <div className="flex justify-between text-[12px] text-stone-600">
              <span>Котировка</span>
              <span className="font-mono tabular-nums font-medium">
                {quotation != null ? `$${quotation.toFixed(2)}` : "нет данных"}
              </span>
            </div>
            <div className="flex justify-between text-[12px] text-stone-600">
              <span>Скидка</span>
              <span className="font-mono tabular-nums">
                − ${discount.toFixed(2)}
              </span>
            </div>
            <div className="border-t border-amber-300 pt-1 flex justify-between text-[13px] font-medium text-amber-900">
              <span>Цена за тонну</span>
              <span className="font-mono tabular-nums">
                {price != null ? `$${price.toFixed(2)}` : "—"}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

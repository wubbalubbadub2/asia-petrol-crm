"use client";
// Страница отчёта «Сбор по валюте» (Task 7 спеки) — склейка готовых слоёв:
// useDeals (сеть, год/архив) → usePassportFilters (клиентские фильтры,
// один в один как в паспорте) → useFxCollection (конвертация валют,
// без сети при смене ₸/$) → CollectionTable (рендер). Кнопка Excel
// выгружает формат «Паспорт Детальный» в выбранной валюте.
import { useState } from "react";
import { useQueryState, parseAsInteger, parseAsStringEnum } from "nuqs";
import { useDeals } from "@/lib/hooks/use-deals";
import { usePassportFilters } from "@/components/reports/passport-filters";
import { useFxCollection } from "@/lib/hooks/use-fx-collection";
import { CollectionTable } from "@/components/reports/collection-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const CURRENT_YEAR = new Date().getFullYear();

export default function CollectionReportPage() {
  const [tab, setTab] = useQueryState("tab",
    parseAsStringEnum(["kg", "kz", "all"]).withDefault("kg"));
  const [currency, setCurrency] = useQueryState("cur",
    parseAsStringEnum(["KZT", "USD"]).withDefault("KZT"));
  const [year, setYear] = useQueryState("year",
    parseAsInteger.withDefault(CURRENT_YEAR));

  // Только year/isArchived уходят в сеть (см. DealFilters в use-deals.ts) —
  // остальные оси (dealType и т.д.) фильтруются клиентски ниже.
  const { data: deals, loading: dealsLoading } = useDeals({ year, isArchived: false });
  const dealType = tab === "kg" ? "KG" : tab === "kz" ? "KZ" : null;
  const { filtered, activeFilterCount, clearAll, bar } = usePassportFilters(deals, dealType);
  const { rows, loading: fxLoading, error } = useFxCollection(filtered, currency);

  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const [{ exportPassportDetailToExcel }, { fetchFxRatesRange }] = await Promise.all([
        import("@/lib/exports/passport-detail-excel"),
        import("@/lib/data/deal-events"),
      ]);
      const rates = await fetchFxRatesRange("2025-01-01", new Date().toISOString().slice(0, 10));
      // ExportContext = { dealType: "KG" | "KZ" | "ALL"; year: number }
      // (см. src/lib/exports/passport-excel.ts:180) — вкладка «Все»
      // маппится в "ALL".
      await exportPassportDetailToExcel(
        filtered,
        { dealType: dealType ?? "ALL", year },
        { variant: "detail", fx: { target: currency, rates } },
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Сбор по валюте</h1>
        <Button size="sm" variant="outline" disabled={exporting || filtered.length === 0}
                onClick={handleExport} className="h-8 text-xs">
          {exporting ? "Выгрузка…" : "Excel"}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded border border-stone-200 bg-white overflow-hidden">
          {(["kg", "kz", "all"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${tab === t ? "bg-amber-500 text-white" : "text-stone-600 hover:bg-stone-50"}`}>
              {t === "kg" ? "KG (Экспорт)" : t === "kz" ? "KZ (Внутренний)" : "Все"}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded border border-stone-200 bg-white overflow-hidden">
          {(["KZT", "USD"] as const).map((c) => (
            <button key={c} onClick={() => setCurrency(c)}
              className={`px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${currency === c ? "bg-amber-500 text-white" : "text-stone-600 hover:bg-stone-50"}`}>
              {c === "KZT" ? "₸ тенге" : "$ доллар"}
            </button>
          ))}
        </div>

        <div className="grid gap-1">
          <Label className="text-[11px] text-stone-500">Год</Label>
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
                 className="w-24 h-8 text-[12px]" />
        </div>

        <span className="ml-auto text-[11px] text-stone-400">
          {rows.length} сделок{activeFilterCount > 0 ? ` · фильтров: ${activeFilterCount}` : ""}
        </span>
      </div>

      {bar}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600">
          Ошибка: {error}
        </div>
      )}
      {dealsLoading || fxLoading
        ? <p className="text-sm text-stone-500">Загрузка…</p>
        : <CollectionTable rows={rows} currency={currency} />}
    </div>
  );
}

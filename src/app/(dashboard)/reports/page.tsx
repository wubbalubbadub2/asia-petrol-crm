"use client";
import { useEffect, useMemo, useState } from "react";
import { FLOW_METRICS, fetchFlows, fetchPrice, type FlowRow, type PriceRow } from "@/lib/hooks/use-fx-reports";
import { FlowReport } from "@/components/reports/flow-report";
import { PriceReport } from "@/components/reports/price-report";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

const REPORTS = [...FLOW_METRICS, { key: "price", label: "Цена (по СНТ)" }] as const;

// Тип отчёта выводится из REPORTS (а не bare string) — опечатка в ключе
// теперь ошибка компиляции, а не тихое «нет данных» на проде.
type ReportKey = (typeof REPORTS)[number]["key"];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

export default function ReportsPage() {
  const [report, setReport] = useState<ReportKey>("supply_in");
  // Отчёты агрегируются помесячно → выбираем ГОД, а не диапазон дней
  // (day-picker для помесячного отчёта сбивал с толку). Период = весь год.
  const [year, setYear] = useState(CURRENT_YEAR);
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [prices, setPrices] = useState<PriceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isPrice = report === "price";
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const load = isPrice
      ? fetchPrice(from, to).then((d) => { if (alive) setPrices(d); })
      : fetchFlows(from, to).then((d) => { if (alive) setFlows(d); });
    load.catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [report, from, to, isPrice]);

  const flowRows = useMemo(() => (flows ?? []).filter((r) => r.metric === report), [flows, report]);
  const reportLabel = REPORTS.find((r) => r.key === report)?.label ?? report;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-stone-900">Отчёты</h1>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <div className="grid gap-1.5">
            <Label className="text-[12px] text-stone-500">Отчёт</Label>
            <Select value={report} onValueChange={(v) => setReport(v as ReportKey)}>
              <SelectTrigger className="w-64">
                <span className="truncate">{reportLabel}</span>
              </SelectTrigger>
              <SelectContent>
                {REPORTS.map((r) => (
                  <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-[12px] text-stone-500">Год</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-32">
                <span className="truncate">{year}</span>
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600">
          Ошибка: {error}
        </div>
      )}
      {loading && <div className="text-[13px] text-stone-500">Загрузка…</div>}
      {!loading && !error && (isPrice
        ? <PriceReport rows={prices ?? []} />
        : <FlowReport metric={report} rows={flowRows} />)}
    </div>
  );
}

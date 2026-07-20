"use client";
import { useEffect, useMemo, useState } from "react";
import { FLOW_METRICS, fetchFlows, fetchPrice, type FlowRow, type PriceRow } from "@/lib/hooks/use-fx-reports";
import { FlowReport } from "@/components/reports/flow-report";
import { PriceReport } from "@/components/reports/price-report";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const REPORTS = [...FLOW_METRICS, { key: "price", label: "Цена (по СНТ)" }] as const;

// Тип отчёта выводится из REPORTS (а не bare string) — опечатка в ключе
// теперь ошибка компиляции, а не тихое «нет данных» на проде.
type ReportKey = (typeof REPORTS)[number]["key"];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReportsPage() {
  const [report, setReport] = useState<ReportKey>("supply_in");
  const [from, setFrom] = useState(() => ymd(new Date(new Date().getFullYear(), 0, 1)));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [prices, setPrices] = useState<PriceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isPrice = report === "price";

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

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-stone-900">Отчёты</h1>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-[12px] text-stone-500">Отчёт</Label>
          <Select value={report} onValueChange={(v) => setReport(v as ReportKey)}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORTS.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[12px] text-stone-500">С</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40 text-[13px]" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[12px] text-stone-500">По</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40 text-[13px]" />
        </div>
      </div>
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

"use client";
import { useEffect, useMemo, useState } from "react";
import { FLOW_METRICS, fetchFlows, fetchPrice, type FlowRow, type PriceRow } from "@/lib/hooks/use-fx-reports";
import { FlowReport } from "@/components/reports/flow-report";
import { PriceReport } from "@/components/reports/price-report";

const REPORTS = [...FLOW_METRICS, { key: "price", label: "Цена (по СНТ)" }] as const;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReportsPage() {
  const [report, setReport] = useState<string>("supply_in");
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
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">Отчёты</h1>
      <div className="flex flex-wrap items-center gap-2">
        <select value={report} onChange={(e) => setReport(e.target.value)} className="border rounded px-2 py-1 text-sm">
          {REPORTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <label className="text-sm">с <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1" /></label>
        <label className="text-sm">по <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1" /></label>
      </div>
      {error && <div className="text-sm text-red-600">Ошибка: {error}</div>}
      {loading && <div className="text-sm text-neutral-500">Загрузка…</div>}
      {!loading && !error && (isPrice
        ? <PriceReport rows={prices ?? []} />
        : <FlowReport metric={report} rows={flowRows} />)}
    </div>
  );
}

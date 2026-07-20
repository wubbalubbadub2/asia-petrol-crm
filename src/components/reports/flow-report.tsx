// src/components/reports/flow-report.tsx
import { FLOW_METRICS, type FlowRow } from "@/lib/hooks/use-fx-reports";
import { MONTHS_RU } from "@/lib/constants/months-ru";

const fmt = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 0 });

const monthLabel = (m: number) => MONTHS_RU[m - 1] ?? String(m);

export function FlowReport({ metric, rows }: { metric: string; rows: FlowRow[] }) {
  // Caption resolves the human-readable report label from FLOW_METRICS so
  // the user always sees which report + currencies they're looking at
  // (review note: tables lacked a caption).
  const label = FLOW_METRICS.find((m) => m.key === metric)?.label ?? metric;
  const caption = (
    <h2 className="text-[15px] font-semibold text-stone-900">
      {label} <span className="font-normal text-stone-400">· USD / KZT</span>
    </h2>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        {caption}
        <div className="text-[13px] text-stone-500">Нет данных за период.</div>
      </div>
    );
  }

  // Сортировка по (год, месяц, тип сделки).
  const sorted = [...rows].sort(
    (a, b) => a.year - b.year || a.month - b.month || a.deal_type.localeCompare(b.deal_type),
  );
  const totalUsd = rows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const totalKzt = rows.reduce((s, r) => s + (r.kzt ?? 0), 0);

  return (
    <div className="space-y-2">
      {caption}
      <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
        <table className="w-full border-collapse text-[11px]">
          <thead className="bg-stone-100 text-stone-500">
            <tr className="border-b border-stone-200">
              <th className="border-r border-stone-200 px-2 py-1.5 text-left font-medium">Период</th>
              <th className="border-r border-stone-200 px-2 py-1.5 text-left font-medium">Тип</th>
              <th className="border-r border-stone-200 px-2 py-1.5 text-right font-medium">USD</th>
              <th className="px-2 py-1.5 text-right font-medium">KZT</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={`${r.year}-${r.month}-${r.deal_type}-${i}`} className="border-b border-stone-100 hover:bg-stone-50">
                <td className="border-r border-stone-100 px-2 py-1 text-stone-700">{monthLabel(r.month)} {r.year}</td>
                <td className="border-r border-stone-100 px-2 py-1 text-stone-700">{r.deal_type}</td>
                <td className="border-r border-stone-100 px-2 py-1 text-right font-mono tabular-nums text-stone-700">{fmt(r.usd)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums text-stone-700">{fmt(r.kzt)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-stone-300 bg-stone-50 font-semibold text-stone-900">
              <td className="border-r border-stone-200 px-2 py-1.5" colSpan={2}>Итого</td>
              <td className="border-r border-stone-200 px-2 py-1.5 text-right font-mono tabular-nums">{fmt(totalUsd)}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(totalKzt)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

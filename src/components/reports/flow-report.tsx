// src/components/reports/flow-report.tsx
import { MONTHS_RU } from "@/lib/constants/months-ru";
import type { FlowRow } from "@/lib/hooks/use-fx-reports";

const fmt = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 0 });

const monthLabel = (m: number) => MONTHS_RU[m - 1] ?? String(m);

export function FlowReport({ metric, rows }: { metric: string; rows: FlowRow[] }) {
  void metric;
  if (rows.length === 0) return <div className="text-sm text-neutral-500">Нет данных за период.</div>;

  // Сортировка по (год, месяц, тип сделки).
  const sorted = [...rows].sort(
    (a, b) => a.year - b.year || a.month - b.month || a.deal_type.localeCompare(b.deal_type),
  );
  const totalUsd = rows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const totalKzt = rows.reduce((s, r) => s + (r.kzt ?? 0), 0);

  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="px-3 py-1.5">Период</th>
            <th className="px-3 py-1.5">Тип</th>
            <th className="px-3 py-1.5 text-right">USD</th>
            <th className="px-3 py-1.5 text-right">KZT</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={`${r.year}-${r.month}-${r.deal_type}-${i}`} className="border-b">
              <td className="px-3 py-1.5">{monthLabel(r.month)} {r.year}</td>
              <td className="px-3 py-1.5">{r.deal_type}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.usd)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.kzt)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <td className="px-3 py-1.5" colSpan={2}>Итого</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totalUsd)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totalKzt)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

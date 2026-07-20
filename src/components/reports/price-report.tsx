import type { PriceRow } from "@/lib/hooks/use-fx-reports";

const fmt = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export function PriceReport({ rows }: { rows: PriceRow[] }) {
  if (rows.length === 0) return <div className="text-sm text-neutral-500">Нет отгрузок за период.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="px-3 py-1.5">Сделка</th>
            <th className="px-3 py-1.5">Тип</th>
            <th className="px-3 py-1.5">Дата исх. СНТ</th>
            <th className="px-3 py-1.5">Дата вх. СНТ</th>
            <th className="px-3 py-1.5 text-right">Цена прих. USD</th>
            <th className="px-3 py-1.5 text-right">Цена прих. KZT</th>
            <th className="px-3 py-1.5 text-right">Цена исх. USD</th>
            <th className="px-3 py-1.5 text-right">Цена исх. KZT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.deal_code}-${i}`} className="border-b">
              <td className="px-3 py-1.5">{r.deal_code}</td>
              <td className="px-3 py-1.5">{r.deal_type}</td>
              <td className="px-3 py-1.5">{r.snt_date ?? "—"}</td>
              <td className="px-3 py-1.5">{r.loading_date ?? "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.supplier_price_usd)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.supplier_price_kzt)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.buyer_price_usd)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.buyer_price_kzt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

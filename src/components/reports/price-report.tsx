import type { PriceRow } from "@/lib/hooks/use-fx-reports";

const fmt = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export function PriceReport({ rows }: { rows: PriceRow[] }) {
  // Caption — this component only ever renders the one «Цена» report, so
  // the label is static (review note: tables lacked a caption).
  const caption = (
    <h2 className="text-[15px] font-semibold text-stone-900">
      Цена (по СНТ) <span className="font-normal text-stone-400">· USD / KZT</span>
    </h2>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        {caption}
        <div className="text-[13px] text-stone-500">Нет отгрузок за период.</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {caption}
      <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
        <table className="w-full border-collapse text-[11px]">
          <thead className="bg-stone-100 text-stone-500">
            <tr className="border-b border-stone-200">
              <th className="border-r border-stone-200 px-2 py-1.5 text-left font-medium">Сделка</th>
              <th className="border-r border-stone-200 px-2 py-1.5 text-left font-medium">Тип</th>
              <th className="border-r border-stone-200 px-2 py-1.5 text-left font-medium">Дата исх. СНТ</th>
              <th className="border-r border-stone-200 px-2 py-1.5 text-left font-medium">Дата вх. СНТ</th>
              <th className="border-r border-stone-200 px-2 py-1.5 text-right font-medium">Цена прих. USD</th>
              <th className="border-r border-stone-200 px-2 py-1.5 text-right font-medium">Цена прих. KZT</th>
              <th className="border-r border-stone-200 px-2 py-1.5 text-right font-medium">Цена исх. USD</th>
              <th className="px-2 py-1.5 text-right font-medium">Цена исх. KZT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.deal_code}-${i}`} className="border-b border-stone-100 hover:bg-stone-50">
                <td className="border-r border-stone-100 px-2 py-1 font-mono text-stone-700">{r.deal_code}</td>
                <td className="border-r border-stone-100 px-2 py-1 text-stone-700">{r.deal_type}</td>
                <td className="border-r border-stone-100 px-2 py-1 text-stone-500">{r.snt_date ?? "—"}</td>
                <td className="border-r border-stone-100 px-2 py-1 text-stone-500">{r.loading_date ?? "—"}</td>
                <td className="border-r border-stone-100 px-2 py-1 text-right font-mono tabular-nums text-stone-700">{fmt(r.supplier_price_usd)}</td>
                <td className="border-r border-stone-100 px-2 py-1 text-right font-mono tabular-nums text-stone-700">{fmt(r.supplier_price_kzt)}</td>
                <td className="border-r border-stone-100 px-2 py-1 text-right font-mono tabular-nums text-stone-700">{fmt(r.buyer_price_usd)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums text-stone-700">{fmt(r.buyer_price_kzt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

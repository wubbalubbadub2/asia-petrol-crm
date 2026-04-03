"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { type Deal, updateDeal } from "@/lib/hooks/use-deals";

function formatNum(val: number | null | undefined): string {
  if (val == null || val === 0) return "";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function FuelDot({ color }: { color?: string }) {
  return <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color ?? "#6B7280" }} />;
}

function EditableNumCell({
  value,
  dealId,
  field,
}: {
  value: number | null | undefined;
  dealId: string;
  field: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const pendingVal = useRef<number | null | undefined>(undefined);

  // What to display: if we have a pending save, show that; otherwise show the prop
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;

  // When the prop catches up to our pending value, clear the pending
  if (pendingVal.current !== undefined && value === pendingVal.current) {
    pendingVal.current = undefined;
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setLocalVal(shown?.toString() ?? ""); setEditing(true); }}
        className="w-full text-right font-mono text-[11px] tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[18px] min-w-[50px]"
      >
        {formatNum(shown)}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      step="0.01"
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const num = localVal.trim() === "" ? null : parseFloat(localVal);
        if (num !== value) {
          pendingVal.current = num; // Show new value immediately
          updateDeal(dealId, { [field]: num }).catch(() => { pendingVal.current = undefined; }); // Revert on error
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
      className="w-16 border border-amber-300 rounded px-1 py-0 text-[11px] font-mono text-right bg-amber-50/50 focus:outline-none focus:border-amber-500"
    />
  );
}

function EditableTextCell({
  value,
  dealId,
  field,
}: {
  value: string | null | undefined;
  dealId: string;
  field: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const pendingVal = useRef<string | null | undefined>(undefined);

  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) {
    pendingVal.current = undefined;
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setLocalVal(shown ?? ""); setEditing(true); }}
        className="w-full text-left text-[11px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[18px] truncate max-w-[100px]"
      >
        {shown ?? ""}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const newVal = localVal || null;
        if (newVal !== (value ?? null)) {
          pendingVal.current = newVal;
          updateDeal(dealId, { [field]: newVal }).catch(() => { pendingVal.current = undefined; });
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
      className="w-20 border border-amber-400 rounded px-1 py-0 text-[11px] bg-amber-50 focus:outline-none"
    />
  );
}

type PassportTableProps = {
  deals: Deal[];
  loading: boolean;
  dealType: "KG" | "KZ";
  onDataChanged: () => void;
};

export function PassportTable({ deals, loading, dealType, onDataChanged }: PassportTableProps) {
  const currency = dealType === "KZ" ? "₸" : "$";

  if (loading) return <p className="text-sm text-muted-foreground py-4">Загрузка паспорта...</p>;

  if (deals.length === 0) {
    return (
      <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
        <p className="text-sm text-stone-500">Нет сделок типа {dealType}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
      <table className="w-max border-collapse" style={{ fontSize: "11px" }}>
        <thead>
          <tr className="bg-stone-100 border-b">
            <th colSpan={5} className="border-r border-stone-300 px-2 py-1 text-center text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
              Сделка
            </th>
            <th colSpan={7} className="border-r border-stone-300 px-2 py-1 text-center text-[10px] font-semibold text-amber-700 uppercase tracking-wider bg-amber-50/50">
              Поставщик
            </th>
            <th colSpan={2} className="border-r border-stone-300 px-2 py-1 text-center text-[10px] font-semibold text-purple-700 uppercase tracking-wider bg-purple-50/50">
              Группы компании
            </th>
            <th colSpan={8} className="border-r border-stone-300 px-2 py-1 text-center text-[10px] font-semibold text-blue-700 uppercase tracking-wider bg-blue-50/50">
              Покупатель
            </th>
            <th colSpan={5} className="px-2 py-1 text-center text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
              Логистика
            </th>
          </tr>
          <tr className="bg-stone-50 border-b">
            {/* Identity */}
            <th className="sticky left-0 z-20 bg-stone-50 border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">№</th>
            <th className="sticky left-[70px] z-20 bg-stone-50 border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[60px]">Месяц</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">Завод</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px]">ГСМ</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-left font-medium text-stone-600 min-w-[50px]">% S</th>
            {/* Supplier */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[120px] bg-amber-50/30">Поставщик</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px] bg-amber-50/30">Договор</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-amber-50/30">Объем</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-amber-50/30">Цена</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[90px] bg-amber-50/30">Отгружено {currency}</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[90px] bg-amber-50/30">Оплата {currency}</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-600 min-w-[80px] bg-amber-50/30">Баланс</th>
            {/* Company groups — between supplier and buyer */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[120px] bg-purple-50/30">Компания</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-purple-50/30">Цена гр.</th>
            {/* Buyer */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[120px] bg-blue-50/30">Покупатель</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px] bg-blue-50/30">Договор</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Объем</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Цена</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Заявлено</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Отгружено</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[90px] bg-blue-50/30">Оплата {currency}</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-600 min-w-[80px] bg-blue-50/30">Долг</th>
            {/* Logistics */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[100px]">Экспедитор</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[60px]">Тариф</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px]">Факт объем</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[80px]">Сумма СФ</th>
            <th className="px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px]">Менеджер</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-b hover:bg-amber-50/20">
              {/* Identity (frozen, read-only) */}
              <td className="sticky left-0 z-10 bg-white border-r px-2 py-1 font-mono font-medium">
                <Link href={`/deals/${deal.id}`} className="text-amber-600 underline decoration-amber-300 hover:decoration-amber-500 hover:text-amber-800 transition-colors">{deal.deal_code}</Link>
              </td>
              <td className="sticky left-[70px] z-10 bg-white border-r px-2 py-1 text-stone-600">{deal.month}</td>
              <td className="border-r px-2 py-1 text-stone-600">{deal.factory?.name ?? ""}</td>
              <td className="border-r px-2 py-1">
                {deal.fuel_type ? (
                  <span className="inline-flex items-center gap-1">
                    <FuelDot color={deal.fuel_type.color} />
                    <span className="text-stone-700">{deal.fuel_type.name}</span>
                  </span>
                ) : ""}
              </td>
              <td className="border-r border-stone-300 px-2 py-1 text-stone-500">{deal.sulfur_percent ?? ""}</td>

              {/* Supplier (editable) */}
              <td className="border-r px-2 py-1 text-stone-700 bg-amber-50/10 truncate max-w-[120px]">{deal.supplier?.short_name ?? ""}</td>
              <td className="border-r px-1 py-0.5 bg-amber-50/10">
                <EditableTextCell value={deal.supplier_contract} dealId={deal.id} field="supplier_contract" onSaved={onDataChanged} />
              </td>
              <td className="border-r px-1 py-0.5 bg-amber-50/10">
                <EditableNumCell value={deal.supplier_contracted_volume} dealId={deal.id} field="supplier_contracted_volume" onSaved={onDataChanged} />
              </td>
              <td className="border-r px-1 py-0.5 bg-amber-50/10">
                <EditableNumCell value={deal.supplier_price} dealId={deal.id} field="supplier_price" onSaved={onDataChanged} />
              </td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10">{formatNum(deal.supplier_shipped_amount)}</td>
              <td className="border-r px-1 py-0.5 bg-amber-50/10">
                <EditableNumCell value={deal.supplier_payment} dealId={deal.id} field="supplier_payment" onSaved={onDataChanged} />
              </td>
              <td className="border-r border-stone-300 px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10">{formatNum(deal.supplier_balance)}</td>

              {/* Company groups — between supplier and buyer */}
              <td className="border-r px-2 py-1 text-[10px] text-stone-700 bg-purple-50/10 max-w-[120px]">
                {deal.deal_company_groups?.sort((a, b) => a.position - b.position).map((cg) => (
                  <div key={cg.id} className="truncate">{cg.company_group?.name ?? ""}</div>
                )) ?? ""}
              </td>
              <td className="border-r border-stone-300 px-2 py-1 text-right font-mono text-[10px] tabular-nums bg-purple-50/10">
                {deal.deal_company_groups?.sort((a, b) => a.position - b.position).map((cg) => (
                  <div key={cg.id}>{cg.price != null ? formatNum(cg.price) : ""}</div>
                )) ?? ""}
              </td>

              {/* Buyer (editable) */}
              <td className="border-r px-2 py-1 text-stone-700 bg-blue-50/10 truncate max-w-[120px]">{deal.buyer?.short_name ?? ""}</td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10">
                <EditableTextCell value={deal.buyer_contract} dealId={deal.id} field="buyer_contract" onSaved={onDataChanged} />
              </td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10">
                <EditableNumCell value={deal.buyer_contracted_volume} dealId={deal.id} field="buyer_contracted_volume" onSaved={onDataChanged} />
              </td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10">
                <EditableNumCell value={deal.buyer_price} dealId={deal.id} field="buyer_price" onSaved={onDataChanged} />
              </td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10">
                <EditableNumCell value={deal.buyer_ordered_volume} dealId={deal.id} field="buyer_ordered_volume" onSaved={onDataChanged} />
              </td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10">{formatNum(deal.buyer_shipped_volume)}</td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10">
                <EditableNumCell value={deal.buyer_payment} dealId={deal.id} field="buyer_payment" onSaved={onDataChanged} />
              </td>
              <td className="border-r border-stone-300 px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10">{formatNum(deal.buyer_debt)}</td>

              {/* Logistics */}

              {/* Logistics */}
              <td className="border-r px-2 py-1 text-stone-600 truncate max-w-[100px]">{deal.forwarder?.name ?? ""}</td>
              <td className="border-r px-1 py-0.5">
                <EditableNumCell value={deal.planned_tariff} dealId={deal.id} field="planned_tariff" onSaved={onDataChanged} />
              </td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums">{formatNum(deal.actual_shipped_volume)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums">{formatNum(deal.invoice_amount)}</td>
              <td className="px-2 py-1 text-stone-500">{deal.supplier_manager?.full_name ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

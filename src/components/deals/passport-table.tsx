"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { type Deal, updateDeal } from "@/lib/hooks/use-deals";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

function formatNum(val: number | null | undefined): string {
  if (val == null || val === 0) return "";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function FuelDot({ color }: { color?: string }) {
  return <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color ?? "#6B7280" }} />;
}

function EditableNumCell({ value, dealId, field, onSaved }: {
  value: number | null | undefined; dealId: string; field: string; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const pendingVal = useRef<number | null | undefined>(undefined);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) pendingVal.current = undefined;
  if (!editing) return (
    <button onClick={() => { setLocalVal(shown?.toString() ?? ""); setEditing(true); }}
      className="w-full text-right font-mono text-[11px] tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[18px] min-w-[50px]">
      {formatNum(shown)}
    </button>
  );
  return (
    <input autoFocus type="number" step="0.01" value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => { setEditing(false); const num = localVal.trim() === "" ? null : parseFloat(localVal); if (num !== value) { pendingVal.current = num; updateDeal(dealId, { [field]: num }).catch(() => { pendingVal.current = undefined; }); } }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-16 border border-amber-300 rounded px-1 py-0 text-[11px] font-mono text-right bg-amber-50/50 focus:outline-none focus:border-amber-500" />
  );
}

function EditableTextCell({ value, dealId, field, onSaved }: {
  value: string | null | undefined; dealId: string; field: string; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const pendingVal = useRef<string | null | undefined>(undefined);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) pendingVal.current = undefined;
  if (!editing) return (
    <button onClick={() => { setLocalVal(shown ?? ""); setEditing(true); }}
      className="w-full text-left text-[11px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[18px] truncate max-w-[100px]">
      {shown ?? ""}
    </button>
  );
  return (
    <input autoFocus value={localVal} onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => { setEditing(false); const nv = localVal || null; if (nv !== (value ?? null)) { pendingVal.current = nv; updateDeal(dealId, { [field]: nv }).catch(() => { pendingVal.current = undefined; }); } }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-20 border border-amber-400 rounded px-1 py-0 text-[11px] bg-amber-50 focus:outline-none" />
  );
}

// Editable company group price
function EditableCGPrice({ cgId, value, onSaved }: { cgId: string; value: number | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  if (!editing) return (
    <button onClick={() => { setLocalVal(value?.toString() ?? ""); setEditing(true); }}
      className="font-mono text-purple-500 hover:bg-purple-50 rounded px-0.5 cursor-text">
      {value != null ? formatNum(value) : ""}
    </button>
  );
  return (
    <input autoFocus type="number" step="0.01" value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={async () => {
        setEditing(false);
        const num = localVal.trim() === "" ? null : parseFloat(localVal);
        if (num !== value) {
          const sb = createClient();
          await sb.from("deal_company_groups").update({ price: num }).eq("id", cgId);
          onSaved();
        }
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-14 border border-purple-300 rounded px-0.5 py-0 text-[9px] font-mono text-right bg-purple-50 focus:outline-none" />
  );
}

type PassportTableProps = {
  deals: Deal[];
  loading: boolean;
  dealType: "KG" | "KZ" | "ALL";
  onDataChanged: () => void;
};

function getCurrency(dt: string) { return dt === "KZ" ? "₸" : "$"; }

export function PassportTable({ deals, loading, dealType, onDataChanged }: PassportTableProps) {
  if (loading) return <p className="text-sm text-muted-foreground py-4">Загрузка паспорта...</p>;
  if (deals.length === 0) return (
    <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
      <p className="text-sm text-stone-500">Нет сделок{dealType !== "ALL" ? ` типа ${dealType}` : ""}</p>
    </div>
  );

  return (
    <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
      <table className="w-max border-collapse" style={{ fontSize: "11px" }}>
        <thead>
          <tr className="bg-stone-100 border-b">
            <th colSpan={5} className="border-r border-stone-300 px-2 py-1 text-center text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Сделка</th>
            <th colSpan={9} className="border-r border-stone-300 px-2 py-1 text-center text-[10px] font-semibold text-amber-700 uppercase tracking-wider bg-amber-50/50">Поставщик</th>
            <th colSpan={2} className="border-r border-stone-300 px-2 py-1 text-center text-[10px] font-semibold text-purple-700 uppercase tracking-wider bg-purple-50/50">Группы компании</th>
            <th colSpan={10} className="border-r border-stone-300 px-2 py-1 text-center text-[10px] font-semibold text-blue-700 uppercase tracking-wider bg-blue-50/50">Покупатель</th>
            <th colSpan={8} className="px-2 py-1 text-center text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Логистика</th>
          </tr>
          <tr className="bg-stone-50 border-b">
            <th className="sticky left-0 z-20 bg-stone-50 border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">№</th>
            <th className="sticky left-[70px] z-20 bg-stone-50 border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[55px]">Месяц</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[55px]">Завод</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">ГСМ</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-left font-medium text-stone-600 min-w-[35px]">%S</th>
            {/* Supplier: 9 cols */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[100px] bg-amber-50/30">Поставщик</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px] bg-amber-50/30">Договор</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[60px] bg-amber-50/30">Ст. отпр.</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px] bg-amber-50/30">Объем</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-amber-50/30">Сумма дог.</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-amber-50/30">Отгр. сумма</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px] bg-amber-50/30">Отгр. тонн</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-amber-50/30">Оплата</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-600 min-w-[65px] bg-amber-50/30">Баланс</th>
            {/* Company groups: 2 cols */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[110px] bg-purple-50/30">Компания</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-600 min-w-[60px] bg-purple-50/30">Цена гр.</th>
            {/* Buyer: 10 cols */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[100px] bg-blue-50/30">Покупатель</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Договор</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[60px] bg-blue-50/30">Ст. назн.</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px] bg-blue-50/30">Объем</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Сумма дог.</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px] bg-blue-50/30">Заявлено</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px] bg-blue-50/30">Отгр. тонн</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Отгр. сумма</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Оплата</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-600 min-w-[65px] bg-blue-50/30">Долг</th>
            {/* Logistics: 9 cols */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px]">Экспедитор</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px]">Группа комп.</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px]">Объем план</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[65px]">Предв. сумма</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px]">Факт объем</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[65px]">Сумма</th>
            <th className="px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">Менеджер</th>
            <th className="px-1 py-1.5 w-[30px]"></th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-b hover:bg-amber-50/20">
              {/* Identity */}
              <td className="sticky left-0 z-10 bg-white border-r px-2 py-1 font-mono font-medium">
                <Link href={`/deals/${deal.id}`} className="text-amber-600 underline decoration-amber-300 hover:decoration-amber-500 hover:text-amber-800 transition-colors">{deal.deal_code}</Link>
              </td>
              <td className="sticky left-[70px] z-10 bg-white border-r px-2 py-1 text-stone-600">{deal.month}</td>
              <td className="border-r px-2 py-1 text-stone-600">{deal.factory?.name ?? ""}</td>
              <td className="border-r px-2 py-1">
                {deal.fuel_type ? <span className="inline-flex items-center gap-1"><FuelDot color={deal.fuel_type.color} /><span className="text-stone-700">{deal.fuel_type.name}</span></span> : ""}
              </td>
              <td className="border-r border-stone-300 px-2 py-1 text-stone-500">{deal.sulfur_percent ?? ""}</td>

              {/* Supplier: 9 cols */}
              <td className="border-r px-2 py-1 text-stone-700 bg-amber-50/10 truncate max-w-[100px]">{deal.supplier?.short_name ?? ""}</td>
              <td className="border-r px-1 py-0.5 bg-amber-50/10"><EditableTextCell value={deal.supplier_contract} dealId={deal.id} field="supplier_contract" onSaved={onDataChanged} /></td>
              <td className="border-r px-2 py-1 text-stone-500 bg-amber-50/10 text-[10px] truncate max-w-[60px]">{deal.supplier_delivery_basis ?? ""}</td>
              <td className="border-r px-1 py-0.5 bg-amber-50/10"><EditableNumCell value={deal.supplier_contracted_volume} dealId={deal.id} field="supplier_contracted_volume" onSaved={onDataChanged} /></td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10">{formatNum(deal.supplier_contracted_amount)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10">{formatNum(deal.supplier_shipped_amount)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10">{formatNum(deal.buyer_shipped_volume)}</td>
              <td className="border-r px-1 py-0.5 bg-amber-50/10"><EditableNumCell value={deal.supplier_payment} dealId={deal.id} field="supplier_payment" onSaved={onDataChanged} /></td>
              <td className="border-r border-stone-300 px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10">{formatNum(deal.supplier_balance)}</td>

              {/* Company groups — editable prices */}
              <td className="border-r px-1 py-1 text-[10px] bg-purple-50/10 min-w-[140px]" colSpan={2}>
                <div className="flex items-center gap-1 flex-wrap">
                  {deal.deal_company_groups?.sort((a, b) => a.position - b.position).map((cg, idx) => (
                    <span key={cg.id} className="inline-flex items-center gap-0.5">
                      {idx > 0 && <span className="text-stone-300 mx-0.5">→</span>}
                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-700 whitespace-nowrap">
                        {cg.company_group?.name ?? ""}
                        <EditableCGPrice cgId={cg.id} value={cg.price} onSaved={onDataChanged} />
                      </span>
                    </span>
                  )) ?? ""}
                </div>
              </td>

              {/* Buyer: 10 cols */}
              <td className="border-r px-2 py-1 text-stone-700 bg-blue-50/10 truncate max-w-[100px]">{deal.buyer?.short_name ?? ""}</td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10"><EditableTextCell value={deal.buyer_contract} dealId={deal.id} field="buyer_contract" onSaved={onDataChanged} /></td>
              <td className="border-r px-2 py-1 text-stone-500 bg-blue-50/10 text-[10px] truncate max-w-[60px]">{deal.buyer_delivery_basis ?? ""}</td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10"><EditableNumCell value={deal.buyer_contracted_volume} dealId={deal.id} field="buyer_contracted_volume" onSaved={onDataChanged} /></td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10">{formatNum(deal.buyer_contracted_amount)}</td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10"><EditableNumCell value={deal.buyer_ordered_volume} dealId={deal.id} field="buyer_ordered_volume" onSaved={onDataChanged} /></td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10">{formatNum(deal.buyer_shipped_volume)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10">{formatNum(deal.buyer_shipped_amount)}</td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10"><EditableNumCell value={deal.buyer_payment} dealId={deal.id} field="buyer_payment" onSaved={onDataChanged} /></td>
              <td className="border-r border-stone-300 px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10">{formatNum(deal.buyer_debt)}</td>

              {/* Logistics */}
              <td className="border-r px-2 py-1 text-stone-600 truncate max-w-[80px]">{deal.forwarder?.name ?? ""}</td>
              <td className="border-r px-2 py-1 text-stone-500 text-[10px] truncate max-w-[80px]">{""}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums">{formatNum(deal.preliminary_tonnage)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums">{formatNum(deal.preliminary_amount)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums">{formatNum(deal.actual_shipped_volume)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums">{formatNum(deal.buyer_shipped_amount)}</td>
              <td className="px-2 py-1 text-stone-500">{deal.supplier_manager?.full_name ?? ""}</td>
              <td className="px-1 py-1">
                <button onClick={async () => {
                  if (!confirm("Удалить сделку?")) return;
                  const sb = createClient();
                  const { error } = await sb.from("deals").delete().eq("id", deal.id);
                  if (error) toast.error(error.message); else { toast.success("Удалено"); onDataChanged(); }
                }} className="rounded p-0.5 text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <Trash2 className="h-3 w-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

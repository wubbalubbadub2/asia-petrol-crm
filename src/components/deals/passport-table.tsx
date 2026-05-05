"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { type Deal, updateDeal } from "@/lib/hooks/use-deals";
import { createClient } from "@/lib/supabase/client";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { toast } from "sonner";

function formatNum(val: number | null | undefined): string {
  if (val == null || val === 0) return "";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

// Computed/auto cells: render "0" explicitly so users see that the calc ran
// (supplier_balance = shipped − payment is a common legitimate zero).
function formatComputedNum(val: number | null | undefined): string {
  if (val == null) return "";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function FuelDot({ color }: { color?: string }) {
  return <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color ?? "#6B7280" }} />;
}

// "+N лин." chip — only renders when at least one side has multiple
// pricing variants. Tooltip spells out per-side counts so users know
// where to look (Поставщик / Покупатель card on the deal detail).
function VariantsBadge({ supplierCount, buyerCount }: { supplierCount: number; buyerCount: number }) {
  const supplierExtra = Math.max(0, supplierCount - 1);
  const buyerExtra = Math.max(0, buyerCount - 1);
  if (supplierExtra === 0 && buyerExtra === 0) return null;
  const parts: string[] = [];
  if (supplierExtra > 0) parts.push(`Поставщик: +${supplierExtra}`);
  if (buyerExtra > 0) parts.push(`Покупатель: +${buyerExtra}`);
  const total = supplierExtra + buyerExtra;
  return (
    <span
      title={parts.join(" · ")}
      className="ml-1 inline-flex items-center rounded bg-purple-100 px-1 py-0.5 align-middle text-[9px] font-medium text-purple-700"
    >
      +{total} лин.
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Inline cell primitives
// ─────────────────────────────────────────────────────────────────────

function EditableNumCell({ value, dealId, field }: {
  value: number | null | undefined; dealId: string; field: string;
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

function EditableTextCell({ value, dealId, field, wide = false }: {
  value: string | null | undefined; dealId: string; field: string; wide?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const pendingVal = useRef<string | null | undefined>(undefined);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) pendingVal.current = undefined;
  const maxW = wide ? "max-w-[140px]" : "max-w-[100px]";
  if (!editing) return (
    <button onClick={() => { setLocalVal(shown ?? ""); setEditing(true); }}
      className={`w-full text-left text-[11px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[18px] truncate ${maxW}`}>
      {shown ?? ""}
    </button>
  );
  return (
    <input autoFocus value={localVal} onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => { setEditing(false); const nv = localVal || null; if (nv !== (value ?? null)) { pendingVal.current = nv; updateDeal(dealId, { [field]: nv }).catch(() => { pendingVal.current = undefined; }); } }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className={`${wide ? "w-32" : "w-20"} border border-amber-400 rounded px-1 py-0 text-[11px] bg-amber-50 focus:outline-none`} />
  );
}

// Reference-select cell: click to open a dropdown; persists on change.
// Uses defaultValue so we don't bind to a controlled state; that way the
// pending display keeps showing until the row reloads with the new value.
function EditableSelectCell({ value, displayLabel, dealId, field, options, color = "stone" }: {
  value: string | null | undefined;
  displayLabel: string;
  dealId: string;
  field: string;
  options: { value: string; label: string }[];
  color?: "stone" | "amber" | "blue";
}) {
  const [editing, setEditing] = useState(false);
  const colorClass =
    color === "amber" ? "text-stone-700" :
    color === "blue" ? "text-stone-700" :
    "text-stone-600";
  if (!editing) return (
    <button onClick={() => setEditing(true)}
      className={`w-full text-left text-[11px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-pointer min-h-[18px] truncate max-w-[110px] ${colorClass}`}>
      {displayLabel || <span className="text-stone-300">—</span>}
    </button>
  );
  return (
    <select autoFocus defaultValue={value ?? ""}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        const nv = e.target.value || null;
        setEditing(false);
        if (nv !== (value ?? null)) {
          updateDeal(dealId, { [field]: nv }).catch(() => {});
        }
      }}
      className="w-full h-6 text-[11px] border border-amber-300 rounded bg-amber-50/50 px-1 focus:outline-none cursor-pointer">
      <option value="">—</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// Editable company-group price (inline, purple accent to match chain styling)
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

// ─────────────────────────────────────────────────────────────────────
//  Shared ref loader
// ─────────────────────────────────────────────────────────────────────

type Opt = { value: string; label: string };

type Refs = {
  suppliers: Opt[]; buyers: Opt[]; forwarders: Opt[]; managers: Opt[];
  stations: Opt[]; factories: Opt[]; fuelTypes: Opt[]; companyGroups: Opt[];
};

function useRefs(): Refs {
  const [refs, setRefs] = useState<Refs>({
    suppliers: [], buyers: [], forwarders: [], managers: [],
    stations: [], factories: [], fuelTypes: [], companyGroups: [],
  });
  useEffect(() => {
    const sb = createClient();
    Promise.all([
      sb.from("counterparties").select("id, short_name, full_name").eq("type", "supplier").eq("is_active", true).order("full_name"),
      sb.from("counterparties").select("id, short_name, full_name").eq("type", "buyer").eq("is_active", true).order("full_name"),
      sb.from("forwarders").select("id, name").eq("is_active", true).order("name"),
      sb.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
      sb.from("stations").select("id, name").eq("is_active", true).order("name"),
      sb.from("factories").select("id, name").eq("is_active", true).order("name"),
      sb.from("fuel_types").select("id, name").eq("is_active", true).order("sort_order"),
      sb.from("company_groups").select("id, name").eq("is_active", true).order("name"),
    ]).then(([sup, buy, fw, mgr, st, fac, ft, cg]) => {
      setRefs({
        suppliers: (sup.data ?? []).map((r) => ({ value: r.id, label: r.short_name ?? r.full_name })),
        buyers: (buy.data ?? []).map((r) => ({ value: r.id, label: r.short_name ?? r.full_name })),
        forwarders: (fw.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        managers: (mgr.data ?? []).map((r) => ({ value: r.id, label: r.full_name })),
        stations: (st.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        factories: (fac.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        fuelTypes: (ft.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        companyGroups: (cg.data ?? []).map((r) => ({ value: r.id, label: r.name })),
      });
    });
  }, []);
  return refs;
}

const MONTH_OPTS: Opt[] = MONTHS_RU.map((m) => ({ value: m, label: m }));

// ─────────────────────────────────────────────────────────────────────
//  Main table
// ─────────────────────────────────────────────────────────────────────

type PassportTableProps = {
  deals: Deal[];
  loading: boolean;
  dealType: "KG" | "KZ" | "ALL";
  onDataChanged: () => void;
};

export function PassportTable({ deals, loading, dealType, onDataChanged }: PassportTableProps) {
  const refs = useRefs();

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
            <th className="sticky left-[70px] z-20 bg-stone-50 border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[75px]">Месяц</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">Завод</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px]">ГСМ</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-left font-medium text-stone-600 min-w-[40px]">%S</th>
            {/* Supplier: 9 cols */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[110px] bg-amber-50/30">Поставщик</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px] bg-amber-50/30">Договор</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px] bg-amber-50/30">Базис</th>
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
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[110px] bg-blue-50/30">Покупатель</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Договор</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px] bg-blue-50/30">Базис</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px] bg-blue-50/30">Объем</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Сумма дог.</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px] bg-blue-50/30">Заявлено</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px] bg-blue-50/30">Отгр. тонн</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Отгр. сумма</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Оплата</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-600 min-w-[65px] bg-blue-50/30">Долг</th>
            {/* Logistics: 8 cols */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[90px]">Экспедитор</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[90px]">Группа комп.</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px]">Объем план</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[65px]">Предв. сумма</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[55px]">Факт объем</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[65px]">Сумма</th>
            <th className="px-2 py-1.5 text-left font-medium text-stone-600 min-w-[90px]">Менеджер</th>
            <th className="px-1 py-1.5 w-[30px]"></th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-b hover:bg-amber-50/20">
              {/* Identity */}
              <td className="sticky left-0 z-10 bg-white border-r px-2 py-1 font-mono font-medium">
                <Link href={`/deals/${deal.id}`} className="text-amber-600 underline decoration-amber-300 hover:decoration-amber-500 hover:text-amber-800 transition-colors">{deal.deal_code}</Link>
                <VariantsBadge supplierCount={deal.supplier_lines_count ?? 1} buyerCount={deal.buyer_lines_count ?? 1} />
              </td>
              <td className="sticky left-[70px] z-10 bg-white border-r px-1 py-0.5">
                <EditableSelectCell value={deal.month} displayLabel={deal.month ?? ""} dealId={deal.id} field="month" options={MONTH_OPTS} />
              </td>
              <td className="border-r px-1 py-0.5">
                <EditableSelectCell value={deal.factory_id} displayLabel={deal.factory?.name ?? ""} dealId={deal.id} field="factory_id" options={refs.factories} />
              </td>
              <td className="border-r px-1 py-0.5">
                <EditableSelectCell
                  value={deal.fuel_type_id}
                  displayLabel={deal.fuel_type?.name ?? ""}
                  dealId={deal.id}
                  field="fuel_type_id"
                  options={refs.fuelTypes}
                />
              </td>
              <td className="border-r border-stone-300 px-1 py-0.5"><EditableTextCell value={deal.sulfur_percent} dealId={deal.id} field="sulfur_percent" /></td>

              {/* Supplier: 9 cols */}
              <td className="border-r px-1 py-0.5 bg-amber-50/10">
                <EditableSelectCell value={deal.supplier_id} displayLabel={deal.supplier?.short_name ?? deal.supplier?.full_name ?? ""} dealId={deal.id} field="supplier_id" options={refs.suppliers} color="amber" />
              </td>
              <td className="border-r px-1 py-0.5 bg-amber-50/10"><EditableTextCell value={deal.supplier_contract} dealId={deal.id} field="supplier_contract" /></td>
              <td className="border-r px-1 py-0.5 bg-amber-50/10"><EditableTextCell value={deal.supplier_delivery_basis} dealId={deal.id} field="supplier_delivery_basis" /></td>
              <td className="border-r px-1 py-0.5 bg-amber-50/10"><EditableNumCell value={deal.supplier_contracted_volume} dealId={deal.id} field="supplier_contracted_volume" /></td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-500" title="auto: объем × цена">{formatComputedNum(deal.supplier_contracted_amount)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-500" title="сумма из секции цен">{formatComputedNum(deal.supplier_shipped_amount)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-500" title="налив (loading_volume) — реестр">{formatComputedNum(deal.supplier_shipped_volume)}</td>
              <td className="border-r px-1 py-0.5 bg-amber-50/10"><EditableNumCell value={deal.supplier_payment} dealId={deal.id} field="supplier_payment" /></td>
              <td className="border-r border-stone-300 px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-500" title="auto: отгружено − оплата">{formatComputedNum(deal.supplier_balance)}</td>

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
              <td className="border-r px-1 py-0.5 bg-blue-50/10">
                <EditableSelectCell value={deal.buyer_id} displayLabel={deal.buyer?.short_name ?? deal.buyer?.full_name ?? ""} dealId={deal.id} field="buyer_id" options={refs.buyers} color="blue" />
              </td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10"><EditableTextCell value={deal.buyer_contract} dealId={deal.id} field="buyer_contract" /></td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10"><EditableTextCell value={deal.buyer_delivery_basis} dealId={deal.id} field="buyer_delivery_basis" /></td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10"><EditableNumCell value={deal.buyer_contracted_volume} dealId={deal.id} field="buyer_contracted_volume" /></td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-500" title="auto: объем × цена">{formatComputedNum(deal.buyer_contracted_amount)}</td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10"><EditableNumCell value={deal.buyer_ordered_volume} dealId={deal.id} field="buyer_ordered_volume" /></td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-500" title="тонн (shipment_volume) — реестр">{formatComputedNum(deal.buyer_shipped_volume)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-500" title="сумма из секции цен">{formatComputedNum(deal.buyer_shipped_amount)}</td>
              <td className="border-r px-1 py-0.5 bg-blue-50/10"><EditableNumCell value={deal.buyer_payment} dealId={deal.id} field="buyer_payment" /></td>
              <td className="border-r border-stone-300 px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-500" title="auto: отгружено − оплата">{formatComputedNum(deal.buyer_debt)}</td>

              {/* Logistics */}
              <td className="border-r px-1 py-0.5">
                <EditableSelectCell value={deal.forwarder_id} displayLabel={deal.forwarder?.name ?? ""} dealId={deal.id} field="forwarder_id" options={refs.forwarders} />
              </td>
              <td className="border-r px-1 py-0.5">
                <EditableSelectCell value={deal.logistics_company_group_id} displayLabel={deal.logistics_company_group?.name ?? ""} dealId={deal.id} field="logistics_company_group_id" options={refs.companyGroups} />
              </td>
              <td className="border-r px-1 py-0.5"><EditableNumCell value={deal.preliminary_tonnage} dealId={deal.id} field="preliminary_tonnage" /></td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums text-stone-500" title="auto: тариф × объем план">{formatComputedNum(deal.preliminary_amount)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums text-stone-500" title="тонны из реестра">{formatComputedNum(deal.actual_shipped_volume)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums text-stone-500" title="сумма из реестра">{formatComputedNum(deal.invoice_amount)}</td>
              <td className="px-1 py-0.5">
                <EditableSelectCell value={deal.supplier_manager_id} displayLabel={deal.supplier_manager?.full_name ?? ""} dealId={deal.id} field="supplier_manager_id" options={refs.managers} />
              </td>
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

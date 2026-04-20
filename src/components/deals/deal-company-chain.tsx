"use client";

import { useState, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

type DealCompanyGroup = {
  id: string;
  position: number;
  company_group_id: string;
  price: number | null;
  contract_ref: string | null;
  company_group: { name: string } | null;
};

type Props = {
  dealId: string;
  editing: boolean;
  supplierName: string;
  buyerName: string;
  supplierPrice: number | null;
  buyerPrice: number | null;
  forwarderName: string;
  forwarderTariff: number | null;
  currencySymbol: string;
  groups: DealCompanyGroup[];
  companyGroupOptions: { value: string; label: string }[];
  onReload: () => void;
};

// ──────────────────────────────────────────────────────────────
//  Inline editor widgets — matching the passport-table pattern
//  (read-only button by default, input/select on click)
// ──────────────────────────────────────────────────────────────

function ChipSelect({ value, displayLabel, options, onSave }: {
  value: string; displayLabel: string;
  options: { value: string; label: string }[];
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) return (
    <button onClick={() => setEditing(true)}
      className="block w-full text-[12px] font-medium text-stone-800 hover:bg-white/60 rounded px-1 -mx-1 cursor-pointer truncate">
      {displayLabel || <span className="text-stone-400">— выбрать —</span>}
    </button>
  );
  return (
    <select autoFocus defaultValue={value}
      onBlur={() => setEditing(false)}
      onChange={(e) => { setEditing(false); if (e.target.value !== value) onSave(e.target.value); }}
      className="block w-full h-6 text-[12px] rounded border border-purple-400 bg-white px-1 focus:outline-none cursor-pointer">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function ChipNum({ value, suffix, onSave }: {
  value: number | null;
  suffix?: string;
  onSave: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [lv, setLv] = useState("");
  if (!editing) return (
    <button onClick={() => { setLv(value == null ? "" : String(value)); setEditing(true); }}
      className="block w-full text-[11px] font-mono tabular-nums text-purple-700 hover:bg-white/60 rounded px-1 -mx-1 cursor-text">
      {value == null ? <span className="text-stone-400">— цена —</span> : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}${suffix ? " " + suffix : ""}`}
    </button>
  );
  return (
    <input autoFocus type="number" step="0.01" value={lv}
      onChange={(e) => setLv(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const n = lv.trim() === "" ? null : parseFloat(lv.replace(",", "."));
        if (n !== value) onSave(Number.isFinite(n as number) ? n : null);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="block w-full h-6 text-[11px] font-mono tabular-nums text-right rounded border border-purple-400 bg-white px-1 focus:outline-none" />
  );
}

function ChipText({ value, placeholder, onSave }: {
  value: string | null;
  placeholder: string;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [lv, setLv] = useState("");
  if (!editing) return (
    <button onClick={() => { setLv(value ?? ""); setEditing(true); }}
      className="block w-full text-[9px] text-stone-500 hover:bg-white/60 rounded px-1 -mx-1 cursor-text truncate">
      {value || <span className="text-stone-400">— {placeholder} —</span>}
    </button>
  );
  return (
    <input autoFocus value={lv}
      onChange={(e) => setLv(e.target.value)}
      onBlur={() => { setEditing(false); const nv = lv.trim() || null; if (nv !== value) onSave(nv); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      placeholder={placeholder}
      className="block w-full h-5 text-[10px] rounded border border-purple-400 bg-white px-1 focus:outline-none" />
  );
}

// ──────────────────────────────────────────────────────────────
//  Main component
// ──────────────────────────────────────────────────────────────

export function DealCompanyChain({
  dealId,
  editing,
  supplierName,
  buyerName,
  supplierPrice,
  buyerPrice,
  forwarderName,
  forwarderTariff,
  currencySymbol,
  groups,
  companyGroupOptions,
  onReload,
}: Props) {
  const sbRef = useRef(createClient());
  const sorted = [...groups].sort((a, b) => a.position - b.position);

  // Маржа = цена покупателя − цена поставщика − тариф экспедитора
  const margin =
    buyerPrice != null && supplierPrice != null
      ? buyerPrice - supplierPrice - (forwarderTariff ?? 0)
      : null;

  async function addGroup() {
    const nextPos = sorted.length > 0 ? Math.max(...sorted.map((g) => g.position)) + 1 : 1;
    if (nextPos > 6) { toast.error("Максимум 6 групп"); return; }
    const defaultGroup = companyGroupOptions[0]?.value ?? null;
    if (!defaultGroup) { toast.error("Нет групп. Создайте в справочнике."); return; }
    const { error } = await sbRef.current.from("deal_company_groups").insert({
      deal_id: dealId, company_group_id: defaultGroup, position: nextPos,
      price: null, contract_ref: null,
    });
    if (error) { toast.error(error.message); return; }
    onReload();
  }

  async function updateGroup(id: string, patch: Partial<DealCompanyGroup>) {
    const { error } = await sbRef.current.from("deal_company_groups").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    onReload();
  }

  async function removeGroup(id: string) {
    if (!confirm("Удалить группу?")) return;
    const { error } = await sbRef.current.from("deal_company_groups").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    onReload();
  }

  const fmt = (v: number | null) =>
    v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 3 });

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-[14px]">
          Цепочка компании
          {editing && (
            <span className="ml-2 text-[10px] font-normal text-stone-400">
              (нажмите на название или цену, чтобы изменить)
            </span>
          )}
        </CardTitle>
        {editing && (
          <Button size="sm" variant="outline" onClick={addGroup} className="h-7 text-[11px]">
            <Plus className="h-3 w-3 mr-1" /> Добавить группу
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Supplier */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center min-w-[140px]">
            <p className="text-[10px] text-amber-600 uppercase font-medium">Поставщик</p>
            <p className="text-[12px] font-medium text-stone-800 truncate max-w-[180px]">{supplierName}</p>
            {supplierPrice != null && (
              <p className="text-[11px] font-mono tabular-nums text-amber-700 mt-0.5">
                {fmt(supplierPrice)} {currencySymbol}
              </p>
            )}
          </div>

          {sorted.map((cg) => (
            <div key={cg.id} className="flex items-center gap-2">
              <span className="text-stone-300 text-lg">→</span>
              <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-center min-w-[160px] relative group">
                <p className="text-[10px] text-purple-600 uppercase font-medium">Группа {cg.position}</p>

                {editing ? (
                  <>
                    <ChipSelect
                      value={cg.company_group_id}
                      displayLabel={cg.company_group?.name ?? ""}
                      options={companyGroupOptions}
                      onSave={(v) => updateGroup(cg.id, { company_group_id: v })}
                    />
                    <ChipNum
                      value={cg.price}
                      suffix={currencySymbol}
                      onSave={(v) => updateGroup(cg.id, { price: v })}
                    />
                    <ChipText
                      value={cg.contract_ref}
                      placeholder="№ приложения"
                      onSave={(v) => updateGroup(cg.id, { contract_ref: v })}
                    />
                    <button
                      onClick={() => removeGroup(cg.id)}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white border border-stone-200 shadow-sm flex items-center justify-center text-stone-400 hover:text-red-500 hover:border-red-300 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Удалить группу"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-[12px] font-medium text-stone-800 truncate max-w-[180px]">
                      {cg.company_group?.name ?? "—"}
                    </p>
                    {cg.price != null && (
                      <p className="text-[11px] font-mono tabular-nums text-purple-700 mt-0.5">
                        {fmt(cg.price)} {currencySymbol}
                      </p>
                    )}
                    {cg.contract_ref && <p className="text-[9px] text-stone-400">{cg.contract_ref}</p>}
                  </>
                )}
              </div>
            </div>
          ))}

          {/* Buyer */}
          <span className="text-stone-300 text-lg">→</span>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-center min-w-[140px]">
            <p className="text-[10px] text-blue-600 uppercase font-medium">Покупатель</p>
            <p className="text-[12px] font-medium text-stone-800 truncate max-w-[180px]">{buyerName}</p>
            {buyerPrice != null && (
              <p className="text-[11px] font-mono tabular-nums text-blue-700 mt-0.5">
                {fmt(buyerPrice)} {currencySymbol}
              </p>
            )}
          </div>

          {/* Forwarder */}
          <span className="text-stone-300 text-lg">/</span>
          <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-center min-w-[140px]">
            <p className="text-[10px] text-teal-600 uppercase font-medium">Экспедитор</p>
            <p className="text-[12px] font-medium text-stone-800 truncate max-w-[180px]">{forwarderName}</p>
            {forwarderTariff != null && (
              <p className="text-[11px] font-mono tabular-nums text-teal-700 mt-0.5">
                {fmt(forwarderTariff)} {currencySymbol}
              </p>
            )}
          </div>

          {/* Маржа */}
          <span className="text-stone-300 text-lg">=</span>
          <div className={`rounded-lg border px-3 py-2 text-center min-w-[140px] ${
            margin == null ? "border-stone-200 bg-stone-50" :
            margin >= 0 ? "border-green-200 bg-green-50" :
            "border-red-200 bg-red-50"
          }`}>
            <p className={`text-[10px] uppercase font-medium ${
              margin == null ? "text-stone-500" : margin >= 0 ? "text-green-600" : "text-red-600"
            }`}>Маржа</p>
            <p className={`text-[13px] font-mono tabular-nums font-semibold ${
              margin == null ? "text-stone-500" : margin >= 0 ? "text-green-700" : "text-red-700"
            }`}>{fmt(margin)} {margin != null && currencySymbol}</p>
            <p className="text-[9px] text-stone-400">цена покуп − цена пост − тариф</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

type DealCompanyGroup = {
  id: string;
  deal_id: string;
  company_group_id: string;
  position: number;
  price: number | null;
  contract_ref: string | null;
  company_group?: { name: string } | null;
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
  groups: { id: string; position: number; price: number | null; contract_ref: string | null; company_group: { name: string } | null }[];
  companyGroupOptions: { value: string; label: string }[];
  onReload: () => void;
};

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

  // Calculate margin: buyer_price - supplier_price - forwarder_tariff
  const margin =
    buyerPrice != null && supplierPrice != null
      ? buyerPrice - supplierPrice - (forwarderTariff ?? 0)
      : null;

  async function addGroup() {
    const nextPos = sorted.length > 0 ? Math.max(...sorted.map((g) => g.position)) + 1 : 1;
    if (nextPos > 6) {
      toast.error("Максимум 6 групп");
      return;
    }
    // Pick first available group as default, or null
    const defaultGroup = companyGroupOptions[0]?.value ?? null;
    if (!defaultGroup) {
      toast.error("Нет групп. Создайте в справочнике.");
      return;
    }
    const { error } = await sbRef.current.from("deal_company_groups").insert({
      deal_id: dealId,
      company_group_id: defaultGroup,
      position: nextPos,
      price: null,
      contract_ref: null,
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

  const fmt = (v: number | null) => v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 3 });

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-[14px]">Цепочка компании</CardTitle>
        {editing && (
          <Button size="sm" variant="outline" onClick={addGroup} className="h-7 text-[11px]">
            <Plus className="h-3 w-3 mr-1" /> Добавить группу
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {/* Horizontal chain view */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {/* Supplier */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center min-w-[120px]">
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
              <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-center min-w-[120px] relative">
                <p className="text-[10px] text-purple-600 uppercase font-medium">Группа {cg.position}</p>
                <p className="text-[12px] font-medium text-stone-800 truncate max-w-[180px]">{cg.company_group?.name ?? "—"}</p>
                {cg.price != null && (
                  <p className="text-[11px] font-mono tabular-nums text-purple-700 mt-0.5">
                    {fmt(cg.price)} {currencySymbol}
                  </p>
                )}
                {cg.contract_ref && <p className="text-[9px] text-stone-400">{cg.contract_ref}</p>}
              </div>
            </div>
          ))}

          {/* Buyer */}
          <span className="text-stone-300 text-lg">→</span>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-center min-w-[120px]">
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
          <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-center min-w-[120px]">
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
          <div className={`rounded-lg border px-3 py-2 text-center min-w-[120px] ${
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

        {/* Edit mode: group rows with edit + delete */}
        {editing && sorted.length > 0 && (
          <div className="border-t border-stone-200 pt-3 space-y-2">
            <p className="text-[11px] font-medium text-stone-500 mb-1">Редактировать группы:</p>
            {sorted.map((cg) => (
              <div key={cg.id} className="flex items-end gap-2 p-2 rounded-md bg-stone-50 border border-stone-200">
                <span className="text-[11px] text-stone-400 font-mono w-5 shrink-0 pb-1.5">{cg.position}</span>
                <div className="flex-1">
                  <label className="text-[10px] text-stone-500 block">Группа</label>
                  <select
                    defaultValue={(cg as unknown as { company_group_id: string }).company_group_id ?? ""}
                    onChange={(e) => updateGroup(cg.id, { company_group_id: e.target.value })}
                    className="w-full h-7 rounded border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer"
                  >
                    {companyGroupOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="w-28">
                  <label className="text-[10px] text-stone-500 block">Цена</label>
                  <Input
                    type="number" step="0.01"
                    defaultValue={cg.price ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim() === "" ? null : parseFloat(e.target.value);
                      if (v !== cg.price) updateGroup(cg.id, { price: v });
                    }}
                    className="h-7 text-[12px] font-mono"
                  />
                </div>
                <div className="w-36">
                  <label className="text-[10px] text-stone-500 block">№ прил</label>
                  <Input
                    defaultValue={cg.contract_ref ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v !== cg.contract_ref) updateGroup(cg.id, { contract_ref: v });
                    }}
                    className="h-7 text-[12px]"
                  />
                </div>
                <button
                  onClick={() => removeGroup(cg.id)}
                  className="rounded p-1 text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors mb-0.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useRef } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  supplierCurrencySymbol: string;
  buyerCurrencySymbol: string;
  logisticsCurrencySymbol: string;
  // True when supplier_currency, buyer_currency and logistics_currency
  // all match. Margin computation collapses three currencies into one
  // number, so we hide the value when they differ.
  currenciesAligned: boolean;
  groups: DealCompanyGroup[];
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
  supplierCurrencySymbol,
  buyerCurrencySymbol,
  logisticsCurrencySymbol,
  currenciesAligned,
  groups,
  companyGroupOptions,
  onReload,
}: Props) {
  const sbRef = useRef(createClient());
  const sorted = [...groups].sort((a, b) => a.position - b.position);

  // Маржа = цена покупателя − цена поставщика − тариф экспедитора.
  // Only meaningful when all three sides are denominated in the same currency.
  const margin =
    currenciesAligned && buyerPrice != null && supplierPrice != null
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
        <CardTitle className="text-[14px]">Цепочка компании</CardTitle>
        {editing && (
          <Button size="sm" variant="outline" onClick={addGroup} className="h-7 text-[11px]">
            <Plus className="h-3 w-3 mr-1" /> Добавить группу
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Visual chain — always read-only, just the mental model */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center min-w-[140px]">
            <p className="text-[10px] text-amber-600 uppercase font-medium">Поставщик</p>
            <p className="text-[12px] font-medium text-stone-800 truncate max-w-[180px]">{supplierName}</p>
            {supplierPrice != null && (
              <p className="text-[11px] font-mono tabular-nums text-amber-700 mt-0.5">
                {fmt(supplierPrice)} {supplierCurrencySymbol}
              </p>
            )}
          </div>

          {sorted.map((cg) => (
            <div key={cg.id} className="flex items-center gap-2">
              <span className="text-stone-300 text-lg">→</span>
              <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-center min-w-[140px]">
                <p className="text-[10px] text-purple-600 uppercase font-medium">Группа {cg.position}</p>
                <p className="text-[12px] font-medium text-stone-800 truncate max-w-[180px]">{cg.company_group?.name ?? "—"}</p>
                {cg.price != null && (
                  <p className="text-[11px] font-mono tabular-nums text-purple-700 mt-0.5">
                    {fmt(cg.price)} {supplierCurrencySymbol}
                  </p>
                )}
                {cg.contract_ref && <p className="text-[9px] text-stone-400">{cg.contract_ref}</p>}
              </div>
            </div>
          ))}

          <span className="text-stone-300 text-lg">→</span>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-center min-w-[140px]">
            <p className="text-[10px] text-blue-600 uppercase font-medium">Покупатель</p>
            <p className="text-[12px] font-medium text-stone-800 truncate max-w-[180px]">{buyerName}</p>
            {buyerPrice != null && (
              <p className="text-[11px] font-mono tabular-nums text-blue-700 mt-0.5">
                {fmt(buyerPrice)} {buyerCurrencySymbol}
              </p>
            )}
          </div>

          <span className="text-stone-300 text-lg">/</span>
          <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-center min-w-[140px]">
            <p className="text-[10px] text-teal-600 uppercase font-medium">Экспедитор</p>
            <p className="text-[12px] font-medium text-stone-800 truncate max-w-[180px]">{forwarderName}</p>
            {forwarderTariff != null && (
              <p className="text-[11px] font-mono tabular-nums text-teal-700 mt-0.5">
                {fmt(forwarderTariff)} {logisticsCurrencySymbol}
              </p>
            )}
          </div>

          <span className="text-stone-300 text-lg">=</span>
          <div
            className={`rounded-lg border px-3 py-2 text-center min-w-[140px] ${
              margin == null ? "border-stone-200 bg-stone-50" :
              margin >= 0 ? "border-green-200 bg-green-50" :
              "border-red-200 bg-red-50"
            }`}
            title={!currenciesAligned ? "Валюты разделов не совпадают — конвертация ещё не реализована" : undefined}
          >
            <p className={`text-[10px] uppercase font-medium ${
              margin == null ? "text-stone-500" : margin >= 0 ? "text-green-600" : "text-red-600"
            }`}>Маржа</p>
            <p className={`text-[13px] font-mono tabular-nums font-semibold ${
              margin == null ? "text-stone-500" : margin >= 0 ? "text-green-700" : "text-red-700"
            }`}>{fmt(margin)} {margin != null && buyerCurrencySymbol}</p>
            <p className="text-[9px] text-stone-400">
              {currenciesAligned ? "цена покуп − цена пост − тариф" : "разные валюты"}
            </p>
          </div>
        </div>

        {/* Edit mode: explicit labelled form for each group */}
        {editing && (
          <div className="border-t border-stone-200 pt-3">
            {sorted.length === 0 ? (
              <p className="text-[12px] text-stone-400">
                Нет групп компании. Нажмите <span className="font-medium">«Добавить группу»</span> в правом верхнем углу, чтобы добавить.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[24px_1fr_140px_180px_36px] gap-2 items-center text-[10px] text-stone-400 uppercase tracking-wide px-2">
                  <div>#</div>
                  <div>Компания</div>
                  <div>Цена ({supplierCurrencySymbol})</div>
                  <div>№ приложения / договора</div>
                  <div></div>
                </div>
                {sorted.map((cg) => {
                  const currentOption = companyGroupOptions.find((o) => o.value === cg.company_group_id);
                  const currentLabel = currentOption?.label ?? cg.company_group?.name ?? "—";
                  return (
                    <div
                      key={cg.id}
                      className="grid grid-cols-[24px_1fr_140px_180px_36px] gap-2 items-center rounded-md border border-purple-200 bg-purple-50/40 p-2"
                    >
                      <div className="text-[11px] font-mono text-purple-500 text-center">{cg.position}</div>

                      <div className="relative">
                        <select
                          value={currentOption ? cg.company_group_id : (cg.company_group_id ?? "")}
                          onChange={(e) => {
                            if (e.target.value && e.target.value !== cg.company_group_id) updateGroup(cg.id, { company_group_id: e.target.value });
                          }}
                          className="h-8 w-full rounded border border-stone-300 bg-white px-2 pr-7 text-[12px] text-stone-800 hover:border-amber-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-200 cursor-pointer appearance-none transition-colors"
                        >
                          {/* Always include the current value option so the selected company is visible
                              even if the active-options list doesn't contain it (e.g. inactive group). */}
                          {cg.company_group_id && (
                            <option value={cg.company_group_id}>{currentLabel}</option>
                          )}
                          {companyGroupOptions
                            .filter((o) => o.value !== cg.company_group_id)
                            .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
                      </div>

                      <Input
                        type="number" step="0.01"
                        defaultValue={cg.price ?? ""}
                        placeholder="цена"
                        onBlur={(e) => {
                          const v = e.target.value.trim() === "" ? null : parseFloat(e.target.value.replace(",", "."));
                          if (v !== cg.price) updateGroup(cg.id, { price: Number.isFinite(v as number) ? v : null });
                        }}
                        className="h-8 text-[12px] font-mono text-right border-stone-300 bg-white hover:border-amber-400 focus:border-amber-500"
                      />

                      <Input
                        defaultValue={cg.contract_ref ?? ""}
                        placeholder="напр. 2 от 21.01.2026"
                        onBlur={(e) => {
                          const v = e.target.value.trim() || null;
                          if (v !== cg.contract_ref) updateGroup(cg.id, { contract_ref: v });
                        }}
                        className="h-8 text-[12px] border-stone-300 bg-white hover:border-amber-400 focus:border-amber-500"
                      />

                      <button
                        onClick={() => removeGroup(cg.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Удалить группу"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

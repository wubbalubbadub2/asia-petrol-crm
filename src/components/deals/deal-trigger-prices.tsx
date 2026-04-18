"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import {
  useDealTriggerPrices,
  fetchTriggerQuotationAvg,
  type TriggerBasis,
  type ShipmentPrice,
} from "@/lib/hooks/use-deal-trigger-prices";

function formatNum(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("ru-RU");
}

type ProductType = { id: string; name: string };

// --- Inline editable cells for existing rows ---
function EdNum({ value, onSave, right = true, bold = false }: { value: number | null; onSave: (v: number | null) => void; right?: boolean; bold?: boolean }) {
  const [ed, setEd] = useState(false);
  const [lv, setLv] = useState("");
  if (!ed) return (
    <button onClick={() => { setLv(value == null ? "" : String(value)); setEd(true); }}
      className={`w-full font-mono tabular-nums hover:bg-amber-50 rounded px-1 py-0.5 cursor-text min-h-[20px] ${right ? "text-right" : "text-left"} ${bold ? "font-medium" : ""}`}>
      {formatNum(value)}
    </button>
  );
  return (
    <input autoFocus type="number" step="0.001" value={lv}
      onChange={(e) => setLv(e.target.value)}
      onBlur={() => { setEd(false); const n = lv.trim() === "" ? null : parseFloat(lv.replace(",", ".")); if (n !== value) onSave(Number.isFinite(n as number) ? n : null); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }}
      className="w-full border border-amber-300 rounded px-1 py-0 text-[11px] font-mono text-right bg-amber-50/50 focus:outline-none" />
  );
}
function EdDate({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const [ed, setEd] = useState(false);
  const [lv, setLv] = useState("");
  if (!ed) return (
    <button onClick={() => { setLv(value ?? ""); setEd(true); }}
      className="w-full text-left hover:bg-amber-50 rounded px-1 py-0.5 cursor-text min-h-[20px]">
      {formatDate(value)}
    </button>
  );
  return (
    <input autoFocus type="date" value={lv}
      onChange={(e) => setLv(e.target.value)}
      onBlur={() => { setEd(false); const nv = lv || null; if (nv !== value) onSave(nv); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }}
      className="w-full border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none" />
  );
}
function EdText({ value, onSave, placeholder = "" }: { value: string | null; onSave: (v: string | null) => void; placeholder?: string }) {
  const [ed, setEd] = useState(false);
  const [lv, setLv] = useState("");
  if (!ed) return (
    <button onClick={() => { setLv(value ?? ""); setEd(true); }}
      className="w-full text-left text-stone-500 hover:bg-amber-50 rounded px-1 py-0.5 cursor-text min-h-[20px] truncate">
      {value || <span className="text-stone-300">—</span>}
    </button>
  );
  return (
    <input autoFocus value={lv}
      onChange={(e) => setLv(e.target.value)}
      onBlur={() => { setEd(false); const nv = lv.trim() || null; if (nv !== value) onSave(nv); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }}
      placeholder={placeholder}
      className="w-full border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none" />
  );
}

export function DealTriggerPrices({
  dealId,
  side,
  currencySymbol,
  defaultBasis = "shipment_date",
  defaultProductTypeId,
  defaultDiscount = 0,
  defaultQuotation = null,
  priceCondition = "trigger",
}: {
  dealId: string;
  side: "supplier" | "buyer";
  currencySymbol: string;
  defaultBasis?: TriggerBasis;
  defaultProductTypeId?: string | null;
  defaultDiscount?: number;
  defaultQuotation?: number | null;
  priceCondition?: string;
}) {
  const isTrigger = priceCondition === "trigger";
  const { data, loading, insert, update, remove } = useDealTriggerPrices(dealId, side);

  // Apply a partial patch to a row and recompute derived fields (calculated_price, amount).
  function applyRowPatch(row: ShipmentPrice, patch: Partial<ShipmentPrice>) {
    const next: Partial<ShipmentPrice> = { ...patch };
    const q = patch.quotation_avg !== undefined ? patch.quotation_avg : row.quotation_avg;
    const d = patch.discount !== undefined ? patch.discount : row.discount;
    const v = patch.volume !== undefined ? patch.volume : row.volume;
    const price = q != null ? q - (d ?? 0) : null;
    next.calculated_price = price;
    next.amount = price != null && v != null ? v * price : null;
    return update(row.id, next);
  }
  const [adding, setAdding] = useState(false);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const sbRef = useRef(createClient());

  // Form state
  const [shipDate, setShipDate] = useState("");
  const [borderDate, setBorderDate] = useState("");
  const [triggerDays, setTriggerDays] = useState("35");
  const [basis, setBasis] = useState<TriggerBasis>(defaultBasis);
  const [productTypeId, setProductTypeId] = useState(defaultProductTypeId ?? "");
  const [quotationAvg, setQuotationAvg] = useState<number | null>(null);
  const [discount, setDiscount] = useState(String(defaultDiscount));
  const [volume, setVolume] = useState("");
  const [notes, setNotes] = useState("");
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    sbRef.current.from("quotation_product_types").select("id, name").order("name")
      .then(({ data }) => setProductTypes((data ?? []) as ProductType[]));
  }, []);

  // Pre-fill the quotation from the deal when opening the form in non-trigger mode.
  // In trigger mode the value is fetched via the "Получить" button.
  useEffect(() => {
    if (adding && !isTrigger && quotationAvg == null && defaultQuotation != null) {
      setQuotationAvg(defaultQuotation);
    }
    // Intentional: only react when `adding` flips open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding]);

  // Auto-fetch quotation when date + product type are set
  async function fetchQuotation() {
    const startDate = basis === "shipment_date" ? shipDate : borderDate;
    if (!startDate || !productTypeId) return;
    setFetching(true);
    const avg = await fetchTriggerQuotationAvg(productTypeId, startDate, parseInt(triggerDays) || 35);
    setQuotationAvg(avg);
    setFetching(false);
  }

  const calculatedPrice = quotationAvg != null ? quotationAvg - (parseFloat(discount) || 0) : null;
  const vol = parseFloat(volume) || null;
  const amount = calculatedPrice != null && vol != null ? vol * calculatedPrice : null;

  async function handleAdd() {
    const startDate = basis === "shipment_date" ? shipDate : borderDate;
    const ok = await insert({
      shipment_date: shipDate || null,
      border_crossing_date: borderDate || null,
      trigger_start_date: startDate || null,
      trigger_days: parseInt(triggerDays) || 35,
      trigger_basis: basis,
      quotation_product_type_id: productTypeId || null,
      quotation_avg: quotationAvg,
      discount: parseFloat(discount) || 0,
      calculated_price: calculatedPrice,
      volume: vol,
      amount,
      notes: notes || null,
    });
    if (ok) {
      setAdding(false);
      setShipDate("");
      setBorderDate("");
      setQuotationAvg(null);
      setVolume("");
      setNotes("");
    }
  }

  const totalVolume = data.reduce((s, r) => s + (r.volume ?? 0), 0);
  const totalAmount = data.reduce((s, r) => s + (r.amount ?? 0), 0);

  const sideLabel = side === "supplier" ? "Поставщик" : "Покупатель";
  const modeLabel = priceCondition === "trigger" ? "Тригер" : priceCondition === "fixed" ? "Фикс цена" : priceCondition === "average_month" ? "Средний месяц" : "Цены";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[14px]">{modeLabel} — {sideLabel}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="h-7 text-[11px]">
            <Plus className="h-3 w-3 mr-1" /> Добавить отгрузку
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-[11px] text-stone-400">Загрузка...</p>
        ) : data.length === 0 && !adding ? (
          <p className="text-[11px] text-stone-400">Нет записей. Добавьте отгрузки с ценами по месяцам/датам.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="text-left py-1 pr-2 font-medium">Дата отгрузки</th>
                  <th className="text-left py-1 pr-2 font-medium">Дата границы</th>
                  <th className="text-right py-1 pr-2 font-medium">Дни</th>
                  <th className="text-right py-1 pr-2 font-medium">Котировка</th>
                  <th className="text-right py-1 pr-2 font-medium">Скидка</th>
                  <th className="text-right py-1 pr-2 font-medium">Цена</th>
                  <th className="text-right py-1 pr-2 font-medium">Объем</th>
                  <th className="text-right py-1 pr-2 font-medium">Сумма</th>
                  <th className="text-left py-1 pr-2 font-medium">Прим.</th>
                  <th className="py-1 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="py-1 pr-2"><EdDate value={row.shipment_date} onSave={(v) => update(row.id, { shipment_date: v })} /></td>
                    <td className="py-1 pr-2"><EdDate value={row.border_crossing_date} onSave={(v) => update(row.id, { border_crossing_date: v })} /></td>
                    <td className="py-1 pr-2"><EdNum value={row.trigger_days} onSave={(v) => update(row.id, { trigger_days: v ?? 35 })} /></td>
                    <td className="py-1 pr-2"><EdNum value={row.quotation_avg} onSave={(v) => applyRowPatch(row, { quotation_avg: v })} /></td>
                    <td className="py-1 pr-2"><EdNum value={row.discount} onSave={(v) => applyRowPatch(row, { discount: v })} /></td>
                    <td className="py-1 pr-2 text-right font-mono tabular-nums font-medium">{formatNum(row.calculated_price)}</td>
                    <td className="py-1 pr-2"><EdNum value={row.volume} onSave={(v) => applyRowPatch(row, { volume: v })} /></td>
                    <td className="py-1 pr-2 text-right font-mono tabular-nums font-medium">{formatNum(row.amount)}</td>
                    <td className="py-1 pr-2 max-w-[120px]"><EdText value={row.notes} onSave={(v) => update(row.id, { notes: v })} /></td>
                    <td className="py-1">
                      <button onClick={() => remove(row.id)} className="text-stone-300 hover:text-red-500 transition-colors">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
                {data.length > 0 && (
                  <tr className="border-t border-stone-300 font-medium">
                    <td colSpan={6} className="py-1 pr-2 text-right text-stone-500">Итого:</td>
                    <td className="py-1 pr-2 text-right font-mono tabular-nums">{formatNum(totalVolume)}</td>
                    <td className="py-1 pr-2 text-right font-mono tabular-nums">{formatNum(totalAmount)} {currencySymbol}</td>
                    <td colSpan={2}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Add form */}
        {adding && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/30 p-3 space-y-3">
            <p className="text-[12px] font-medium text-stone-700">Новая отгрузка — {sideLabel}</p>

            <div className="flex gap-2 items-end flex-wrap">
              <div className="w-24">
                <Label className="text-[10px]">Базис тригера</Label>
                <select value={basis} onChange={(e) => setBasis(e.target.value as TriggerBasis)}
                  className="w-full h-7 rounded border border-stone-200 bg-white px-1 text-[11px] focus:border-amber-400 focus:outline-none">
                  <option value="shipment_date">Отгрузка</option>
                  <option value="border_crossing_date">Граница</option>
                </select>
              </div>
              <div className="w-28">
                <Label className="text-[10px]">Дата отгрузки</Label>
                <Input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} className="h-7 text-[11px]" />
              </div>
              <div className="w-28">
                <Label className="text-[10px]">Дата границы</Label>
                <Input type="date" value={borderDate} onChange={(e) => setBorderDate(e.target.value)} className="h-7 text-[11px]" />
              </div>
              <div className="w-16">
                <Label className="text-[10px]">Дни</Label>
                <Input type="number" value={triggerDays} onChange={(e) => setTriggerDays(e.target.value)} className="h-7 text-[11px] font-mono" />
              </div>
            </div>

            <div className="flex gap-2 items-end flex-wrap">
              {isTrigger && (
                <>
                  <div className="w-48">
                    <Label className="text-[10px]">Продукт котировки</Label>
                    <select value={productTypeId} onChange={(e) => setProductTypeId(e.target.value)}
                      className="w-full h-7 rounded border border-stone-200 bg-white px-1 text-[11px] focus:border-amber-400 focus:outline-none">
                      <option value="">Выберите...</option>
                      {productTypes.map((pt) => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                    </select>
                  </div>
                  <Button size="sm" variant="outline" onClick={fetchQuotation} disabled={fetching} className="h-7 text-[10px]">
                    <RefreshCw className={`h-3 w-3 mr-1 ${fetching ? "animate-spin" : ""}`} />
                    Получить
                  </Button>
                </>
              )}
              <div className="w-28">
                <Label className="text-[10px]">
                  {isTrigger ? "Котировка (средняя)" : priceCondition === "fixed" ? "Цена фикс" : "Средний месяц"}
                </Label>
                <Input
                  type="number"
                  step="0.001"
                  value={quotationAvg != null ? String(quotationAvg) : ""}
                  readOnly={isTrigger}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (v === "") { setQuotationAvg(null); return; }
                    const n = parseFloat(v.replace(",", "."));
                    setQuotationAvg(Number.isFinite(n) ? n : null);
                  }}
                  className={`h-7 text-[11px] font-mono ${isTrigger ? "bg-stone-50" : ""}`}
                />
              </div>
              <div className="w-20">
                <Label className="text-[10px]">Скидка</Label>
                <Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-7 text-[11px] font-mono" />
              </div>
              <div className="w-24">
                <Label className="text-[10px]">Цена</Label>
                <Input value={calculatedPrice != null ? calculatedPrice.toFixed(3) : ""} readOnly
                  className="h-7 text-[11px] font-mono bg-stone-50 font-medium" />
              </div>
            </div>

            <div className="flex gap-2 items-end flex-wrap">
              <div className="w-24">
                <Label className="text-[10px]">Объем (тонн)</Label>
                <Input type="number" step="0.001" value={volume} onChange={(e) => setVolume(e.target.value)} className="h-7 text-[11px] font-mono" />
              </div>
              <div className="w-28">
                <Label className="text-[10px]">Сумма</Label>
                <Input value={amount != null ? formatNum(amount) : ""} readOnly
                  className="h-7 text-[11px] font-mono bg-stone-50 font-medium" />
              </div>
              <div className="flex-1">
                <Label className="text-[10px]">Примечание</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-7 text-[11px]" />
              </div>
              <Button size="sm" onClick={handleAdd} className="h-7 text-[11px]">Добавить</Button>
              <Button size="sm" variant="outline" onClick={() => setAdding(false)} className="h-7 text-[11px]">Отмена</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

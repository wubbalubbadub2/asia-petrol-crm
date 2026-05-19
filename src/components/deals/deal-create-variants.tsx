"use client";

import { useEffect, useRef } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_FORMULA_MODE,
  FORMULA_SUBMODES,
  PRICE_TIER_LABELS,
  decodePriceMode,
  priceTierOf,
  type PriceMode,
  type PriceTier,
  type TriggerBasisLite,
} from "@/lib/constants/deal-types";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { createClient } from "@/lib/supabase/client";

export type VariantDraft = {
  // ── Persisted on the line ─────────────────────────────────────
  // priceMode is the UI-level mode (manual / manual_formula /
  // average_month / fixed / trigger_shipment / trigger_border). It
  // encodes price_condition + trigger_basis — see decodePriceMode at
  // save.
  priceMode: PriceMode;
  quotationTypeId: string;
  quotation: string;          // numeric quotation value (auto from quotations table; manual override allowed)
  quotationComment: string;
  discount: string;
  price: string;              // = quotation - discount, auto-computed unless manually edited
  deliveryBasis: string;
  stationId: string;
  // Trigger config — persisted on the line when priceMode is a trigger.
  // For non-trigger modes these stay empty and are dropped on save.
  triggerDays: string;
  // Custom lookup month for «Средний месяц» mode. Empty string = use
  // the deal's own month. Stored as `selected_month` on the line.
  selectedMonth: string;
  // Stage of the formula price (only meaningful when priceMode !== 'manual').
  // 'preliminary' at deal-signing — all shipments use line.price. Manager
  // can flip to 'final' later from the deal detail page.
  priceStage: "preliminary" | "final";
  // Manual-formula FX multiplier (migration 00071). Persisted as
  // deal_*_lines.fx_rate. Used only when priceMode === 'manual_formula'
  // — price = (quotation − discount) × fxRate.
  fxRate: string;
  // ── Form-only helpers, not persisted on the line ──────────────
  fixDate: string;
  triggerStart: string;
  // Tracks per-field manual override so auto-flow stops clobbering it.
  // Reset when condition or quotation type changes (fresh autofill cycle).
  quotationManualEdited: boolean;
  priceManualEdited: boolean;
};

export const EMPTY_VARIANT: VariantDraft = {
  priceMode: "average_month",
  quotationTypeId: "",
  quotation: "",
  quotationComment: "",
  discount: "",
  price: "",
  deliveryBasis: "",
  stationId: "",
  fixDate: "",
  triggerStart: "",
  triggerDays: "37",
  selectedMonth: "",
  priceStage: "preliminary",
  fxRate: "",
  quotationManualEdited: false,
  priceManualEdited: false,
};

// Helper used by the deal-creation page when persisting a variant: turn
// VariantDraft into a column patch for deal_supplier_lines / deal_buyer_lines.
export function variantDraftToLinePatch(v: VariantDraft): {
  price_condition: "manual" | "manual_formula" | "fixed" | "average_month" | "trigger";
  trigger_basis: TriggerBasisLite | null;
  trigger_days: number | null;
  selected_month: string | null;
  price_stage: "preliminary" | "final";
} {
  const decoded = decodePriceMode(v.priceMode);
  return {
    price_condition: decoded.price_condition,
    trigger_basis:   decoded.trigger_basis,
    trigger_days:    decoded.price_condition === "trigger"
                       ? (parseInt(v.triggerDays || String(decoded.trigger_days_default ?? 35), 10) || decoded.trigger_days_default || 35)
                       : null,
    selected_month:  decoded.price_condition === "average_month"
                       ? (v.selectedMonth || null)
                       : null,
    // Stage applies to all formula modes (auto and manual_formula);
    // pure-manual stays at preliminary because there's no recompute.
    price_stage:     decoded.price_condition === "manual" ? "preliminary" : v.priceStage,
  };
}

type RefOption = { id: string; name: string };

export function VariantsCard({
  side, variants, setVariants, month, year, quotationTypes, stations,
}: {
  side: "supplier" | "buyer";
  variants: VariantDraft[];
  setVariants: (v: VariantDraft[]) => void;
  month: string;
  year: number;
  quotationTypes: RefOption[];
  stations: RefOption[];
}) {
  const stationLabel = side === "supplier" ? "Ст. отправления" : "Ст. назначения";

  function update(idx: number, patch: Partial<VariantDraft>) {
    setVariants(variants.map((v, i) => i === idx ? { ...v, ...patch } : v));
  }
  function add() {
    setVariants([...variants, { ...EMPTY_VARIANT }]);
  }
  function remove(idx: number) {
    setVariants(variants.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      {variants.map((v, idx) => (
        <VariantRow
          key={idx}
          idx={idx}
          variant={v}
          isDefault={idx === 0}
          onChange={(patch) => update(idx, patch)}
          onRemove={() => remove(idx)}
          month={month}
          year={year}
          quotationTypes={quotationTypes}
          stations={stations}
          stationLabel={stationLabel}
        />
      ))}
      <Button type="button" size="sm" variant="outline" onClick={add} className="w-full">
        <Plus className="mr-1 h-3.5 w-3.5" /> Добавить вариант
      </Button>
    </div>
  );
}

function VariantRow({
  idx, variant: v, isDefault, onChange, onRemove,
  month, year, quotationTypes, stations, stationLabel,
}: {
  idx: number;
  variant: VariantDraft;
  isDefault: boolean;
  onChange: (patch: Partial<VariantDraft>) => void;
  onRemove: () => void;
  month: string;
  year: number;
  quotationTypes: RefOption[];
  stations: RefOption[];
  stationLabel: string;
}) {
  const supabase = useRef(createClient());

  const decoded = decodePriceMode(v.priceMode);
  const isTriggerMode = decoded.price_condition === "trigger";
  const triggerBasis: TriggerBasisLite | null = decoded.trigger_basis;

  // Auto-fetch the quotation VALUE (not price) whenever condition / type /
  // dates change. The price is derived from the quotation by the next
  // effect below (price = quotation - discount). Hands off if the user
  // has manually entered something in the quotation field.
  useEffect(() => {
    if (decoded.price_condition === "manual" || !v.quotationTypeId) return;
    if (v.quotationManualEdited) return;
    // For «Средний месяц» the lookup month can be overridden by the
    // user via the selectedMonth field; otherwise default to the
    // deal's own month.
    const lookupMonth = (decoded.price_condition === "average_month" && v.selectedMonth)
      ? v.selectedMonth
      : month;
    fetchQuotationPrice(
      supabase.current,
      decoded.price_condition, v.quotationTypeId, lookupMonth, year,
      v.fixDate, v.triggerStart, v.triggerDays,
    ).then((q) => {
      if (q != null && !v.quotationManualEdited) {
        onChange({ quotation: String(Math.round(q * 100) / 100) });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.priceMode, v.quotationTypeId, month, year, v.fixDate, v.triggerStart, v.triggerDays, v.selectedMonth]);

  // Auto-compute price whenever an input changes:
  //   • manual_formula: price = (quotation − discount) × fxRate
  //   • all others:     price = quotation − discount
  // Skips when the user has explicitly entered a price value.
  useEffect(() => {
    if (v.priceManualEdited) return;
    const q = v.quotation ? parseFloat(v.quotation.replace(",", ".")) : NaN;
    if (!Number.isFinite(q)) return;
    const d = v.discount ? parseFloat(v.discount.replace(",", ".")) : 0;
    const dNum = Number.isFinite(d) ? d : 0;
    let next: string;
    if (v.priceMode === "manual_formula") {
      const fx = v.fxRate ? parseFloat(v.fxRate.replace(",", ".")) : NaN;
      if (!Number.isFinite(fx)) return;
      next = String(Math.round((q - dNum) * fx * 100) / 100);
    } else {
      next = String(Math.round((q - dNum) * 100) / 100);
    }
    if (next !== v.price) onChange({ price: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.quotation, v.discount, v.fxRate, v.priceMode, v.priceManualEdited]);

  return (
    <div className={`rounded-md border p-3 ${isDefault ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-stone-50/40"}`}>
      <div className="flex items-center justify-between mb-2">
        {isDefault ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">★ Основной</span>
        ) : (
          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-700">Вариант {idx + 1}</span>
        )}
        {!isDefault && (
          <button type="button" onClick={onRemove} className="text-red-500 hover:text-red-700">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {/* Тип цены — 2-step picker. Tier 1: manual vs formula.
            Tier 2 (only when formula): which formula subtype.
            DB shape stays the same — priceMode collapses both choices
            into a single PriceMode that decodePriceMode unwinds at save. */}
        <div>
          <Label className="text-[12px] text-stone-500">Тип цены</Label>
          <select
            value={priceTierOf(v.priceMode)}
            onChange={(e) => {
              const tier = e.target.value as PriceTier;
              if (tier === "manual") {
                onChange({
                  priceMode: "manual",
                  quotation: "", price: "", fxRate: "",
                  quotationManualEdited: false, priceManualEdited: false,
                });
              } else if (tier === "manual_formula") {
                onChange({
                  priceMode: "manual_formula",
                  quotation: "", price: "",
                  // fxRate kept — manager may want to reuse the same rate
                  quotationManualEdited: false, priceManualEdited: false,
                });
              } else {
                // Land on the default formula subtype. Seed triggerDays
                // only if that default happens to be a trigger basis.
                const dec = decodePriceMode(DEFAULT_FORMULA_MODE);
                onChange({
                  priceMode: DEFAULT_FORMULA_MODE,
                  quotation: "", price: "", fxRate: "",
                  quotationManualEdited: false, priceManualEdited: false,
                  triggerDays: dec.price_condition === "trigger"
                    ? String(dec.trigger_days_default ?? 35)
                    : v.triggerDays,
                });
              }
            }}
            className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
          >
            <option value="manual">{PRICE_TIER_LABELS.manual}</option>
            <option value="manual_formula">{PRICE_TIER_LABELS.manual_formula}</option>
            <option value="formula">{PRICE_TIER_LABELS.formula}</option>
          </select>
        </div>

        {priceTierOf(v.priceMode) === "formula" && (
          <div>
            <Label className="text-[12px] text-stone-500">Подтип формулы</Label>
            <select
              value={v.priceMode}
              onChange={(e) => {
                const next = e.target.value as PriceMode;
                const dec = decodePriceMode(next);
                onChange({
                  priceMode: next,
                  quotation: "", price: "",
                  quotationManualEdited: false, priceManualEdited: false,
                  // When switching INTO a trigger subtype, seed days from
                  // the basis-specific default (35 for shipment, 37 for
                  // border). User can edit further within 30-44 / 35-40.
                  triggerDays: dec.price_condition === "trigger"
                    ? String(dec.trigger_days_default ?? 35)
                    : v.triggerDays,
                });
              }}
              className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
            >
              {FORMULA_SUBMODES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        )}

        {/* Стадия цены — for both formula tiers (auto and manual).
            Default 'preliminary' at deal creation; manager flips to
            'final' later from the deal page once the quotation period
            closes (or after the manual values are confirmed). */}
        {(priceTierOf(v.priceMode) === "formula" || priceTierOf(v.priceMode) === "manual_formula") && (
          <div>
            <Label className="text-[12px] text-stone-500">Стадия цены</Label>
            <div className="inline-flex h-8 rounded-md border border-stone-200 bg-white p-0.5 w-full">
              <button
                type="button"
                onClick={() => v.priceStage !== "preliminary" && onChange({ priceStage: "preliminary" })}
                className={`flex-1 px-2 text-[12px] rounded-sm transition-colors ${
                  v.priceStage === "preliminary"
                    ? "bg-amber-100 text-amber-800 font-medium"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                Предварительная
              </button>
              <button
                type="button"
                onClick={() => v.priceStage !== "final" && onChange({ priceStage: "final" })}
                className={`flex-1 px-2 text-[12px] rounded-sm transition-colors ${
                  v.priceStage === "final"
                    ? "bg-emerald-100 text-emerald-800 font-medium"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                Окончательная
              </button>
            </div>
          </div>
        )}

        {/* «Котировка» (тип из таблицы) — only for auto-formula. Manual
            entry tier doesn't need it, and manual_formula gets its
            quotation value typed by hand. */}
        {decoded.price_condition !== "manual" && decoded.price_condition !== "manual_formula" && (
          <div>
            <Label className="text-[12px] text-stone-500">Котировка</Label>
            <select
              value={v.quotationTypeId}
              onChange={(e) => onChange({
                quotationTypeId: e.target.value,
                quotation: "", price: "",
                quotationManualEdited: false, priceManualEdited: false,
              })}
              className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
            >
              <option value="">Выбрать котировку...</option>
              {quotationTypes.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </div>
        )}

        {/* ───── Manual-formula trio ─────
            Wrapped in a md:col-span-3 sub-grid so the three inputs land
            together on a single row directly under the type picker, no
            matter how the outer grid has flowed so far. Replaces the
            default Котировка значение / Скидка cells for this tier
            (price cell is still rendered below). */}
        {v.priceMode === "manual_formula" && (
          <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-[12px] text-stone-500">Котировка значение</Label>
              <Input
                type="number"
                step="0.0001"
                value={v.quotation}
                onChange={(e) => onChange({ quotation: e.target.value, quotationManualEdited: e.target.value !== "" })}
                placeholder="вручную"
                className="h-8 text-[13px] font-mono"
              />
            </div>
            <div>
              <Label className="text-[12px] text-stone-500">Скидка</Label>
              <Input
                type="number"
                step="0.0001"
                value={v.discount}
                onChange={(e) => onChange({ discount: e.target.value })}
                className="h-8 text-[13px] font-mono"
              />
            </div>
            <div>
              <Label className="text-[12px] text-stone-500">Курс валют</Label>
              <Input
                type="number"
                step="0.0001"
                value={v.fxRate}
                onChange={(e) => onChange({ fxRate: e.target.value })}
                placeholder="(котировка − скидка) × курс"
                className="h-8 text-[13px] font-mono"
              />
            </div>
          </div>
        )}

        {decoded.price_condition === "fixed" && (
          <div>
            <Label className="text-[12px] text-stone-500">Дата фиксации</Label>
            <Input type="date" value={v.fixDate} onChange={(e) => onChange({ fixDate: e.target.value })} className="h-8 text-[13px]" />
          </div>
        )}

        {/* Месяц расчёта для «Средний месяц» — null/«» = месяц сделки */}
        {decoded.price_condition === "average_month" && (
          <div>
            <Label className="text-[12px] text-stone-500">
              Месяц расчёта <span className="text-[10px] text-stone-400">(по умолч. — месяц сделки)</span>
            </Label>
            <select
              value={v.selectedMonth}
              onChange={(e) => onChange({
                selectedMonth: e.target.value,
                quotation: "", price: "",
                quotationManualEdited: false, priceManualEdited: false,
              })}
              className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
            >
              <option value="">— (месяц сделки)</option>
              {MONTHS_RU.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}

        {isTriggerMode && (
          <>
            <div>
              <Label className="text-[12px] text-stone-500">
                {triggerBasis === "border_crossing_date" ? "Дата пересечения границы" : "Дата отгрузки"}
              </Label>
              <Input type="date" value={v.triggerStart} onChange={(e) => onChange({ triggerStart: e.target.value })} className="h-8 text-[13px]" />
            </div>
            <div>
              <Label className="text-[12px] text-stone-500">
                Кол-во дней <span className="text-[10px] text-stone-400">(обычно 35-40)</span>
              </Label>
              <Input type="number" value={v.triggerDays} onChange={(e) => onChange({ triggerDays: e.target.value })} className="h-8 text-[13px]" min="1" max="90" />
            </div>
          </>
        )}

        {/* Котировка значение + Скидка — default placement for the
            non-manual_formula tiers. manual_formula renders these
            (plus Курс валют) in a dedicated row above. */}
        {v.priceMode !== "manual_formula" && (
          <>
            <div>
              <Label className="text-[12px] text-stone-500">
                Котировка значение {decoded.price_condition !== "manual" && v.quotationTypeId ? (
                  v.quotationManualEdited ? <span className="text-[10px] text-amber-600">(вручную)</span>
                    : v.quotation ? <span className="text-[10px] text-green-600">(из таблицы)</span>
                    : <span className="text-[10px] text-red-500">(нет данных)</span>
                ) : ""}
              </Label>
              <Input
                type="number"
                step="0.01"
                value={v.quotation}
                onChange={(e) => onChange({ quotation: e.target.value, quotationManualEdited: e.target.value !== "" })}
                placeholder={decoded.price_condition !== "manual" ? "авто или вручную" : "вручную"}
                className="h-8 text-[13px] font-mono"
              />
            </div>

            <div>
              <Label className="text-[12px] text-stone-500">Скидка</Label>
              <Input
                type="number"
                step="0.01"
                value={v.discount}
                onChange={(e) => onChange({ discount: e.target.value })}
                className="h-8 text-[13px] font-mono"
              />
            </div>
          </>
        )}

        {/* Цена — авто = котировка − скидка, можно перебить руками. */}
        <div>
          <Label className="text-[12px] text-stone-500">
            Цена {v.priceManualEdited
              ? <span className="text-[10px] text-amber-600">(вручную)</span>
              : v.price ? <span className="text-[10px] text-green-600">(котировка − скидка)</span>
              : <span className="text-[10px] text-stone-400">(ожидание)</span>}
          </Label>
          <Input
            type="number"
            step="0.01"
            value={v.price}
            onChange={(e) => onChange({ price: e.target.value, priceManualEdited: e.target.value !== "" })}
            placeholder="авто из котировки − скидки"
            className="h-8 text-[13px] font-mono"
          />
        </div>

        <div>
          <Label className="text-[12px] text-stone-500">Базис поставки</Label>
          <Input value={v.deliveryBasis} onChange={(e) => onChange({ deliveryBasis: e.target.value })} placeholder={isDefault ? "FCA Текесу" : ""} className="h-8 text-[13px]" />
        </div>

        <div>
          <Label className="text-[12px] text-stone-500">{stationLabel}</Label>
          <select
            value={v.stationId}
            onChange={(e) => onChange({ stationId: e.target.value })}
            className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
          >
            <option value="">—</option>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="md:col-span-3">
          <Label className="text-[12px] text-stone-500">Комментарий котировки</Label>
          <Input value={v.quotationComment} onChange={(e) => onChange({ quotationComment: e.target.value })} className="h-8 text-[13px]" />
        </div>
      </div>
    </div>
  );
}

async function fetchQuotationPrice(
  supabase: ReturnType<typeof createClient>,
  condition: string, quotTypeId: string, monthName: string, yr: number,
  fixDate: string, triggerStart: string, triggerDays: string,
): Promise<number | null> {
  if (!quotTypeId) return null;

  if (condition === "average_month") {
    const monthIdx = MONTHS_RU.indexOf(monthName as (typeof MONTHS_RU)[number]) + 1;
    if (monthIdx <= 0) return null;
    const startDate = `${yr}-${String(monthIdx).padStart(2, "0")}-01`;
    const endMonth = monthIdx === 12 ? 1 : monthIdx + 1;
    const endYear = monthIdx === 12 ? yr + 1 : yr;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
    const { data } = await supabase.from("quotations")
      .select("price, price_cif_nwe, price_fob_med, price_fob_rotterdam")
      .eq("product_type_id", quotTypeId)
      .gte("date", startDate).lt("date", endDate);
    if (!data || data.length === 0) return null;
    const prices = data
      .map((d) => d.price ?? d.price_cif_nwe ?? d.price_fob_rotterdam ?? d.price_fob_med)
      .filter((p): p is number => p != null);
    return prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  }

  if (condition === "fixed" && fixDate) {
    const { data } = await supabase.from("quotations")
      .select("price, price_cif_nwe, price_fob_med, price_fob_rotterdam")
      .eq("product_type_id", quotTypeId).eq("date", fixDate).single();
    if (!data) return null;
    return data.price ?? data.price_cif_nwe ?? data.price_fob_rotterdam ?? data.price_fob_med ?? null;
  }

  if (condition === "trigger" && triggerStart && triggerDays) {
    const startDate = new Date(triggerStart);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + parseInt(triggerDays));
    const endStr = endDate.toISOString().split("T")[0];
    const { data } = await supabase.from("quotations")
      .select("price, price_cif_nwe, price_fob_med, price_fob_rotterdam")
      .eq("product_type_id", quotTypeId)
      .gte("date", triggerStart).lte("date", endStr);
    if (!data || data.length === 0) return null;
    const prices = data
      .map((d) => d.price ?? d.price_cif_nwe ?? d.price_fob_rotterdam ?? d.price_fob_med)
      .filter((p): p is number => p != null);
    return prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  }

  return null;
}

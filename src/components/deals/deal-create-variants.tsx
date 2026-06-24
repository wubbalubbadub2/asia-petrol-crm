"use client";

import { useEffect, useRef } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CALC_MODES,
  DEFAULT_FORMULA_MODE,
  FORMULA_SUBMODES,
  PRICE_TIER_LABELS,
  decodePriceMode,
  priceTierOf,
  type CalcMode,
  type PriceMode,
  type PriceTier,
  type TriggerBasisLite,
} from "@/lib/constants/deal-types";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { getColumnsForProduct } from "@/lib/constants/quotation-columns";
import { createClient } from "@/lib/supabase/client";

export type VariantDraft = {
  // ── Persisted on the line ─────────────────────────────────────
  // priceMode is the UI-level mode (manual / manual_formula /
  // fixed / trigger_shipment / trigger_border). It encodes
  // price_condition + trigger_basis — see decodePriceMode at save.
  priceMode: PriceMode;
  // Migration 00079 — «Режим расчёта», orthogonal to priceMode.
  // 'on_date'   → quotation value ON the computed target date
  // 'avg_month' → AVG over the calendar month of the target date
  // Only meaningful when tier=formula; defaults to 'on_date'.
  calcMode: CalcMode;
  quotationTypeId: string;
  // Migration 00077 — which wide column of `quotations` to read for
  // this variant (one of: price / price_cif_nwe / price_fob_med /
  // price_fob_rotterdam / price_cif_nwe_standalone). Empty string =
  // legacy fallback via fetchQuotationPrice.
  priceSource: string;
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
  // Migration 00072 — free-text appendix label («Прил. 1», «Прил. 2», etc).
  // Registry add form uses this to auto-resolve the variant.
  appendix: string;
  // ── Form-only helpers, not persisted on the line ──────────────
  fixDate: string;
  triggerStart: string;
  // Tracks per-field manual override so auto-flow stops clobbering it.
  // Reset when condition or quotation type changes (fresh autofill cycle).
  quotationManualEdited: boolean;
  priceManualEdited: boolean;
};

export const EMPTY_VARIANT: VariantDraft = {
  priceMode: "fixed",
  calcMode: "on_date",
  quotationTypeId: "",
  priceSource: "",
  quotation: "",
  quotationComment: "",
  discount: "",
  price: "",
  deliveryBasis: "",
  stationId: "",
  fixDate: "",
  triggerStart: "",
  triggerDays: "",
  selectedMonth: "",
  priceStage: "preliminary",
  fxRate: "",
  appendix: "",
  quotationManualEdited: false,
  priceManualEdited: false,
};

// Helper used by the deal-creation page when persisting a variant: turn
// VariantDraft into a column patch for deal_supplier_lines / deal_buyer_lines.
//
// Returns price_source for ANY formula-tier condition — including
// manual_in_formula (migration 00078) where the price is typed by hand
// but the quotation / sub-quotation pick is still persisted for audit.
export function variantDraftToLinePatch(v: VariantDraft): {
  price_condition: "manual" | "manual_formula" | "manual_in_formula" | "fixed" | "average_month" | "avg_to_date" | "trigger";
  trigger_basis: TriggerBasisLite | null;
  trigger_days: number | null;
  selected_month: string | null;
  price_stage: "preliminary" | "final";
  price_source: string | null;
  calc_mode: CalcMode;
} {
  const decoded = decodePriceMode(v.priceMode);
  return {
    price_condition: decoded.price_condition,
    trigger_basis:   decoded.trigger_basis,
    // Empty input ⇒ 0 (per Beken: «Кол-во дней» is optional; missing means
    // no day-shift). Was previously coerced to trigger_days_default (37/35).
    trigger_days:    decoded.price_condition === "trigger"
                       ? (parseInt(v.triggerDays, 10) || 0)
                       : null,
    // Persisted whenever the manager picks an explicit month — either
    // via calc_mode='avg_month' on a fixed/trigger subtype, or via the
    // «Средний месяц» subtype itself (which forces calc_mode='avg_month'
    // and exposes only the month picker).
    selected_month:  (v.priceMode === "average_month" || v.calcMode === "avg_month")
                       ? (v.selectedMonth || null)
                       : null,
    // Stage applies to all formula modes (auto, manual_formula, and
    // manual_in_formula); pure-manual stays at preliminary because there's
    // no recompute to do.
    price_stage:     decoded.price_condition === "manual" ? "preliminary" : v.priceStage,
    price_source:    v.priceSource || null,
    // Migration 00079 — calc_mode is persisted (DB CHECK enforces
    // 'on_date' | 'avg_month'). The «Средний месяц» subtype forces
    // calc_mode='avg_month' since the subtype itself already implies
    // a monthly average — the UI hides the selector in that case.
    calc_mode:       v.priceMode === "average_month" ? "avg_month" : v.calcMode,
  };
}

type RefOption = { id: string; name: string };

export function VariantsCard({
  side, variants, onUpdate, onAdd, onRemove, month, year, quotationTypes, stations,
}: {
  side: "supplier" | "buyer";
  variants: VariantDraft[];
  onUpdate: (idx: number, patch: Partial<VariantDraft>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  month: string;
  year: number;
  quotationTypes: RefOption[];
  stations: RefOption[];
}) {
  const stationLabel = side === "supplier" ? "Ст. отправления" : "Ст. назначения";

  return (
    <div className="space-y-2">
      {variants.map((v, idx) => (
        <VariantRow
          key={idx}
          idx={idx}
          variant={v}
          isDefault={idx === 0}
          onChange={(patch) => onUpdate(idx, patch)}
          onRemove={() => onRemove(idx)}
          month={month}
          year={year}
          quotationTypes={quotationTypes}
          stations={stations}
          stationLabel={stationLabel}
        />
      ))}
      <Button type="button" size="sm" variant="outline" onClick={onAdd} className="w-full">
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

  // Auto-fetch the quotation VALUE (not price) whenever subtype / calc
  // mode / type / dates change. The price is derived from the quotation
  // by the next effect below (price = quotation - discount). Hands off
  // if the user has manually entered something in the quotation field.
  //
  // Migration 00079 — the manager now picks two orthogonal dimensions
  // when tier=formula:
  //   • Подтип формулы (fixed / trigger_shipment / average_month) —
  //     defines how the «target date» is derived.
  //   • Режим расчёта (on_date / avg_month) — defines how to extract a
  //     price from that target date. Hidden for average_month subtype,
  //     where it's forced to avg_month.
  // We compute target_date here, then delegate to
  // compute_quotation_value(product_type_id, price_source, target_date,
  // calc_mode). When priceSource is empty, fall back to the legacy
  // wide-column lookup so existing deals keep working.
  useEffect(() => {
    // Manual tiers + the legacy «manual_in_formula» picks a quotation
    // for audit but skip auto-fetch — price is typed by hand.
    if (
      decoded.price_condition === "manual" ||
      decoded.price_condition === "manual_formula" ||
      decoded.price_condition === "manual_in_formula"
    ) return;
    if (!v.quotationTypeId) return;
    if (v.quotationManualEdited) return;

    const sub = decoded.price_condition;
    if (sub !== "fixed" && sub !== "trigger" && sub !== "average_month") return;

    // Resolve target_date + effective calc_mode.
    //   • average_month subtype: target = 15-th of v.selectedMonth, calc = avg_month
    //   • on_date / fixed / trigger: target = anchor (+ days), calc = v.calcMode
    //   • avg_month calc + manual month override: target = 15-th of v.selectedMonth
    let p_target_date: string | null = null;
    let effectiveCalcMode: CalcMode = v.calcMode;
    if (sub === "average_month") {
      if (!v.selectedMonth) return;
      p_target_date = `${v.selectedMonth}-15`;
      effectiveCalcMode = "avg_month";
    } else if (v.calcMode === "avg_month" && v.selectedMonth) {
      p_target_date = `${v.selectedMonth}-15`;
    } else {
      if (!v.triggerStart) return;
      const days = sub === "trigger" ? (parseInt(v.triggerDays, 10) || 0) : 0;
      const targetDate = new Date(v.triggerStart);
      targetDate.setUTCDate(targetDate.getUTCDate() + days);
      p_target_date = targetDate.toISOString().slice(0, 10);
    }

    if (v.priceSource) {
      supabase.current.rpc("compute_quotation_value", {
        p_product_type_id: v.quotationTypeId,
        p_price_source: v.priceSource,
        p_target_date,
        p_calc_mode: effectiveCalcMode,
      }).then(({ data, error }) => {
        if (error || data == null) return;
        if (!v.quotationManualEdited) {
          onChange({ quotation: String(Math.round(data * 100) / 100) });
        }
      });
      return;
    }

    // Legacy fallback when no price_source set — pre-00077 deals.
    // Uses the deal's month for any auto-month lookup; the wide column
    // is resolved by coalescing the first non-null price field. The new
    // «average_month» subtype is only reachable in the new RPC path
    // (needs a priceSource), so we skip the legacy fallback here.
    if (sub === "average_month") return;
    fetchQuotationPrice(
      supabase.current,
      sub, v.quotationTypeId, month, year,
      sub === "fixed" ? v.triggerStart : "", v.triggerStart, v.triggerDays,
    ).then((q) => {
      if (q != null && !v.quotationManualEdited) {
        onChange({ quotation: String(Math.round(q * 100) / 100) });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.priceMode, v.calcMode, v.quotationTypeId, v.priceSource, v.triggerStart, v.triggerDays, v.selectedMonth]);

  // Auto-compute price whenever an input changes:
  //   • manual_formula:    price = (quotation − discount) × fxRate
  //   • manual_in_formula: SKIP — price is typed by hand (migration 00078)
  //   • all others:        price = quotation − discount
  // Skips when the user has explicitly entered a price value.
  useEffect(() => {
    if (v.priceManualEdited) return;
    if (v.priceMode === "manual_in_formula") return;
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
                  priceSource: "",
                  quotationManualEdited: false, priceManualEdited: false,
                });
              } else if (tier === "manual_formula") {
                onChange({
                  priceMode: "manual_formula",
                  quotation: "", price: "",
                  priceSource: "",
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
                  priceSource: "",
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
            <option value="formula">{PRICE_TIER_LABELS.formula}</option>
            <option value="manual_formula">{PRICE_TIER_LABELS.manual_formula}</option>
          </select>
        </div>

        {/* «Подтип формулы» — three options per Beken 2026-05-24:
              • Фикс цена         — target = anchor date
              • Триггер           — target = anchor + N days (the two
                                    trigger flavours were merged; basis
                                    defaults to shipment_date in storage)
              • Средний месяц     — target = manager-picked calendar
                                    month; forces calc_mode='avg_month'
                                    and hides the «Режим расчёта» selector */}
        {priceTierOf(v.priceMode) === "formula" && (() => {
          const inSub = FORMULA_SUBMODES.some((m) => m.value === v.priceMode);
          return (
            <div>
              <Label className="text-[12px] text-stone-500">Подтип формулы</Label>
              <select
                value={inSub ? v.priceMode : ""}
                onChange={(e) => {
                  const next = e.target.value as PriceMode;
                  if (!next) return;
                  const patch: Partial<VariantDraft> = {
                    priceMode: next,
                    quotation: "", price: "",
                    quotationManualEdited: false, priceManualEdited: false,
                    // Days are optional — empty ⇒ 0.
                    triggerDays: "",
                  };
                  if (next === "average_month") {
                    // Force calc_mode and clear the anchor date — only
                    // the month picker matters.
                    patch.calcMode = "avg_month";
                    patch.triggerStart = "";
                  } else {
                    // Leaving avg_month subtype — drop the month
                    // override so the auto-fetch reverts to anchor+days.
                    patch.selectedMonth = "";
                  }
                  onChange(patch);
                }}
                className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
              >
                {!inSub && <option value="">— (не выбрано)</option>}
                {FORMULA_SUBMODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          );
        })()}

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

        {/* «Котировка» (тип из таблицы) — surfaced for every tier.
            Operator 2026-06-24: «пропали котировки, скидки» — this
            picker used to be hidden under manual / manual_formula, but
            the operator still needs the reference type recorded even
            when the numeric value is typed by hand. Auto-fetch effects
            below are gated on price_condition so picking a type on a
            manual tier is harmless (audit-only). */}
        <div>
          <Label className="text-[12px] text-stone-500">Котировка</Label>
          <select
            value={v.quotationTypeId}
            onChange={(e) => {
              const nextId = e.target.value;
              // If the newly-picked parent has a single price column,
              // auto-seed priceSource so the auto-fetch effect can fire
              // without an explicit «Подкотировка» pick.
              const parent = quotationTypes.find((q) => q.id === nextId);
              const cols = parent
                ? getColumnsForProduct(parent.name).filter((c) => c.key !== "comment")
                : [];
              onChange({
                quotationTypeId: nextId,
                priceSource: cols.length === 1 ? cols[0].key : "",
                quotation: "", price: "",
                quotationManualEdited: false, priceManualEdited: false,
              });
            }}
            className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
          >
            <option value="">Выбрать котировку...</option>
            {quotationTypes.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
        </div>

        {decoded.price_condition !== "manual" && decoded.price_condition !== "manual_formula" && (() => {
          // Derive the column options from quotation-columns.ts using the
          // parent quotation's name. Each editable column (and the
          // formula-averaged column) of the wide `quotations` layout is
          // a sub-quotation; drop the «Комментарии» text column.
          const parent = quotationTypes.find((q) => q.id === v.quotationTypeId);
          const cols = parent
            ? getColumnsForProduct(parent.name).filter((c) => c.key !== "comment")
            : [];
          const hasParent = !!parent;
          const onlyOne = cols.length === 1;
          // When there's only one column, pre-select & disable. When
          // there's no parent yet, render a disabled placeholder picker.
          const effectiveValue = onlyOne ? cols[0].key : v.priceSource;
          const disabled = !hasParent || onlyOne;
          return (
            <div>
              <Label className="text-[12px] text-stone-500">Подкотировка</Label>
              <select
                value={effectiveValue}
                disabled={disabled}
                onChange={(e) => onChange({
                  priceSource: e.target.value,
                  quotation: "", price: "",
                  quotationManualEdited: false, priceManualEdited: false,
                })}
                className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed"
              >
                {!hasParent && <option value="">— выберите котировку —</option>}
                {hasParent && !onlyOne && <option value="">Выбрать подкотировку...</option>}
                {cols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          );
        })()}

        {/* «Режим расчёта» — visible for Фикс цена / Триггер subtypes.
            Hidden under «Средний месяц» where it's forced to avg_month
            (the subtype itself already implies monthly averaging). */}
        {priceTierOf(v.priceMode) === "formula" && v.priceMode !== "average_month" && (
          <div>
            <Label className="text-[12px] text-stone-500">Режим расчёта</Label>
            <select
              value={v.calcMode}
              onChange={(e) => onChange({
                calcMode: e.target.value as CalcMode,
                // Drop the manual month override when switching back to
                // on_date so the auto-fetch reverts to anchor+days.
                selectedMonth: e.target.value === "avg_month" ? v.selectedMonth : "",
              })}
              className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
            >
              {CALC_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        )}

        {/* «Месяц котировки» — appears for the «Средний месяц» subtype
            (required, the only target-date input) or as an override
            under Фикс/Триггер + Средний месяц calc mode (overrides the
            month derived from anchor+days). */}
        {priceTierOf(v.priceMode) === "formula" &&
         (v.priceMode === "average_month" || v.calcMode === "avg_month") && (
          <div>
            <Label className="text-[12px] text-stone-500">Месяц котировки</Label>
            <Input
              type="month"
              value={v.selectedMonth}
              onChange={(e) => onChange({
                selectedMonth: e.target.value,
                quotationManualEdited: false,
              })}
              className="h-8 text-[13px]"
            />
          </div>
        )}

        {/* Курс валют — only for manual_formula. The matching
            Котировка значение / Скидка cells are rendered alongside
            every other tier below, so they stay visible regardless of
            price mode. Operator 2026-06-24 — see corresponding fix in
            deal-lines-editor.tsx. */}
        {v.priceMode === "manual_formula" && (
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
        )}

        {/* Anchor date — only under «на Дату». Under «Средний месяц»
            (either as subtype or as calc_mode) the target is the picked
            calendar month, so the anchor carries no info. */}
        {(decoded.price_condition === "fixed" || isTriggerMode) && v.calcMode === "on_date" && (
          <div>
            <Label className="text-[12px] text-stone-500">Дата</Label>
            <Input
              type="date"
              value={v.triggerStart}
              onChange={(e) => onChange({ triggerStart: e.target.value })}
              className="h-8 text-[13px]"
            />
          </div>
        )}

        {/* Day-count — shown for ANY trigger subtype, regardless of
            calc_mode. Under «на Дату» it shifts the anchor date; under
            «Средний месяц» it's still persisted on the line for record
            (contract typically still cites the trigger window). */}
        {isTriggerMode && (
          <div>
            <Label className="text-[12px] text-stone-500">
              Кол-во дней <span className="text-[10px] text-stone-400">(обычно 35-40)</span>
            </Label>
            <Input
              type="number"
              value={v.triggerDays}
              onChange={(e) => onChange({ triggerDays: e.target.value })}
              className="h-8 text-[13px]"
              min="0"
              max="90"
              placeholder="0"
            />
          </div>
        )}

        {/* Котировка значение + Скидка — surfaced for every tier
            (manual / fixed / average_month / trigger / manual_formula).
            Operator 2026-06-24: «пропали котировки, скидки» — the
            previous layout routed these through a manual_formula-only
            sub-grid, which left the slots invisible to operators
            switching between modes. They now render as plain grid
            cells alongside the other variant fields. */}
        <div>
          <Label className="text-[12px] text-stone-500">
            Котировка значение {decoded.price_condition !== "manual" && decoded.price_condition !== "manual_formula" && v.quotationTypeId ? (
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
            placeholder={
              v.priceMode === "manual_formula" ? "вручную"
                : decoded.price_condition !== "manual" ? "авто или вручную"
                : "вручную"
            }
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

        {/* Приложение + Комментарий — bottom row. Appendix is a free-text
            label (e.g. «Прил. 1»); the registry add form uses it to
            auto-resolve the variant when a shipment is registered. */}
        <div>
          <Label className="text-[12px] text-stone-500">Приложение</Label>
          <Input
            value={v.appendix}
            onChange={(e) => onChange({ appendix: e.target.value })}
            placeholder="Прил. 1"
            className="h-8 text-[13px]"
          />
        </div>
        <div className="md:col-span-2">
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

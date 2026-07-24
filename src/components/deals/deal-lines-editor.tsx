"use client";

import { useEffect, useState, useRef, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { Trash2, Plus, ChevronDown, Star, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DEFAULT_FORMULA_MODE,
  FORMULA_SUBMODES,
  PRICE_MODES,
  PRICE_TIER_LABELS,
  decodePriceMode,
  encodePriceMode,
  priceTierOf,
  type PriceMode,
  type PriceTier,
  type TriggerBasisLite,
} from "@/lib/constants/deal-types";
import {
  type DealSupplierLine,
  type DealBuyerLine,
  type LineRollup,
  updateSupplierLine,
  updateBuyerLine,
  addSupplierLine,
  addBuyerLine,
  deleteSupplierLine,
  deleteBuyerLine,
  recomputeLineShipmentPrices,
} from "@/lib/hooks/use-deal-lines";
import { invalidateShipmentPrices } from "@/lib/hooks/use-deal-trigger-prices";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { getColumnsForProduct } from "@/lib/constants/quotation-columns";
import { toast } from "sonner";
import { formatDMY } from "@/lib/format";

type PriceStage = "preliminary" | "final";

type Option = { value: string; label: string };

type CommonProps = {
  dealId: string;
  editing: boolean;
  currencySymbol: string;
  stations: Option[];
  quotationTypes: Option[];
  rollups?: Record<string, LineRollup>;
  onChanged: () => void;
  // Client 2026-07-02 «Котировочное значение не выходит»: when the
  // operator picks a formula subtype + a Подкотировка on an existing
  // line, we auto-fetch the quotation value from `quotations` via
  // compute_quotation_value(). The target month for «Средний месяц»
  // falls back to the deal's own month/year when the line doesn't
  // carry a selected_month override.
  dealMonth: string | null;
  dealYear: number | null;
};

export function SupplierLinesEditor({
  dealId, editing, currencySymbol, stations, quotationTypes, lines, rollups, onChanged,
  dealMonth, dealYear,
}: CommonProps & { lines: DealSupplierLine[] }) {
  const [busy, setBusy] = useState(false);
  // Pending finalize: holds the line id + the patch the user wants to
  // apply. We surface a styled confirmation dialog and only commit the
  // update on user confirm.
  const [pending, setPending] = useState<{ id: string; patch: Record<string, unknown> } | null>(null);

  async function handleAdd() {
    setBusy(true);
    const nextPosition = (lines.reduce((m, l) => Math.max(m, l.position), 0)) + 1;
    try {
      await addSupplierLine(dealId, nextPosition);
      onChanged();
    } finally { setBusy(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить этот вариант?")) return;
    setBusy(true);
    try {
      await deleteSupplierLine(id);
      onChanged();
    } catch { /* toast already shown */ } finally { setBusy(false); }
  }

  async function commitUpdate(id: string, patch: Record<string, unknown>) {
    const finalPatch = applyPriceFormulaPatch(patch, lines.find((l) => l.id === id));
    try {
      await updateSupplierLine(id, finalPatch);
      const updated = lines.find((l) => l.id === id);
      const willBeFinal = (patch.price_stage as PriceStage | undefined) ?? updated?.price_stage;
      if (willBeFinal === "final") {
        const n = await recomputeLineShipmentPrices(id, "supplier");
        if (n > 0) toast.success(`Пересчитано отгрузок: ${n}`);
      }
      // Bump the deal_shipment_prices pub-sub so «Окончательная цена
      // — по отгрузкам» refetches even when nothing about the price
      // changed structurally (e.g. discount / fx tweak on a final
      // variant). Cheap: just a Set iteration client-side.
      invalidateShipmentPrices(dealId);
      onChanged();
    } catch {}
  }

  function handleUpdate(id: string, patch: Record<string, unknown>) {
    // Stage flip to 'final' opens the styled confirmation dialog.
    // Anything else commits immediately.
    if (patch.price_stage === "final") {
      const current = lines.find((l) => l.id === id);
      if (current?.price_stage !== "final") {
        setPending({ id, patch });
        return;
      }
    }
    void commitUpdate(id, patch);
  }

  // Build a short identifier for the pending variant — shown in the dialog title.
  const pendingLine = pending ? lines.find((l) => l.id === pending.id) : null;
  const pendingLabel = pendingLine
    ? `${pendingLine.is_default ? "Основной" : `Вариант ${pendingLine.position}`} · ${pendingLine.quotation_type?.name ?? "без типа котировки"}`
    : "";

  return (
    <>
    <FinalizeStageDialog
      open={pending != null}
      onOpenChange={(o) => { if (!o) setPending(null); }}
      variantLabel={pendingLabel}
      onConfirm={() => { if (pending) { void commitUpdate(pending.id, pending.patch); setPending(null); } }}
    />
    <LinesEditorView
      side="supplier"
      lines={lines.map((l) => ({
        id: l.id,
        is_default: l.is_default,
        position: l.position,
        price_condition: l.price_condition,
        trigger_basis: (l as { trigger_basis?: TriggerBasisLite | null }).trigger_basis ?? null,
        trigger_days:  (l as { trigger_days?: number | null }).trigger_days ?? null,
        quotation_type_id: l.quotation_type_id,
        quotation_type_label: l.quotation_type?.name ?? null,
        quotation: l.quotation,
        quotation_comment: l.quotation_comment,
        discount: l.discount,
        price: l.price,
        delivery_basis: l.delivery_basis,
        station_id: l.departure_station_id,
        station_label: l.departure_station?.name ?? null,
        stationField: "departure_station_id",
        stationLabel: "Ст. отправления",
        rollup: rollups?.[l.id],
        price_stage: l.price_stage ?? "preliminary",
        preliminary_quotation: l.preliminary_quotation ?? null,
        preliminary_price: l.preliminary_price ?? null,
        preliminary_set_at: l.preliminary_set_at ?? null,
        selected_month: l.selected_month ?? null,
        calc_mode: ((l as { calc_mode?: string }).calc_mode ?? "avg_month") as "avg_month" | "on_date",
        selected_date: (l as { selected_date?: string | null }).selected_date ?? null,
        fx_rate: l.fx_rate ?? null,
        preliminary_fx_rate: l.preliminary_fx_rate ?? null,
        appendix: l.appendix ?? null,
        price_source: l.price_source ?? null,
        quotation_type_name: l.quotation_type?.name ?? null,
      }))}
      editing={editing}
      busy={busy}
      currencySymbol={currencySymbol}
      stations={stations}
      quotationTypes={quotationTypes}
      onAdd={handleAdd}
      onDelete={handleDelete}
      onUpdate={handleUpdate}
      dealMonth={dealMonth}
      dealYear={dealYear}
    />
    </>
  );
}

// Auto-recompute patch.price when the user edits any of the formula
// inputs (quotation / discount / fx_rate) OR flips the stage to
// «Окончательная» without explicitly touching price. Caller passes
// the current line so we can read the inputs that weren't part of
// this patch.
//
// The price_stage trigger was added 2026-07-02 — client asked that
// switching to «Окончательная» refresh price from the current
// quotation just like preliminary does on quotation change.
// Previously the flip only wrote price_stage='final' and left the
// operator to re-blur the quotation cell to force the recompute.
//
// For manual_formula lines: price = (quotation − discount) × fx_rate
//                           — all three inputs are line-level.
// For other modes:          price = quotation − discount
//                           — fx_rate is irrelevant.
//
// Skips «manual_in_formula» (Формула: Фикс цена) — that subtype
// explicitly keeps price hand-entered, matching create-form behaviour
// (deal-create-variants.tsx: «if v.priceMode === 'manual_in_formula'
// return»).
//
// Explicit `price` in the patch always wins. Missing inputs leave
// price untouched.
function applyPriceFormulaPatch(
  patch: Record<string, unknown>,
  line:
    | {
        quotation: number | null;
        discount: number | null;
        price: number | null;
        price_condition?: string | null;
        fx_rate?: number | null;
      }
    | undefined,
): Record<string, unknown> {
  if (!line) return patch;
  const touchedQuotation = "quotation" in patch;
  const touchedDiscount  = "discount" in patch;
  const touchedFx        = "fx_rate"  in patch;
  const touchedPrice     = "price"    in patch;
  const flippedToFinal   = patch.price_stage === "final";
  if (touchedPrice) return patch;
  if (!touchedQuotation && !touchedDiscount && !touchedFx && !flippedToFinal) return patch;

  const q   = touchedQuotation ? (patch.quotation as number | null) : line.quotation;
  const d   = touchedDiscount  ? (patch.discount  as number | null) : line.discount;
  const fx  = touchedFx        ? (patch.fx_rate   as number | null) : line.fx_rate ?? null;

  // Effective condition after this patch — patch.price_condition wins.
  const cond = (patch.price_condition as string | null | undefined) ?? line.price_condition;

  if (q == null) return patch;
  // «Формула: Фикс цена» — цена набивается вручную, автопересчёт
  // не трогает; матчит поведение формы создания сделки.
  if (cond === "manual_in_formula") return patch;
  if (cond === "manual_formula") {
    if (fx == null) return patch;
    return { ...patch, price: (q - (d ?? 0)) * fx };
  }
  return { ...patch, price: q - (d ?? 0) };
}

export function BuyerLinesEditor({
  dealId, editing, currencySymbol, stations, quotationTypes, lines, rollups, onChanged,
  dealMonth, dealYear,
}: CommonProps & { lines: DealBuyerLine[] }) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ id: string; patch: Record<string, unknown> } | null>(null);

  async function handleAdd() {
    setBusy(true);
    const nextPosition = (lines.reduce((m, l) => Math.max(m, l.position), 0)) + 1;
    try {
      await addBuyerLine(dealId, nextPosition);
      onChanged();
    } finally { setBusy(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить этот вариант?")) return;
    setBusy(true);
    try {
      await deleteBuyerLine(id);
      onChanged();
    } catch {} finally { setBusy(false); }
  }

  async function commitUpdate(id: string, patch: Record<string, unknown>) {
    const finalPatch = applyPriceFormulaPatch(patch, lines.find((l) => l.id === id));
    try {
      await updateBuyerLine(id, finalPatch);
      const updated = lines.find((l) => l.id === id);
      const willBeFinal = (patch.price_stage as PriceStage | undefined) ?? updated?.price_stage;
      if (willBeFinal === "final") {
        const n = await recomputeLineShipmentPrices(id, "buyer");
        if (n > 0) toast.success(`Пересчитано отгрузок: ${n}`);
      }
      // See SupplierLinesEditor.commitUpdate for the rationale.
      invalidateShipmentPrices(dealId);
      onChanged();
    } catch {}
  }

  function handleUpdate(id: string, patch: Record<string, unknown>) {
    if (patch.price_stage === "final") {
      const current = lines.find((l) => l.id === id);
      if (current?.price_stage !== "final") {
        setPending({ id, patch });
        return;
      }
    }
    void commitUpdate(id, patch);
  }

  const pendingLine = pending ? lines.find((l) => l.id === pending.id) : null;
  const pendingLabel = pendingLine
    ? `${pendingLine.is_default ? "Основной" : `Вариант ${pendingLine.position}`} · ${pendingLine.quotation_type?.name ?? "без типа котировки"}`
    : "";

  return (
    <>
    <FinalizeStageDialog
      open={pending != null}
      onOpenChange={(o) => { if (!o) setPending(null); }}
      variantLabel={pendingLabel}
      onConfirm={() => { if (pending) { void commitUpdate(pending.id, pending.patch); setPending(null); } }}
    />
    <LinesEditorView
      side="buyer"
      lines={lines.map((l) => ({
        id: l.id,
        is_default: l.is_default,
        position: l.position,
        price_condition: l.price_condition,
        trigger_basis: (l as { trigger_basis?: TriggerBasisLite | null }).trigger_basis ?? null,
        trigger_days:  (l as { trigger_days?: number | null }).trigger_days ?? null,
        quotation_type_id: l.quotation_type_id,
        quotation_type_label: l.quotation_type?.name ?? null,
        quotation: l.quotation,
        quotation_comment: l.quotation_comment,
        discount: l.discount,
        price: l.price,
        delivery_basis: l.delivery_basis,
        station_id: l.destination_station_id,
        station_label: l.destination_station?.name ?? null,
        stationField: "destination_station_id",
        stationLabel: "Ст. назначения",
        rollup: rollups?.[l.id],
        price_stage: l.price_stage ?? "preliminary",
        preliminary_quotation: l.preliminary_quotation ?? null,
        preliminary_price: l.preliminary_price ?? null,
        preliminary_set_at: l.preliminary_set_at ?? null,
        selected_month: l.selected_month ?? null,
        calc_mode: ((l as { calc_mode?: string }).calc_mode ?? "avg_month") as "avg_month" | "on_date",
        selected_date: (l as { selected_date?: string | null }).selected_date ?? null,
        fx_rate: l.fx_rate ?? null,
        preliminary_fx_rate: l.preliminary_fx_rate ?? null,
        appendix: l.appendix ?? null,
        price_source: l.price_source ?? null,
        quotation_type_name: l.quotation_type?.name ?? null,
      }))}
      editing={editing}
      busy={busy}
      currencySymbol={currencySymbol}
      stations={stations}
      quotationTypes={quotationTypes}
      onAdd={handleAdd}
      onDelete={handleDelete}
      onUpdate={handleUpdate}
      dealMonth={dealMonth}
      dealYear={dealYear}
    />
    </>
  );
}

// Shared internal view — driven by a normalized "Line" shape so both
// supplier and buyer go through the same JSX without code duplication.
type LineVM = {
  id: string;
  is_default: boolean;
  position: number;
  price_condition: string | null;
  trigger_basis: TriggerBasisLite | null;
  trigger_days: number | null;
  quotation_type_id: string | null;
  quotation_type_label: string | null;
  quotation: number | null;
  quotation_comment: string | null;
  discount: number | null;
  price: number | null;
  delivery_basis: string | null;
  station_id: string | null;
  station_label: string | null;
  stationField: "departure_station_id" | "destination_station_id";
  stationLabel: string;
  rollup?: LineRollup;
  // Stage workflow (migration 00068).
  price_stage: PriceStage;
  preliminary_quotation: number | null;
  preliminary_price: number | null;
  preliminary_set_at: string | null;
  selected_month: string | null;
  // Клиент 2026-07-10: «Режим расчёта» для average_month subtype.
  // 'avg_month' (default) — среднее по месяцу; 'on_date' —
  // котировка на selected_date. Уже существует в БД (миграция
  // 00079), теперь тянем в UI. selected_date (миграция 00114) —
  // конкретная дата для режима on_date.
  calc_mode: "avg_month" | "on_date";
  selected_date: string | null;
  // Manual-formula inputs (migration 00071). fx_rate is the
  // multiplier in (quotation − discount) × fx_rate; preliminary_fx_rate
  // snapshots the value at the moment of finalize.
  fx_rate: number | null;
  preliminary_fx_rate: number | null;
  // Migration 00072 — free-text appendix label.
  appendix: string | null;
  // Migration 00077 — «Подкотировка», concrete wide-column of
  // quotations (price_cif_nwe / price_fob_med / …). Missing on
  // legacy lines; picker only shown when the parent quotation
  // type actually exposes multiple sub-columns.
  price_source: string | null;
  // Joined name of the parent quotation type — used to look up
  // the column configuration via getColumnsForProduct.
  quotation_type_name: string | null;
};

// Resolve line.selected_month + deal month/year into a YYYY-MM string
// consumable by compute_quotation_value(). Handles two shapes clients
// have historically produced:
//   • «2026-03» — new create-form (<Input type="month" />)
//   • «март»   — lines editor SelectCell (Russian month name)
// Falls back to the deal's own month + year when the line's override is
// null. Returns null when nothing valid resolves.
function resolveTargetMonth(
  selectedMonth: string | null,
  dealMonth: string | null,
  dealYear: number | null,
): string | null {
  if (selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)) return selectedMonth;
  const name = selectedMonth ?? dealMonth;
  if (!name || dealYear == null) return null;
  const idx = MONTHS_RU.indexOf(name as (typeof MONTHS_RU)[number]);
  if (idx < 0) return null;
  const mm = String(idx + 1).padStart(2, "0");
  return `${dealYear}-${mm}`;
}

// Effect-only child: fires compute_quotation_value() whenever the line's
// (quotation_type_id + price_source + selected_month) resolves to enough
// input and the current quotation is empty. Mirrors the create form's
// auto-fetch effect (deal-create-variants.tsx line 220-285) so operators
// see the value drop in without re-typing it. Skipped on manual /
// manual_formula subtypes — those keep the value hand-entered.
function LineAutoFetchQuotation({
  line, dealMonth, dealYear, onUpdate,
}: {
  line: LineVM;
  dealMonth: string | null;
  dealYear: number | null;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
}) {
  const sbRef = useRef(createClient());
  useEffect(() => {
    // Guards: only formula subtypes read from `quotations`.
    const cond = line.price_condition;
    if (cond !== "average_month") return; // fixed/trigger need an anchor
                                          // date we don't surface here yet
    if (!line.quotation_type_id) return;
    if (!line.price_source) return;
    // Don't overwrite a value the operator already typed.
    if (line.quotation != null) return;

    // Клиент 2026-07-10: два режима расчёта.
    //   avg_month → target_date = середина selected_month/deal.month;
    //               p_calc_mode = 'avg_month'.
    //   on_date   → target_date = selected_date (YYYY-MM-DD);
    //               p_calc_mode = 'on_date'.
    let target_date: string | null = null;
    let p_calc_mode: "avg_month" | "on_date" = line.calc_mode;
    if (line.calc_mode === "on_date") {
      if (!line.selected_date) return;
      target_date = line.selected_date;
    } else {
      const targetMonth = resolveTargetMonth(line.selected_month, dealMonth, dealYear);
      if (!targetMonth) return;
      target_date = `${targetMonth}-15`;
      p_calc_mode = "avg_month";
    }

    sbRef.current
      .rpc("compute_quotation_value" as never, {
        p_product_type_id: line.quotation_type_id,
        p_price_source: line.price_source,
        p_target_date: target_date,
        p_calc_mode,
      } as never)
      .then(({ data, error }) => {
        if (error || data == null) return;
        const rounded = Math.round((data as number) * 100) / 100;
        onUpdate(line.id, { quotation: rounded });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    line.id, line.price_condition, line.quotation_type_id, line.price_source,
    line.selected_month, line.selected_date, line.calc_mode,
    line.quotation, dealMonth, dealYear,
  ]);
  return null;
}

function LinesEditorView({
  side, lines, editing, busy, currencySymbol, stations, quotationTypes,
  onAdd, onDelete, onUpdate, dealMonth, dealYear,
}: {
  side: "supplier" | "buyer";
  lines: LineVM[];
  editing: boolean;
  busy: boolean;
  currencySymbol: string;
  stations: Option[];
  quotationTypes: Option[];
  onAdd: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  dealMonth: string | null;
  dealYear: number | null;
}) {
  // Keep `side` referenced (for the eventual per-side rendering hooks).
  void side;
  const modeLabel = (mode: PriceMode) =>
    PRICE_MODES.find((m) => m.value === mode)?.label ?? "—";

  return (
    <div className="space-y-2">
      {lines.map((l, idx) => (
        <div
          key={l.id}
          className={`rounded-md border p-3 ${l.is_default ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-stone-50/40"}`}
        >
          {/* Silent auto-fetch hook — no visible UI. Renders null;
              triggers compute_quotation_value() when the operator
              picks quotation type + Подкотировка on a Средний-месяц
              line. */}
          {editing && (
            <LineAutoFetchQuotation
              line={l}
              dealMonth={dealMonth}
              dealYear={dealYear}
              onUpdate={onUpdate}
            />
          )}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-[12px]">
              {l.is_default ? (
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 font-medium">
                  <Star className="h-3 w-3" /> Основной
                </span>
              ) : (
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-700 font-medium">Вариант {idx + 1}</span>
              )}
            </div>
            {editing && !l.is_default && (
              <button
                onClick={() => onDelete(l.id)}
                disabled={busy}
                className="text-red-500 hover:text-red-700 disabled:opacity-40"
                title="Удалить вариант"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          {(() => {
            const mode = encodePriceMode(l.price_condition, l.trigger_basis);
            const tier = priceTierOf(mode);
            const isTrigger = mode === "trigger_shipment" || mode === "trigger_border";
            const daysHint = "обычно 35-40";
            const tierOptions: Option[] = [
              { value: "manual",         label: PRICE_TIER_LABELS.manual },
              { value: "formula",        label: PRICE_TIER_LABELS.formula },
              { value: "manual_formula", label: PRICE_TIER_LABELS.manual_formula },
            ];
            return (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
            {/* Тип цены — 2-step picker. Tier 1: manual vs formula.
                When tier=formula, a second cell exposes the subtype.
                Each onChange writes (price_condition, trigger_basis,
                trigger_days) via decodePriceMode — same DB shape as before. */}
            <SelectCell
              label="Тип цены"
              value={tier}
              displayValue={PRICE_TIER_LABELS[tier]}
              editing={editing}
              options={tierOptions}
              onChange={(v) => {
                const nextTier = (v as PriceTier) || "manual";
                if (nextTier === "manual") {
                  onUpdate(l.id, {
                    price_condition: "manual",
                    trigger_basis:   null,
                    trigger_days:    null,
                  });
                } else if (nextTier === "manual_formula") {
                  onUpdate(l.id, {
                    price_condition: "manual_formula",
                    trigger_basis:   null,
                    trigger_days:    null,
                  });
                } else {
                  const dec = decodePriceMode(DEFAULT_FORMULA_MODE);
                  onUpdate(l.id, {
                    price_condition: dec.price_condition,
                    trigger_basis:   dec.trigger_basis,
                    trigger_days:    dec.price_condition === "trigger"
                                       ? (l.trigger_days ?? dec.trigger_days_default ?? 35)
                                       : null,
                  });
                }
              }}
            />

            {/* Подтип формулы — only when tier=formula. */}
            {tier === "formula" && (
              <SelectCell
                label="Подтип формулы"
                value={mode}
                displayValue={modeLabel(mode)}
                editing={editing}
                options={FORMULA_SUBMODES.map((m) => ({ value: m.value, label: m.label }))}
                onChange={(v) => {
                  const dec = decodePriceMode(v as PriceMode);
                  onUpdate(l.id, {
                    price_condition: dec.price_condition,
                    trigger_basis:   dec.trigger_basis,
                    trigger_days:    dec.price_condition === "trigger"
                                       ? (l.trigger_days ?? dec.trigger_days_default ?? 35)
                                       : null,
                  });
                }}
              />
            )}

            {/* Стадия — for both formula tiers (auto-quotation and
                manual-formula). Same UX: Предварительная (default) →
                Окончательная. Flipping to final triggers a confirm +
                recompute of all existing shipments under this variant
                (the RPC handles both modes via migration 00071). */}
            {(tier === "formula" || tier === "manual_formula") && (
              <StageCell
                value={l.price_stage}
                editing={editing}
                onChange={(next) => onUpdate(l.id, { price_stage: next })}
              />
            )}

            {/* «Режим расчёта» — только для average_month subtype.
                Клиент 2026-07-10: «avg_month» (среднее по месяцу,
                как раньше) vs «on_date» (котировка на конкретную
                дату — тогда вместо месяц-селектора показываем
                date-input). До сих пор аналогичное разделение
                было только у trigger'а. */}
            {mode === "average_month" && (
              <SelectCell
                label="Режим расчёта"
                value={l.calc_mode}
                displayValue={l.calc_mode === "on_date" ? "На дату" : "Средний месяц"}
                editing={editing}
                options={[
                  { value: "avg_month", label: "Средний месяц" },
                  { value: "on_date", label: "На дату" },
                ]}
                onChange={(v) => {
                  const next = (v as "avg_month" | "on_date") || "avg_month";
                  onUpdate(l.id, {
                    calc_mode: next,
                    // Сбрасываем quotation и price, чтобы auto-fetch
                    // перезапустил с новым режимом.
                    quotation: null,
                    price: null,
                  });
                }}
              />
            )}

            {/* Месяц расчёта — только для avg_month режима. */}
            {mode === "average_month" && l.calc_mode !== "on_date" && (
              <SelectCell
                label="Месяц расчёта"
                value={l.selected_month}
                displayValue={l.selected_month ?? "(месяц сделки)"}
                editing={editing}
                options={MONTHS_RU.map((m) => ({ value: m, label: m }))}
                onChange={(v) => onUpdate(l.id, { selected_month: v || null })}
              />
            )}

            {/* Дата расчёта — только для on_date режима внутри
                average_month subtype. Инпут type="date"; при пустом
                значении котировка не будет автоматически подтянута. */}
            {mode === "average_month" && l.calc_mode === "on_date" && (
              <div>
                <span className="text-[11px] text-stone-400 block">Дата расчёта</span>
                {editing ? (
                  <input
                    type="date"
                    value={l.selected_date ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      onUpdate(l.id, {
                        selected_date: v || null,
                        quotation: null,
                        price: null,
                      });
                    }}
                    className="w-full h-8 border border-stone-300 rounded px-2 text-[13px] bg-white hover:border-amber-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-200 transition-colors font-mono"
                  />
                ) : (
                  <span className="text-[13px] text-stone-800 font-mono">
                    {l.selected_date ? formatDMY(l.selected_date) : "—"}
                  </span>
                )}
              </div>
            )}

            {/* «Котировка» (тип из таблицы) — surfaced for every tier so
                the operator always has a consistent slot for the
                reference quotation, even on «Фикс/Вручную» or
                «Формульная вручную» lines where the value is typed by
                hand. Operator 2026-06-24: «пропали котировки, скидки» —
                this cell was previously hidden under manual_formula.

                Client 2026-07-02: picking a quotation type also drops
                the current price_source — mirrors the create form so
                the operator picks a fresh sub-column for the new type.
                If the new type exposes exactly one editable column, we
                auto-seed it so the auto-fetch RPC can fire without an
                explicit «Подкотировка» pick. */}
            <SelectCell
              label="Котировка"
              value={l.quotation_type_id}
              displayValue={l.quotation_type_label ?? "—"}
              editing={editing}
              options={quotationTypes}
              onChange={(v) => {
                if (!v) {
                  onUpdate(l.id, { quotation_type_id: null, price_source: null, quotation: null, price: null });
                  return;
                }
                const parent = quotationTypes.find((q) => q.value === v);
                const cols = parent
                  ? getColumnsForProduct(parent.label).filter((c) => c.key !== "comment")
                  : [];
                onUpdate(l.id, {
                  quotation_type_id: v,
                  price_source: cols.length === 1 ? cols[0].key : null,
                  // Clear the numeric value so the LineAutoFetchQuotation
                  // effect refetches under the new type. Matches the
                  // create form which also resets quotation + price on
                  // type switch.
                  quotation: null,
                  price: null,
                });
              }}
            />

            {/* «Подкотировка» (price_source) — the specific wide-column
                the formula reads from. Mirrors the create form's second
                dropdown; previously missing on the edit view so lines
                on «Средний месяц» / «На дату» / etc. could not be
                edited fully without deleting and re-creating.
                Only shown when tier=formula (manual and manual_formula
                pick their prices without touching the wide columns). */}
            {tier === "formula" && (() => {
              const parent = quotationTypes.find((q) => q.value === l.quotation_type_id);
              // Prefer the joined parent name (accurate even if the
              // parent got renamed since the deal was saved); fall back
              // to the option label when it's not resolved yet.
              const parentName = l.quotation_type_name ?? parent?.label ?? "";
              const cols = parentName
                ? getColumnsForProduct(parentName).filter((c) => c.key !== "comment")
                : [];
              const hasParent = cols.length > 0;
              const onlyOne = cols.length === 1;
              const effectiveValue = onlyOne ? cols[0].key : (l.price_source ?? "");
              const disabled = !hasParent || onlyOne;
              const displayLabel = effectiveValue
                ? cols.find((c) => c.key === effectiveValue)?.label ?? effectiveValue
                : "—";
              return (
                <div>
                  <span className="text-[11px] text-stone-400 block">Подкотировка</span>
                  {editing ? (
                    <select
                      value={effectiveValue}
                      disabled={disabled}
                      onChange={(e) => onUpdate(l.id, {
                        price_source: e.target.value || null,
                        // Same rationale as quotation-type onChange —
                        // wipe the numeric so auto-fetch picks up the
                        // new sub-column.
                        quotation: null,
                        price: null,
                      })}
                      className="w-full h-8 rounded border border-stone-300 bg-white px-2 text-[13px] hover:border-amber-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-200 transition-colors cursor-pointer disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed"
                    >
                      {!hasParent && <option value="">— выберите котировку —</option>}
                      {hasParent && !onlyOne && <option value="">Выбрать подкотировку…</option>}
                      {cols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  ) : (
                    <span className="text-[13px] text-stone-800">{displayLabel}</span>
                  )}
                </div>
              );
            })()}

            {/* Курс валют — only meaningful for manual_formula
                (multiplier in (q − d) × fx). Displayed as a regular grid
                cell so it flows alongside Котировка значение / Скидка
                rather than living in a separate sub-grid that could push
                the inputs off the visible row. */}
            {tier === "manual_formula" && (
              <NumberCell
                label="Курс валют"
                value={l.fx_rate}
                editing={editing}
                onChange={(v) => onUpdate(l.id, { fx_rate: v })}
              />
            )}

            {/* Дни триггера — only when this variant uses a trigger */}
            {isTrigger && (
              <NumberCell
                label={`Кол-во дней (${daysHint})`}
                value={l.trigger_days}
                editing={editing}
                onChange={(v) => onUpdate(l.id, { trigger_days: v })}
                decimals={0}
              />
            )}

            {/* Цена — plain label. The current stage is shown by
                the dedicated «Стадия цены» control above, so no
                duplicate badge here. The saved preliminary value
                appears as a small history line below once a variant
                has been finalized. */}
            <div>
              <NumberCell
                label="Цена"
                value={l.price}
                editing={editing}
                onChange={(v) => onUpdate(l.id, { price: v })}
              />
              {l.price_stage === "final" && l.preliminary_price != null && (
                <div className="mt-1.5 inline-flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1">
                  <span className="rounded bg-amber-200/70 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-amber-900">
                    Предв.
                  </span>
                  <span className="font-mono tabular-nums text-[12px] font-medium text-amber-900">
                    {l.preliminary_price.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {tier === "manual_formula" && l.preliminary_fx_rate != null && (
                    <span className="text-[10px] text-amber-700/80">
                      · курс {l.preliminary_fx_rate.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                  {l.preliminary_set_at && (
                    <span className="text-[10px] text-amber-700/80">
                      · зафикс. {formatDMY(l.preliminary_set_at)}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Котировка значение + Скидка — surfaced for every tier
                (manual / fixed / average_month / trigger / manual_formula).
                Operator 2026-06-24 complaint: «пропали котировки,
                скидки» — these fields were previously routed through a
                col-span-3 sub-grid only for manual_formula, which under
                some breakpoints (or with the «Тип котировки» cell now
                always present) was easy to miss. Rendering them as
                regular grid cells keeps the layout uniform across all
                price modes. */}
            <NumberCell
              label="Котировка значение"
              value={l.quotation}
              editing={editing}
              onChange={(v) => onUpdate(l.id, { quotation: v })}
            />

            <NumberCell
              label="Скидка"
              value={l.discount}
              editing={editing}
              onChange={(v) => onUpdate(l.id, { discount: v })}
            />

            {/* Комментарий котировки */}
            <TextCell
              label="Комментарий котировки"
              value={l.quotation_comment}
              editing={editing}
              onChange={(v) => onUpdate(l.id, { quotation_comment: v })}
            />

            {/* Базис поставки */}
            <TextCell
              label="Базис поставки"
              value={l.delivery_basis}
              editing={editing}
              onChange={(v) => onUpdate(l.id, { delivery_basis: v })}
            />

            {/* Станция (отправления / назначения) */}
            <SelectCell
              label={l.stationLabel}
              value={l.station_id}
              displayValue={l.station_label ?? "—"}
              editing={editing}
              options={stations}
              onChange={(v) => onUpdate(l.id, { [l.stationField]: v || null })}
            />

            {/* Приложение — free-text label («Прил. 1», «Прил. 2», …).
                The registry add form uses this to auto-resolve which
                variant a shipment ties to when the operator picks an
                appendix value. Independent on each side. */}
            <TextCell
              label="Приложение"
              value={l.appendix}
              editing={editing}
              onChange={(v) => onUpdate(l.id, { appendix: v })}
            />
          </div>
            );
          })()}

          {/* Per-variant rollup — what's been shipped against this line */}
          {l.rollup && (l.rollup.volume > 0 || l.rollup.amount > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stone-200/70 pt-2 text-[11px]">
              <span className="text-stone-500">
                Отгружено по этому варианту:{" "}
                <span className="font-mono tabular-nums font-medium text-stone-700">
                  {l.rollup.volume.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                </span>
                <span className="text-stone-500"> тонн</span>
              </span>
              <span className="text-stone-500">
                Сумма:{" "}
                <span className="font-mono tabular-nums font-medium text-stone-700">
                  {l.rollup.amount.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-stone-500"> {currencySymbol}</span>
                {l.price != null && l.rollup.volume > 0 && (
                  <span className="ml-1 text-stone-400">
                    (по цене {l.price.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                  </span>
                )}
              </span>
              {l.rollup.volume > 0 && l.rollup.amount === 0 && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title="Зайдите в реестр и обновите эту отгрузку, чтобы пересчитать сумму">
                  ⚠ цена не разнесена
                </span>
              )}
            </div>
          )}
        </div>
      ))}

      {editing && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onAdd}
          disabled={busy}
          className="w-full"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Добавить вариант
        </Button>
      )}
    </div>
  );
}

// ─── Inline cells ───

// Stage segmented control — two pills side by side for Preliminary
// vs Final. In view mode it just renders a colored chip. In edit
// mode the manager can click the other pill, which fires onChange.
// The consumer (Supplier/BuyerLinesEditor) handles the confirm()
// dialog + the recompute RPC.
function StageCell({ value, editing, onChange }: {
  value: PriceStage;
  editing: boolean;
  onChange: (next: PriceStage) => void;
}) {
  return (
    <div>
      <span className="text-[11px] text-stone-400 block">Стадия цены</span>
      {editing ? (
        <div className="inline-flex h-8 rounded-md border border-stone-300 bg-white p-0.5">
          <button
            type="button"
            onClick={() => value !== "preliminary" && onChange("preliminary")}
            className={`px-2.5 text-[12px] rounded-sm transition-colors ${
              value === "preliminary"
                ? "bg-amber-100 text-amber-800 font-medium"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            Предварительная
          </button>
          <button
            type="button"
            onClick={() => value !== "final" && onChange("final")}
            className={`px-2.5 text-[12px] rounded-sm transition-colors ${
              value === "final"
                ? "bg-emerald-100 text-emerald-800 font-medium"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            Окончательная
          </button>
        </div>
      ) : (
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${
            value === "final"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {value === "final" ? "Окончательная" : "Предварительная"}
        </span>
      )}
    </div>
  );
}

// Styled confirmation dialog shown before flipping a variant to
// «Окончательная». Replaces the native confirm() popup — looks better
// and matches DESIGN.md.
function FinalizeStageDialog({
  open, onOpenChange, onConfirm, variantLabel,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onConfirm: () => void;
  variantLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-700" />
            </div>
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-[15px]">
                Перейти на окончательную цену?
              </DialogTitle>
              <DialogDescription className="text-[12px] text-stone-500">
                Вариант: <span className="font-medium text-stone-700">{variantLabel}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="text-[13px] text-stone-700 space-y-2">
          <p>После переключения:</p>
          <ul className="list-disc pl-5 space-y-1 text-stone-600">
            <li>Все существующие отгрузки этого варианта будут <b>пересчитаны</b> по окончательной цене.</li>
            <li>Новые отгрузки также будут считаться по окончательной формуле.</li>
            <li>Текущая <span className="rounded bg-amber-100 px-1 text-[10px] font-medium uppercase tracking-wide text-amber-800">Предварительная</span> цена <b>сохранится в истории</b> и будет видна под полем «Цена».</li>
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => { onConfirm(); onOpenChange(false); }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Перейти на окончательную
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumberCell({ label, value, editing, onChange, decimals = 2 }: {
  label: ReactNode;
  value: number | null;
  editing: boolean;
  onChange: (v: number | null) => void;
  /** Кол-во знаков после запятой в READ-ONLY отображении. 2 по
   * умолчанию (деньги). 0 для целых (напр. Кол-во дней триггера). */
  decimals?: number;
}) {
  const pendingVal = useRef<number | null | undefined>(undefined);
  const [, force] = useState(0);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && pendingVal.current === value) {
    pendingVal.current = undefined;
  }

  return (
    <div>
      <span className="text-[11px] text-stone-400 block">{label}</span>
      {editing ? (
        <input
          key={String(value ?? "")}
          type="number"
          step="0.0001"
          defaultValue={shown == null ? "" : String(shown)}
          onBlur={(e) => {
            const raw = e.target.value;
            const nv = raw.trim() === "" ? null : parseFloat(raw.replace(",", "."));
            if (nv !== value) {
              pendingVal.current = nv;
              force((n) => n + 1);
              onChange(nv);
            }
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-full h-8 border border-stone-300 rounded px-2 text-[13px] bg-white hover:border-amber-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-200 transition-colors font-mono tabular-nums"
        />
      ) : (
        <span className="text-[13px] text-stone-800 font-mono tabular-nums">
          {shown != null ? Number(shown).toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "—"}
        </span>
      )}
    </div>
  );
}

function TextCell({ label, value, editing, onChange }: {
  label: string;
  value: string | null;
  editing: boolean;
  onChange: (v: string | null) => void;
}) {
  const pendingVal = useRef<string | null | undefined>(undefined);
  const [, force] = useState(0);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && pendingVal.current === value) {
    pendingVal.current = undefined;
  }

  return (
    <div>
      <span className="text-[11px] text-stone-400 block">{label}</span>
      {editing ? (
        <input
          key={String(value ?? "")}
          type="text"
          defaultValue={shown ?? ""}
          onBlur={(e) => {
            const nv = e.target.value.trim() || null;
            if (nv !== value) {
              pendingVal.current = nv;
              force((n) => n + 1);
              onChange(nv);
            }
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-full h-8 border border-stone-300 rounded px-2 text-[13px] bg-white hover:border-amber-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-200 transition-colors"
        />
      ) : (
        <span className="text-[13px] text-stone-800">{shown || "—"}</span>
      )}
    </div>
  );
}

function SelectCell({ label, value, displayValue, editing, options, onChange }: {
  label: string;
  value: string | null;
  displayValue: string;
  editing: boolean;
  options: Option[];
  onChange: (v: string) => void;
}) {
  const pendingVal = useRef<string | undefined>(undefined);
  const [, force] = useState(0);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && pendingVal.current === value) {
    pendingVal.current = undefined;
  }

  if (!editing) {
    return (
      <div>
        <span className="text-[11px] text-stone-400 block">{label}</span>
        <span className="text-[13px] text-stone-800">{displayValue || "—"}</span>
      </div>
    );
  }

  // Include current value if not in options (e.g. inactive ref)
  const hasCurrent = shown && options.some((o) => o.value === shown);

  return (
    <div>
      <span className="text-[11px] text-stone-400 block">{label}</span>
      <div className="relative">
        <select
          value={shown ?? ""}
          onChange={(e) => {
            const nv = e.target.value;
            pendingVal.current = nv;
            force((n) => n + 1);
            onChange(nv);
          }}
          className="w-full h-8 rounded border border-stone-300 hover:border-amber-400 bg-white pl-2 pr-7 text-[13px] text-stone-800 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-200 cursor-pointer appearance-none transition-colors"
        >
          <option value="">—</option>
          {!hasCurrent && shown && <option value={shown}>{displayValue || "—"}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
      </div>
    </div>
  );
}

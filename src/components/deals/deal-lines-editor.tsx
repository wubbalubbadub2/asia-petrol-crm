"use client";

import { useState, useRef } from "react";
import { Trash2, Plus, ChevronDown, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PRICE_MODES,
  encodePriceMode,
  decodePriceMode,
  type PriceMode,
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
} from "@/lib/hooks/use-deal-lines";

type Option = { value: string; label: string };

type CommonProps = {
  dealId: string;
  editing: boolean;
  currencySymbol: string;
  stations: Option[];
  quotationTypes: Option[];
  rollups?: Record<string, LineRollup>;
  onChanged: () => void;
};

export function SupplierLinesEditor({
  dealId, editing, currencySymbol, stations, quotationTypes, lines, rollups, onChanged,
}: CommonProps & { lines: DealSupplierLine[] }) {
  const [busy, setBusy] = useState(false);

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

  async function handleUpdate(id: string, patch: Record<string, unknown>) {
    // When the user edits the quotation or discount on a line, recompute
    // price = quotation - discount inside the same UPDATE so the supplier
    // shipped amount stays in sync. Editing the price field directly skips
    // the recompute (patch.price is set explicitly by the caller).
    const finalPatch = applyPriceFormulaPatch(patch, lines.find((l) => l.id === id));
    try { await updateSupplierLine(id, finalPatch); onChanged(); } catch {}
  }

  return (
    <LinesEditorView
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
      }))}
      editing={editing}
      busy={busy}
      currencySymbol={currencySymbol}
      stations={stations}
      quotationTypes={quotationTypes}
      onAdd={handleAdd}
      onDelete={handleDelete}
      onUpdate={handleUpdate}
    />
  );
}

// Adds patch.price = quotation - discount when the user edits one of those
// two without also touching price. Caller passes the current line so we
// can read the field that wasn't part of this patch. If the resulting
// quotation is non-numeric we leave price untouched.
function applyPriceFormulaPatch(
  patch: Record<string, unknown>,
  line: { quotation: number | null; discount: number | null; price: number | null } | undefined,
): Record<string, unknown> {
  if (!line) return patch;
  const touchedQuotation = "quotation" in patch;
  const touchedDiscount  = "discount" in patch;
  const touchedPrice     = "price" in patch;
  if (touchedPrice) return patch;       // explicit price — keep as is
  if (!touchedQuotation && !touchedDiscount) return patch;
  const q = touchedQuotation ? (patch.quotation as number | null) : line.quotation;
  if (q == null) return patch;
  const d = touchedDiscount ? (patch.discount as number | null) : line.discount;
  return { ...patch, price: q - (d ?? 0) };
}

export function BuyerLinesEditor({
  dealId, editing, currencySymbol, stations, quotationTypes, lines, rollups, onChanged,
}: CommonProps & { lines: DealBuyerLine[] }) {
  const [busy, setBusy] = useState(false);

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

  async function handleUpdate(id: string, patch: Record<string, unknown>) {
    const finalPatch = applyPriceFormulaPatch(patch, lines.find((l) => l.id === id));
    try { await updateBuyerLine(id, finalPatch); onChanged(); } catch {}
  }

  return (
    <LinesEditorView
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
      }))}
      editing={editing}
      busy={busy}
      currencySymbol={currencySymbol}
      stations={stations}
      quotationTypes={quotationTypes}
      onAdd={handleAdd}
      onDelete={handleDelete}
      onUpdate={handleUpdate}
    />
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
};

function LinesEditorView({
  lines, editing, busy, currencySymbol, stations, quotationTypes,
  onAdd, onDelete, onUpdate,
}: {
  lines: LineVM[];
  editing: boolean;
  busy: boolean;
  currencySymbol: string;
  stations: Option[];
  quotationTypes: Option[];
  onAdd: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
}) {
  const modeLabel = (mode: PriceMode) =>
    PRICE_MODES.find((m) => m.value === mode)?.label ?? "—";

  return (
    <div className="space-y-2">
      {lines.map((l, idx) => (
        <div
          key={l.id}
          className={`rounded-md border p-3 ${l.is_default ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-stone-50/40"}`}
        >
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
            const isTrigger = mode === "trigger_shipment" || mode === "trigger_border";
            const daysHint = mode === "trigger_border" ? "обычно 35-40" : "обычно 30-44";
            return (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
            {/* Тип цены — encodes (price_condition, trigger_basis) */}
            <SelectCell
              label="Тип цены"
              value={mode}
              displayValue={modeLabel(mode)}
              editing={editing}
              options={PRICE_MODES.map((m) => ({ value: m.value, label: m.label }))}
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

            {/* Котировка */}
            <SelectCell
              label="Котировка"
              value={l.quotation_type_id}
              displayValue={l.quotation_type_label ?? "—"}
              editing={editing}
              options={quotationTypes}
              onChange={(v) => onUpdate(l.id, { quotation_type_id: v || null })}
            />

            {/* Дни триггера — only when this variant uses a trigger */}
            {isTrigger && (
              <NumberCell
                label={`Кол-во дней (${daysHint})`}
                value={l.trigger_days}
                editing={editing}
                onChange={(v) => onUpdate(l.id, { trigger_days: v })}
              />
            )}

            {/* Цена */}
            <NumberCell
              label="Цена"
              value={l.price}
              editing={editing}
              onChange={(v) => onUpdate(l.id, { price: v })}
            />

            {/* Котировка значение */}
            <NumberCell
              label="Котировка значение"
              value={l.quotation}
              editing={editing}
              onChange={(v) => onUpdate(l.id, { quotation: v })}
            />

            {/* Скидка */}
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
          </div>
            );
          })()}

          {/* Per-variant rollup — what's been shipped against this line */}
          {l.rollup && (l.rollup.volume > 0 || l.rollup.amount > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stone-200/70 pt-2 text-[11px]">
              <span className="text-stone-500">
                Отгружено по этому варианту:{" "}
                <span className="font-mono tabular-nums font-medium text-stone-700">
                  {l.rollup.volume.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                </span>
                <span className="text-stone-500"> тонн</span>
              </span>
              <span className="text-stone-500">
                Сумма:{" "}
                <span className="font-mono tabular-nums font-medium text-stone-700">
                  {l.rollup.amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
                </span>
                <span className="text-stone-500"> {currencySymbol}</span>
                {l.price != null && l.rollup.volume > 0 && (
                  <span className="ml-1 text-stone-400">
                    (по цене {l.price.toLocaleString("ru-RU", { maximumFractionDigits: 4 })})
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

function NumberCell({ label, value, editing, onChange }: {
  label: string;
  value: number | null;
  editing: boolean;
  onChange: (v: number | null) => void;
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
          {shown != null ? Number(shown).toLocaleString("ru-RU", { maximumFractionDigits: 4 }) : "—"}
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

"use client";

import { useState, useEffect, useRef, useMemo, createContext, useContext, memo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Trash2, ChevronDown } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type Deal, type ShipmentSnap, type PaymentSnap, updateDeal, fetchDealShipments, fetchDealPayments, invalidateDealPayments, invalidateDeal } from "@/lib/hooks/use-deals";
import { createClient } from "@/lib/supabase/client";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { useGlobalRefs } from "@/lib/refs";
import { useDelayed } from "@/lib/hooks/use-delayed";
import { useTabs } from "@/lib/contexts/tabs-context";
import { toast } from "sonner";
import { parseNum } from "@/lib/utils/parse-num";
import { PairedSyncedScrollbars } from "@/components/ui/double-scroll-x";

// Keep useDelayed imported (used elsewhere conceptually + kept here in case
// future surfaces want the delayed-loader pattern again).
void useDelayed;

// Format the lazy-loaded shipments into the popover body. Header is
// «N отгрузок»; each row is «DD.MM.YYYY: объём» sorted by date asc.
function shipmentLines(
  shipments: ShipmentSnap[],
  field: "loading_volume" | "shipment_volume",
): string {
  const rows = shipments
    .filter((s) => s[field] != null)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .map((s) => {
      const v = (s[field] as number).toLocaleString("ru-RU", {
        minimumFractionDigits: 3, maximumFractionDigits: 3,
      });
      const d = s.date ? s.date.slice(0, 10).split("-").reverse().join(".") : "—";
      return `${d}: ${v}`;
    });
  if (rows.length === 0) return "Нет отгрузок";
  const word = rows.length === 1 ? "отгрузка" : "отгрузок";
  return `${rows.length} ${word}\n${rows.join("\n")}`;
}

// Money fields — always 2 decimals (client request 2026-06-26:
// «Оплата, дебет, долг, переплата — округление 2 цифры»). Applies to
// all monetary columns (price, contracted amount, shipped amount,
// payment, balance/debt, tariff) for consistency.
function formatNum(val: number | null | undefined): string {
  if (val == null || val === 0) return "";
  return val.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Volumes always show 3 decimal places (client request — «3 ноля после запятой»).
function formatVol(val: number | null | undefined): string {
  if (val == null || val === 0) return "";
  return val.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// Computed/auto monetary cells: render "0" explicitly so users see that
// the calc ran (supplier_balance = shipped − payment is a common
// legitimate zero). 2 decimals — money convention.
function formatComputedNum(val: number | null | undefined): string {
  if (val == null) return "";
  return val.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Same as formatComputedNum, but pads to exactly 3 decimals for tonnage.
function formatComputedVol(val: number | null | undefined): string {
  if (val == null) return "";
  return val.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// Same as formatComputedNum but wrapped in a span that colors negative
// values red. Used for balance / debt columns where the sign carries the
// meaning (overpayment vs остаток) and a bare leading "−" is too easy to
// miss in a dense table.
function ComputedNumSigned({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value == null) return null;
  const isNegative = value < 0;
  return (
    <span className={`${className} ${isNegative ? "text-red-600" : ""}`}>
      {formatComputedNum(value)}
    </span>
  );
}

// Convert a #RRGGBB / #RGB hex to an rgba() string with the given
// alpha. Used to derive translucent row tints from each fuel type's
// own color — operator request 2026-06-23: «every ГСМ has its own
// color. Fill the rows ... with the color of selected ГСМ». Returns
// `transparent` for missing / malformed input so the row falls back
// to the page background.
function hexToRgba(hex: string | null | undefined, alpha: number): string {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) return "transparent";
  const h = hex.length === 4
    ? hex.slice(1).split("").map((c) => c + c).join("")
    : hex.slice(1);
  if (h.length !== 6) return "transparent";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return "transparent";
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function FuelDot({ color }: { color?: string }) {
  return <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color ?? "#6B7280" }} />;
}

// Identity column link — clicking a deal code adds the deal as a
// new workspace tab (foreground), Ctrl/Cmd/middle-click adds it
// as a background tab. Falls back to a regular Link href so
// right-click → «Open in new browser tab» still works and the URL
// is meaningful for sharing.
function DealCodeLink({ dealId, dealCode }: { dealId: string; dealCode: string | null }) {
  const { openTab } = useTabs();
  const href = `/deals/${dealId}`;
  const placeholderTitle = dealCode ? `Сделка ${dealCode}` : "Сделка";
  const handle = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let the browser handle real new-tab requests so right-click /
    // shift-click keep working.
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      openTab(href, { background: true, title: placeholderTitle });
      return;
    }
    e.preventDefault();
    openTab(href, { title: placeholderTitle });
  };
  return (
    <Link
      href={href}
      onClick={handle}
      onAuxClick={(e) => {
        // Middle-click → background tab (matches browser convention).
        if (e.button === 1) {
          e.preventDefault();
          openTab(href, { background: true, title: placeholderTitle });
        }
      }}
      className="text-amber-600 underline decoration-amber-300 hover:decoration-amber-500 hover:text-amber-800 transition-colors"
    >
      {dealCode}
    </Link>
  );
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

// Click-toggle popover on a volume cell. First open fires a lazy
// shipment_registry query (cached at module level — see
// fetchDealShipments); subsequent opens for the same deal hit the
// cache and render instantly. Click outside closes. Uses createPortal
// so the popover escapes the table's overflow-auto clipping context
// and isn't trimmed when the cell is near the viewport edge.
function VolumeBreakdownCell({
  dealId, value, field, className, dataCol, dataValue,
}: {
  dealId: string;
  value: number | null | undefined;
  field: "loading_volume" | "shipment_volume";
  className?: string;
  // Selection-mode metadata (rendered as data-col / data-deal-id /
  // data-value on the inner <td> so the table-level modifier-click
  // handler can pick this cell up for sum/avg aggregation).
  dataCol?: string;
  dataValue?: number | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [shipments, setShipments] = useState<ShipmentSnap[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (cellRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  async function toggle() {
    if (open) { setOpen(false); return; }
    const rect = cellRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
    if (shipments !== null) return;
    setLoading(true);
    try {
      const data = await fetchDealShipments(dealId);
      setShipments(data);
    } catch {
      setShipments([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <td
        ref={cellRef}
        onClick={toggle}
        className={`${className ?? ""} cursor-pointer ${open ? "ring-2 ring-amber-300/70" : ""}`}
        data-col={dataCol}
        data-deal-id={dataCol ? dealId : undefined}
        data-value={dataCol && dataValue != null ? String(dataValue) : undefined}
      >
        {formatComputedVol(value)}
      </td>
      {open && pos && typeof window !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 min-w-[200px] max-w-[300px] rounded-md bg-stone-800 px-3 py-2 text-[11px] text-stone-100 shadow-xl whitespace-pre-line font-mono tabular-nums"
        >
          {loading || shipments === null ? "Загрузка…" : shipmentLines(shipments, field)}
        </div>,
        document.body,
      )}
    </>
  );
}

// Russian pluralization for «оплата / оплаты / оплат» — Russian uses
// three forms (1, 2-4, 5+) with the usual mod-10/mod-100 exceptions
// for teens. Used by the payment-breakdown popover header.
function pluralizePayments(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} оплат`;
  if (mod10 === 1) return `${n} оплата`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} оплаты`;
  return `${n} оплат`;
}

// Editable payment row inside the popover — клиент 2026-07-19: «оплаты
// и даты можно сразу в модалке менять, не проваливаясь в сделку».
// Дата + сумма редактируются inline, × удаляет запись. Каждая запись
// коммитится на blur; rollup deals.supplier_payment/buyer_payment
// пересчитывает DB-триггер, invalidateDeal() будит список.
function PaymentEditRow({ p, fallbackCurrency, onPatch, onDelete }: {
  p: PaymentSnap;
  fallbackCurrency: string;
  onPatch: (id: string, patch: { amount?: number; payment_date?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [amount, setAmount] = useState(p.amount != null ? String(p.amount) : "");
  const [date, setDate] = useState(p.payment_date?.slice(0, 10) ?? "");
  return (
    <div className="flex items-center gap-1 py-0.5">
      <input
        type="date"
        value={date}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDate(e.target.value)}
        onBlur={() => { if (date && date !== p.payment_date?.slice(0, 10)) onPatch(p.id, { payment_date: date }); }}
        className="w-[118px] rounded border border-stone-600 bg-stone-700 px-1 py-0.5 text-[11px] text-stone-100 focus:outline-none focus:border-amber-400"
      />
      <input
        type="number"
        step="0.01"
        value={amount}
        placeholder="сумма"
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setAmount(e.target.value)}
        onBlur={() => {
          // amount NOT NULL в БД — пустой ввод трактуем как 0.
          const n = amount.trim() === "" ? 0 : parseFloat(amount);
          if (!Number.isNaN(n) && n !== p.amount) onPatch(p.id, { amount: n });
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-[92px] rounded border border-stone-600 bg-stone-700 px-1 py-0.5 text-[11px] font-mono text-right text-stone-100 focus:outline-none focus:border-amber-400"
      />
      <span className="text-[10px] text-stone-400 w-8">{p.currency ?? fallbackCurrency}</span>
      <button
        type="button"
        title="Удалить оплату"
        onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
        className="text-stone-400 hover:text-red-400 px-0.5 text-[13px] leading-none"
      >×</button>
    </div>
  );
}

// UX choice (2026-06-18): single click opens the breakdown popover;
// the popover carries an «Изменить итог» button at the bottom which
// switches the cell into the existing inline-edit input. Rationale —
// splitting the cell into a number-zone + pencil-icon zone would
// reduce the click target for both actions in an already-dense table
// (~11px font, 36 columns), and we'd need to also split the totals
// row column. The popover-button keeps the cell width constant and
// keeps the inline-edit affordance discoverable (visible whenever the
// popover is open).
function PaymentBreakdownCell({
  dealId, value, side, currency, className, dataCol, dataValue,
}: {
  dealId: string;
  value: number | null | undefined;
  side: "supplier" | "buyer";
  currency: string;
  className?: string;
  dataCol?: string;
  dataValue?: number | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const pendingVal = useRef<number | null | undefined>(undefined);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) pendingVal.current = undefined;
  const [payments, setPayments] = useState<PaymentSnap[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (cellRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
      setEditing(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  async function toggle() {
    // When editing, ignore cell-click — the inner <input> handles its
    // own blur. Otherwise behave like VolumeBreakdownCell: click to
    // open, click again to close, lazy-fetch on first open.
    if (editing) return;
    if (open) { setOpen(false); return; }
    const rect = cellRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
    if (payments !== null) return;
    setLoading(true);
    try {
      const data = await fetchDealPayments(dealId, side);
      setPayments(data);
    } catch {
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }

  // Inline-CRUD по deal_payments прямо из попапа (клиент 2026-07-19).
  // После каждой записи: DB-триггер пересчитывает rollup оплаты на
  // deals; invalidateDealPayments сбрасывает Promise-кэш попапа;
  // invalidateDeal будит список сделок (колонки Оплата/Баланс/Долг).
  async function refreshAfterWrite() {
    invalidateDealPayments(dealId, side);
    try {
      const data = await fetchDealPayments(dealId, side);
      setPayments(data);
    } catch { /* список обновится при следующем открытии */ }
    invalidateDeal(dealId);
  }

  async function patchPayment(id: string, patch: { amount?: number; payment_date?: string }) {
    const sb = createClient();
    const { error } = await sb.from("deal_payments").update(patch).eq("id", id);
    if (error) { toast.error(`Оплата: ${error.message}`); return; }
    await refreshAfterWrite();
  }

  async function deletePayment(id: string) {
    if (!confirm("Удалить оплату?")) return;
    const sb = createClient();
    const { error } = await sb.from("deal_payments").delete().eq("id", id);
    if (error) { toast.error(`Оплата: ${error.message}`); return; }
    await refreshAfterWrite();
  }

  async function addPayment() {
    const sb = createClient();
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await sb.from("deal_payments").insert({
      deal_id: dealId,
      side,
      amount: 0,
      payment_date: today,
      payment_type: "payment",
    });
    if (error) { toast.error(`Оплата: ${error.message}`); return; }
    await refreshAfterWrite();
  }

  function startEdit() {
    setLocalVal(shown?.toString() ?? "");
    setEditing(true);
    // Don't close the popover — the user might want to glance at the
    // breakdown while typing the summary value. It closes when they
    // commit (Enter / blur) or hit Escape.
  }

  function commitEdit() {
    setEditing(false);
    setOpen(false);
    const num = parseNum(localVal);
    if (num !== value) {
      pendingVal.current = num;
      const field = side === "supplier" ? "supplier_payment" : "buyer_payment";
      updateDeal(dealId, { [field]: num }).catch(() => { pendingVal.current = undefined; });
    }
  }

  return (
    <>
      <td
        ref={cellRef}
        onClick={toggle}
        className={`${className ?? ""} cursor-pointer ${open ? "ring-2 ring-amber-300/70" : ""}`}
        data-col={dataCol}
        data-deal-id={dataCol ? dealId : undefined}
        data-value={dataCol && dataValue != null ? String(dataValue) : undefined}
      >
        {editing ? (
          <input
            autoFocus
            type="number"
            step="0.01"
            value={localVal}
            onChange={(e) => setLocalVal(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") { setEditing(false); setOpen(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-16 border border-amber-400 rounded px-1 py-0 text-[12px] font-mono text-right bg-amber-50 focus:outline-none focus:border-amber-500"
          />
        ) : (
          formatNum(shown)
        )}
      </td>
      {open && pos && typeof window !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 min-w-[220px] max-w-[320px] rounded-md bg-stone-800 px-3 py-2 text-[11px] text-stone-100 shadow-xl"
        >
          {loading || payments === null ? (
            <div className="font-mono">Загрузка…</div>
          ) : (
            <div>
              <div className="mb-1 font-medium">{payments.length === 0 ? "Нет оплат" : pluralizePayments(payments.length)}</div>
              {payments
                .slice()
                .sort((a, b) => (a.payment_date ?? "").localeCompare(b.payment_date ?? ""))
                .map((p) => (
                  <div key={p.id}>
                    <PaymentEditRow p={p} fallbackCurrency={currency} onPatch={patchPayment} onDelete={deletePayment} />
                    {p.description ? <div className="pl-1 text-[10px] text-stone-400">{p.description}</div> : null}
                  </div>
                ))}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); addPayment(); }}
                className="mt-1 w-full rounded border border-stone-600 px-2 py-0.5 text-[10px] text-stone-300 hover:bg-stone-700 focus:outline-none"
              >
                + Оплата
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); startEdit(); }}
            className="mt-2 w-full rounded bg-amber-500/90 px-2 py-1 text-[10px] font-medium text-stone-900 hover:bg-amber-400 focus:outline-none"
          >
            Изменить итог
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Inline cell primitives
// ─────────────────────────────────────────────────────────────────────

// Volume fields that should always display with 3 decimal places (client request).
const VOLUME_FIELDS = new Set([
  "supplier_contracted_volume", "supplier_shipped_volume",
  "buyer_contracted_volume", "buyer_ordered_volume", "buyer_shipped_volume",
  "preliminary_tonnage", "actual_shipped_volume", "invoice_volume",
]);

function EditableNumCell({ value, dealId, field, overrideField, overridden }: {
  value: number | null | undefined; dealId: string; field: string;
  // 00120: ручная правка авто-вычисляемого поля закрепляет значение —
  // в PATCH дописывается override-флаг, отображение курсив+amber.
  overrideField?: string; overridden?: boolean | null;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const pendingVal = useRef<number | null | undefined>(undefined);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) pendingVal.current = undefined;
  const isVol = VOLUME_FIELDS.has(field);
  if (!editing) return (
    <button onClick={() => { setLocalVal(shown?.toString() ?? ""); setEditing(true); }}
      title={overrideField ? (overridden ? "Введено вручную — авто-расчёт не трогает." : "Авто-расчёт. Введите значение, чтобы закрепить вручную.") : undefined}
      className={`w-full text-right font-mono text-[12px] tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[18px] min-w-[50px] ${overridden ? "italic text-amber-700" : ""}`}>
      {isVol ? formatVol(shown) : formatNum(shown)}
    </button>
  );
  return (
    <input autoFocus type="number" step={isVol ? "0.001" : "0.01"} value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => { setEditing(false); const num = parseNum(localVal); if (num !== value) { pendingVal.current = num; const patch = overrideField ? { [field]: num, [overrideField]: true } : { [field]: num }; updateDeal(dealId, patch).catch(() => { pendingVal.current = undefined; }); } }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-16 border border-amber-300 rounded px-1 py-0 text-[12px] font-mono text-right bg-amber-50/50 focus:outline-none focus:border-amber-500" />
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
      className={`w-full text-left text-[12px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[18px] truncate ${maxW}`}>
      {shown ?? ""}
    </button>
  );
  return (
    <input autoFocus value={localVal} onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => { setEditing(false); const nv = localVal || null; if (nv !== (value ?? null)) { pendingVal.current = nv; updateDeal(dealId, { [field]: nv }).catch(() => { pendingVal.current = undefined; }); } }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className={`${wide ? "w-32" : "w-20"} border border-amber-400 rounded px-1 py-0 text-[12px] bg-amber-50 focus:outline-none`} />
  );
}

// Reference-select cell: native <select> always rendered (no button↔select
// transition). One click opens the dropdown; onChange saves immediately.
// pendingVal masks the joined display label until the parent's reload
// brings the fresh deal.<rel>.name through DEAL_SELECT.
//
// A fallback <option> is emitted for shownVal when refs haven't loaded
// or don't include it (e.g. inactive entry) so the current label is
// always visible — without it the select would silently render blank.
function EditableSelectCell({ value, displayLabel, dealId, field, options, color = "stone", onSaved }: {
  value: string | null | undefined;
  displayLabel: string;
  dealId: string;
  field: string;
  options: { value: string; label: string }[];
  color?: "stone" | "amber" | "blue";
  onSaved?: () => void;
}) {
  const pendingVal = useRef<string | null | undefined>(undefined);
  const shownVal = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) pendingVal.current = undefined;
  const pendingLabel = pendingVal.current !== undefined
    ? (options.find((o) => o.value === pendingVal.current)?.label ?? "—")
    : displayLabel;
  const hasMatch = !!shownVal && options.some((o) => o.value === shownVal);
  const colorClass =
    color === "amber" ? "text-stone-700" :
    color === "blue" ? "text-stone-700" :
    "text-stone-700";
  return (
    <select
      value={shownVal ?? ""}
      onChange={(e) => {
        const nv = e.target.value || null;
        if (nv !== (value ?? null)) {
          pendingVal.current = nv;
          updateDeal(dealId, { [field]: nv })
            .then(() => { onSaved?.(); })
            .catch(() => { pendingVal.current = undefined; });
        }
      }}
      className={`w-full max-w-[140px] text-left text-[12px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-pointer min-h-[18px] appearance-none bg-transparent border-0 focus:outline-none truncate ${colorClass}`}
      title={pendingLabel || undefined}
    >
      <option value="">—</option>
      {!hasMatch && shownVal && (
        <option value={shownVal}>{pendingLabel || "—"}</option>
      )}
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
        const num = parseNum(localVal);
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

// Module-level cache for contract_ref lookups (keyed by deal_company_groups.id).
// Avoids re-querying when the same chip popover is opened repeatedly. Cleared
// on full page reload — staleness here is acceptable because contract_ref is
// edited from the deal detail page and operators don't expect live sync in
// the passport list.
const contractRefCache = new Map<string, string | null>();

// Click-toggle popover on a company-group chip's name. First open fires a
// lazy `deal_company_groups.contract_ref` query (cached at module level);
// subsequent opens for the same chip hit the cache and render instantly.
// Click outside closes. Uses createPortal so the popover escapes the
// table's overflow-auto clipping context and isn't trimmed near viewport
// edges — same pattern as VolumeBreakdownCell / PaymentBreakdownCell.
function ContractRefPopover({ cgId, label }: { cgId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [contractRef, setContractRef] = useState<string | null | undefined>(
    contractRefCache.has(cgId) ? contractRefCache.get(cgId) : undefined,
  );
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
    if (contractRef !== undefined) return;
    setLoading(true);
    try {
      const sb = createClient();
      const { data } = await sb
        .from("deal_company_groups")
        .select("contract_ref")
        .eq("id", cgId)
        .single();
      const ref = (data?.contract_ref ?? null) as string | null;
      contractRefCache.set(cgId, ref);
      setContractRef(ref);
    } catch {
      setContractRef(null);
    } finally {
      setLoading(false);
    }
  }

  const hasRef = typeof contractRef === "string" && contractRef.trim().length > 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        title="Открыть № договора"
        className={`inline-flex items-center gap-0.5 rounded px-0.5 hover:bg-purple-200/60 ${open ? "bg-purple-200/80" : ""}`}
      >
        <span>{label}</span>
        <ChevronDown className="h-2.5 w-2.5 text-purple-500" />
      </button>
      {open && pos && typeof window !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 min-w-[180px] max-w-[320px] rounded-md bg-stone-800 px-3 py-2 text-stone-100 shadow-xl"
        >
          {loading || contractRef === undefined ? (
            <div className="text-[11px]">Загрузка…</div>
          ) : hasRef ? (
            <>
              <div className="text-[10px] uppercase tracking-wide text-stone-400">№ договора</div>
              <div className="mt-0.5 text-[13px] font-mono">{contractRef}</div>
            </>
          ) : (
            <div className="text-[11px] text-stone-300">Договор не указан</div>
          )}
        </div>,
        document.body,
      )}
    </>
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
  // Pulls from the shared module cache (see lib/refs.ts). First page
  // that needs refs fires the parallel fetch once; this component then
  // reads synchronously and only re-renders when the cache resolves.
  const { refs: g } = useGlobalRefs();
  return useMemo<Refs>(() => ({
    suppliers: g.suppliers.map((c) => ({ value: c.id, label: c.short_name ?? c.full_name })),
    buyers: g.buyers.map((c) => ({ value: c.id, label: c.short_name ?? c.full_name })),
    forwarders: g.forwarders.map((r) => ({ value: r.id, label: r.name })),
    managers: g.managers.map((p) => ({ value: p.id, label: p.full_name })),
    stations: g.stations.map((r) => ({ value: r.id, label: r.name })),
    factories: g.factories.map((r) => ({ value: r.id, label: r.name })),
    fuelTypes: g.fuelTypes.map((r) => ({ value: r.id, label: r.name })),
    companyGroups: g.companyGroups.map((r) => ({ value: r.id, label: r.name })),
  }), [g]);
}

const MONTH_OPTS: Opt[] = MONTHS_RU.map((m) => ({ value: m, label: m }));

// ─────────────────────────────────────────────────────────────────────
//  PassportRefsContext
//
//  All read-only lookup data (refs + label maps) shared by every row
//  goes through this context. Rows pull from it via useContext, which
//  means the only React.memo-relevant prop a row receives is `deal`
//  (plus a stable `onDataChanged` callback + `dealType`).
//
//  When `useDeals` mutates a single deal, only that row's `deal` ref
//  changes, the rest of the array's references stay equal, and the
//  shallow-compare in React.memo bails the unchanged rows out.
// ─────────────────────────────────────────────────────────────────────

type LabelMap = Map<string, string>;
type FuelLabelMap = Map<string, { name: string; color: string }>;

type PassportRefsValue = {
  refs: Refs;
  supplierLabels: LabelMap;
  buyerLabels: LabelMap;
  factoryLabels: LabelMap;
  fuelTypeLabels: FuelLabelMap;
  forwarderLabels: LabelMap;
  managerLabels: LabelMap;
  cgLabels: LabelMap;
};

const PassportRefsContext = createContext<PassportRefsValue | null>(null);

function usePassportRefs(): PassportRefsValue {
  const ctx = useContext(PassportRefsContext);
  if (!ctx) throw new Error("PassportRow must be rendered inside <PassportRefsContext>");
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────
//  PassportRow
//
//  React.memo'd row: re-renders only when its own `deal` reference
//  changes (or onDataChanged / dealType, both stable from the parent).
//  All ref/label data lives in context, so it doesn't participate in
//  the memo comparison.
// ─────────────────────────────────────────────────────────────────────

type PassportRowProps = {
  deal: Deal;
  onDataChanged: () => void;
  rowIndex: number;
};

const PassportRow = memo(function PassportRow({ deal, onDataChanged, rowIndex }: PassportRowProps) {
  const {
    refs,
    supplierLabels,
    buyerLabels,
    factoryLabels,
    fuelTypeLabels,
    forwarderLabels,
    managerLabels,
    cgLabels,
  } = usePassportRefs();

  // Row background is tinted by the deal's ГСМ color (uniform across
  // all rows, no zebra — operator request 2026-06-23 round 2: «нам
  // теперь не нужно чередовать цвета, использовать только цвета ГСМ,
  // но чтобы было читабельно»). Single alpha picked to sit between
  // the previous even (0.08, barely visible) and zebra (0.16, too
  // strong on bright fuels) values. CSS vars drive both the base
  // tint and the :hover state — Tailwind utility classes referencing
  // them keep :hover winning on specificity.
  const fuel = deal.fuel_type_id ? fuelTypeLabels.get(deal.fuel_type_id) : null;
  const rowBg = hexToRgba(fuel?.color, 0.12);
  const rowBgHover = hexToRgba(fuel?.color, 0.22);
  const rowStyle = { "--row-bg": rowBg, "--row-bg-hover": rowBgHover } as React.CSSProperties;

  return (
    <tr
      style={rowStyle}
      className="border-b bg-[var(--row-bg)] hover:bg-[var(--row-bg-hover)]"
    >
      {/* Identity. Clicking the deal code opens the deal as a new
          workspace tab so the operator never loses the list view
          they came from. Ctrl/Cmd/middle-click keeps the click
          targeted at the list (background tab) — matches browser
          tab UX. */}
      {/* Sticky identity cell — its own bg has to match the row tint
          otherwise it would render white over the colored row when
          frozen on horizontal scroll. The opaque white fallback
          (added on top of --row-bg) keeps text readable when the
          row tint is very strong; the row tint then sits at the
          aforementioned 8%/16% alpha on top, just like every other
          cell. */}
      <td className="sticky left-0 z-10 bg-white before:absolute before:inset-0 before:bg-[var(--row-bg)] before:-z-10 border-r px-2 py-1 font-mono text-stone-700 relative">
        <DealCodeLink dealId={deal.id} dealCode={deal.deal_code} />
        <VariantsBadge supplierCount={deal.supplier_lines_count ?? 1} buyerCount={deal.buyer_lines_count ?? 1} />
      </td>
      <td className="border-r px-1 py-0.5 text-stone-700">
        <EditableSelectCell value={deal.month} displayLabel={deal.month ?? ""} dealId={deal.id} field="month" options={MONTH_OPTS} />
      </td>
      <td className="border-r px-1 py-0.5 text-stone-700">
        <EditableSelectCell value={deal.factory_id} displayLabel={(deal.factory_id && factoryLabels.get(deal.factory_id)) || ""} dealId={deal.id} field="factory_id" options={refs.factories} />
      </td>
      <td className="border-r px-1 py-0.5 text-stone-700">
        <EditableSelectCell
          value={deal.fuel_type_id}
          displayLabel={(deal.fuel_type_id && fuelTypeLabels.get(deal.fuel_type_id)?.name) || ""}
          dealId={deal.id}
          field="fuel_type_id"
          options={refs.fuelTypes}
        />
      </td>
      <td className="border-r border-stone-300 px-1 py-0.5 text-stone-700"><EditableTextCell value={deal.sulfur_percent} dealId={deal.id} field="sulfur_percent" /></td>

      {/* Supplier: 9 cols */}
      <td className="border-r px-1 py-0.5 bg-amber-50/10 text-stone-700">
        <EditableSelectCell value={deal.supplier_id} displayLabel={(deal.supplier_id && supplierLabels.get(deal.supplier_id)) || ""} dealId={deal.id} field="supplier_id" options={refs.suppliers} color="amber" />
      </td>
      <td className="border-r px-1 py-0.5 bg-amber-50/10 text-stone-700"><EditableTextCell value={deal.supplier_contract} dealId={deal.id} field="supplier_contract" /></td>
      <td className="border-r px-1 py-0.5 bg-amber-50/10 text-stone-700"><EditableTextCell value={deal.supplier_delivery_basis} dealId={deal.id} field="supplier_delivery_basis" /></td>
      <td
        className="border-r px-1 py-0.5 bg-amber-50/10 text-stone-700"
        data-col="supplier_contracted_volume" data-deal-id={deal.id}
        data-value={deal.supplier_contracted_volume ?? undefined}
      ><EditableNumCell value={deal.supplier_contracted_volume} dealId={deal.id} field="supplier_contracted_volume" /></td>
      <td
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-700" title="auto: объем × цена"
        data-col="supplier_contracted_amount" data-deal-id={deal.id}
        data-value={deal.supplier_contracted_amount ?? undefined}
      >{formatComputedNum(deal.supplier_contracted_amount)}</td>
      <td
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-700" title="цена за тонну (из условий)"
        data-col="supplier_price" data-deal-id={deal.id}
        data-value={deal.supplier_price ?? undefined}
      >{formatComputedNum(deal.supplier_price)}</td>
      <td
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-700" title="сумма из секции цен"
        data-col="supplier_shipped_amount" data-deal-id={deal.id}
        data-value={deal.supplier_shipped_amount ?? undefined}
      >{formatComputedNum(deal.supplier_shipped_amount)}</td>
      <VolumeBreakdownCell
        dealId={deal.id}
        value={deal.supplier_shipped_volume}
        field="loading_volume"
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-700"
        dataCol="supplier_shipped_volume"
        dataValue={deal.supplier_shipped_volume}
      />
      <PaymentBreakdownCell
        dealId={deal.id}
        value={deal.supplier_payment}
        side="supplier"
        currency={deal.supplier_currency ?? ""}
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-700"
        dataCol="supplier_payment"
        dataValue={deal.supplier_payment}
      />
      <td
        className="border-r border-stone-300 px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-700" title="auto: отгружено − оплата"
        data-col="supplier_balance" data-deal-id={deal.id}
        data-value={deal.supplier_balance ?? undefined}
      >
        <ComputedNumSigned value={deal.supplier_balance} />
      </td>

      {/* Company groups — editable prices */}
      <td className="border-r px-1 py-1 text-[11px] bg-purple-50/10 min-w-[140px]" colSpan={2}>
        <div className="flex items-center gap-1 flex-wrap">
          {deal.deal_company_groups?.sort((a, b) => a.position - b.position).map((cg, idx) => (
            <span key={cg.id} className="inline-flex items-center gap-0.5">
              {idx > 0 && <span className="text-stone-300 mx-0.5">→</span>}
              <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 whitespace-nowrap inline-flex items-center gap-1">
                <ContractRefPopover
                  cgId={cg.id}
                  label={cgLabels.get(cg.company_group_id) ?? cg.company_group?.name ?? ""}
                />
                <EditableCGPrice cgId={cg.id} value={cg.price} onSaved={onDataChanged} />
                <span
                  className={`rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide ${
                    cg.price_kind === "final"
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                  title={cg.price_kind === "final" ? "Окончательная цена" : "Предварительная цена"}
                >
                  {cg.price_kind === "final" ? "оконч." : "предв."}
                </span>
              </span>
            </span>
          )) ?? ""}
        </div>
      </td>

      {/* Buyer: 10 cols */}
      <td className="border-r px-1 py-0.5 bg-blue-50/10 text-stone-700">
        <EditableSelectCell value={deal.buyer_id} displayLabel={(deal.buyer_id && buyerLabels.get(deal.buyer_id)) || ""} dealId={deal.id} field="buyer_id" options={refs.buyers} color="blue" />
      </td>
      <td className="border-r px-1 py-0.5 bg-blue-50/10 text-stone-700"><EditableTextCell value={deal.buyer_contract} dealId={deal.id} field="buyer_contract" /></td>
      <td className="border-r px-1 py-0.5 bg-blue-50/10 text-stone-700"><EditableTextCell value={deal.buyer_delivery_basis} dealId={deal.id} field="buyer_delivery_basis" /></td>
      <td
        className="border-r px-1 py-0.5 bg-blue-50/10 text-stone-700"
        data-col="buyer_contracted_volume" data-deal-id={deal.id}
        data-value={deal.buyer_contracted_volume ?? undefined}
      ><EditableNumCell value={deal.buyer_contracted_volume} dealId={deal.id} field="buyer_contracted_volume" /></td>
      <td
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-700" title="auto: объем × цена"
        data-col="buyer_contracted_amount" data-deal-id={deal.id}
        data-value={deal.buyer_contracted_amount ?? undefined}
      >{formatComputedNum(deal.buyer_contracted_amount)}</td>
      <td
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-700" title="цена за тонну (из условий)"
        data-col="buyer_price" data-deal-id={deal.id}
        data-value={deal.buyer_price ?? undefined}
      >{formatComputedNum(deal.buyer_price)}</td>
      <td
        className="border-r px-1 py-0.5 bg-blue-50/10 text-stone-700"
        data-col="buyer_ordered_volume" data-deal-id={deal.id}
        data-value={deal.buyer_ordered_volume ?? undefined}
      ><EditableNumCell value={deal.buyer_ordered_volume} dealId={deal.id} field="buyer_ordered_volume" /></td>
      {/* Остаток — operator request 2026-06-23: «нужно добавить
          колонку со стороны покупателя между Заявлено и Отгружено,
          колонку Остаток по формуле отгружено минус заявлено».
          Read-only computed: shipped − ordered (negative until
          fulfilled, positive on overshipment). */}
      <td
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-700" title="auto: отгружено − заявлено"
        data-col="buyer_remaining" data-deal-id={deal.id}
        data-value={((deal.buyer_shipped_volume ?? 0) - (deal.buyer_ordered_volume ?? 0))}
      >
        {/* Остаток — это разность объёмов (тонн), не сумма; используем
            formatComputedVol чтобы было 3 знака после запятой, как и
            у других тоннажных колонок. */}
        {formatComputedVol((deal.buyer_shipped_volume ?? 0) - (deal.buyer_ordered_volume ?? 0))}
      </td>
      <VolumeBreakdownCell
        dealId={deal.id}
        value={deal.buyer_shipped_volume}
        field="shipment_volume"
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-700"
        dataCol="buyer_shipped_volume"
        dataValue={deal.buyer_shipped_volume}
      />
      <td
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-700" title="сумма из секции цен"
        data-col="buyer_shipped_amount" data-deal-id={deal.id}
        data-value={deal.buyer_shipped_amount ?? undefined}
      >{formatComputedNum(deal.buyer_shipped_amount)}</td>
      <PaymentBreakdownCell
        dealId={deal.id}
        value={deal.buyer_payment}
        side="buyer"
        currency={deal.buyer_currency ?? ""}
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-700"
        dataCol="buyer_payment"
        dataValue={deal.buyer_payment}
      />
      <td
        className="border-r border-stone-300 px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-700" title="auto: оплата − отгружено"
        data-col="buyer_debt" data-deal-id={deal.id}
        data-value={deal.buyer_debt ?? undefined}
      >
        <ComputedNumSigned value={deal.buyer_debt} />
      </td>

      {/* Logistics */}
      <td className="border-r px-1 py-0.5 text-stone-700">
        <EditableSelectCell value={deal.forwarder_id} displayLabel={(deal.forwarder_id && forwarderLabels.get(deal.forwarder_id)) || ""} dealId={deal.id} field="forwarder_id" options={refs.forwarders} />
      </td>
      <td className="border-r px-1 py-0.5 text-stone-700">
        <EditableSelectCell value={deal.logistics_company_group_id} displayLabel={(deal.logistics_company_group_id && cgLabels.get(deal.logistics_company_group_id)) || ""} dealId={deal.id} field="logistics_company_group_id" options={refs.companyGroups} />
      </td>
      {/* Тариф — operator request 2026-06-23: «в паспорте в основном
          где видны все сделки, в разделе логистика нужно добавить
          тариф». planned_tariff is the per-ton rate used to compute
          preliminary_amount = тариф × объем план; editing it here
          recomputes the next column via the existing trigger. */}
      <td
        className="border-r px-1 py-0.5 text-stone-700"
        data-col="planned_tariff" data-deal-id={deal.id}
        data-value={deal.planned_tariff ?? undefined}
      ><EditableNumCell value={deal.planned_tariff} dealId={deal.id} field="planned_tariff" /></td>
      <td
        className="border-r px-1 py-0.5 text-stone-700"
        data-col="preliminary_tonnage" data-deal-id={deal.id}
        data-value={deal.preliminary_tonnage ?? undefined}
      ><EditableNumCell value={deal.preliminary_tonnage} dealId={deal.id} field="preliminary_tonnage" /></td>
      <td
        className="border-r px-2 py-1 text-right font-mono tabular-nums text-stone-700" title="auto: тариф × объем план"
        data-col="preliminary_amount" data-deal-id={deal.id}
        data-value={deal.preliminary_amount ?? undefined}
      >{formatComputedNum(deal.preliminary_amount)}</td>
      {/* Тариф факт (логисты) — 00120: авто = Сумма ÷ объем СНТ; ручная
          правка закрепляет (actual_tariff_override). */}
      <td
        className="border-r px-1 py-0.5 text-stone-700"
        data-col="actual_tariff" data-deal-id={deal.id}
        data-value={deal.actual_tariff ?? undefined}
      ><EditableNumCell value={deal.actual_tariff} dealId={deal.id} field="actual_tariff" overrideField="actual_tariff_override" overridden={deal.actual_tariff_override} /></td>
      <VolumeBreakdownCell
        dealId={deal.id}
        value={deal.actual_shipped_volume}
        field="shipment_volume"
        className="border-r px-2 py-1 text-right font-mono tabular-nums text-stone-700"
        dataCol="actual_shipped_volume"
        dataValue={deal.actual_shipped_volume}
      />
      {/* Логистика → Сумма (invoice_amount). Was read-only; operator
          Symbat 2026-06-22: «можем сразу здесь писать сумму по
          экспедитору, не заходя в каждую сделку?». Made editable —
          writing the cell PERSISTS the value (no derived-field
          trigger touches invoice_amount on a deal UPDATE). The value
          WILL be overwritten the next time the trigger fires on
          shipment_registry / esf_documents (sum is recomputed from
          source rows), so this is for quick manual entry on deals
          that haven't been shipped yet. Title makes the rule
          visible on hover. */}
      <td
        className="border-r px-1 py-0.5 text-stone-700" title="Сумма по экспедитору. Перезапишется при следующей правке реестра/ЭСФ."
        data-col="invoice_amount" data-deal-id={deal.id}
        data-value={deal.invoice_amount ?? undefined}
      >
        <EditableNumCell value={deal.invoice_amount} dealId={deal.id} field="invoice_amount" />
      </td>
      {/* Тариф факт (грузоотпр.) — 00120: авто = Сумма грузоотпр. ÷
          входящее СНТ; ручная правка закрепляет. */}
      <td
        className="border-r px-1 py-0.5 text-stone-700"
        data-col="shipper_actual_tariff" data-deal-id={deal.id}
        data-value={deal.shipper_actual_tariff ?? undefined}
      ><EditableNumCell value={deal.shipper_actual_tariff} dealId={deal.id} field="shipper_actual_tariff" overrideField="shipper_actual_tariff_override" overridden={deal.shipper_actual_tariff_override} /></td>
      <td
        className="border-r px-2 py-1 text-right font-mono tabular-nums text-stone-700"
        title="Сумма грузоотправителя = SUM(shipment_registry.additional_expenses)."
        data-col="additional_expenses_amount" data-deal-id={deal.id}
        data-value={deal.additional_expenses_amount ?? undefined}
      >
        {formatComputedNum(deal.additional_expenses_amount)}
      </td>
      <td className="px-1 py-0.5 text-stone-700">
        <EditableSelectCell value={deal.supplier_manager_id} displayLabel={(deal.supplier_manager_id && managerLabels.get(deal.supplier_manager_id)) || ""} dealId={deal.id} field="supplier_manager_id" options={refs.managers} />
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
  );
});

// ─────────────────────────────────────────────────────────────────────
//  Skeleton placeholder row
//
//  Used during cold load (loading && deals.length === 0) so the user
//  sees the table chrome immediately instead of a blank page for up
//  to 1 s. Geometry matches the real row (36 columns, accounting for
//  the company-groups colSpan=2 merge) so column widths don't jump
//  when the real rows arrive.
// ─────────────────────────────────────────────────────────────────────

function PassportSkeletonRow() {
  // 38 visible columns: 5 identity + 10 supplier + 2 company-groups
  // (merged via colSpan=2 in real rows) + 12 buyer (Остаток column
  // added 2026-06-23) + 9 logistics (Тариф column added 2026-06-23).
  // We render them as plain cells (no colSpan merging) so the column
  // widths line up exactly with the header.
  return (
    <tr className="border-b animate-pulse">
      {Array.from({ length: 38 }).map((_, i) => (
        <td key={i} className="border-r px-2 py-1.5 bg-stone-50/50">
          <div className="h-3 rounded-sm bg-stone-100" />
        </td>
      ))}
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Selection-mode config
//
//  Multi-cell selection with a live sum/avg/count summary — client
//  2026-07-01: «как в Excel когда выделяем несколько строк можно
//  автоматом увидеть сумму». Only numeric columns participate; each
//  row's cell in these columns carries `data-col`, `data-deal-id`,
//  `data-value` attributes so the table-level onClickCapture handler
//  can pick them up on Shift/Ctrl/Cmd-click without every cell
//  having to subscribe to selection state through React.
// ─────────────────────────────────────────────────────────────────────

const NUMERIC_COLS: Record<string, { label: string; decimals: 2 | 3 }> = {
  supplier_contracted_volume: { label: "Объем контракт (Поставщик)", decimals: 3 },
  supplier_contracted_amount: { label: "Сумма дог. (Поставщик)",     decimals: 2 },
  supplier_price:             { label: "Цена (Поставщик)",           decimals: 2 },
  supplier_shipped_amount:    { label: "Отгр. сумма (Поставщик)",    decimals: 2 },
  supplier_shipped_volume:    { label: "Отгр. тонн (Поставщик)",     decimals: 3 },
  supplier_payment:           { label: "Оплата (Поставщик)",         decimals: 2 },
  supplier_balance:           { label: "Баланс (Поставщик)",         decimals: 2 },
  buyer_contracted_volume:    { label: "Объем контракт (Покупатель)", decimals: 3 },
  buyer_contracted_amount:    { label: "Сумма дог. (Покупатель)",     decimals: 2 },
  buyer_price:                { label: "Цена (Покупатель)",           decimals: 2 },
  buyer_ordered_volume:       { label: "Заявлено (Покупатель)",       decimals: 3 },
  buyer_remaining:            { label: "Остаток (Покупатель)",        decimals: 3 },
  buyer_shipped_volume:       { label: "Отгр. тонн (Покупатель)",     decimals: 3 },
  buyer_shipped_amount:       { label: "Отгр. сумма (Покупатель)",    decimals: 2 },
  buyer_payment:              { label: "Оплата (Покупатель)",         decimals: 2 },
  buyer_debt:                 { label: "Долг (Покупатель)",           decimals: 2 },
  planned_tariff:             { label: "Тариф",                       decimals: 2 },
  actual_tariff:              { label: "Тариф факт (Логистика)",      decimals: 2 },
  shipper_actual_tariff:      { label: "Тариф факт грузоотпр.",       decimals: 2 },
  preliminary_tonnage:        { label: "Объем план (Логистика)",      decimals: 3 },
  preliminary_amount:         { label: "Предв. сумма (Логистика)",    decimals: 2 },
  actual_shipped_volume:      { label: "Факт объем (Логистика)",      decimals: 3 },
  invoice_amount:             { label: "Сумма (Логистика)",           decimals: 2 },
  additional_expenses_amount: { label: "Сумма грузоотправителя (Логистика)", decimals: 2 },
};

function formatWithDecimals(v: number, decimals: 2 | 3): string {
  return v.toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

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
  const { refs: g } = useGlobalRefs();

  // Tab-switch skeleton flash. When `dealType` changes (operator
  // clicked «Паспорт KG» / «Паспорт KZ» / «Все сделки»), we briefly
  // show the skeleton rows even if the filtered data is ready
  // synchronously — addresses 2026-06-18 complaint #1: «таблица не
  // меняется сразу… должны сразу показывать skeleton». The flash is
  // cleared after a single paint via setTimeout(…, 0) so the real
  // rows commit on the very next frame; total perceived delay ~16 ms.
  const prevDealTypeRef = useRef<string>(dealType);
  const [tabFlash, setTabFlash] = useState(false);
  useEffect(() => {
    if (prevDealTypeRef.current !== dealType) {
      prevDealTypeRef.current = dealType;
      setTabFlash(true);
      const t = setTimeout(() => setTabFlash(false), 16);
      return () => clearTimeout(t);
    }
  }, [dealType]);

  // Virtualization: with 500+ deals × ~36 cells each, mounting every row
  // synchronously blocks the route commit by 5+ seconds. We render only
  // the rows visible in the viewport (+ overscan) and pad the rest with
  // two phantom <tr> rows that reserve vertical space via colSpan=36.
  //
  // Why phantom rows instead of absolute positioning: native <table>
  // layout doesn't accept absolutely-positioned <tr> children without
  // breaking column-width inheritance from <thead>. A pair of spacer
  // rows with explicit `height` keeps the table layout intact, which
  // means the sticky <thead> column widths still cascade to the body
  // (each <th> has min-w-[NN] declared above), and PassportTotalsRow
  // can still sit at the natural bottom of <tbody>.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: deals.length,
    getScrollElement: () => scrollRef.current,
    // Body rows are tightly packed (~28 px). The virtualizer
    // re-measures real rows post-mount so this only needs to be
    // close — overscan absorbs any slop on initial scroll.
    estimateSize: () => 28,
    overscan: 8,
  });

  // Resolver maps — passport rows used to read joined names from the
  // deals query (deal.supplier?.short_name etc), but those embeds were
  // 7 sub-selects per row. We dropped them from LIST_SELECT and look
  // up names here from the already-warmed refs cache. O(1) per lookup,
  // zero extra round-trips.
  const supplierLabels = useMemo(
    () => new Map(g.suppliers.map((c) => [c.id, c.short_name ?? c.full_name])),
    [g.suppliers],
  );
  const buyerLabels = useMemo(
    () => new Map(g.buyers.map((c) => [c.id, c.short_name ?? c.full_name])),
    [g.buyers],
  );
  const factoryLabels = useMemo(() => new Map(g.factories.map((r) => [r.id, r.name])), [g.factories]);
  const fuelTypeLabels = useMemo(
    () => new Map(g.fuelTypes.map((r) => [r.id, { name: r.name, color: r.color ?? "#6B7280" }])),
    [g.fuelTypes],
  );
  const forwarderLabels = useMemo(() => new Map(g.forwarders.map((r) => [r.id, r.name])), [g.forwarders]);
  const managerLabels = useMemo(() => new Map(g.managers.map((p) => [p.id, p.full_name])), [g.managers]);
  const cgLabels = useMemo(() => new Map(g.companyGroups.map((r) => [r.id, r.name])), [g.companyGroups]);

  // Bundle refs + label maps into a single context value. Identity
  // changes only when one of the warmed ref arrays changes (rare —
  // happens once at first load + on explicit refs reloads), so per-
  // row useContext reads don't churn on every filter keystroke.
  const refsContextValue = useMemo<PassportRefsValue>(() => ({
    refs,
    supplierLabels,
    buyerLabels,
    factoryLabels,
    fuelTypeLabels,
    forwarderLabels,
    managerLabels,
    cgLabels,
  }), [refs, supplierLabels, buyerLabels, factoryLabels, fuelTypeLabels, forwarderLabels, managerLabels, cgLabels]);

  // Empty-state flag — вычисляется здесь, чтобы early-return был ПОСЛЕ
  // всех остальных хуков (иначе React #300: количество вызванных хуков
  // между рендерами не совпадает, когда фильтр сужает deals до 0).
  // Bug 2026-07-07: /deals?search=<любая-непопадающая-строка> при
  // определённом тайминге приводил к «This page couldn't load»,
  // потому что этот `if (…) return` был ВЫШЕ хуков selection/keyboard.
  const empty = !loading && !tabFlash && deals.length === 0;

  // Skeleton branch — true on initial cold load OR during the brief
  // tab-switch flash. Even if `deals` already contains rows for the
  // new tab (it will, since filtering is client-side and instant),
  // tabFlash forces the skeleton for one render so the operator gets
  // immediate «click» feedback.
  const isColdLoad = (loading && deals.length === 0) || tabFlash;

  // ── Multi-cell selection ──────────────────────────────────────────
  // Excel-style: Shift-click extends from the anchor to the clicked
  // cell within the same column; Ctrl/Cmd-click toggles a single
  // cell; clicking a cell in a different column resets to just that
  // cell (anchor moves with it). Escape clears everything.
  //
  // State is deliberately kept OUT of PassportRefsContext so row
  // re-renders don't cascade on every click — the visual highlight
  // is delivered via a dynamic <style> block that emits CSS rules
  // keyed on the same data-col/data-deal-id attributes the row
  // <td>s already carry.
  const [selection, setSelection] = useState<{
    colKey: string | null;
    ids: Set<string>;
    anchorId: string | null;
  }>({ colKey: null, ids: new Set(), anchorId: null });

  function clearSelection() {
    setSelection({ colKey: null, ids: new Set(), anchorId: null });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") clearSelection();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clear selection whenever the underlying dataset changes (filters,
  // deal_type tab switch, refetch after an edit). Otherwise the
  // selected ids would keep pointing at rows that are no longer
  // visible and the footer sum would grow silently stale.
  useEffect(() => {
    clearSelection();
  }, [dealType, deals.length]);

  // Capture-phase so we intercept the click BEFORE any child cell's
  // own onClick fires (VolumeBreakdownCell.toggle,
  // EditableNumCell.startEdit). Without a modifier we bail out and
  // let the child handler run its usual path (open popover, enter
  // edit mode, etc).
  function handleTableClickCapture(e: React.MouseEvent) {
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const td = target.closest("td[data-col][data-deal-id]") as HTMLElement | null;
    if (!td) return;
    e.preventDefault();
    e.stopPropagation();
    const colKey = td.dataset.col!;
    const dealId = td.dataset.dealId!;
    setSelection((prev) => {
      // Different column → reset to single-cell selection.
      if (prev.colKey !== colKey) {
        return { colKey, ids: new Set([dealId]), anchorId: dealId };
      }
      if (e.shiftKey && prev.anchorId) {
        // Range from anchor → clicked, inclusive. Uses the currently
        // filtered `deals` array so the range only spans visible rows.
        const idxA = deals.findIndex((d) => d.id === prev.anchorId);
        const idxB = deals.findIndex((d) => d.id === dealId);
        if (idxA < 0 || idxB < 0) return prev;
        const [lo, hi] = idxA <= idxB ? [idxA, idxB] : [idxB, idxA];
        const rangeIds = new Set(deals.slice(lo, hi + 1).map((d) => d.id));
        return { colKey, ids: rangeIds, anchorId: prev.anchorId };
      }
      // Ctrl/Cmd-click: toggle individual cell + move anchor.
      const ids = new Set(prev.ids);
      if (ids.has(dealId)) ids.delete(dealId);
      else ids.add(dealId);
      return { colKey, ids, anchorId: dealId };
    });
  }

  const selectionStats = useMemo(() => {
    if (!selection.colKey || selection.ids.size === 0) return null;
    const meta = NUMERIC_COLS[selection.colKey];
    if (!meta) return null;
    let sum = 0;
    let count = 0;
    let min: number | null = null;
    let max: number | null = null;
    for (const d of deals) {
      if (!selection.ids.has(d.id)) continue;
      // buyer_remaining is computed on the fly; other columns are
      // plain properties on Deal. Cast through unknown to sidestep
      // Deal's typed field list without loosening the whole type.
      const raw =
        selection.colKey === "buyer_remaining"
          ? (d.buyer_shipped_volume ?? 0) - (d.buyer_ordered_volume ?? 0)
          : (d as unknown as Record<string, number | null | undefined>)[selection.colKey!];
      const v = typeof raw === "number" ? raw : null;
      if (v == null) continue;
      sum += v;
      count += 1;
      if (min == null || v < min) min = v;
      if (max == null || v > max) max = v;
    }
    return {
      sum,
      avg: count > 0 ? sum / count : 0,
      min: min ?? 0,
      max: max ?? 0,
      count,
      label: meta.label,
      decimals: meta.decimals,
    };
  }, [selection, deals]);

  // Empty-state early return — вынесен ПОСЛЕ всех хуков.
  if (empty) return (
    <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
      <p className="text-sm text-stone-500">Нет сделок{dealType !== "ALL" ? ` типа ${dealType}` : ""}</p>
    </div>
  );

  return (
    <PassportRefsContext.Provider value={refsContextValue}>
      {/* Emit CSS for the currently selected cells. Cheap: at most
          selection.ids.size rules re-emitted on selection change, no
          row re-renders. Virtualized rows entering the viewport pick
          up the highlight for free. */}
      {selection.colKey && selection.ids.size > 0 && (
        <style>{Array.from(selection.ids).map((id) =>
          `td[data-col="${selection.colKey}"][data-deal-id="${id}"]{`
            + `background-color:rgba(245,158,11,0.28)!important;`
            + `box-shadow:inset 0 0 0 2px rgb(217,119,6);`
          + `}`,
        ).join("")}</style>
      )}
      <div className="flex flex-col h-full">
      {/* Пара кастомных скроллбаров (top + bottom) синхронизированных
          с scrollRef. Один общий dim state — иначе верхний может
          отрисоваться с scrollWidth=clientWidth (первое измерение до
          того, как таблица разложилась) и не появиться. */}
      <PairedSyncedScrollbars
        targetRef={scrollRef}
        topClassName="bg-white border border-b-0 border-stone-200 rounded-t-md"
        bottomClassName="bg-white border border-t-0 border-stone-200 rounded-b-md"
      >
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto border-l border-r border-stone-200 bg-white"
        onClickCapture={handleTableClickCapture}
      >
        {/* The wrapper has its OWN vertical + horizontal scroll context.
            The page above is non-scrollable; users scroll the table
            internally.

            Sticky-top is applied to each <tr> individually (NOT to the
            <thead>) because the second header row has a sticky-left
            cell — Chrome silently drops the parent's sticky-top from
            rows that contain a sticky-left child. Per-row sticky keeps
            both axes independent and reliable. */}
        {/*
          Operator request 2026-06-25: «увеличить шрифт цифр и текстов,
          но размер ячеек не менять». fontSize bumped 11→12; lineHeight
          pinned to 14px so row heights stay where the cell paddings
          put them (min-h-[18px] on inner cells locks the rest).
        */}
        <table className="w-max border-collapse" style={{ fontSize: "12px", lineHeight: "14px" }}>
          <thead>
            {/* Sticky-top per-cell, NOT per-<tr>/<thead> — Chrome's
                sticky on <tr> conflicts with sticky-left on child cells.
                Row 1 cells use h-7 (28px) which on table-cells locks
                the height tightly enough; row 2 cells stick at top-7
                (also 28px) for a pixel-perfect seam, no gap, no overlap.
                No border-b on row 1 → the two header rows visually
                merge into one block (border-b is on row 2 only, marking
                the boundary with the body). */}
            {/* Category band colors per client request 2026-07-01. Hex
                values from the client's brand palette: Сделка #b4c6e7,
                Поставщик #fce3d6, Группы компании #bcd7ee, Покупатель
                #fff2cc, Логистика #d9d9d9. Applied to BOTH header rows
                so the top-band label and its detail cells share a
                single visual identity. */}
            <tr>
              <th colSpan={5} className="sticky top-0 z-20 h-7 border-r border-stone-300 px-2 text-center text-[11px] font-semibold text-stone-700 uppercase tracking-wider bg-[#b4c6e7]">Сделка</th>
              <th colSpan={10} className="sticky top-0 z-20 h-7 border-r border-stone-300 px-2 text-center text-[11px] font-semibold text-stone-700 uppercase tracking-wider bg-[#fce3d6]">Поставщик</th>
              <th colSpan={2} className="sticky top-0 z-20 h-7 border-r border-stone-300 px-2 text-center text-[11px] font-semibold text-stone-700 uppercase tracking-wider bg-[#bcd7ee]">Группы компании</th>
              <th colSpan={12} className="sticky top-0 z-20 h-7 border-r border-stone-300 px-2 text-center text-[11px] font-semibold text-stone-700 uppercase tracking-wider bg-[#fff2cc]">Покупатель</th>
              <th colSpan={12} className="sticky top-0 z-20 h-7 px-2 text-center text-[11px] font-semibold text-stone-700 uppercase tracking-wider bg-[#d9d9d9]">Логистика</th>
            </tr>
            <tr className="border-b">
              <th className="sticky top-7 left-0 z-30 bg-[#b4c6e7] border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[70px]">№</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[75px] bg-[#b4c6e7]">Месяц</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[70px] bg-[#b4c6e7]">Завод</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[80px] bg-[#b4c6e7]">ГСМ</th>
              <th className="sticky top-7 z-20 border-r border-stone-300 px-2 py-1.5 text-left font-medium text-stone-700 min-w-[40px] bg-[#b4c6e7]">%S</th>
              {/* Supplier: 10 cols */}
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[110px] bg-[#fce3d6]">Поставщик</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[70px] bg-[#fce3d6]">Договор</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[80px] bg-[#fce3d6]">Базис</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[55px] bg-[#fce3d6]">Объем</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[70px] bg-[#fce3d6]">Сумма дог.</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[60px] bg-[#fce3d6]">Цена</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[70px] bg-[#fce3d6]">Отгр. сумма</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[55px] bg-[#fce3d6]">Отгр. тонн</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[70px] bg-[#fce3d6]">Оплата</th>
              <th className="sticky top-7 z-20 border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-700 min-w-[65px] bg-[#fce3d6]">Баланс</th>
              {/* Company groups: 2 cols */}
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[110px] bg-[#bcd7ee]">Компания</th>
              <th className="sticky top-7 z-20 border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-700 min-w-[60px] bg-[#bcd7ee]">Цена гр.</th>
              {/* Buyer: 11 cols */}
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[110px] bg-[#fff2cc]">Покупатель</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[70px] bg-[#fff2cc]">Договор</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[80px] bg-[#fff2cc]">Базис</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[55px] bg-[#fff2cc]">Объем</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[70px] bg-[#fff2cc]">Сумма дог.</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[60px] bg-[#fff2cc]">Цена</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[55px] bg-[#fff2cc]">Заявлено</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[55px] bg-[#fff2cc]" title="отгружено − заявлено">Остаток</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[55px] bg-[#fff2cc]">Отгр. тонн</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[70px] bg-[#fff2cc]">Отгр. сумма</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[70px] bg-[#fff2cc]">Оплата</th>
              <th className="sticky top-7 z-20 border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-700 min-w-[65px] bg-[#fff2cc]">Долг</th>
              {/* Logistics: 8 cols */}
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[90px] bg-[#d9d9d9]">Экспедитор</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-left font-medium text-stone-700 min-w-[90px] bg-[#d9d9d9]">Группа комп.</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[55px] bg-[#d9d9d9]">Тариф</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[55px] bg-[#d9d9d9]">Объем план</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[65px] bg-[#d9d9d9]">Предв. сумма</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[60px] bg-[#d9d9d9]" title="Тариф факт (логисты) = Сумма ÷ объем СНТ (KZ — входящее, KG — исходящее). Авто; ручной ввод закрепляет.">Тариф факт</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[55px] bg-[#d9d9d9]">Факт объем</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[65px] bg-[#d9d9d9]">Сумма</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[75px] bg-[#d9d9d9]" title="Тариф факт (грузоотпр.) = Сумма грузоотправителя ÷ входящее СНТ. Авто; ручной ввод закрепляет.">Тариф факт (грузоотпр.)</th>
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[80px] bg-[#d9d9d9]" title="Сумма грузоотправителя = SUM(additional_expenses) из реестра. Если галочка «Грузоотправитель в цене» — плюсует к балансу поставщика.">Сумма грузоотпр.</th>
              <th className="sticky top-7 z-20 px-2 py-1.5 text-left font-medium text-stone-700 min-w-[90px] bg-[#d9d9d9]">Коммерция</th>
              <th className="sticky top-7 z-20 px-1 py-1.5 w-[30px] bg-[#d9d9d9]"></th>
            </tr>
          </thead>
          <tbody>
            {isColdLoad ? (
              Array.from({ length: 12 }).map((_, i) => <PassportSkeletonRow key={`sk-${i}`} />)
            ) : (
              <VirtualizedRows
                deals={deals}
                virtualizer={rowVirtualizer}
                onDataChanged={onDataChanged}
              />
            )}
            {/* Totals: sum numeric columns across visible (filtered) rows.
                Mirrors the column ordering above. Empty cells under
                identity / contract-text columns keep the layout aligned.
                Mixed currencies are summed as raw numbers — the dashboard
                already does the same, and per-side currency picker is per
                deal, not a global field.

                Sits OUTSIDE the virtualized range (after the bottom
                spacer) so it always renders at the natural bottom of
                the table regardless of scroll position. */}
            {!isColdLoad && <PassportTotalsRow deals={deals} />}
          </tbody>
        </table>
      </div>
      </PairedSyncedScrollbars>
      {selectionStats && (
        <div className="flex flex-wrap items-center gap-4 border-t border-amber-400 bg-amber-100 px-3 py-1.5 text-[12px] text-stone-800">
          <span className="font-medium text-amber-900">{selectionStats.label}</span>
          <span>
            Ячеек: <strong className="font-mono tabular-nums">{selectionStats.count}</strong>
          </span>
          <span>
            Сумма: <strong className="font-mono tabular-nums">{formatWithDecimals(selectionStats.sum, selectionStats.decimals)}</strong>
          </span>
          <span>
            Среднее: <strong className="font-mono tabular-nums">{formatWithDecimals(selectionStats.avg, selectionStats.decimals)}</strong>
          </span>
          <span className="text-stone-600">
            min <span className="font-mono tabular-nums">{formatWithDecimals(selectionStats.min, selectionStats.decimals)}</span>
            {" · "}
            max <span className="font-mono tabular-nums">{formatWithDecimals(selectionStats.max, selectionStats.decimals)}</span>
          </span>
          <button
            onClick={clearSelection}
            className="ml-auto rounded px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-200"
            title="Esc"
          >
            × Сбросить
          </button>
        </div>
      )}
      </div>
    </PassportRefsContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  VirtualizedRows
//
//  Renders only the rows currently visible in the scroll container
//  (plus an overscan of 8 above/below). The unrendered range is
//  reserved with two spacer <tr>s carrying explicit heights so the
//  table preserves its column widths and the totals row below sits
//  at the correct natural bottom.
//
//  The total visible column count is 36 (5 Сделка + 10 Поставщик
//  + 2 Группы компании + 11 Покупатель + 8 Логистика); the spacer
//  rows use colSpan=36 to span the full table without disturbing
//  any column.
// ─────────────────────────────────────────────────────────────────────

const TOTAL_COLS = 36;

type VirtualizerInstance = ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;

function VirtualizedRows({
  deals,
  virtualizer,
  onDataChanged,
}: {
  deals: Deal[];
  virtualizer: VirtualizerInstance;
  onDataChanged: () => void;
}) {
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <>
      {paddingTop > 0 && (
        <tr aria-hidden style={{ height: paddingTop }}>
          <td colSpan={TOTAL_COLS} />
        </tr>
      )}
      {virtualItems.map((vi) => {
        const deal = deals[vi.index];
        if (!deal) return null;
        return (
          <PassportRow
            key={deal.id}
            deal={deal}
            onDataChanged={onDataChanged}
            rowIndex={vi.index}
          />
        );
      })}
      {paddingBottom > 0 && (
        <tr aria-hidden style={{ height: paddingBottom }}>
          <td colSpan={TOTAL_COLS} />
        </tr>
      )}
    </>
  );
}

// Totals row — pure presentational, computes sums on the fly.
function PassportTotalsRow({ deals }: { deals: Deal[] }) {
  const sum = (pick: (d: Deal) => number | null | undefined): number => {
    let s = 0;
    for (const d of deals) {
      const v = pick(d);
      if (typeof v === "number" && Number.isFinite(v)) s += v;
    }
    return s;
  };
  const fmt = (v: number) => v === 0 ? "" : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Volumes — always 3 decimals (client request).
  const fmtVol = (v: number) => v === 0 ? "" : v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  // Cell builder — keeps the markup consistent.
  const num = (band: "amber" | "blue" | "stone" | "purple", v: number, digits: 2 | 3 = 2) => (
    <td className={`border-r px-2 py-1 text-right font-mono tabular-nums font-medium ${
      band === "amber" ? "bg-amber-100/60 text-amber-900" :
      band === "blue"  ? "bg-blue-100/60 text-blue-900" :
      band === "purple" ? "bg-purple-100/60 text-purple-900" :
      "bg-stone-100/60 text-stone-700"
    }`}>{digits === 3 ? fmtVol(v) : fmt(v)}</td>
  );
  const blank = (band: "amber" | "blue" | "stone" | "purple") => (
    <td className={`border-r px-2 py-1 ${
      band === "amber" ? "bg-amber-100/60" :
      band === "blue"  ? "bg-blue-100/60" :
      band === "purple" ? "bg-purple-100/60" :
      "bg-stone-100/60"
    }`}></td>
  );
  // Note: removed `sticky bottom-0` — sticky on a <tr> inside
  // <tbody> renders inconsistently across browsers (a phantom copy of
  // the row was bleeding above the page-level sticky filter bar in
  // Chrome). The totals row sits at the natural bottom of the table.
  return (
    <tr className="border-t-2 border-stone-300">
      {/* Сделка (5 cols): label spans them */}
      <td colSpan={5} className="sticky left-0 z-10 bg-stone-100 border-r border-stone-300 px-2 py-1 text-right text-[12px] font-semibold text-stone-600 uppercase tracking-wider">
        Итого ({deals.length})
      </td>
      {/* Поставщик (10 cols): name/contract/basis blank + numeric sums.
          Клиент 2026-07-08: Объем / Сумма дог. / Цена — это данные
          контракта (одинаковые для всех строк одной сделки, а если
          сделки разные — их сумма всё равно не имеет бизнес-смысла).
          Оставляем пустые ячейки. Отгрузка/оплата/баланс — rollup'ы,
          их суммируем. */}
      {blank("amber")}{blank("amber")}{blank("amber")}
      {blank("amber")}
      {blank("amber")}
      {blank("amber")}
      {num("amber", sum((d) => d.supplier_shipped_amount))}
      {num("amber", sum((d) => d.supplier_shipped_volume), 3)}
      {num("amber", sum((d) => d.supplier_payment))}
      {num("amber", sum((d) => d.supplier_balance))}
      {/* Группы компании (2 cols) */}
      {blank("purple")}{blank("purple")}
      {/* Покупатель (12 cols): + Остаток inserted between Заявлено
          and Отгр. тонн (2026-06-23). Sum is shipped − ordered. */}
      {blank("blue")}{blank("blue")}{blank("blue")}
      {blank("blue")}
      {blank("blue")}
      {blank("blue")}
      {num("blue", sum((d) => d.buyer_ordered_volume), 3)}
      {num("blue", sum((d) => (d.buyer_shipped_volume ?? 0) - (d.buyer_ordered_volume ?? 0)), 3)}
      {num("blue", sum((d) => d.buyer_shipped_volume), 3)}
      {num("blue", sum((d) => d.buyer_shipped_amount))}
      {num("blue", sum((d) => d.buyer_payment))}
      {num("blue", sum((d) => d.buyer_debt))}
      {/* Логистика (12 cols): expeditor / group / tariff blank-cells,
          затем суммируемые числа. Оба «Тариф факт» (00120) — ставки,
          не суммы: blank. Коммерция+spacer в конце. */}
      {blank("stone")}{blank("stone")}{blank("stone")}
      {num("stone", sum((d) => d.preliminary_tonnage), 3)}
      {num("stone", sum((d) => d.preliminary_amount))}
      {blank("stone")}
      {num("stone", sum((d) => d.actual_shipped_volume), 3)}
      {num("stone", sum((d) => d.invoice_amount))}
      {blank("stone")}
      {num("stone", sum((d) => d.additional_expenses_amount))}
      {blank("stone")}{blank("stone")}
    </tr>
  );
}

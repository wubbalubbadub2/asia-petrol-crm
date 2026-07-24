"use client";

import { use, useState, useEffect, useRef, useContext, createContext, useMemo } from "react";
import { useGlobalRefs } from "@/lib/refs";
import { useDelayed } from "@/lib/hooks/use-delayed";
import { useSetTabTitle } from "@/lib/contexts/tabs-context";
// useEffect needed for Field optimistic state sync
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Upload, FileText, Trash2, MessageSquare, X, Plus, History, ChevronDown, Pencil, Eye, Download, RefreshCw, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { updateDeal, type Deal } from "@/lib/hooks/use-deals";
import { formatDMY } from "@/lib/format";
import { DEAL_TYPE_CURRENCY } from "@/lib/constants/deal-types";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { DealPayments } from "@/components/deals/deal-payments";
import { DealTriggerPrices } from "@/components/deals/deal-trigger-prices";
import { DealShipments } from "@/components/deals/deal-shipments";
import { DealCompanyChain } from "@/components/deals/deal-company-chain";
import { CollapsibleSection, SECTION_COLORS } from "@/components/deals/collapsible-section";
import { AuditHistory } from "@/components/shared/audit-history";
import { ChangeDealNumberDialog } from "@/components/deals/change-deal-number-dialog";
import { useRole } from "@/lib/hooks/use-role";
import { SupplierLinesEditor, BuyerLinesEditor } from "@/components/deals/deal-lines-editor";
// Single-RPC bundle хук, заменяющий useDeal / useDealSupplierLines /
// useDealBuyerLines / useDealLineRollups / useDealActivity + четыре
// DocumentsSection fetch'а в одном round-trip (migration 00093).
import { useDealBundle, useDealActivityLive, invalidateDealBundle } from "@/lib/hooks/use-deal-bundle";
import type { ActivityMessage } from "@/lib/hooks/use-deal-activity";
import { BulkAddDialog } from "@/components/registry/bulk-add-dialog";
import { invalidateRegistry } from "@/lib/hooks/use-registry";
import { ClipboardPaste } from "lucide-react";
import { parseNum } from "@/lib/utils/parse-num";

const ATTACHMENT_CATEGORIES = [
  { value: "contract", label: "Договор / Приложение" },
  { value: "snt", label: "СНТ" },
  { value: "esf", label: "ЭСФ" },
  { value: "waybill", label: "ЖД накладная" },
  { value: "act_completed_works", label: "АКТ выполненных работ" },
  { value: "invoice", label: "Счет на оплату" },
  { value: "quality_cert", label: "Паспорт качества" },
  { value: "reconciliation_act", label: "Акт сверки" },
  { value: "application", label: "Заявка (PDF)" },
  { value: "other", label: "Прочее" },
] as const;

type Attachment = {
  id: string;
  category: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  uploaded_at: string;
};

// Some OS / drag-drop paths leave file.type === "" — Supabase Storage
// then falls back to application/octet-stream, which forces browsers to
// download attachments instead of rendering them inline (PDFs in
// particular). Map the extension when file.type is missing so signed
// URLs serve a sensible Content-Type.
const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".csv": "text/csv",
  ".txt": "text/plain",
};
function resolveMime(file: File, ext: string): string {
  if (file.type && file.type.length > 0) return file.type;
  return MIME_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
}

// Context lets every editable cell on this page refetch the deal
// after a successful save. The BEFORE-UPDATE trigger on `deals`
// recomputes derived columns (supplier_balance, buyer_debt,
// preliminary_amount, contracted_amount) — without a refetch the UI
// shows the stale derived values and the formula change looks
// broken (e.g. flipping ЖД в цене didn't visibly update the balance).
const DealReloadContext = createContext<(() => void) | null>(null);
function useDealReload() {
  return useContext(DealReloadContext);
}

// Per-deal field labels whose value is a tonnage — always pad to 3 decimals
// (client request 30.05.2026). Includes per-variant rollups rendered nearby.
const VOLUME_FIELDS_BY_LABEL = new Set([
  "Объем контракт", "Заявлено", "Остаток", "Отгружено",
  "Объем плановый", "Факт объем",
]);

function Field({ label, value, suffix, editing, field, dealId, inputType, onSaved, extraPatch }: {
  label: string; value: string | number | null | undefined; suffix?: string;
  editing?: boolean; field?: string; dealId?: string; onSaved?: () => void;
  inputType?: "text" | "number" | "date";
  // Доп. поля, дописываемые в PATCH при ручной правке — напр. override-флаг
  // («Тариф факт» 00120: ручной ввод закрепляет значение от авто-расчёта).
  extraPatch?: Record<string, boolean>;
}) {
  const isVolume = VOLUME_FIELDS_BY_LABEL.has(label);
  const ctxReload = useDealReload();
  // 2026-06-26: detect numeric ALSO when isVolume — fields like
  // «Заявлено» whose current value is null still need numeric input.
  // Before this, isNumeric=false for null-valued volume fields → the
  // onBlur branch treated the raw "293,246" as a string and Postgres
  // rejected it with «invalid input syntax for type numeric».
  const isNumeric = typeof value === "number" || inputType === "number" || isVolume;
  const isDate = inputType === "date";
  const pendingVal = useRef<string | number | null | undefined>(undefined);
  const [, forceRender] = useState(0);

  // What to show: pending save value takes priority, then prop
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) {
    pendingVal.current = undefined;
  }

  // Client canon 2026-07-07: volume = 3/3, everything else (money,
  // price, tariff, FX, quotation) = 2/2. Old behaviour ({max:3, no min})
  // showed non-volume ints as «1 200» — no trailing decimals.
  const numOpts: Intl.NumberFormatOptions = isVolume
    ? { minimumFractionDigits: 3, maximumFractionDigits: 3 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const formatted = shown != null && shown !== ""
    ? (typeof shown === "number"
      ? Number(shown).toLocaleString("ru-RU", numOpts)
      // Даты в режиме чтения — ДД.ММ.ГГ (клиент 2026-07-24), а не сырой ISO.
      : isDate ? formatDMY(String(shown)) : String(shown))
    : "—";

  const monoClass = isNumeric ? "font-mono tabular-nums" : "";

  // Edit mode: always render a real input so fields look editable at rest.
  if (editing && field && dealId) {
    const inputVal = shown == null ? "" : String(shown);
    return (
      <div>
        <span className="text-[11px] text-stone-400 block">
          {label}{suffix ? ` (${suffix})` : ""}
        </span>
        <input
          key={String(value ?? "")}
          // Use type=text + inputMode=decimal for numeric fields —
          // type=number silently strips "," in some browsers (Russian
          // operators type «293,246» as a decimal and expect parseNum
          // to convert it). text+inputMode keeps the mobile numeric
          // keypad while accepting any decimal separator.
          type={isDate ? "date" : "text"}
          inputMode={isNumeric ? "decimal" : undefined}
          step={isNumeric ? "0.01" : undefined}
          defaultValue={inputVal}
          onBlur={(e) => {
            const raw = e.target.value;
            // parseNum handles both «,» and «.» as decimal separator and
            // strips space-thousands. Required for the Russian locale —
            // operator typed «293,246» and Postgres rejected the literal.
            const newVal = isNumeric ? parseNum(raw) : (raw.trim() || null);
            if (newVal !== value) {
              pendingVal.current = newVal as string | number | null;
              forceRender((n) => n + 1);
              updateDeal(dealId, { [field]: newVal, ...(extraPatch ?? {}) })
                .then(() => {
                  onSaved?.();
                  ctxReload?.();
                })
                .catch(() => {
                  pendingVal.current = undefined;
                  forceRender((n) => n + 1);
                });
            }
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className={`w-full h-8 border border-stone-300 rounded px-2 text-[13px] bg-white hover:border-amber-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-200 transition-colors ${monoClass}`}
        />
      </div>
    );
  }

  // Negative monetary values (буyer overpayment, supplier balance after
  // ЖД-в-цене subtraction, etc.) render in red so the sign is obvious at
  // a glance — the leading "−" alone is too easy to miss.
  const isNegative = typeof shown === "number" && shown < 0;
  return (
    <div>
      <span className="text-[11px] text-stone-400 block">{label}</span>
      <span className={`text-[13px] ${monoClass} ${isNegative ? "text-red-600 font-medium" : "text-stone-800"}`}>
        {formatted}{suffix && shown != null ? ` ${suffix}` : ""}
      </span>
    </div>
  );
}

// Editable select for reference fields
function SectionCurrencyPicker({ editing, value, dealId, field, syncLegacy, onSaved }: {
  editing: boolean;
  value: string;
  dealId: string;
  field: "supplier_currency" | "buyer_currency" | "logistics_currency";
  syncLegacy?: boolean;
  onSaved?: () => void;
}) {
  const pendingVal = useRef<string | undefined>(undefined);
  const [, forceRender] = useState(0);
  const shown = pendingVal.current ?? value;
  const ctxReload = useDealReload();
  if (pendingVal.current !== undefined && value === pendingVal.current) {
    pendingVal.current = undefined;
  }

  if (!editing) {
    return <span className="text-[11px] font-mono text-stone-500">{shown}</span>;
  }

  return (
    <select
      value={shown}
      onChange={(e) => {
        const nv = e.target.value;
        pendingVal.current = nv;
        forceRender((n) => n + 1);
        const patch: Record<string, string> = { [field]: nv };
        // Keep legacy deals.currency in sync with the supplier side so
        // dashboard / passport-table (still on the legacy column) stay consistent.
        if (syncLegacy) patch.currency = nv;
        updateDeal(dealId, patch)
          .then(() => { onSaved?.(); ctxReload?.(); })
          .catch(() => {
            pendingVal.current = undefined;
            forceRender((n) => n + 1);
          });
      }}
      className="h-7 rounded border border-stone-300 hover:border-amber-400 bg-white pl-2 pr-6 text-[11px] focus:border-amber-500 focus:outline-none cursor-pointer"
    >
      <option value="USD">USD $</option>
      <option value="KZT">KZT ₸</option>
      <option value="KGS">KGS сом</option>
      <option value="RUB">RUB ₽</option>
    </select>
  );
}

// "ЖД в цене" — when ON the railway invoice_amount is added to
// supplier_balance by the DB trigger (see migrations 00052/00063).
// Rationale: the supplier's price already includes the railway, so we
// owe him the railway amount on top of the goods value.
function RailwayInPriceToggle({ dealId, value, editing, onSaved }: {
  dealId: string; value: boolean; editing: boolean; onSaved?: () => void;
}) {
  const pendingVal = useRef<boolean | undefined>(undefined);
  const [, forceRender] = useState(0);
  const shown = pendingVal.current ?? value;
  const ctxReload = useDealReload();
  if (pendingVal.current !== undefined && value === pendingVal.current) {
    pendingVal.current = undefined;
  }
  return (
    <div>
      <span className="text-[11px] text-stone-400 block">ЖД в цене</span>
      <label className="inline-flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={shown}
          disabled={!editing}
          onChange={(e) => {
            const nv = e.target.checked;
            pendingVal.current = nv;
            forceRender((n) => n + 1);
            updateDeal(dealId, { railway_in_price: nv })
              .then(() => { onSaved?.(); ctxReload?.(); })
              .catch(() => {
                pendingVal.current = undefined;
                forceRender((n) => n + 1);
              });
          }}
          className={`h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500 ${editing ? "" : "cursor-default"}`}
        />
        <span className="text-[12px] text-stone-700">
          {shown ? "Да (плюсует к балансу)" : "Нет"}
        </span>
      </label>
    </div>
  );
}

// «Грузоотправитель в цене» — переименовано 2026-07-10, было «Доп.
// расходы в цене». Логика та же: когда ON, сумма всех
// shipment_registry.additional_expenses по сделке плюсуется к
// supplier_balance (см. миграцию 00112).
function AdditionalExpensesInPriceToggle({ dealId, value, editing, onSaved }: {
  dealId: string; value: boolean; editing: boolean; onSaved?: () => void;
}) {
  const pendingVal = useRef<boolean | undefined>(undefined);
  const [, forceRender] = useState(0);
  const shown = pendingVal.current ?? value;
  const ctxReload = useDealReload();
  if (pendingVal.current !== undefined && value === pendingVal.current) {
    pendingVal.current = undefined;
  }
  return (
    <div>
      <span className="text-[11px] text-stone-400 block">Грузоотправитель в цене</span>
      <label className="inline-flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={shown}
          disabled={!editing}
          onChange={(e) => {
            const nv = e.target.checked;
            pendingVal.current = nv;
            forceRender((n) => n + 1);
            updateDeal(dealId, { additional_expenses_in_price: nv } as Parameters<typeof updateDeal>[1])
              .then(() => { onSaved?.(); ctxReload?.(); })
              .catch(() => {
                pendingVal.current = undefined;
                forceRender((n) => n + 1);
              });
          }}
          className={`h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500 ${editing ? "" : "cursor-default"}`}
        />
        <span className="text-[12px] text-stone-700">
          {shown ? "Да (плюсует к балансу)" : "Нет"}
        </span>
      </label>
    </div>
  );
}

function EditableSelect({ label, value, displayValue, editing, field, dealId, options, onSaved }: {
  label: string; value: string | null | undefined; displayValue: string;
  editing: boolean; field: string; dealId: string;
  options: { value: string; label: string }[];
  onSaved?: () => void;
}) {
  const pendingVal = useRef<string | undefined>(undefined);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  const ctxReload = useDealReload();
  if (pendingVal.current !== undefined && value === pendingVal.current) pendingVal.current = undefined;

  if (!editing) {
    return (
      <div>
        <span className="text-[11px] text-stone-400 block">{label}</span>
        <span className="text-[13px] text-stone-800">{displayValue || "—"}</span>
      </div>
    );
  }

  // Include current option even if not in list (e.g. inactive reference)
  const hasCurrent = shown && options.some((o) => o.value === shown);

  return (
    <div>
      <span className="text-[11px] text-stone-400 block">{label}</span>
      <div className="relative">
        <select
          value={shown ?? ""}
          onChange={(e) => {
            const newVal = e.target.value || null;
            pendingVal.current = newVal ?? undefined;
            updateDeal(dealId, { [field]: newVal })
              .then(() => { onSaved?.(); ctxReload?.(); })
              .catch(() => { pendingVal.current = undefined; });
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

// «Условия оплаты» (отсрочка) — supplier + buyer deferral terms.
// Extracted into its own component (rather than the inline ModeSelect
// used before) because the mode <select> needs a LOCAL optimistic echo:
// updateDeal() invalidates the deal bundle with a hard refetch (full RPC
// round-trip), not an in-place patch — same reason Field and
// SectionCurrencyPicker each keep a `pendingVal` ref. Without it, picking
// «прочее» wouldn't reveal the «Заметка»/«Плановая дата» fields (gated on
// *_deferral_mode === "other") until the round-trip finished, breaking
// the reveal-on-select interaction and the project's optimistic-UI rule.
function PaymentConditionsSection({ deal, editing }: { deal: Deal; editing: boolean }) {
  const [supMode, setSupMode] = useState(deal.supplier_deferral_mode);
  const [buyMode, setBuyMode] = useState(deal.buyer_deferral_mode);
  useEffect(() => setSupMode(deal.supplier_deferral_mode), [deal.supplier_deferral_mode]);
  useEffect(() => setBuyMode(deal.buyer_deferral_mode), [deal.buyer_deferral_mode]);

  function renderModeSelect(
    label: string,
    value: "shipment" | "other" | null,
    field: "supplier_deferral_mode" | "buyer_deferral_mode",
    setLocal: (v: "shipment" | "other" | null) => void,
  ) {
    const human = value === "shipment" ? "с даты отгрузки" : value === "other" ? "прочее" : "—";
    if (!editing) {
      return (
        <div>
          <span className="text-[11px] text-stone-400 block">{label}</span>
          <span className="text-[13px] text-stone-700">{human}</span>
        </div>
      );
    }
    return (
      <div>
        <span className="text-[11px] text-stone-400 block">{label}</span>
        <select
          className="h-7 rounded border border-stone-200 bg-white px-1 text-[13px] focus:border-amber-400 focus:outline-none"
          value={value ?? ""}
          onChange={(e) => {
            const nv = (e.target.value || null) as "shipment" | "other" | null;
            // Optimistic: reveal/hide the "other" fields instantly,
            // before the round-trip. Revert on rejection.
            setLocal(nv);
            updateDeal(deal.id, { [field]: nv } as never).catch(() => setLocal(value));
          }}
        >
          <option value="">—</option>
          <option value="shipment">с даты отгрузки</option>
          <option value="other">прочее</option>
        </select>
      </div>
    );
  }

  return (
    <CollapsibleSection title="Условия оплаты" headerBg={SECTION_COLORS.deal} storageKey={`deal:${deal.id}:section:payment-conditions`}>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="text-[12px] font-medium text-stone-500">Поставщик</div>
          <Field label="Отсрочка, дн." value={deal.supplier_deferral_days} inputType="number" editing={editing} field="supplier_deferral_days" dealId={deal.id} />
          {renderModeSelect("Режим", supMode, "supplier_deferral_mode", setSupMode)}
          {supMode === "other" && (
            <>
              <Field label="Заметка" value={deal.supplier_deferral_note} inputType="text" editing={editing} field="supplier_deferral_note" dealId={deal.id} />
              <Field label="Плановая дата (ручная)" value={deal.supplier_planned_pay_date} inputType="date" editing={editing} field="supplier_planned_pay_date" dealId={deal.id} />
            </>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="text-[12px] font-medium text-stone-500">Покупатель</div>
          <Field label="Отсрочка, дн." value={deal.buyer_deferral_days} inputType="number" editing={editing} field="buyer_deferral_days" dealId={deal.id} />
          {renderModeSelect("Режим", buyMode, "buyer_deferral_mode", setBuyMode)}
          {buyMode === "other" && (
            <>
              <Field label="Заметка" value={deal.buyer_deferral_note} inputType="text" editing={editing} field="buyer_deferral_note" dealId={deal.id} />
              <Field label="Плановая дата (ручная)" value={deal.buyer_planned_pay_date} inputType="date" editing={editing} field="buyer_planned_pay_date" dealId={deal.id} />
            </>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}

export default function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Один RPC вместо семи параллельных fetch'ей. Bundle отдаёт сделку +
  // линии + аггрегации + вложения по секциям + первичную ленту
  // активности. Реалтайм-канал поднимается лениво ниже в
  // DealActivityWrapper (см. useDealActivityLive).
  const {
    deal,
    supplierLines,
    buyerLines,
    lineRollups,
    attachments: bundleAttachments,
    activity: bundleActivity,
    loading,
    reload,
  } = useDealBundle(id);
  // Update the workspace-tab title once the deal code is known —
  // until then the tab reads «Сделка»; after load it becomes
  // «Сделка KZ/26/123».
  useSetTabTitle(`/deals/${id}`, deal?.deal_code ? `Сделка ${deal.deal_code}` : null);
  // Узкие reload-обёртки — UI-сайты, которые раньше дергали отдельные
  // {reloadSupplierLines, reloadBuyerLines, reloadLineRollups},
  // получают одну функцию-обёртку поверх bundle reload. Это незначительно
  // тяжелее одиночного refetch, но в одном round-trip обновляются ВСЕ
  // зависимости (rollups считаются по тем же линиям + shipment_registry).
  const reloadSupplierLines = reload;
  const reloadBuyerLines = reload;
  const reloadLineRollups = reload;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [numberDialogOpen, setNumberDialogOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  // Bulk-add — operator 2026-06-25: «массовое добавление в карточке
  // сделок в секции логистики». Reuses the same BulkAddDialog the
  // registry page uses; context derived from the deal so the dialog
  // doesn't make the operator re-pick supplier/buyer/factory etc.
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const { isAdmin, isWritable } = useRole();
  // All form selectors read from the shared refs cache (warmed by
  // /lib/refs.ts in the dashboard layout). On a navigation back to a
  // deal the dropdowns are populated synchronously instead of waiting
  // for nine parallel ref queries every time.
  const { refs: globalRefs } = useGlobalRefs();
  const refs = useMemo(() => ({
    suppliers: globalRefs.suppliers.map((c) => ({ value: c.id, label: c.short_name || c.full_name })),
    buyers: globalRefs.buyers.map((c) => ({ value: c.id, label: c.short_name || c.full_name })),
    forwarders: globalRefs.forwarders.map((r) => ({ value: r.id, label: r.name })),
    managers: globalRefs.managers.map((p) => ({ value: p.id, label: p.full_name })),
    stations: globalRefs.stations.map((r) => ({ value: r.id, label: r.name })),
    companyGroups: globalRefs.companyGroups.map((r) => ({ value: r.id, label: r.name })),
    factories: globalRefs.factories.map((r) => ({ value: r.id, label: r.name })),
    fuelTypes: globalRefs.fuelTypes.map((r) => ({ value: r.id, label: r.name })),
    quotationTypes: globalRefs.quotationTypes.map((r) => ({ value: r.id, label: r.name })),
  }), [globalRefs]);

  // Pricing variants per side (multi-line, 00053+00054) — теперь приходят
  // из bundle выше.

  const priceConditionOptions = [
    { value: "average_month", label: "Средний месяц" },
    { value: "fixed", label: "Фикс цена на дату" },
    { value: "trigger", label: "Триггер" },
    { value: "manual", label: "Вручную" },
  ];
  const monthOptions = MONTHS_RU.map((m) => ({ value: m, label: m }));

  // Only show the loader once the fetch has dragged past 800 ms —
  // sub-second loads don't get a blocker. Cached snapshots paint
  // instantly so the blocker only ever appears on the very first cold
  // visit.
  // «Сделка не найдена» is shown ONLY after the fetch finishes — while
  // loading is still true we render nothing (or the delayed loader),
  // otherwise the user sees a red «не найдена» flash during the first
  // 800 ms of every cold load before the data arrives.
  const showLoader = useDelayed(loading);
  if (loading) return showLoader ? <p className="text-sm text-muted-foreground py-8">Загрузка сделки...</p> : null;
  if (!deal) return <p className="text-sm text-destructive py-8">Сделка не найдена</p>;

  // ── Дублирование сделки ────────────────────────────────────────────
  // Создаёт новую сделку, скопировав из текущей все скалярные поля + цепочку
  // groups + supplier/buyer варианты. НЕ копируются:
  //   * derived from registry/payments fields (balance/debt/shipped*/invoice*),
  //   * supplier/buyer payment totals и даты (оплаты сами по себе не копируются),
  //   * lines_count (триггеры пересчитают после копирования вариантов),
  //   * is_draft / is_archived — новая сделка всегда активная.
  // Реестр отгрузок, оплаты, активность и документы не копируются — это
  // намеренно: операционные сущности привязаны к конкретной сделке.
  //
  // PostgREST не отдаёт транзакции — если один из последующих INSERT'ов
  // упадёт, новая сделка уже будет существовать без линий/групп. Оператор
  // может либо повторно нажать «Дублировать» (новая сделка с новым номером),
  // либо вручную почистить пустую сделку. Это явно проговорено в confirm-диалоге.
  async function duplicateDeal() {
    if (!deal || duplicating) return;
    const ok = confirm(
      "Скопировать сделку как новую? Будут продублированы все поля, варианты, цепочка групп компании. Реестр отгрузок, оплаты, активность и документы не копируются.",
    );
    if (!ok) return;
    setDuplicating(true);
    try {
      const supabase = createClient();

      // 1. Generate new deal_number (same RPC as createDeal).
      const { data: numData, error: numError } = await supabase.rpc(
        "generate_deal_number",
        { p_type: deal.deal_type, p_year: deal.year },
      );
      if (numError) {
        toast.error(`Ошибка генерации номера: ${numError.message}`);
        return;
      }
      const newDealNumber = numData as number;

      // 2. Build INSERT payload for `deals`. Strip joined/derived/runtime
      // fields; let triggers regenerate deal_code, supplier_lines_count,
      // buyer_lines_count, created_at, updated_at.
      const dealInsert = {
        deal_type: deal.deal_type,
        deal_number: newDealNumber,
        year: deal.year,
        quarter: deal.quarter,
        month: deal.month,
        factory_id: deal.factory_id,
        fuel_type_id: deal.fuel_type_id,
        sulfur_percent: deal.sulfur_percent,
        avg_month_date: deal.avg_month_date,
        // Supplier scalars (pricing config copied, derived totals reset).
        supplier_id: deal.supplier_id,
        supplier_contract: deal.supplier_contract,
        // Manually-entered contract sums & volumes are intentionally NOT
        // copied — client wants them blank on the duplicated deal (2026-07-24).
        supplier_contracted_volume: null,
        supplier_contracted_amount: null,
        supplier_delivery_basis: deal.supplier_delivery_basis,
        supplier_quotation: deal.supplier_quotation,
        supplier_quotation_comment: deal.supplier_quotation_comment,
        supplier_discount: deal.supplier_discount,
        supplier_price: deal.supplier_price,
        supplier_price_condition: deal.supplier_price_condition,
        supplier_departure_station_id: deal.supplier_departure_station_id,
        supplier_currency: deal.supplier_currency,
        supplier_manager_id: deal.supplier_manager_id,
        // Buyer scalars.
        buyer_id: deal.buyer_id,
        buyer_contract: deal.buyer_contract,
        // Not copied — see supplier note above (2026-07-24).
        buyer_contracted_volume: null,
        buyer_contracted_amount: null,
        buyer_delivery_basis: deal.buyer_delivery_basis,
        buyer_destination_station_id: deal.buyer_destination_station_id,
        buyer_quotation: deal.buyer_quotation,
        buyer_quotation_comment: deal.buyer_quotation_comment,
        buyer_discount: deal.buyer_discount,
        buyer_price: deal.buyer_price,
        buyer_price_condition: deal.buyer_price_condition,
        // "Заявлено, т" — not copied (2026-07-24).
        buyer_ordered_volume: null,
        buyer_currency: deal.buyer_currency,
        buyer_manager_id: deal.buyer_manager_id,
        buyer_ship_date: deal.buyer_ship_date,
        buyer_multi_deal_payments: deal.buyer_multi_deal_payments,
        buyer_snt_written: deal.buyer_snt_written,
        // Logistics scalars.
        forwarder_id: deal.forwarder_id,
        logistics_company_group_id: deal.logistics_company_group_id,
        logistics_shipment_month: deal.logistics_shipment_month ?? null,
        logistics_currency: deal.logistics_currency,
        logistics_notes: deal.logistics_notes,
        planned_tariff: deal.planned_tariff,
        preliminary_tonnage: deal.preliminary_tonnage,
        actual_tariff: deal.actual_tariff,
        railway_in_price: deal.railway_in_price,
        surcharge_amount: deal.surcharge_amount,
        surcharge_reinvoiced_to: deal.surcharge_reinvoiced_to,
        // Managers / trader.
        trader_id: deal.trader_id,
        // Legacy single currency (kept in sync with supplier_currency).
        currency: deal.currency,
        // Reset flags & lifecycle.
        is_archived: false,
        is_draft: false,
      };

      // Local `Deal` type widens *_price_condition to `string | null`, but the
      // generated Insert type insists on the enum union. The values came
      // straight off a deals row so they're already valid — narrow cast at
      // the insert site rather than narrowing every property up-stream.
      const { data: inserted, error: insertError } = await supabase
        .from("deals")
        .insert(dealInsert as never)
        .select("id, deal_code")
        .single();
      if (insertError || !inserted) {
        toast.error(`Ошибка создания копии: ${insertError?.message ?? "неизвестная ошибка"}`);
        return;
      }
      const newDealId = inserted.id as string;
      const newDealCode = inserted.deal_code as string;

      // 3. Copy deal_company_groups chain.
      // Generated database.ts is one migration behind (00089 added
      // quotation/quotation_comment/discount). Bypass Insert type checks
      // with a narrow cast — the columns exist in the live DB schema.
      const groupsSource = deal.deal_company_groups ?? [];
      const groupsInsert = groupsSource.map((g) => ({
        deal_id: newDealId,
        company_group_id: g.company_group_id,
        position: g.position,
        price: g.price,
        price_kind: g.price_kind,
        contract_ref: g.contract_ref ?? null,
        currency: g.currency ?? null,
        quotation: g.quotation ?? null,
        quotation_comment: g.quotation_comment ?? null,
        discount: g.discount ?? null,
      }));

      // 4 + 5 + 6. Copy supplier + buyer lines.
      // Reset `id` (let Supabase generate fresh UUIDs) and
      // `preliminary_set_at` (the finalize snapshot timestamp is
      // per-shipment-stage on the original — new lines start fresh).
      // Drop `created_at` / `updated_at` so DEFAULT now() applies.
      // Drop `deal_id` from source (we set the new one explicitly).
      const supplierInsert = supplierLines.map((l) => ({
        deal_id: newDealId,
        position: l.position,
        is_default: l.is_default,
        price_condition: l.price_condition,
        trigger_basis: l.trigger_basis ?? null,
        trigger_days: l.trigger_days ?? null,
        quotation_type_id: l.quotation_type_id,
        quotation: l.quotation,
        quotation_comment: l.quotation_comment,
        discount: l.discount,
        price: l.price,
        delivery_basis: l.delivery_basis,
        departure_station_id: l.departure_station_id,
        appendix: l.appendix ?? null,
        price_stage: l.price_stage ?? "preliminary",
        preliminary_quotation: l.preliminary_quotation ?? null,
        preliminary_price: l.preliminary_price ?? null,
        preliminary_fx_rate: l.preliminary_fx_rate ?? null,
        preliminary_set_at: null,
        selected_month: l.selected_month ?? null,
        fx_rate: l.fx_rate ?? null,
      }));

      const buyerInsert = buyerLines.map((l) => ({
        deal_id: newDealId,
        position: l.position,
        is_default: l.is_default,
        price_condition: l.price_condition,
        trigger_basis: l.trigger_basis ?? null,
        trigger_days: l.trigger_days ?? null,
        quotation_type_id: l.quotation_type_id,
        quotation: l.quotation,
        quotation_comment: l.quotation_comment,
        discount: l.discount,
        price: l.price,
        delivery_basis: l.delivery_basis,
        destination_station_id: l.destination_station_id,
        appendix: l.appendix ?? null,
        price_stage: l.price_stage ?? "preliminary",
        preliminary_quotation: l.preliminary_quotation ?? null,
        preliminary_price: l.preliminary_price ?? null,
        preliminary_fx_rate: l.preliminary_fx_rate ?? null,
        preliminary_set_at: null,
        selected_month: l.selected_month ?? null,
        fx_rate: l.fx_rate ?? null,
      }));

      // groups + supplier_lines + buyer_lines are independent — fire all
      // three in parallel. PostgREST has no transactions, so the new deal
      // already exists; if any insert errors we still navigate to the
      // copy and surface the error so the operator can decide whether
      // to fix or delete it.
      // PostgREST query builders return a PromiseLike, not a Promise — wrap
      // with Promise.resolve(...) so Promise.all() typing stays clean.
      const tasks: Promise<{ error: { message: string } | null }>[] = [];
      if (groupsInsert.length > 0) {
        tasks.push(
          Promise.resolve(
            supabase
              .from("deal_company_groups")
              .insert(groupsInsert as never),
          ).then(({ error }) => ({ error: error ? { message: error.message } : null })),
        );
      }
      if (supplierInsert.length > 0) {
        tasks.push(
          Promise.resolve(
            supabase
              .from("deal_supplier_lines")
              .insert(supplierInsert as never),
          ).then(({ error }) => ({ error: error ? { message: error.message } : null })),
        );
      }
      if (buyerInsert.length > 0) {
        tasks.push(
          Promise.resolve(
            supabase
              .from("deal_buyer_lines")
              .insert(buyerInsert as never),
          ).then(({ error }) => ({ error: error ? { message: error.message } : null })),
        );
      }
      const results = await Promise.all(tasks);
      const firstErr = results.find((r) => r.error)?.error;
      if (firstErr) {
        toast.error(`Сделка создана, но часть данных не скопировалась: ${firstErr.message}`);
      } else {
        toast.success(`Сделка ${newDealCode} создана как копия ${deal.deal_code}`);
      }

      router.push(`/deals/${newDealId}`);
    } finally {
      setDuplicating(false);
    }
  }

  const symbolOf = (code: string) =>
    code === "KZT" ? "₸" : code === "KGS" ? "сом" : code === "RUB" ? "₽" : "$";
  const fallbackCurrency = DEAL_TYPE_CURRENCY[deal.deal_type] ?? "USD";
  const supplierCurrency  = deal.supplier_currency  ?? fallbackCurrency;
  const buyerCurrency     = deal.buyer_currency     ?? fallbackCurrency;
  const logisticsCurrency = deal.logistics_currency ?? fallbackCurrency;
  const supplierCurrencySymbol  = symbolOf(supplierCurrency);
  const buyerCurrencySymbol     = symbolOf(buyerCurrency);
  const logisticsCurrencySymbol = symbolOf(logisticsCurrency);

  return (
    <DealReloadContext.Provider value={reload}>
    <div className="flex gap-4">
    <div className="space-y-4 flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3">
        {/* Back via history — сохраняет ?filters в URL списка сделок (nuqs).
            Прежняя <Link href="/deals"> жёстко стирала query-параметры. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) router.back();
            else router.push("/deals");
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold font-mono">{deal.deal_code}</h1>
            {isWritable && (
              <button
                title="Изменить номер сделки"
                onClick={() => setNumberDialogOpen(true)}
                className="rounded p-1 text-stone-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setHistoryOpen(true)}
                title="История изменений"
              >
                <History className="mr-1 h-3.5 w-3.5" />
                История
              </Button>
              {isWritable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={duplicateDeal}
                  disabled={duplicating}
                  title="Скопировать сделку как новую (поля, варианты, цепочка групп)"
                >
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  {duplicating ? "Копирую..." : "Скопировать сделку"}
                </Button>
              )}
              <Button
                size="sm"
                variant={editing ? "default" : "outline"}
                onClick={async () => {
                  if (editing) {
                    // Save mode — just toggle off (data already saved optimistically)
                    setEditing(false);
                  } else {
                    setEditing(true);
                  }
                }}
              >
                <Save className="mr-1 h-3.5 w-3.5" />
                {editing ? "Сохранить" : "Редактировать"}
              </Button>
            </div>
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium border ${
              deal.deal_type === "KG" ? "bg-blue-50 text-blue-700 border-blue-200" :
              deal.deal_type === "KZ" ? "bg-green-50 text-green-700 border-green-200" :
              "bg-purple-50 text-purple-700 border-purple-200"
            }`}>
              {deal.deal_type}
            </span>
            {deal.fuel_type && !editing && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-stone-600">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: deal.fuel_type.color }} />
                {deal.fuel_type.name}
              </span>
            )}
          </div>
          {editing ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-1 max-w-[600px]">
              <EditableSelect label="Месяц" value={deal.month} displayValue={deal.month} editing field="month" dealId={deal.id} options={monthOptions} />
              <EditableSelect label="Завод" value={deal.factory_id} displayValue={deal.factory?.name ?? "—"} editing field="factory_id" dealId={deal.id} options={refs.factories} />
              <EditableSelect label="ГСМ" value={deal.fuel_type_id} displayValue={deal.fuel_type?.name ?? "—"} editing field="fuel_type_id" dealId={deal.id} options={refs.fuelTypes} />
            </div>
          ) : (
            <p className="text-[12px] text-stone-500">
              {deal.month} {deal.year} | {deal.factory?.name ?? "—"} |{" "}
              <span className="font-mono">
                {supplierCurrency === buyerCurrency
                  ? supplierCurrency
                  : `${supplierCurrency} → ${buyerCurrency}`}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* ===== SUPPLIER SECTION (fields + pricing + payments + docs) ===== */}
      <CollapsibleSection
        title="Поставщик"
        headerBg={SECTION_COLORS.supplier}
        storageKey={`deal:${deal.id}:section:supplier`}
        headerRight={<SectionCurrencyPicker editing={editing} value={supplierCurrency} dealId={deal.id} field="supplier_currency" syncLegacy onSaved={reload} />}
      >
        {/* Header / scalar fields (one per side) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
          <EditableSelect label="Поставщик" value={deal.supplier_id} displayValue={deal.supplier?.short_name ?? deal.supplier?.full_name ?? "—"} editing={editing} field="supplier_id" dealId={deal.id} options={refs.suppliers} />
          <Field label="№ договора" value={deal.supplier_contract} editing={editing} field="supplier_contract" dealId={deal.id} />
          <Field label="Объем контракт" value={deal.supplier_contracted_volume} suffix="тонн" editing={editing} field="supplier_contracted_volume" dealId={deal.id} />
          <Field label="Сумма по контракту" value={deal.supplier_contracted_amount} suffix={`${supplierCurrencySymbol} (авто)`} />
          <Field label="% S" value={deal.sulfur_percent} editing={editing} field="sulfur_percent" dealId={deal.id} />
        </div>

        {/* Multi-line pricing variants */}
        <div>
          <div className="text-[12px] font-medium text-stone-600 mb-1.5">Условия и маршрут</div>
          <SupplierLinesEditor
            dealId={deal.id}
            editing={editing}
            currencySymbol={supplierCurrencySymbol}
            stations={refs.stations}
            quotationTypes={refs.quotationTypes}
            lines={supplierLines}
            rollups={lineRollups.supplier}
            onChanged={() => { reloadSupplierLines(); reloadLineRollups(); reload(); }}
            dealMonth={deal.month ?? null}
            dealYear={deal.year ?? null}
          />
        </div>

        {/* Rollups — derived from registry / payments */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
          <Field label="Приход, сумма" value={deal.supplier_shipped_amount} suffix={supplierCurrencySymbol} />
          <Field label="Оплата" value={deal.supplier_payment} suffix={`${supplierCurrencySymbol} (оплаты)`} />
          <Field label="Дата оплаты" value={deal.supplier_payment_date} inputType="date" editing={editing} field="supplier_payment_date" dealId={deal.id} />
          <Field label="Баланс" value={deal.supplier_balance} suffix={`${supplierCurrencySymbol} (авто)`} />
          {/* Anchor date for «Средний месяц» pickup — migration 00085. */}
          <Field label="Дата котировки (ср. месяц)" value={deal.avg_month_date} inputType="date" editing={editing} field="avg_month_date" dealId={deal.id} />
        </div>

        {/* Supplier pricing by month */}
        {deal.supplier_price_condition && deal.supplier_price_condition !== "manual" && (
          <div className="space-y-1.5">
            <div>
              <h3 className="text-[14px] font-medium text-stone-800">
                Окончательная цена — по отгрузкам
              </h3>
              <p className="text-[12px] text-stone-500">
                Цена пересчитывается отдельно для каждой отгрузки по выбранному режиму. Можно править вручную.
              </p>
            </div>
            <DealTriggerPrices dealId={deal.id} side="supplier" currencySymbol={supplierCurrencySymbol}
              defaultBasis={(deal as Record<string, unknown>).trigger_basis as "shipment_date" | "border_crossing_date" | undefined}
              defaultDiscount={deal.supplier_discount ?? 0}
              defaultQuotation={deal.supplier_quotation ?? null}
              avgMonthDate={deal.avg_month_date ?? null}
              priceCondition={deal.supplier_price_condition} />
          </div>
        )}
        {/* Supplier payments */}
        <DealPayments dealId={deal.id} currencySymbol={supplierCurrencySymbol} side="supplier" />
        {/* Supplier documents — initial set приехал в bundle.attachments;
            DocumentsSection делает свой re-fetch только при mutation. */}
        <DocumentsSection dealId={deal.id} section="supplier" title="Документы — Поставщик" initialAttachments={bundleAttachments["supplier"] ?? []} />
      </CollapsibleSection>

      {/* ===== BUYER SECTION (fields + pricing + payments + docs) ===== */}
      <CollapsibleSection
        title="Покупатель"
        headerBg={SECTION_COLORS.buyer}
        storageKey={`deal:${deal.id}:section:buyer`}
        headerRight={<SectionCurrencyPicker editing={editing} value={buyerCurrency} dealId={deal.id} field="buyer_currency" onSaved={reload} />}
      >
        {/* Header / scalar fields (one per side) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
          <EditableSelect label="Покупатель" value={deal.buyer_id} displayValue={deal.buyer?.short_name ?? deal.buyer?.full_name ?? "—"} editing={editing} field="buyer_id" dealId={deal.id} options={refs.buyers} />
          <Field label="№ договора" value={deal.buyer_contract} editing={editing} field="buyer_contract" dealId={deal.id} />
          <Field label="Объем контракт" value={deal.buyer_contracted_volume} suffix="тонн" editing={editing} field="buyer_contracted_volume" dealId={deal.id} />
          <Field label="Сумма по контракту" value={deal.buyer_contracted_amount} suffix={`${buyerCurrencySymbol} (авто)`} />
          <Field label="Заявлено" value={deal.buyer_ordered_volume} suffix="тонн" editing={editing} field="buyer_ordered_volume" dealId={deal.id} />
          <Field label="Остаток" value={deal.buyer_remaining} suffix="тонн (авто)" />
        </div>

        {/* Multi-line pricing variants */}
        <div>
          <div className="text-[12px] font-medium text-stone-600 mb-1.5">Условия и маршрут</div>
          <BuyerLinesEditor
            dealId={deal.id}
            editing={editing}
            currencySymbol={buyerCurrencySymbol}
            stations={refs.stations}
            quotationTypes={refs.quotationTypes}
            lines={buyerLines}
            rollups={lineRollups.buyer}
            onChanged={() => { reloadBuyerLines(); reloadLineRollups(); reload(); }}
            dealMonth={deal.month ?? null}
            dealYear={deal.year ?? null}
          />
        </div>

        {/* Rollups — derived from registry / payments */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
          <Field label="Отгружено" value={deal.buyer_shipped_volume} suffix="тонн (реестр)" />
          <Field label="Дата отгрузки" value={deal.buyer_ship_date} inputType="date" editing={editing} field="buyer_ship_date" dealId={deal.id} />
          <Field label="Сумма отгрузки" value={deal.buyer_shipped_amount} suffix={buyerCurrencySymbol} />
          <Field label="Оплата" value={deal.buyer_payment} suffix={`${buyerCurrencySymbol} (оплаты)`} />
          <Field label="Дата оплаты" value={deal.buyer_payment_date} inputType="date" editing={editing} field="buyer_payment_date" dealId={deal.id} />
          <Field label="Долг / переплата" value={deal.buyer_debt} suffix={`${buyerCurrencySymbol} (авто)`} />
        </div>

        {/* Buyer pricing by month */}
        {deal.buyer_price_condition && deal.buyer_price_condition !== "manual" && (
          <div className="space-y-1.5">
            <div>
              <h3 className="text-[14px] font-medium text-stone-800">
                Окончательная цена — по отгрузкам
              </h3>
              <p className="text-[12px] text-stone-500">
                Цена пересчитывается отдельно для каждой отгрузки по выбранному режиму. Можно править вручную.
              </p>
            </div>
            <DealTriggerPrices dealId={deal.id} side="buyer" currencySymbol={buyerCurrencySymbol}
              defaultBasis={(deal as Record<string, unknown>).trigger_basis as "shipment_date" | "border_crossing_date" | undefined}
              defaultDiscount={deal.buyer_discount ?? 0}
              defaultQuotation={deal.buyer_quotation ?? null}
              avgMonthDate={deal.avg_month_date ?? null}
              priceCondition={deal.buyer_price_condition} />
          </div>
        )}
        {/* Buyer payments */}
        <DealPayments dealId={deal.id} currencySymbol={buyerCurrencySymbol} side="buyer" />
        {/* Buyer documents */}
        <DocumentsSection dealId={deal.id} section="buyer" title="Документы — Покупатель" initialAttachments={bundleAttachments["buyer"] ?? []} />
      </CollapsibleSection>

      {/* ===== COMPANY CHAIN ===== */}
      <CollapsibleSection title="Группа компаний" headerBg={SECTION_COLORS.chain} storageKey={`deal:${deal.id}:section:chain`}>
        <DealCompanyChain
          dealId={deal.id}
          editing={editing}
          supplierName={deal.supplier?.short_name ?? deal.supplier?.full_name ?? "—"}
          buyerName={deal.buyer?.short_name ?? deal.buyer?.full_name ?? "—"}
          supplierPrice={deal.supplier_price}
          buyerPrice={deal.buyer_price}
          forwarderName={deal.forwarder?.name ?? "—"}
          forwarderTariff={deal.planned_tariff}
          supplierCurrencySymbol={supplierCurrencySymbol}
          buyerCurrencySymbol={buyerCurrencySymbol}
          logisticsCurrencySymbol={logisticsCurrencySymbol}
          currenciesAligned={
            supplierCurrency === buyerCurrency && buyerCurrency === logisticsCurrency
          }
          groups={deal.deal_company_groups ?? []}
          companyGroupOptions={refs.companyGroups}
          onReload={reload}
        />
        {/* Company chain documents */}
        <DocumentsSection dealId={deal.id} section="company_chain" title="Документы — Цепочка компании" initialAttachments={bundleAttachments["company_chain"] ?? []} />
      </CollapsibleSection>

      {/* ===== PAYMENT CONDITIONS (deferral) ===== */}
      <PaymentConditionsSection deal={deal} editing={editing} />

      {/* ===== LOGISTICS ===== */}
      <CollapsibleSection
        title="Логистика"
        headerBg={SECTION_COLORS.logistics}
        storageKey={`deal:${deal.id}:section:logistics`}
        headerRight={
          <div className="flex items-center gap-2">
            {/* Кнопка «Массово» рендерится только для KG/KZ — BulkAddDialog
                рендерится по тому же условию ниже. Раньше кнопка
                показывалась всегда, и для OIL/тестовых сделок без
                registry_type клик ничего не делал (диалог не был в
                DOM). Operator 2026-06-26. */}
            {isWritable && (deal.deal_type === "KG" || deal.deal_type === "KZ") && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => setBulkAddOpen(true)}
              >
                <ClipboardPaste className="h-3 w-3 mr-1" />
                Массово
              </Button>
            )}
            <SectionCurrencyPicker editing={editing} value={logisticsCurrency} dealId={deal.id} field="logistics_currency" onSaved={reload} />
          </div>
        }
      >
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
            <EditableSelect label="Экспедитор" value={deal.forwarder_id} displayValue={deal.forwarder?.name ?? "—"} editing={editing} field="forwarder_id" dealId={deal.id} options={refs.forwarders} />
            <EditableSelect label="Группа компании" value={deal.logistics_company_group_id} displayValue={deal.logistics_company_group?.name ?? "—"} editing={editing} field="logistics_company_group_id" dealId={deal.id} options={refs.companyGroups} />
            <EditableSelect label="Ст. отправления" value={deal.supplier_departure_station_id} displayValue={deal.supplier_departure_station?.name ?? "—"} editing={editing} field="supplier_departure_station_id" dealId={deal.id} options={refs.stations} />
            <EditableSelect label="Ст. назначения" value={deal.buyer_destination_station_id} displayValue={deal.buyer_destination_station?.name ?? "—"} editing={editing} field="buyer_destination_station_id" dealId={deal.id} options={refs.stations} />
            {/* Месяц отгрузки для поиска тарифа. NULL → fall back на
                deal.month. Без календаря — просто dropdown месяцев. */}
            <EditableSelect
              label="Месяц отгрузки"
              value={deal.logistics_shipment_month ?? null}
              displayValue={deal.logistics_shipment_month ?? `${deal.month} (мес. сделки)`}
              editing={editing}
              field="logistics_shipment_month"
              dealId={deal.id}
              options={MONTHS_RU.map((m) => ({ value: m, label: m }))}
            />
            <Field label="Тариф план" value={deal.planned_tariff} suffix={logisticsCurrencySymbol} editing={editing} field="planned_tariff" dealId={deal.id} />
            <Field label="Тариф факт" value={deal.actual_tariff} suffix={`${logisticsCurrencySymbol} (авто: Сумма ÷ СНТ)`} editing={editing} field="actual_tariff" dealId={deal.id} inputType="number" extraPatch={{ actual_tariff_override: true }} />
            <Field label="Тариф менеджер" value={deal.shipper_actual_tariff} suffix={`${logisticsCurrencySymbol} (авто: Сумма грузоотпр. ÷ вход. СНТ)`} editing={editing} field="shipper_actual_tariff" dealId={deal.id} inputType="number" extraPatch={{ shipper_actual_tariff_override: true }} />
            <Field label="Объем плановый" value={deal.preliminary_tonnage} suffix="тонн" editing={editing} field="preliminary_tonnage" dealId={deal.id} />
            <Field label="Предв. сумма" value={deal.preliminary_amount} suffix={`${logisticsCurrencySymbol} (авто)`} />
            <Field label="Факт объем" value={deal.actual_shipped_volume} suffix="тонн (реестр)" />
            <Field label="Сумма" value={deal.invoice_amount} suffix={`${logisticsCurrencySymbol} (реестр)`} />
            <Field label="ЭСФ грузоотправление" value={deal.additional_expenses_amount ?? 0} suffix={`${logisticsCurrencySymbol} (реестр)`} />
            <RailwayInPriceToggle dealId={deal.id} value={!!deal.railway_in_price} editing={editing} onSaved={reload} />
            <AdditionalExpensesInPriceToggle dealId={deal.id} value={!!deal.additional_expenses_in_price} editing={editing} onSaved={reload} />
            <EditableSelect label="Коммерция" value={deal.supplier_manager_id} displayValue={deal.supplier_manager?.full_name ?? "—"} editing={editing} field="supplier_manager_id" dealId={deal.id} options={refs.managers} />
          </div>
          <DealShipments dealId={deal.id} currencySymbol={logisticsCurrencySymbol} />
        {/* Logistics documents */}
        <DocumentsSection dealId={deal.id} section="logistics" title="Документы — Логистика" initialAttachments={bundleAttachments["logistics"] ?? []} />
      </CollapsibleSection>

      {/* ===== MANAGERS ===== */}
      <CollapsibleSection title="Ответственные" headerBg={SECTION_COLORS.deal} storageKey={`deal:${deal.id}:section:managers`} contentClassName="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
        <EditableSelect label="Коммерция (поставщик)" value={deal.supplier_manager_id} displayValue={deal.supplier_manager?.full_name ?? "—"} editing={editing} field="supplier_manager_id" dealId={deal.id} options={refs.managers} />
        <EditableSelect label="Коммерция (покупатель)" value={deal.buyer_manager_id} displayValue={deal.buyer_manager?.full_name ?? "—"} editing={editing} field="buyer_manager_id" dealId={deal.id} options={refs.managers} />
        <EditableSelect label="Трейдер" value={deal.trader_id} displayValue={deal.trader?.full_name ?? "—"} editing={editing} field="trader_id" dealId={deal.id} options={refs.managers} />
      </CollapsibleSection>

    </div>

    {/* History drawer */}
    <AuditHistory open={historyOpen} onClose={() => setHistoryOpen(false)} dealId={deal.id} />

    {isWritable && (
      <ChangeDealNumberDialog
        open={numberDialogOpen}
        onOpenChange={setNumberDialogOpen}
        dealId={deal.id}
        dealType={deal.deal_type}
        year={deal.year}
        currentNumber={deal.deal_number}
        currentCode={deal.deal_code}
        onChanged={reload}
      />
    )}

    {/* Bulk-add shipments — same dialog the registry page uses, fed
        with a context derived from this deal so the operator doesn't
        re-pick supplier/buyer/factory/etc. regType is locked to the
        deal's own type (KG/KZ) so the bulk add can't land rows in
        the wrong registry tab. */}
    {isWritable && (deal.deal_type === "KG" || deal.deal_type === "KZ") && (
      <BulkAddDialog
        open={bulkAddOpen}
        onClose={() => setBulkAddOpen(false)}
        regType={deal.deal_type}
        context={{
          dealId: deal.id,
          dealCode: deal.deal_code,
          month: deal.month ?? null,
          shipmentMonth: deal.logistics_shipment_month ?? null,
          fuelTypeId: deal.fuel_type_id ?? null,
          factoryId: deal.factory_id ?? null,
          supplierId: deal.supplier_id ?? null,
          buyerId: deal.buyer_id ?? null,
          forwarderId: deal.forwarder_id ?? null,
          companyGroupId: deal.logistics_company_group_id ?? null,
          destinationStationId: deal.buyer_destination_station_id ?? null,
          departureStationId: deal.supplier_departure_station_id ?? null,
          railwayTariff: deal.actual_tariff ?? deal.planned_tariff ?? null,
          dealYear: deal.year ?? null,
          currency: deal.currency ?? null,
        }}
        onDone={() => {
          // The bulk insert already invalidates registry; here we
          // also bump the deal bundle so the «Логистика» card's
          // shipments table and the rollups (supplier_shipped_*,
          // buyer_shipped_*) refresh without a manual reload.
          invalidateRegistry();
          reload();
        }}
      />
    )}

    {/* Right sidebar: Activity feed — sidebar on large, floating button + modal on small */}
    <div className="hidden lg:block w-[340px] shrink-0">
      <div className="sticky top-0">
        <Card className="h-[calc(100vh-7rem)]">
          <CardHeader className="pb-2 border-b border-stone-200">
            <CardTitle className="text-[14px]">Активность</CardTitle>
          </CardHeader>
          <CardContent className="p-3 h-[calc(100%-3rem)]">
            <DealActivityWrapper dealId={deal.id} seed={bundleActivity} />
          </CardContent>
        </Card>
      </div>
    </div>

    {/* Mobile: floating chat button */}
    <MobileChatButton dealId={deal.id} seed={bundleActivity} />
    </div>
    </DealReloadContext.Provider>
  );
}

function DealActivityWrapper({ dealId, seed }: { dealId: string; seed: ActivityMessage[] }) {
  // bundle.activity = seed. useDealActivityLive поднимает realtime-канал
  // лениво, оставляя первый paint без WS handshake.
  const { messages, sendMessage } = useDealActivityLive(dealId, seed);
  // loading=false: seed уже от bundle, реалтайм-канал только наращивает.
  return <ActivityFeed messages={messages} loading={false} sendMessage={sendMessage} />;
}

function MobileChatButton({ dealId, seed }: { dealId: string; seed: ActivityMessage[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Floating button — visible only on small screens */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-lg shadow-amber-500/30 hover:shadow-xl hover:scale-105 transition-all"
      >
        <MessageSquare className="h-5 w-5" />
      </button>

      {/* Fullscreen modal */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 bg-white flex flex-col">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
            <h3 className="text-[14px] font-bold">Активность</h3>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-stone-100">
              <X className="h-5 w-5 text-stone-500" />
            </button>
          </div>
          <div className="flex-1 p-3 overflow-hidden">
            <DealActivityWrapper dealId={dealId} seed={seed} />
          </div>
        </div>
      )}
    </>
  );
}

type DocSection = "supplier" | "buyer" | "company_chain" | "logistics";

function DocumentsSection({ dealId, section, title, initialAttachments }: {
  dealId: string;
  section: DocSection;
  title: string;
  // Pre-seeded из bundle.attachments[section]. Если поле есть — рисуем
  // мгновенно без отдельного запроса. Если undefined (например, секции
  // нет в bundle, либо bundle ещё не загрузился) — фолбэк на старый
  // self-fetch, чтобы не зависеть жёстко от родителя.
  initialAttachments?: Attachment[];
}) {
  const supabase = createClient();
  const seedRef = useRef(initialAttachments);
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments ?? []);
  const [loading, setLoading] = useState(initialAttachments == null);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("contract");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Seed приехал из родителя — рисуем сразу, без round-trip'а.
    if (seedRef.current != null) {
      setAttachments(seedRef.current);
      setLoading(false);
      return;
    }
    loadAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, section]);

  // Если bundle обновился после первичной отрисовки (например, родитель
  // дёрнул reload) — синхронизируем. NB: не подкладываем seed в
  // зависимости первого useEffect, чтобы старая привязка [dealId, section]
  // не цеплялась к референсной нестабильности initialAttachments.
  useEffect(() => {
    if (initialAttachments != null) {
      setAttachments(initialAttachments);
    }
  }, [initialAttachments]);

  async function loadAttachments() {
    setLoading(true);
    const { data } = await supabase
      .from("deal_attachments")
      .select("id, category, file_name, file_path, file_size, uploaded_at")
      .eq("deal_id", dealId)
      .eq("section", section)
      .order("uploaded_at", { ascending: false });
    setAttachments((data ?? []) as Attachment[]);
    setLoading(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    // Storage key uses UUID + extension only — Supabase storage rejects
    // signed-URL lookups when the key carries a literal space ("Invalid
    // key" 400). The user's original filename is preserved in the
    // file_name DB column and used for display + download.
    const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
    const filePath = `deals/${dealId}/${section}/${category}/${Date.now()}-${crypto.randomUUID()}${ext}`;
    const contentType = resolveMime(file, ext);

    const { error: uploadError } = await supabase.storage
      .from("deal-attachments")
      .upload(filePath, file, { contentType, cacheControl: "3600", upsert: false });

    if (uploadError) {
      // Hard fail — do NOT create a DB row pointing at a file that
      // didn't land in Storage. The previous behavior (warn + insert
      // anyway) produced hundreds of dangling rows that 400'd on view.
      toast.error(`Загрузка не удалась: ${uploadError.message}`);
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const { error: dbError } = await supabase.from("deal_attachments").insert({
      deal_id: dealId,
      section,
      category,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: contentType,
    });

    if (dbError) {
      // The bytes are in Storage but the DB insert failed — try to
      // clean up the orphan file so the bucket doesn't grow forever.
      await supabase.storage.from("deal-attachments").remove([filePath]).catch(() => {});
      toast.error(`Ошибка: ${dbError.message}`);
    } else {
      toast.success(`Файл "${file.name}" прикреплен`);
      await loadAttachments();
      // Bundle carries attachments per-section — drop it so other parts
      // of the page (counters, other sections sharing the same bundle)
      // refetch with the new row instead of staying stuck on the seed.
      invalidateDealBundle(dealId);
    }

    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleDelete(att: Attachment) {
    const { error } = await supabase.from("deal_attachments").delete().eq("id", att.id);
    if (error) {
      toast.error(`Ошибка удаления: ${error.message}`);
    } else {
      toast.success("Файл удален");
      await loadAttachments();
      invalidateDealBundle(dealId);
    }
  }

  // Public-bucket URL builder. The bucket is PUBLIC, so a plain public
  // URL renders inline (PDFs in particular) with the Content-Type that
  // we now set explicitly on upload. The `download` option appends
  // `?download=<filename>` so Supabase serves the same file with
  // Content-Disposition: attachment + filename.
  function publicUrl(att: Attachment, opts?: { download?: string }): string {
    const { data } = supabase.storage
      .from("deal-attachments")
      .getPublicUrl(att.file_path, opts);
    return data.publicUrl;
  }

  function handleView(att: Attachment) {
    window.open(publicUrl(att), "_blank", "noopener,noreferrer");
  }

  function handleDownload(att: Attachment) {
    const a = document.createElement("a");
    a.href = publicUrl(att, { download: att.file_name });
    a.download = att.file_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Re-upload an attachment in place. For legacy files whose storage key
  // was rejected by Supabase's validator (literal-space paths), the only
  // path forward is to upload a fresh copy from disk under a UUID-based
  // key and rewire the DB row to point at the new file. The old object
  // stays as orphan in storage — harmless, just no longer referenced.
  async function handleReupload(att: Attachment) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
      const newPath = `deals/${dealId}/${section}/${att.category}/${Date.now()}-${crypto.randomUUID()}${ext}`;
      const contentType = resolveMime(file, ext);
      const { error: upErr } = await supabase.storage
        .from("deal-attachments")
        .upload(newPath, file, { contentType, cacheControl: "3600", upsert: false });
      if (upErr) { toast.error(`Загрузка не удалась: ${upErr.message}`); return; }
      const { error: dbErr } = await supabase.from("deal_attachments").update({
        file_path: newPath,
        file_name: file.name,
        file_size: file.size,
        mime_type: contentType,
      }).eq("id", att.id);
      if (dbErr) { toast.error(`Сохранение не удалось: ${dbErr.message}`); return; }
      toast.success("Файл перезалит");
      await loadAttachments();
      invalidateDealBundle(dealId);
    };
    input.click();
  }

  const getCategoryLabel = (cat: string) =>
    ATTACHMENT_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[13px] text-stone-600">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Upload */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-[11px] text-stone-500">Категория</Label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
            >
              {ATTACHMENT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              onChange={handleUpload}
              className="hidden"
              accept=".pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              {uploading ? "Загрузка..." : "Загрузить файл"}
            </Button>
          </div>
        </div>

        {/* File list */}
        {loading ? (
          <p className="text-[12px] text-stone-400">Загрузка...</p>
        ) : attachments.length === 0 ? (
          <p className="text-[12px] text-stone-400">Нет прикрепленных файлов</p>
        ) : (
          <div className="space-y-1">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-1.5 text-[12px]"
              >
                <FileText className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                <span className="font-medium text-stone-700 truncate flex-1">{att.file_name}</span>
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 shrink-0">
                  {getCategoryLabel(att.category)}
                </span>
                {att.file_size && (
                  <span className="text-[10px] text-stone-400 shrink-0">
                    {(att.file_size / 1024).toFixed(0)} KB
                  </span>
                )}
                <button
                  onClick={() => handleView(att)}
                  title="Открыть"
                  className="text-stone-400 hover:text-amber-600 shrink-0"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDownload(att)}
                  title="Скачать"
                  className="text-stone-400 hover:text-amber-600 shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleReupload(att)}
                  title="Перезалить — для старых файлов которые не открываются"
                  className="text-stone-400 hover:text-amber-600 shrink-0"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(att)}
                  title="Удалить"
                  className="text-red-400 hover:text-red-600 shrink-0"
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

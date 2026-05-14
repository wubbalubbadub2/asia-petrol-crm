"use client";

import { use, useState, useEffect, useRef, useContext, createContext } from "react";
// useEffect needed for Field optimistic state sync
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Upload, FileText, Trash2, MessageSquare, X, Plus, History, ChevronDown, Pencil, Eye, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDeal, updateDeal } from "@/lib/hooks/use-deals";
import { DEAL_TYPE_CURRENCY } from "@/lib/constants/deal-types";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { DealPayments } from "@/components/deals/deal-payments";
import { DealTriggerPrices } from "@/components/deals/deal-trigger-prices";
import { DealShipments } from "@/components/deals/deal-shipments";
import { DealCompanyChain } from "@/components/deals/deal-company-chain";
import { AuditHistory } from "@/components/shared/audit-history";
import { useDealActivity } from "@/lib/hooks/use-deal-activity";
import { ChangeDealNumberDialog } from "@/components/deals/change-deal-number-dialog";
import { useRole } from "@/lib/hooks/use-role";
import { useDealSupplierLines, useDealBuyerLines, useDealLineRollups } from "@/lib/hooks/use-deal-lines";
import { SupplierLinesEditor, BuyerLinesEditor } from "@/components/deals/deal-lines-editor";

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

function Field({ label, value, suffix, editing, field, dealId, inputType, onSaved }: {
  label: string; value: string | number | null | undefined; suffix?: string;
  editing?: boolean; field?: string; dealId?: string; onSaved?: () => void;
  inputType?: "text" | "number" | "date";
}) {
  const ctxReload = useDealReload();
  const isNumeric = typeof value === "number" || inputType === "number";
  const isDate = inputType === "date";
  const pendingVal = useRef<string | number | null | undefined>(undefined);
  const [, forceRender] = useState(0);

  // What to show: pending save value takes priority, then prop
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) {
    pendingVal.current = undefined;
  }

  const formatted = shown != null && shown !== ""
    ? (typeof shown === "number"
      ? Number(shown).toLocaleString("ru-RU", { maximumFractionDigits: 3 })
      : String(shown))
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
          type={isDate ? "date" : isNumeric ? "number" : "text"}
          step="0.01"
          defaultValue={inputVal}
          onBlur={(e) => {
            const raw = e.target.value;
            const newVal = isNumeric
              ? (raw.trim() === "" ? null : parseFloat(raw.replace(",", ".")))
              : (raw.trim() || null);
            if (newVal !== value) {
              pendingVal.current = newVal as string | number | null;
              forceRender((n) => n + 1);
              updateDeal(dealId, { [field]: newVal })
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

export default function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: deal, loading, reload } = useDeal(id);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [numberDialogOpen, setNumberDialogOpen] = useState(false);
  const { isAdmin, isWritable } = useRole();
  const [refs, setRefs] = useState<{
    suppliers: { value: string; label: string }[];
    buyers: { value: string; label: string }[];
    forwarders: { value: string; label: string }[];
    managers: { value: string; label: string }[];
    stations: { value: string; label: string }[];
    companyGroups: { value: string; label: string }[];
    factories: { value: string; label: string }[];
    fuelTypes: { value: string; label: string }[];
    quotationTypes: { value: string; label: string }[];
  }>({ suppliers: [], buyers: [], forwarders: [], managers: [], stations: [], companyGroups: [], factories: [], fuelTypes: [], quotationTypes: [] });

  // Pricing variants per side (multi-line, 00053+00054)
  const { data: supplierLines, reload: reloadSupplierLines } = useDealSupplierLines(id);
  const { data: buyerLines,    reload: reloadBuyerLines }    = useDealBuyerLines(id);
  const { data: lineRollups,   reload: reloadLineRollups }   = useDealLineRollups(id);

  // Load reference data — needed at all times so the variants block
  // can render station/quotation labels even outside edit mode.
  useEffect(() => {
    const sb = createClient();
    Promise.all([
      sb.from("counterparties").select("id, short_name, full_name").eq("type", "supplier").eq("is_active", true),
      sb.from("counterparties").select("id, short_name, full_name").eq("type", "buyer").eq("is_active", true),
      sb.from("forwarders").select("id, name").eq("is_active", true),
      sb.from("profiles").select("id, full_name").eq("is_active", true),
      sb.from("stations").select("id, name").eq("is_active", true).order("name"),
      sb.from("company_groups").select("id, name").eq("is_active", true).order("name"),
      sb.from("factories").select("id, name").eq("is_active", true).order("name"),
      sb.from("fuel_types").select("id, name").eq("is_active", true).order("sort_order"),
      sb.from("quotation_product_types").select("id, name").eq("is_active", true).order("sort_order"),
    ]).then(([s, b, f, m, st, cg, fac, ft, qt]) => {
      setRefs({
        suppliers: (s.data ?? []).map((r) => ({ value: r.id, label: r.short_name || r.full_name })),
        buyers: (b.data ?? []).map((r) => ({ value: r.id, label: r.short_name || r.full_name })),
        forwarders: (f.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        managers: (m.data ?? []).map((r) => ({ value: r.id, label: r.full_name })),
        stations: (st.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        companyGroups: (cg.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        factories: (fac.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        fuelTypes: (ft.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        quotationTypes: (qt.data ?? []).map((r) => ({ value: r.id, label: r.name })),
      });
    });
  }, []);

  const priceConditionOptions = [
    { value: "average_month", label: "Средний месяц" },
    { value: "fixed", label: "Фикс цена на дату" },
    { value: "trigger", label: "Триггер" },
    { value: "manual", label: "Вручную" },
  ];
  const monthOptions = MONTHS_RU.map((m) => ({ value: m, label: m }));

  if (loading) return <p className="text-sm text-muted-foreground py-8">Загрузка сделки...</p>;
  if (!deal) return <p className="text-sm text-destructive py-8">Сделка не найдена</p>;

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
        <Link href="/deals">
          <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
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

      {/* ===== SUPPLIER SECTION (fields + pricing + payments) ===== */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-[14px]">Поставщик</CardTitle>
          <SectionCurrencyPicker editing={editing} value={supplierCurrency} dealId={deal.id} field="supplier_currency" syncLegacy onSaved={reload} />
        </CardHeader>
        <CardContent className="space-y-4">
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
            />
          </div>

          {/* Rollups — derived from registry / payments */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
            <Field label="Сумма отгрузки" value={deal.supplier_shipped_amount} suffix={supplierCurrencySymbol} />
            <Field label="Оплата" value={deal.supplier_payment} suffix={`${supplierCurrencySymbol} (оплаты)`} />
            <Field label="Дата оплаты" value={deal.supplier_payment_date} inputType="date" editing={editing} field="supplier_payment_date" dealId={deal.id} />
            <Field label="Баланс" value={deal.supplier_balance} suffix={`${supplierCurrencySymbol} (авто)`} />
          </div>
        </CardContent>
      </Card>
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
            priceCondition={deal.supplier_price_condition} />
        </div>
      )}
      {/* Supplier payments */}
      <DealPayments dealId={deal.id} currencySymbol={supplierCurrencySymbol} side="supplier" />
      {/* Supplier documents */}
      <DocumentsSection dealId={deal.id} section="supplier" title="Документы — Поставщик" />

      {/* ===== BUYER SECTION (fields + pricing + payments) ===== */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-[14px]">Покупатель</CardTitle>
          <SectionCurrencyPicker editing={editing} value={buyerCurrency} dealId={deal.id} field="buyer_currency" onSaved={reload} />
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>
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
            priceCondition={deal.buyer_price_condition} />
        </div>
      )}
      {/* Buyer payments */}
      <DealPayments dealId={deal.id} currencySymbol={buyerCurrencySymbol} side="buyer" />
      {/* Buyer documents */}
      <DocumentsSection dealId={deal.id} section="buyer" title="Документы — Покупатель" />

      {/* ===== COMPANY CHAIN ===== */}
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
      <DocumentsSection dealId={deal.id} section="company_chain" title="Документы — Цепочка компании" />

      {/* ===== LOGISTICS ===== */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-[14px]">Логистика</CardTitle>
          <SectionCurrencyPicker editing={editing} value={logisticsCurrency} dealId={deal.id} field="logistics_currency" onSaved={reload} />
        </CardHeader>
        <CardContent className="space-y-4">
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
            <Field label="Тариф факт" value={deal.actual_tariff} suffix={logisticsCurrencySymbol} editing={editing} field="actual_tariff" dealId={deal.id} inputType="number" />
            <Field label="Объем плановый" value={deal.preliminary_tonnage} suffix="тонн" editing={editing} field="preliminary_tonnage" dealId={deal.id} />
            <Field label="Предв. сумма" value={deal.preliminary_amount} suffix={`${logisticsCurrencySymbol} (авто)`} />
            <Field label="Факт объем" value={deal.actual_shipped_volume} suffix="тонн (реестр)" />
            <Field label="Сумма" value={deal.invoice_amount} suffix={`${logisticsCurrencySymbol} (реестр)`} />
            <RailwayInPriceToggle dealId={deal.id} value={!!deal.railway_in_price} editing={editing} onSaved={reload} />
            <EditableSelect label="Менеджер" value={deal.supplier_manager_id} displayValue={deal.supplier_manager?.full_name ?? "—"} editing={editing} field="supplier_manager_id" dealId={deal.id} options={refs.managers} />
          </div>
          <DealShipments dealId={deal.id} currencySymbol={logisticsCurrencySymbol} />
        </CardContent>
      </Card>
      {/* Logistics documents */}
      <DocumentsSection dealId={deal.id} section="logistics" title="Документы — Логистика" />

      {/* ===== MANAGERS ===== */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[14px]">Ответственные</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
          <EditableSelect label="Менеджер поставщика" value={deal.supplier_manager_id} displayValue={deal.supplier_manager?.full_name ?? "—"} editing={editing} field="supplier_manager_id" dealId={deal.id} options={refs.managers} />
          <EditableSelect label="Менеджер покупателя" value={deal.buyer_manager_id} displayValue={deal.buyer_manager?.full_name ?? "—"} editing={editing} field="buyer_manager_id" dealId={deal.id} options={refs.managers} />
          <EditableSelect label="Трейдер" value={deal.trader_id} displayValue={deal.trader?.full_name ?? "—"} editing={editing} field="trader_id" dealId={deal.id} options={refs.managers} />
        </CardContent>
      </Card>

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

    {/* Right sidebar: Activity feed — sidebar on large, floating button + modal on small */}
    <div className="hidden lg:block w-[340px] shrink-0">
      <div className="sticky top-0">
        <Card className="h-[calc(100vh-7rem)]">
          <CardHeader className="pb-2 border-b border-stone-200">
            <CardTitle className="text-[14px]">Активность</CardTitle>
          </CardHeader>
          <CardContent className="p-3 h-[calc(100%-3rem)]">
            <DealActivityWrapper dealId={deal.id} />
          </CardContent>
        </Card>
      </div>
    </div>

    {/* Mobile: floating chat button */}
    <MobileChatButton dealId={deal.id} />
    </div>
    </DealReloadContext.Provider>
  );
}

function DealActivityWrapper({ dealId }: { dealId: string }) {
  const { messages, loading, sendMessage } = useDealActivity(dealId);
  return <ActivityFeed messages={messages} loading={loading} sendMessage={sendMessage} />;
}

function MobileChatButton({ dealId }: { dealId: string }) {
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
            <DealActivityWrapper dealId={dealId} />
          </div>
        </div>
      )}
    </>
  );
}

type DocSection = "supplier" | "buyer" | "company_chain" | "logistics";

function DocumentsSection({ dealId, section, title }: {
  dealId: string;
  section: DocSection;
  title: string;
}) {
  const supabase = createClient();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("contract");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, section]);

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

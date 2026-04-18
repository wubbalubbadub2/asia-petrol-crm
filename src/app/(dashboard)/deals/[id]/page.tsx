"use client";

import { use, useState, useEffect, useRef } from "react";
// useEffect needed for Field optimistic state sync
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Upload, FileText, Trash2, MessageSquare, X, Plus } from "lucide-react";
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
import { useDealActivity } from "@/lib/hooks/use-deal-activity";

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

function Field({ label, value, suffix, editing, field, dealId, inputType }: {
  label: string; value: string | number | null | undefined; suffix?: string;
  editing?: boolean; field?: string; dealId?: string; onSaved?: () => void;
  inputType?: "text" | "number" | "date";
}) {
  const isNumeric = typeof value === "number" || inputType === "number";
  const isDate = inputType === "date";
  const [localVal, setLocalVal] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const pendingVal = useRef<string | number | null | undefined>(undefined);

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

  if (editing && field && dealId) {
    if (!isEditing) {
      return (
        <div>
          <span className="text-[11px] text-stone-400 block">{label}</span>
          <button
            onClick={() => { setLocalVal(shown?.toString() ?? ""); setIsEditing(true); }}
            className={`text-[13px] text-stone-800 hover:bg-amber-50 rounded px-1 -ml-1 cursor-text min-w-[40px] text-left ${monoClass}`}
          >
            {formatted}{suffix && shown != null ? ` ${suffix}` : ""}
          </button>
        </div>
      );
    }
    return (
      <div>
        <span className="text-[11px] text-stone-400 block">{label}</span>
        <input
          autoFocus
          type={isDate ? "date" : isNumeric ? "number" : "text"}
          step="0.01"
          value={localVal}
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={() => {
            setIsEditing(false);
            const newVal = isNumeric
              ? (localVal.trim() === "" ? null : parseFloat(localVal))
              : (localVal.trim() || null);
            if (newVal !== value) {
              pendingVal.current = newVal; // Show new value immediately via ref
              updateDeal(dealId, { [field]: newVal }).catch(() => {
                pendingVal.current = undefined; // Revert on error
              });
            }
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setIsEditing(false); }}
          className={`w-full border border-amber-300 rounded px-1 py-0 text-[13px] bg-amber-50/50 focus:outline-none focus:border-amber-500 ${monoClass}`}
        />
      </div>
    );
  }

  return (
    <div>
      <span className="text-[11px] text-stone-400 block">{label}</span>
      <span className={`text-[13px] text-stone-800 ${monoClass}`}>
        {formatted}{suffix && shown != null ? ` ${suffix}` : ""}
      </span>
    </div>
  );
}

// Editable select for reference fields
function EditableSelect({ label, value, displayValue, editing, field, dealId, options }: {
  label: string; value: string | null | undefined; displayValue: string;
  editing: boolean; field: string; dealId: string;
  options: { value: string; label: string }[];
}) {
  const pendingVal = useRef<string | undefined>(undefined);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) pendingVal.current = undefined;

  if (!editing) {
    return (
      <div>
        <span className="text-[11px] text-stone-400 block">{label}</span>
        <span className="text-[13px] text-stone-800">{displayValue || "—"}</span>
      </div>
    );
  }

  return (
    <div>
      <span className="text-[11px] text-stone-400 block">{label}</span>
      <select
        value={shown ?? ""}
        onChange={(e) => {
          const newVal = e.target.value || null;
          pendingVal.current = newVal ?? undefined;
          updateDeal(dealId, { [field]: newVal }).catch(() => { pendingVal.current = undefined; });
        }}
        className="w-full h-8 rounded-md border border-amber-300 bg-amber-50/50 px-2 text-[13px] focus:border-amber-500 focus:outline-none cursor-pointer"
      >
        <option value="">—</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export default function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: deal, loading, reload } = useDeal(id);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [refs, setRefs] = useState<{
    suppliers: { value: string; label: string }[];
    buyers: { value: string; label: string }[];
    forwarders: { value: string; label: string }[];
    managers: { value: string; label: string }[];
    stations: { value: string; label: string }[];
    companyGroups: { value: string; label: string }[];
    factories: { value: string; label: string }[];
    fuelTypes: { value: string; label: string }[];
  }>({ suppliers: [], buyers: [], forwarders: [], managers: [], stations: [], companyGroups: [], factories: [], fuelTypes: [] });

  // Load reference data when entering edit mode
  useEffect(() => {
    if (!editing) return;
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
    ]).then(([s, b, f, m, st, cg, fac, ft]) => {
      setRefs({
        suppliers: (s.data ?? []).map((r: Record<string, string>) => ({ value: r.id, label: r.short_name || r.full_name })),
        buyers: (b.data ?? []).map((r: Record<string, string>) => ({ value: r.id, label: r.short_name || r.full_name })),
        forwarders: (f.data ?? []).map((r: Record<string, string>) => ({ value: r.id, label: r.name })),
        managers: (m.data ?? []).map((r: Record<string, string>) => ({ value: r.id, label: r.full_name })),
        stations: (st.data ?? []).map((r: Record<string, string>) => ({ value: r.id, label: r.name })),
        companyGroups: (cg.data ?? []).map((r: Record<string, string>) => ({ value: r.id, label: r.name })),
        factories: (fac.data ?? []).map((r: Record<string, string>) => ({ value: r.id, label: r.name })),
        fuelTypes: (ft.data ?? []).map((r: Record<string, string>) => ({ value: r.id, label: r.name })),
      });
    });
  }, [editing]);

  const priceConditionOptions = [
    { value: "average_month", label: "Средний месяц" },
    { value: "fixed", label: "Фикс цена на дату" },
    { value: "trigger", label: "Триггер" },
    { value: "manual", label: "Вручную" },
  ];
  const monthOptions = MONTHS_RU.map((m) => ({ value: m, label: m }));
  const currencyOptions = [
    { value: "USD", label: "USD $" },
    { value: "KZT", label: "KZT ₸" },
    { value: "KGS", label: "KGS сом" },
    { value: "RUB", label: "RUB ₽" },
  ];

  if (loading) return <p className="text-sm text-muted-foreground py-8">Загрузка сделки...</p>;
  if (!deal) return <p className="text-sm text-destructive py-8">Сделка не найдена</p>;

  const currency = (deal as Record<string, unknown>).currency as string ?? DEAL_TYPE_CURRENCY[deal.deal_type] ?? "USD";
  const currencySymbol = currency === "KZT" ? "₸" : currency === "KGS" ? "сом" : currency === "RUB" ? "₽" : "$";

  return (
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
              className="ml-auto"
            >
              <Save className="mr-1 h-3.5 w-3.5" />
              {editing ? "Сохранить" : "Редактировать"}
            </Button>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-1 max-w-[600px]">
              <EditableSelect label="Месяц" value={deal.month} displayValue={deal.month} editing field="month" dealId={deal.id} options={monthOptions} />
              <EditableSelect label="Завод" value={deal.factory_id} displayValue={deal.factory?.name ?? "—"} editing field="factory_id" dealId={deal.id} options={refs.factories} />
              <EditableSelect label="ГСМ" value={deal.fuel_type_id} displayValue={deal.fuel_type?.name ?? "—"} editing field="fuel_type_id" dealId={deal.id} options={refs.fuelTypes} />
              <EditableSelect label="Валюта" value={currency} displayValue={currency} editing field="currency" dealId={deal.id} options={currencyOptions} />
            </div>
          ) : (
            <p className="text-[12px] text-stone-500">
              {deal.month} {deal.year} | {deal.factory?.name ?? "—"} | {currency}
            </p>
          )}
        </div>
      </div>

      {/* ===== SUPPLIER SECTION (fields + pricing + payments) ===== */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[14px]">Поставщик</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
          <EditableSelect label="Поставщик" value={deal.supplier_id} displayValue={deal.supplier?.short_name ?? deal.supplier?.full_name ?? "—"} editing={editing} field="supplier_id" dealId={deal.id} options={refs.suppliers} />
          <Field label="№ договора" value={deal.supplier_contract} editing={editing} field="supplier_contract" dealId={deal.id} />
          <Field label="Базис поставки" value={deal.supplier_delivery_basis} editing={editing} field="supplier_delivery_basis" dealId={deal.id} />
          <EditableSelect label="Условие фиксации" value={deal.supplier_price_condition} displayValue={
            deal.supplier_price_condition === "average_month" ? "Средний месяц" :
            deal.supplier_price_condition === "fixed" ? "Фикс цена на дату" :
            deal.supplier_price_condition === "trigger" ? "Триггер" :
            deal.supplier_price_condition === "manual" ? "Вручную" : "—"
          } editing={editing} field="supplier_price_condition" dealId={deal.id} options={priceConditionOptions} />
          <Field label="Котировка" value={deal.supplier_quotation} suffix={currencySymbol} editing={editing} field="supplier_quotation" dealId={deal.id} />
          <Field label="Комментарий котировки" value={deal.supplier_quotation_comment} editing={editing} field="supplier_quotation_comment" dealId={deal.id} />
          <Field label="Скидка" value={deal.supplier_discount} suffix={currencySymbol} editing={editing} field="supplier_discount" dealId={deal.id} />
          <Field label="Объем контракт" value={deal.supplier_contracted_volume} suffix="тонн" editing={editing} field="supplier_contracted_volume" dealId={deal.id} />
          <Field label="Сумма по контракту" value={deal.supplier_contracted_amount} suffix={`${currencySymbol} (авто)`} />
          <Field label="Цена" value={deal.supplier_price} suffix={currencySymbol} editing={editing} field="supplier_price" dealId={deal.id} />
          <Field label="Сумма отгрузки" value={deal.supplier_shipped_amount} suffix={currencySymbol} />
          <Field label="Оплата" value={deal.supplier_payment} suffix={`${currencySymbol} (оплаты)`} />
          <Field label="Дата оплаты" value={deal.supplier_payment_date} inputType="date" editing={editing} field="supplier_payment_date" dealId={deal.id} />
          <Field label="Баланс" value={deal.supplier_balance} suffix={`${currencySymbol} (авто)`} />
          <Field label="% S" value={deal.sulfur_percent} editing={editing} field="sulfur_percent" dealId={deal.id} />
        </CardContent>
      </Card>
      {/* Supplier pricing by month */}
      {deal.supplier_price_condition && deal.supplier_price_condition !== "manual" && (
        <DealTriggerPrices dealId={deal.id} side="supplier" currencySymbol={currencySymbol}
          defaultBasis={(deal as Record<string, unknown>).trigger_basis as "shipment_date" | "border_crossing_date" | undefined}
          defaultDiscount={deal.supplier_discount ?? 0}
          defaultQuotation={deal.supplier_quotation ?? null}
          priceCondition={deal.supplier_price_condition} />
      )}
      {/* Supplier payments */}
      <DealPayments dealId={deal.id} currencySymbol={currencySymbol} side="supplier" />

      {/* ===== BUYER SECTION (fields + pricing + payments) ===== */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[14px]">Покупатель</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
          <EditableSelect label="Покупатель" value={deal.buyer_id} displayValue={deal.buyer?.short_name ?? deal.buyer?.full_name ?? "—"} editing={editing} field="buyer_id" dealId={deal.id} options={refs.buyers} />
          <Field label="№ договора" value={deal.buyer_contract} editing={editing} field="buyer_contract" dealId={deal.id} />
          <Field label="Базис поставки" value={deal.buyer_delivery_basis} editing={editing} field="buyer_delivery_basis" dealId={deal.id} />
          <EditableSelect label="Условие фиксации" value={deal.buyer_price_condition} displayValue={
            deal.buyer_price_condition === "average_month" ? "Средний месяц" :
            deal.buyer_price_condition === "fixed" ? "Фикс цена на дату" :
            deal.buyer_price_condition === "trigger" ? "Триггер" :
            deal.buyer_price_condition === "manual" ? "Вручную" : "—"
          } editing={editing} field="buyer_price_condition" dealId={deal.id} options={priceConditionOptions} />
          <Field label="Котировка" value={deal.buyer_quotation} suffix={currencySymbol} editing={editing} field="buyer_quotation" dealId={deal.id} />
          <Field label="Комментарий котировки" value={deal.buyer_quotation_comment} editing={editing} field="buyer_quotation_comment" dealId={deal.id} />
          <Field label="Скидка" value={deal.buyer_discount} suffix={currencySymbol} editing={editing} field="buyer_discount" dealId={deal.id} />
          <Field label="Объем контракт" value={deal.buyer_contracted_volume} suffix="тонн" editing={editing} field="buyer_contracted_volume" dealId={deal.id} />
          <Field label="Сумма по контракту" value={deal.buyer_contracted_amount} suffix={`${currencySymbol} (авто)`} />
          <Field label="Цена" value={deal.buyer_price} suffix={currencySymbol} editing={editing} field="buyer_price" dealId={deal.id} />
          <Field label="Заявлено" value={deal.buyer_ordered_volume} suffix="тонн" editing={editing} field="buyer_ordered_volume" dealId={deal.id} />
          <Field label="Остаток" value={deal.buyer_remaining} suffix="тонн (авто)" />
          <Field label="Отгружено" value={deal.buyer_shipped_volume} suffix="тонн (реестр)" />
          <Field label="Дата отгрузки" value={deal.buyer_ship_date} inputType="date" editing={editing} field="buyer_ship_date" dealId={deal.id} />
          <Field label="Сумма отгрузки" value={deal.buyer_shipped_amount} suffix={currencySymbol} />
          <Field label="Оплата" value={deal.buyer_payment} suffix={`${currencySymbol} (оплаты)`} />
          <Field label="Дата оплаты" value={deal.buyer_payment_date} inputType="date" editing={editing} field="buyer_payment_date" dealId={deal.id} />
          <Field label="Долг / переплата" value={deal.buyer_debt} suffix={`${currencySymbol} (авто)`} />
        </CardContent>
      </Card>
      {/* Buyer pricing by month */}
      {deal.buyer_price_condition && deal.buyer_price_condition !== "manual" && (
        <DealTriggerPrices dealId={deal.id} side="buyer" currencySymbol={currencySymbol}
          defaultBasis={(deal as Record<string, unknown>).trigger_basis as "shipment_date" | "border_crossing_date" | undefined}
          defaultDiscount={deal.buyer_discount ?? 0}
          defaultQuotation={deal.buyer_quotation ?? null}
          priceCondition={deal.buyer_price_condition} />
      )}
      {/* Buyer payments */}
      <DealPayments dealId={deal.id} currencySymbol={currencySymbol} side="buyer" />

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
        currencySymbol={currencySymbol}
        groups={deal.deal_company_groups ?? []}
        companyGroupOptions={refs.companyGroups}
        onReload={reload}
      />

      {/* ===== LOGISTICS ===== */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[14px]">Логистика</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
            <EditableSelect label="Экспедитор" value={deal.forwarder_id} displayValue={deal.forwarder?.name ?? "—"} editing={editing} field="forwarder_id" dealId={deal.id} options={refs.forwarders} />
            <EditableSelect label="Группа компании" value={deal.logistics_company_group_id} displayValue={deal.logistics_company_group?.name ?? "—"} editing={editing} field="logistics_company_group_id" dealId={deal.id} options={refs.companyGroups} />
            <EditableSelect label="Ст. назначения" value={deal.buyer_destination_station_id} displayValue={deal.buyer_destination_station?.name ?? "—"} editing={editing} field="buyer_destination_station_id" dealId={deal.id} options={refs.stations} />
            <Field label="Тариф план" value={deal.planned_tariff} suffix={currencySymbol} editing={editing} field="planned_tariff" dealId={deal.id} />
            <Field label="Объем плановый" value={deal.preliminary_tonnage} suffix="тонн" editing={editing} field="preliminary_tonnage" dealId={deal.id} />
            <Field label="Предв. сумма" value={deal.preliminary_amount} suffix={`${currencySymbol} (авто)`} />
            <Field label="Факт объем" value={deal.actual_shipped_volume} suffix="тонн (реестр)" />
            <Field label="Сумма" value={deal.invoice_amount} suffix={`${currencySymbol} (реестр)`} />
            <EditableSelect label="Менеджер" value={deal.supplier_manager_id} displayValue={deal.supplier_manager?.full_name ?? "—"} editing={editing} field="supplier_manager_id" dealId={deal.id} options={refs.managers} />
          </div>
          <DealShipments dealId={deal.id} currencySymbol={currencySymbol} />
        </CardContent>
      </Card>

      {/* ===== MANAGERS ===== */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[14px]">Ответственные</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
          <EditableSelect label="Менеджер поставщика" value={deal.supplier_manager_id} displayValue={deal.supplier_manager?.full_name ?? "—"} editing={editing} field="supplier_manager_id" dealId={deal.id} options={refs.managers} />
          <EditableSelect label="Менеджер покупателя" value={deal.buyer_manager_id} displayValue={deal.buyer_manager?.full_name ?? "—"} editing={editing} field="buyer_manager_id" dealId={deal.id} options={refs.managers} />
          <EditableSelect label="Трейдер" value={deal.trader_id} displayValue={deal.trader?.full_name ?? "—"} editing={editing} field="trader_id" dealId={deal.id} options={refs.managers} />
        </CardContent>
      </Card>

      {/* Documents */}
      <DocumentsSection dealId={deal.id} />
    </div>

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

function DocumentsSection({ dealId }: { dealId: string }) {
  const supabase = createClient();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("contract");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAttachments();
  }, [dealId]);

  async function loadAttachments() {
    setLoading(true);
    const { data } = await supabase
      .from("deal_attachments")
      .select("id, category, file_name, file_path, file_size, uploaded_at")
      .eq("deal_id", dealId)
      .order("uploaded_at", { ascending: false });
    setAttachments((data ?? []) as Attachment[]);
    setLoading(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const filePath = `deals/${dealId}/${category}/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("deal-attachments")
      .upload(filePath, file);

    if (uploadError) {
      // Storage bucket might not exist yet, save record anyway with path
      console.warn("Storage upload:", uploadError.message);
    }

    const { error: dbError } = await supabase.from("deal_attachments").insert({
      deal_id: dealId,
      category,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type,
    });

    if (dbError) {
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

  const getCategoryLabel = (cat: string) =>
    ATTACHMENT_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[14px]">Документы</CardTitle>
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
                  onClick={() => handleDelete(att)}
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

"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDeal, updateDeal } from "@/lib/hooks/use-deals";
import { DEAL_TYPE_CURRENCY } from "@/lib/constants/deal-types";

function Field({ label, value, suffix }: { label: string; value: string | number | null | undefined; suffix?: string }) {
  const display = value != null && value !== "" ? String(value) : "—";
  const isNumeric = typeof value === "number";
  return (
    <div>
      <span className="text-[11px] text-stone-400 block">{label}</span>
      <span className={`text-[13px] text-stone-800 ${isNumeric ? "font-mono tabular-nums" : ""}`}>
        {isNumeric ? Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) : display}
        {suffix && value != null ? ` ${suffix}` : ""}
      </span>
    </div>
  );
}

export default function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: deal, loading, reload } = useDeal(id);
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  if (loading) return <p className="text-sm text-muted-foreground py-8">Загрузка сделки...</p>;
  if (!deal) return <p className="text-sm text-destructive py-8">Сделка не найдена</p>;

  const currency = DEAL_TYPE_CURRENCY[deal.deal_type] ?? "USD";
  const currencySymbol = currency === "KZT" ? "₸" : "$";

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/deals">
          <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold font-mono">{deal.deal_code}</h1>
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium border ${
              deal.deal_type === "KG" ? "bg-blue-50 text-blue-700 border-blue-200" :
              deal.deal_type === "KZ" ? "bg-green-50 text-green-700 border-green-200" :
              "bg-purple-50 text-purple-700 border-purple-200"
            }`}>
              {deal.deal_type}
            </span>
            {deal.fuel_type && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-stone-600">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: deal.fuel_type.color }} />
                {deal.fuel_type.name}
              </span>
            )}
          </div>
          <p className="text-[12px] text-stone-500">
            {deal.month} {deal.year} | {deal.factory?.name ?? "—"} | {currency}
          </p>
        </div>
      </div>

      {/* Supplier */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px]">Поставщик</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
          <Field label="Наименование" value={deal.supplier?.short_name ?? deal.supplier?.full_name} />
          <Field label="№ договора" value={deal.supplier_contract} />
          <Field label="Базис поставки" value={deal.supplier_delivery_basis} />
          <Field label="Условие фиксации" value={
            deal.supplier_price_condition === "average_month" ? "Средний месяц" :
            deal.supplier_price_condition === "fixed" ? "Фикс" :
            deal.supplier_price_condition === "trigger" ? "Триггер" : "—"
          } />
          <Field label="Объем контракт" value={deal.supplier_contracted_volume} suffix="тонн" />
          <Field label="Цена" value={deal.supplier_price} suffix={currencySymbol} />
          <Field label="Сумма отгрузки" value={deal.supplier_shipped_amount} suffix={currencySymbol} />
          <Field label="Оплата" value={deal.supplier_payment} suffix={currencySymbol} />
          <Field label="Дата оплаты" value={deal.supplier_payment_date} />
          <Field label="Баланс" value={deal.supplier_balance} suffix={currencySymbol} />
        </CardContent>
      </Card>

      {/* Buyer */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px]">Покупатель</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
          <Field label="Наименование" value={deal.buyer?.short_name ?? deal.buyer?.full_name} />
          <Field label="№ договора" value={deal.buyer_contract} />
          <Field label="Базис / ст. назначения" value={deal.buyer_delivery_basis} />
          <Field label="Условие фиксации" value={
            deal.buyer_price_condition === "average_month" ? "Средний месяц" :
            deal.buyer_price_condition === "fixed" ? "Фикс" :
            deal.buyer_price_condition === "trigger" ? "Триггер" : "—"
          } />
          <Field label="Объем контракт" value={deal.buyer_contracted_volume} suffix="тонн" />
          <Field label="Цена" value={deal.buyer_price} suffix={currencySymbol} />
          <Field label="Заявлено" value={deal.buyer_ordered_volume} suffix="тонн" />
          <Field label="Остаток" value={deal.buyer_remaining} suffix="тонн" />
          <Field label="Отгружено" value={deal.buyer_shipped_volume} suffix="тонн" />
          <Field label="Сумма отгрузки" value={deal.buyer_shipped_amount} suffix={currencySymbol} />
          <Field label="Оплата" value={deal.buyer_payment} suffix={currencySymbol} />
          <Field label="Долг / переплата" value={deal.buyer_debt} suffix={currencySymbol} />
        </CardContent>
      </Card>

      {/* Logistics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px]">Логистика</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
          <Field label="Экспедитор" value={deal.forwarder?.name} />
          <Field label="Тариф план" value={deal.planned_tariff} suffix={currencySymbol} />
          <Field label="Тариф факт" value={deal.actual_tariff} suffix={currencySymbol} />
          <Field label="Объем предварит." value={deal.preliminary_tonnage} suffix="тонн" />
          <Field label="Сумма предварит." value={deal.preliminary_amount} suffix={currencySymbol} />
          <Field label="Факт. объем" value={deal.actual_shipped_volume} suffix="тонн" />
          <Field label="Объем по СФ" value={deal.invoice_volume} suffix="тонн" />
          <Field label="Сумма по СФ" value={deal.invoice_amount} suffix={currencySymbol} />
        </CardContent>
      </Card>

      {/* Managers */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px]">Ответственные</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-x-6 gap-y-2">
          <Field label="Менеджер поставщика" value={deal.supplier_manager?.full_name} />
          <Field label="Менеджер покупателя" value={deal.buyer_manager?.full_name} />
          <Field label="Трейдер" value={deal.trader_id ? "—" : "—"} />
        </CardContent>
      </Card>
    </div>
  );
}

"use client";
// Отчёт «Условия оплаты» (ТЗ клиента 10.08.2026 + файл-пример).
//
// Вся арифметика — в представлении deal_payment_terms_report (00141):
// срок по приложению, плановая дата оплаты, «дней до оплаты». Здесь
// только выбор стороны, года и типа сделки.
//
// Сторона переключается, потому что отчёт нужен по обеим: у поставщика
// свои приложения и свои сроки, у покупателя свои. В присланном файле
// показана сторона поставщика.
import { useQueryState, parseAsInteger, parseAsStringEnum } from "nuqs";
import { usePaymentTerms, type PaymentTermsSide } from "@/lib/hooks/use-payment-terms";
import { PaymentTermsTable } from "@/components/reports/payment-terms-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CURRENT_YEAR = new Date().getFullYear();

export default function PaymentTermsReportPage() {
  const [side, setSide] = useQueryState("side",
    parseAsStringEnum(["supplier", "buyer"]).withDefault("supplier"));
  const [tab, setTab] = useQueryState("tab",
    parseAsStringEnum(["kg", "kz", "all"]).withDefault("kg"));
  const [year, setYear] = useQueryState("year",
    parseAsInteger.withDefault(CURRENT_YEAR));

  const dealType = tab === "kg" ? "KG" : tab === "kz" ? "KZ" : null;
  const { data, loading } = usePaymentTerms({
    side: side as PaymentTermsSide,
    year,
    dealType,
  });

  const overdueCount = data.filter((r) => (r.days_to_pay ?? 0) < 0).length;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Условия оплаты</h1>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex overflow-hidden rounded border border-stone-200 bg-white">
          {(["supplier", "buyer"] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)}
              className={`cursor-pointer px-3 py-1.5 text-[12px] font-medium transition-colors ${side === s ? "bg-amber-500 text-white" : "text-stone-600 hover:bg-stone-50"}`}>
              {s === "supplier" ? "Поставщик" : "Покупатель"}
            </button>
          ))}
        </div>

        <div className="inline-flex overflow-hidden rounded border border-stone-200 bg-white">
          {(["kg", "kz", "all"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`cursor-pointer px-3 py-1.5 text-[12px] font-medium transition-colors ${tab === t ? "bg-amber-500 text-white" : "text-stone-600 hover:bg-stone-50"}`}>
              {t === "kg" ? "KG (Экспорт)" : t === "kz" ? "KZ (Внутренний)" : "Все"}
            </button>
          ))}
        </div>

        <div className="grid gap-1">
          <Label className="text-[11px] text-stone-500">Год</Label>
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
                 className="h-8 w-24 text-[12px]" />
        </div>

        <span className="ml-auto text-[11px] text-stone-400">
          {data.length} строк
          {overdueCount > 0 ? ` · просрочено: ${overdueCount}` : ""}
        </span>
      </div>

      {loading
        ? <p className="text-sm text-stone-500">Загрузка…</p>
        : <PaymentTermsTable rows={data} />}
    </div>
  );
}

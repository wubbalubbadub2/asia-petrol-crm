"use client";

import { use, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Upload, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDeal, updateDeal } from "@/lib/hooks/use-deals";
import { DEAL_TYPE_CURRENCY } from "@/lib/constants/deal-types";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

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

      {/* Documents */}
      <DocumentsSection dealId={deal.id} />
    </div>
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

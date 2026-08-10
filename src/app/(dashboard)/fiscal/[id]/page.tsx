"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy } from "lucide-react";
import { toast } from "sonner";

import { currencySymbol } from "@/lib/constants/currencies";
import { formatDMY, formatDMYTime, formatMoney } from "@/lib/format";
import { FiscalStateBadge } from "@/components/fiscal/fiscal-state-badge";
import { FiscalPositions } from "@/components/fiscal/fiscal-positions";
import { useFiscalDocument, type FiscalLink } from "@/lib/hooks/use-fiscal-document";

/**
 * Карточка фискального документа.
 *
 * Маршрут — по `id` (UUID первичного ключа). Учётный номер в маршруте
 * не участвует принципиально: он не уникален, «225» встречается у трёх
 * разных СНТ за 2023–2025.
 */
export default function FiscalDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { doc, lines, corrects, correctedBy, relatedSnt, loading, error } = useFiscalDocument(id);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Регистрационный номер скопирован");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  if (loading) return <div className="px-4 py-6 text-[13px] text-stone-500">Загрузка…</div>;
  if (error || !doc) {
    return (
      <div className="px-4 py-6">
        <div className="mb-3 text-[13px] text-red-600">{error ?? "Документ не найден"}</div>
        <Link href="/fiscal" className="text-[13px] text-amber-700 hover:underline">
          ← к реестру
        </Link>
      </div>
    );
  }

  const sym = currencySymbol(doc.currency_code, doc.currency_code);
  const kindLabel = doc.doc_kind === "esf" ? "ЭСФ" : "СНТ";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-stone-200 px-4 py-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-2 flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> назад
        </button>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1
            className="text-[20px] font-bold tracking-tight text-stone-900"
            style={{ fontFamily: "'Satoshi', 'DM Sans', sans-serif" }}
          >
            {kindLabel} № {doc.doc_number_display || "—"}
          </h1>
          <FiscalStateBadge code={doc.state_code} label={doc.state_label} />
          {doc.is_void && (
            <span className="rounded-sm bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700 ring-1 ring-inset ring-red-600/20">
              гашеный
            </span>
          )}
          {doc.is_superseded && (
            <span className="rounded-sm bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 ring-1 ring-inset ring-stone-500/20">
              исправлен более поздним
            </span>
          )}
          {doc.operation_kind_code === "Ввоз" && (
            <span className="rounded-sm bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700 ring-1 ring-inset ring-blue-600/20">
              ввоз
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center gap-1">
          <span className="font-mono text-[11px] tabular-nums text-stone-500">
            {doc.registration_number}
          </span>
          <button
            type="button"
            onClick={() => void copy(doc.registration_number)}
            aria-label="Скопировать регистрационный номер"
            className="rounded p-0.5 text-stone-300 hover:bg-stone-100 hover:text-stone-600"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Шапка */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-1 px-4 py-3 text-[12px] sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Дата регистрации" value={formatDMYTime(doc.registration_date)} mono />
        <Field label="Дата выписки" value={formatDMY(doc.issue_date)} mono />
        <Field label="Дата отгрузки" value={formatDMY(doc.shipment_date)} mono />
        <Field label="Направление" value={doc.direction_code} />
        <Field label="Тип" value={doc.doc_type_label ?? doc.doc_type_code} />
        <Field label="Статус" value={doc.status_label ?? doc.status_code} />
        <Field
          label="Вид операции"
          value={doc.operation_kind_label ?? doc.operation_kind_code ?? "—"}
        />
        <Field
          label="Наша сторона"
          value={`${doc.own_party_name ?? "—"}${
            doc.own_party_role_code ? ` · ${roleLabel(doc.own_party_role_code)}` : ""
          }`}
        />
        <Field
          label="Контрагент"
          value={`${doc.counterparty_name ?? "—"}${
            doc.counterparty_role_code ? ` · ${roleLabel(doc.counterparty_role_code)}` : ""
          }`}
          hint={doc.counterparty_identifier ?? "нерезидент, без БИН"}
        />
        <Field
          label="Сумма"
          value={`${formatMoney(doc.total_amount)} ${sym}`}
          mono
          strong
        />
        {doc.fx_rate !== 1 && (
          // Курс справочный: пересчёт в тенге — отдельное решение,
          // которое не принято, и здесь его нет.
          <Field
            label="Курс документа"
            value={`${doc.fx_rate} · пересчёт не выполняется`}
            mono
          />
        )}
        <Field label="Строк" value={String(doc.line_count)} mono />
      </div>

      {/* Цепочка исправлений */}
      {(corrects || correctedBy || relatedSnt) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-stone-200 bg-stone-50 px-4 py-2 text-[12px]">
          {corrects && <LinkRow label="Исправляет" link={corrects} />}
          {correctedBy && <LinkRow label="Исправлен документом" link={correctedBy} />}
          {relatedSnt && <LinkRow label="СНТ" link={relatedSnt} />}
        </div>
      )}

      {/* Позиции */}
      <div className="px-4 py-3">
        <h2 className="mb-1.5 text-[13px] font-semibold text-stone-800">
          Позиции бланка ИС ЭСФ
          {lines.length > 0 && (
            <span className="ml-2 text-[11px] font-normal text-stone-400">
              {lines.length} строк табличной части
            </span>
          )}
        </h2>
        <FiscalPositions
          lines={lines}
          currency={doc.currency_code}
          onLotClick={(lot) => {
            // Партия ищется по всему реестру: приход её создаёт,
            // расход списывает — так видно происхождение товара.
            router.push(`/fiscal?q=${encodeURIComponent(lot)}&chain=1`);
          }}
        />
      </div>
    </div>
  );
}

function roleLabel(code: string): string {
  if (code === "supplier") return "поставщик";
  if (code === "recipient") return "получатель";
  return code;
}

function Field({
  label,
  value,
  hint,
  mono,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span className="w-[130px] shrink-0 text-stone-400">{label}</span>
      <span className="min-w-0">
        <span
          className={`${mono ? "font-mono tabular-nums" : ""} ${
            strong ? "font-semibold text-stone-900" : "text-stone-700"
          }`}
        >
          {value || "—"}
        </span>
        {hint && <span className="ml-2 font-mono text-[10px] text-stone-400">{hint}</span>}
      </span>
    </div>
  );
}

function LinkRow({ label, link }: { label: string; link: NonNullable<FiscalLink> }) {
  return (
    <span>
      <span className="text-stone-400">{label} </span>
      <Link
        href={`/fiscal/${link.id}`}
        className="font-mono tabular-nums text-amber-700 hover:underline"
        title={link.registration_number}
      >
        № {link.doc_number_display || link.registration_number}
      </Link>
    </span>
  );
}

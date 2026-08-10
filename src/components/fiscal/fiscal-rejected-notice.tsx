"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

import { formatDMY, formatMoney } from "@/lib/format";
import { currencySymbol } from "@/lib/constants/currencies";
import { rejectReasonLabel } from "@/lib/fiscal/constants";
import type { FiscalRejectedRow } from "@/lib/hooks/use-fiscal-documents";

/**
 * Предупреждение о документах, которые есть в выгрузке 1С, но которых
 * нет в реестре: загрузчик их отклонил.
 *
 * Зачем это на экране. Без строки счётчики вкладок выглядят полными, а
 * они неполные. Первый, кто сверит реестр с журналом 1С, найдёт
 * расхождение и пойдёт искать ошибку в реестре — которой там нет.
 * Честнее сказать вслух: столько-то документов не загружено и почему.
 *
 * Строка исчезнет сама, без правок кода: список читается из
 * fiscal_rejected_document, и когда 1С пришлёт эти документы
 * исправленными, загрузчик их примет, а представление опустеет.
 */
export function FiscalRejectedNotice({ rows }: { rows: FiscalRejectedRow[] }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;

  // Причина почти всегда одна на всю пачку; если их несколько,
  // показываем в заголовке самую частую, а полный разбор — в раскрытии.
  const byReason = new Map<string, number>();
  for (const r of rows) {
    const key = r.reject_reason ?? "";
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  const topReason = [...byReason.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const dates = rows.map((r) => r.registration_date ?? "").filter(Boolean).sort();
  const kinds = [...new Set(rows.map((r) => (r.doc_kind === "esf" ? "ЭСФ" : "СНТ")))];
  const operations = [...new Set(rows.map((r) => r.operation_kind_code).filter(Boolean))];

  // Суммы складываются в пределах валюты — как и везде на этом экране.
  const sums = new Map<string, number>();
  for (const r of rows) {
    const cur = r.currency_code ?? "—";
    sums.set(cur, (sums.get(cur) ?? 0) + (r.total_amount ?? 0));
  }

  return (
    <div className="mb-2 rounded-md border border-amber-300 bg-amber-50/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="text-[13px] font-semibold text-stone-800">
          {rows.length}{" "}
          {rows.length === 1 ? "документ не загружен" : "документов не загружены"}
        </span>
        <span className="truncate text-[12px] text-stone-600">
          — {rejectReasonLabel(topReason)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-stone-500">
          {open ? "свернуть" : "раскрыть"}
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-amber-200 px-3 py-2.5 text-[12px] text-stone-700">
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
            <dt className="text-stone-500">Причина</dt>
            <dd>
              {[...byReason.entries()]
                .map(([code, n]) => `${rejectReasonLabel(code)} — ${n}`)
                .join("; ")}
            </dd>

            <dt className="text-stone-500">Вид</dt>
            <dd>
              {kinds.join(", ")}
              {operations.length ? `, вид операции «${operations.join("», «")}»` : ""}
            </dd>

            <dt className="text-stone-500">Период</dt>
            <dd className="font-mono tabular-nums">
              {dates.length ? `${formatDMY(dates[0])} — ${formatDMY(dates[dates.length - 1])}` : "—"}
            </dd>

            <dt className="text-stone-500">Сумма</dt>
            <dd className="font-mono tabular-nums">
              {[...sums.entries()]
                .map(([cur, sum]) => `${formatMoney(sum)} ${currencySymbol(cur, cur)}`)
                .join(" · ")}
            </dd>

            <dt className="text-stone-500">Что дальше</dt>
            <dd>
              Исправление на стороне обработки 1С. После перевыгрузки документы
              приедут принятыми и попадут в реестр сами — эта строка исчезнет.
            </dd>

            <dt className="self-start text-stone-500">Номера</dt>
            <dd className="space-y-0.5 font-mono text-[11px] tabular-nums">
              {/* Ключ — позиция в списке: регистрационный номер здесь
                  формально nullable (колонка представления), а
                  Math.random() в ключе ломал бы согласование при каждом
                  рендере. Список неупорядоченно не меняется: он
                  приходит одним запросом и отсортирован по дате. */}
              {rows.map((r, i) => (
                <div key={`${r.registration_number ?? "—"}#${i}`}>{r.registration_number ?? "—"}</div>
              ))}
            </dd>
          </dl>
        </div>
      )}
    </div>
  );
}

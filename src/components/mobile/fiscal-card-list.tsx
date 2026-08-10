"use client";

import Link from "next/link";

import { currencySymbol } from "@/lib/constants/currencies";
import { formatDMY, formatMoney } from "@/lib/format";
import { FiscalStateBadge } from "@/components/fiscal/fiscal-state-badge";
import type { FiscalDocumentRow } from "@/lib/hooks/use-fiscal-documents";

/**
 * Мобильный вид реестра: карточка на документ вместо таблицы —
 * так же, как сделаны реестр отгрузки и ДТ-КТ.
 *
 * Только чтение. Порядок сведений внутри карточки повторяет порядок
 * колонок журнала, чтобы взгляд, привыкший к десктопу, не
 * переучивался.
 */
export function FiscalCardList({
  rows,
  canonicalNameById,
}: {
  rows: FiscalDocumentRow[];
  canonicalNameById: Map<string, string>;
}) {
  if (!rows.length) {
    return (
      <div className="px-3 py-6 text-center text-[13px] text-stone-500">
        Ничего не найдено
      </div>
    );
  }

  return (
    <div className="space-y-2 px-2 py-2">
      {rows.map((r) => {
        const canonical = r.counterparty_identifier
          ? canonicalNameById.get(r.counterparty_identifier)
          : null;
        const dimmed = r.is_void || r.is_superseded;

        return (
          <Link
            key={r.id}
            href={`/fiscal/${r.id}`}
            className={`block rounded-lg border border-stone-200 bg-white px-3 py-2.5 ${
              dimmed ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={`font-mono text-[13px] font-semibold text-stone-800 ${
                  r.is_superseded ? "line-through" : ""
                }`}
              >
                {r.doc_number_display || "—"}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-stone-400">
                {formatDMY(r.registration_date)}
              </span>
            </div>

            <div className="mt-1 truncate text-[12px] text-stone-700">
              {canonical ?? r.counterparty_name ?? "—"}
            </div>
            <div className="font-mono text-[10px] tabular-nums text-stone-400">
              {r.counterparty_identifier ?? "нерезидент, без БИН"}
            </div>

            <div className="mt-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <FiscalStateBadge code={r.state_code} label={r.state_label} />
                {r.operation_kind_code === "Ввоз" && (
                  <span className="rounded-sm bg-blue-50 px-1 text-[10px] text-blue-700 ring-1 ring-inset ring-blue-600/20">
                    ввоз
                  </span>
                )}
              </div>
              <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-stone-900">
                {formatMoney(r.total_amount)} {currencySymbol(r.currency_code, r.currency_code)}
              </span>
            </div>

            <div className="mt-1 truncate text-[10px] text-stone-400">
              {r.doc_type_label ?? r.doc_type_code}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

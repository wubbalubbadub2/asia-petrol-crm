"use client";

import Link from "next/link";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currencySymbol } from "@/lib/constants/currencies";
import { formatDMY, formatDMYTime, formatMoney } from "@/lib/format";
import { FiscalStateBadge } from "@/components/fiscal/fiscal-state-badge";
import type { FiscalDocumentRow } from "@/lib/hooks/use-fiscal-documents";
import type { CurrencyTotal } from "@/lib/fiscal/filter";

/**
 * Журнал фискальных документов. Колонки и их порядок повторяют журнал
 * 1С — клиент к нему привык: дата, номер, состояние, тип, контрагент,
 * сумма.
 *
 * Номер в колонке — учётный (`doc_number_display`), тот, которым
 * оперируют в разговоре. Он НЕ уникален: «225» встречается у трёх СНТ
 * за 2023–2025, у ЭСФ 2713 различных номеров на 4626 документов.
 * Поэтому ни в маршруте, ни в ключе React он не участвует — везде
 * используется `id`. Полный регистрационный живёт в тултипе и
 * копируется одним кликом: он нужен ровно в момент, когда его надо
 * куда-то вставить.
 */
export function FiscalTable({
  rows,
  canonicalNameById,
  totals,
  loading,
}: {
  rows: FiscalDocumentRow[];
  canonicalNameById: Map<string, string>;
  totals: CurrencyTotal[];
  loading: boolean;
}) {
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Регистрационный номер скопирован");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  if (loading) {
    return <div className="px-3 py-6 text-[13px] text-stone-500">Загрузка…</div>;
  }
  if (!rows.length) {
    return (
      <div className="px-3 py-6 text-[13px] text-stone-500">
        Ничего не найдено. Проверьте фильтры или включите «показать всю цепочку».
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-stone-50">
          <TableRow>
            <TableHead className="w-[86px] text-[12px]">Дата</TableHead>
            <TableHead className="w-[140px] text-[12px]">Номер</TableHead>
            <TableHead className="w-[190px] text-[12px]">Состояние</TableHead>
            <TableHead className="w-[170px] text-[12px]">Тип</TableHead>
            <TableHead className="text-[12px]">Контрагент</TableHead>
            <TableHead className="w-[170px] text-right text-[12px]">Сумма</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((r) => {
            const canonical = r.counterparty_identifier
              ? canonicalNameById.get(r.counterparty_identifier)
              : null;
            // Гашеный документ виден только при включённой цепочке —
            // приглушаем, чтобы он не читался как рабочий.
            const dimmed = r.is_void || r.is_superseded;

            return (
              <TableRow key={r.id} className={dimmed ? "text-stone-400" : undefined}>
                <TableCell className="py-1 align-top">
                  <span
                    className="font-mono text-[11px] tabular-nums"
                    title={formatDMYTime(r.registration_date)}
                  >
                    {formatDMY(r.registration_date)}
                  </span>
                </TableCell>

                <TableCell className="py-1 align-top">
                  <div className="flex items-start gap-1">
                    <Link
                      href={`/fiscal/${r.id}`}
                      title={r.registration_number}
                      className={`font-mono text-[11px] tabular-nums hover:underline ${
                        r.is_superseded ? "line-through" : ""
                      } ${dimmed ? "" : "text-stone-800"}`}
                    >
                      {r.doc_number_display || "—"}
                    </Link>
                    <button
                      type="button"
                      onClick={() => void copy(r.registration_number)}
                      title={`Скопировать ${r.registration_number}`}
                      aria-label="Скопировать регистрационный номер"
                      className="mt-0.5 shrink-0 rounded p-0.5 text-stone-300 hover:bg-stone-100 hover:text-stone-600"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  {r.is_superseded && (
                    <div className="text-[10px] text-stone-400">исправлен</div>
                  )}
                </TableCell>

                <TableCell className="py-1 align-top">
                  <FiscalStateBadge code={r.state_code} label={r.state_label} />
                </TableCell>

                <TableCell className="py-1 align-top">
                  <span className="text-[11px]" title={r.doc_type_label ?? r.doc_type_code}>
                    {r.doc_type_label ?? r.doc_type_code}
                  </span>
                  {/* «Ввоз» помечается прямо в строке: у таких СНТ
                      направление «Исходящий», хотя товар получаем мы. */}
                  {r.operation_kind_code === "Ввоз" && (
                    <span className="ml-1 rounded-sm bg-blue-50 px-1 text-[10px] text-blue-700 ring-1 ring-inset ring-blue-600/20">
                      ввоз
                    </span>
                  )}
                </TableCell>

                <TableCell className="py-1 align-top">
                  <div className="truncate text-[11px]" title={r.counterparty_name ?? undefined}>
                    {canonical ?? r.counterparty_name ?? "—"}
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-stone-400">
                    {r.counterparty_identifier ?? "нерезидент, без БИН"}
                  </div>
                </TableCell>

                <TableCell className="py-1 text-right align-top">
                  <span className="font-mono text-[11px] tabular-nums">
                    {formatMoney(r.total_amount)} {currencySymbol(r.currency_code, r.currency_code)}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <FiscalCurrencyTotals totals={totals} />
    </div>
  );
}

/**
 * Итоги по валютам.
 *
 * Единого итога нет намеренно: 158 документов выписаны не в тенге,
 * пересчёт по fx_rate — отдельное решение, которое сейчас не принято.
 * Сложить разные валюты нельзя, показать только тенге — соврать
 * умолчанием. Поэтому по строке на валюту.
 */
export function FiscalCurrencyTotals({ totals }: { totals: CurrencyTotal[] }) {
  if (!totals.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stone-200 bg-stone-50 px-3 py-1.5">
      {totals.map((t) => (
        <span key={t.currency} className="text-[11px] text-stone-600">
          <span className="font-semibold text-stone-700">{t.currency}</span>{" "}
          <span className="font-mono tabular-nums">{t.count}</span>
          <span className="text-stone-400"> · </span>
          <span className="font-mono tabular-nums">
            {formatMoney(t.amount)} {currencySymbol(t.currency, t.currency)}
          </span>
        </span>
      ))}
      <span className="text-[10px] text-stone-400">
        валюты не суммируются между собой
      </span>
    </div>
  );
}

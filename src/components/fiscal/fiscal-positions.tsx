"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { currencySymbol } from "@/lib/constants/currencies";
import { formatMoney, formatVolume } from "@/lib/format";
import { groupPositions, type FiscalLine } from "@/lib/fiscal/group-positions";

/**
 * Позиции документа.
 *
 * Позиция бланка ИС ЭСФ — это ГРУППА строк с одним `snt_line_no`, а не
 * строка табличной части: 1С раскладывает одну позицию по записям-
 * остаткам виртуального склада. Контрагент в ИС ЭСФ видит позиции,
 * поэтому первым уровнем показываем их, а исходные строки — раскрытием.
 * В боевом СНТ …50229974 таких строк 88 при двух позициях.
 *
 * В раскрытии видна партия (`source_lot_id`): по ней прослеживается
 * происхождение товара — входящая СНТ партию создаёт, исходящая
 * с неё списывает.
 */
export function FiscalPositions({
  lines,
  currency,
  onLotClick,
}: {
  lines: FiscalLine[];
  currency: string;
  onLotClick?: (lot: string) => void;
}) {
  const positions = groupPositions(lines);
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (!positions.length) {
    return (
      <div className="px-3 py-4 text-[12px] text-stone-500">
        В документе нет товарных строк. Это нормальное состояние: в выгрузке
        118 таких СНТ.
      </div>
    );
  }

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const sym = currencySymbol(currency, currency);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead className="bg-stone-50 text-stone-500">
          <tr>
            <th className="w-[28px] px-1 py-1" />
            <th className="w-[44px] px-2 py-1 text-left font-medium">№</th>
            <th className="px-2 py-1 text-left font-medium">Наименование</th>
            <th className="w-[110px] px-2 py-1 text-left font-medium">ПИН</th>
            <th className="w-[110px] px-2 py-1 text-right font-medium">Количество</th>
            <th className="w-[110px] px-2 py-1 text-right font-medium">Цена</th>
            <th className="w-[130px] px-2 py-1 text-right font-medium">Без НДС</th>
            <th className="w-[110px] px-2 py-1 text-right font-medium">НДС</th>
            <th className="w-[130px] px-2 py-1 text-right font-medium">Сумма</th>
          </tr>
        </thead>

        <tbody>
          {positions.map((p) => {
            const expandable = p.lines.length > 1;
            const isOpen = open.has(p.key);
            return (
              // Ключ на фрагменте, а не на <tr>: позиция разворачивается
              // в несколько строк таблицы, и React сверяет именно
              // фрагмент. Ключ — p.key (позиция бланка либо номер строки),
              // учётный номер документа в ключах не участвует нигде: он
              // не уникален.
              <Fragment key={p.key}>
                <tr className="border-t border-stone-100 hover:bg-stone-50/60">
                  <td className="px-1 py-1 align-top">
                    {expandable && (
                      <button
                        type="button"
                        onClick={() => toggle(p.key)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? "Свернуть строки позиции" : "Раскрыть строки позиции"}
                        className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                      >
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1 align-top font-mono tabular-nums text-stone-500">
                    {p.positionNo ?? "—"}
                  </td>
                  <td className="px-2 py-1 align-top">
                    {p.name ?? "—"}
                    {expandable && (
                      <span className="ml-1.5 text-[10px] text-stone-400">
                        {p.lines.length} строк по партиям
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 align-top font-mono tabular-nums text-stone-500">
                    {p.pinCode ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-right align-top font-mono tabular-nums">
                    {p.quantity == null ? (
                      // Единицы внутри позиции разошлись — сумма
                      // количества смысла не имеет.
                      <span title="Внутри позиции разные единицы измерения" className="text-stone-400">
                        —
                      </span>
                    ) : (
                      <>
                        {formatVolume(p.quantity)}{" "}
                        <span className="text-stone-400">{p.unit ?? ""}</span>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right align-top font-mono tabular-nums">
                    {p.priceVaries ? (
                      <span title="Внутри позиции цена различается" className="text-stone-400">
                        разная
                      </span>
                    ) : (
                      formatMoney(p.price)
                    )}
                  </td>
                  <td className="px-2 py-1 text-right align-top font-mono tabular-nums">
                    {formatMoney(p.amountNet)}
                  </td>
                  <td className="px-2 py-1 text-right align-top font-mono tabular-nums">
                    {formatMoney(p.vatAmount)}
                  </td>
                  <td className="px-2 py-1 text-right align-top font-mono font-semibold tabular-nums">
                    {formatMoney(p.amount)} {sym}
                  </td>
                </tr>

                {isOpen &&
                  p.lines.map((l) => (
                    <tr key={l.id} className="bg-stone-50/40 text-stone-600">
                      <td />
                      <td className="px-2 py-0.5 text-right align-top font-mono text-[10px] tabular-nums text-stone-400">
                        {l.line_no}
                      </td>
                      <td className="px-2 py-0.5 align-top" colSpan={2}>
                        {l.source_lot_id ? (
                          <button
                            type="button"
                            onClick={() => onLotClick?.(l.source_lot_id as string)}
                            title="Партия виртуального склада ИС ЭСФ — показать все документы с ней"
                            className="font-mono text-[10px] tabular-nums text-amber-700 hover:underline"
                          >
                            партия {l.source_lot_id}
                          </button>
                        ) : (
                          <span className="text-[10px] text-stone-400">партия не указана</span>
                        )}
                        {/* Вес нетто живёт только здесь и в своей
                            единице: с quantity он не связан и не
                            сверяется — приходит в разных единицах. */}
                        {l.net_weight ? (
                          <span className="ml-2 text-[10px] text-stone-400">
                            нетто {formatVolume(l.net_weight)} {l.storage_unit ?? ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-0.5 text-right align-top font-mono text-[10px] tabular-nums">
                        {formatVolume(l.quantity)} <span className="text-stone-400">{l.unit ?? ""}</span>
                      </td>
                      <td className="px-2 py-0.5 text-right align-top font-mono text-[10px] tabular-nums">
                        {formatMoney(l.price)}
                      </td>
                      <td className="px-2 py-0.5 text-right align-top font-mono text-[10px] tabular-nums">
                        {formatMoney(l.amount_net)}
                      </td>
                      <td className="px-2 py-0.5 text-right align-top font-mono text-[10px] tabular-nums">
                        {formatMoney(l.vat_amount)}
                      </td>
                      <td className="px-2 py-0.5 text-right align-top font-mono text-[10px] tabular-nums">
                        {formatMoney(l.amount)}
                      </td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Раздел печатного бланка СНТ и поле внутри него.
 *
 * Подписи повторяют бланк дословно, вместе с номерами полей: клиент
 * сверяет экран с печатной формой, и «13. ИИН/БИН» он там и найдёт.
 * Придуманных названий вроде «наша сторона» здесь быть не должно —
 * в документе таких нет.
 *
 * Пустые поля по умолчанию скрыты: в бланке 90 полей, у типичной СНТ
 * заполнена половина, и показывать сорок прочерков — значит утопить
 * то, что заполнено.
 */
export function FiscalSection({
  title,
  children,
  defaultOpen = true,
  count,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-stone-200 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-4 py-1.5 text-left hover:bg-stone-50"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
        )}
        <span className="text-[12px] font-semibold uppercase tracking-wide text-stone-600">
          {title}
        </span>
        {count != null && count > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-stone-400">{count}</span>
        )}
      </button>
      {open && <div className="px-4 pb-2.5">{children}</div>}
    </section>
  );
}

/** Сетка полей раздела: подпись слева, значение справа. */
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-0.5 text-[12px] lg:grid-cols-2">
      {children}
    </dl>
  );
}

/**
 * Поле бланка. `label` — подпись оттуда же, вместе с номером.
 * Пустое значение не рендерится вовсе, если не задано `always`.
 */
export function Field({
  label,
  value,
  hint,
  mono,
  always,
}: {
  label: string;
  value: string | null | undefined;
  hint?: string | null;
  mono?: boolean;
  always?: boolean;
}) {
  const empty = value == null || value === "";
  if (empty && !always) return null;
  return (
    <div className="flex gap-2 py-0.5">
      <dt className="w-[210px] shrink-0 text-stone-400">{label}</dt>
      <dd className="min-w-0 flex-1">
        <span className={mono ? "font-mono tabular-nums text-stone-700" : "text-stone-700"}>
          {empty ? "—" : value}
        </span>
        {hint && <span className="ml-2 font-mono text-[10px] text-stone-400">{hint}</span>}
      </dd>
    </div>
  );
}

/**
 * Отметка-галочка бланка: показываем только проставленные.
 * null означает «в выгрузке поля нет», false — «явно не отмечено»;
 * ни то ни другое в бланке не печатается.
 */
export function Marks({ items }: { items: [string, boolean | null | undefined][] }) {
  const on = items.filter(([, v]) => v === true);
  if (!on.length) return null;
  return (
    <div className="flex flex-wrap gap-1 py-1">
      {on.map(([label]) => (
        <span
          key={label}
          className="rounded-sm bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-700 ring-1 ring-inset ring-stone-500/20"
        >
          ☑ {label}
        </span>
      ))}
    </div>
  );
}

/**
 * Табличная часть документа, кроме товарной: ТоварыВС и
 * ДанныеОГрузе1_2 (путевой лист, ТТН, водитель, маршрут). Состав
 * колонок в них плавает, поэтому рисуем как есть — по ключам объекта.
 */
export function RawTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows?.length) return null;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) =>
    rows.some((r) => r[c] !== null && r[c] !== "" && r[c] !== false),
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead className="bg-stone-50 text-stone-500">
          <tr>
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-stone-100">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap px-2 py-0.5 text-stone-700">
                  {r[c] == null || r[c] === false ? "" : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

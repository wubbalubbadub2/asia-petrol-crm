/**
 * Единый источник правды для форматирования чисел в UI.
 *
 * Правила (утверждено клиентом 2026-07-07):
 * • Деньги (сумма, оплата, баланс, долг, тариф, цена $/т, скидка,
 *   котировка, FX-курс) — 2 знака после запятой всегда.
 * • Тонны / объёмы — 3 знака после запятой всегда.
 * • Целые числа (кол-во дней триггера, кол-во строк, размер файла) —
 *   0 знаков.
 * • Проценты — 1–2 знака + суффикс "%".
 *
 * Все функции принимают `number | null | undefined`. null/undefined →
 * пустая строка. 0 форматируется явно ("0,00" / "0,000" / "0") — чтобы
 * пользователь видел «ноль», а не пустую ячейку. Если конкретному
 * вызову нужно «пусто на 0», используй *OrBlank варианты.
 */

const RU = "ru-RU";

/** Деньги / цена / тариф / котировка / FX. Всегда 2 знака. */
export function formatMoney(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toLocaleString(RU, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Как formatMoney, но 0 → "" (пустая ячейка вместо «0,00»). */
export function formatMoneyOrBlank(v: number | null | undefined): string {
  if (v == null || v === 0) return "";
  return formatMoney(v);
}

/** Тонны / объём. Всегда 3 знака. */
export function formatVolume(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toLocaleString(RU, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/** Тонны с 0 → "". */
export function formatVolumeOrBlank(v: number | null | undefined): string {
  if (v == null || v === 0) return "";
  return formatVolume(v);
}

/** Целое число (без запятой). */
export function formatCount(v: number | null | undefined): string {
  if (v == null) return "";
  return Math.trunc(v).toLocaleString(RU, { maximumFractionDigits: 0 });
}

/** Процент — 1–2 знака после запятой + " %". */
export function formatPercent(v: number | null | undefined): string {
  if (v == null) return "";
  return `${v.toLocaleString(RU, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} %`;
}

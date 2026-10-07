/**
 * Фильтр паспорта по цене поставщика / покупателя (клиент 2026-10-07:
 * «добавь фильтр по ценам… и со стороны покупателя»).
 *
 * Цена в паспорте показывается с 3 знаками; ключ фильтра — та же цена,
 * записанная с 3 знаками («771.000»), чтобы 771 и 771.0004 не стали
 * двумя разными пунктами, которые выглядят одинаково.
 */
import { formatPrice } from "@/lib/format";

export function priceKey(v: number | string | null | undefined): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(3) : null;
}

/** Пункты списка: уникальные цены по возрастанию + уже выбранные. */
export function priceOptions(
  values: Iterable<number | string | null | undefined>,
  selected: readonly string[] = [],
): { value: string; label: string }[] {
  const keys = new Set<string>(selected);
  for (const v of values) {
    const k = priceKey(v);
    if (k != null) keys.add(k);
  }
  return [...keys]
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => ({ value: k, label: formatPrice(Number(k)) }));
}

export function matchesPrice(v: number | string | null | undefined, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  const k = priceKey(v);
  return k != null && selected.includes(k);
}

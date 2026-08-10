/**
 * Фильтрация и итоги реестра фискальных документов.
 *
 * Чистые функции без React и без сети: вкладка и признак актуальности
 * отсекаются в БД, всё остальное — здесь, поверх уже загруженной
 * вкладки.
 *
 * Правило перечислений действует и тут: любое сравнение идёт по КОДУ
 * (`state_code`, `doc_type_code`, `operation_kind_code`), синонимы
 * участвуют только в текстовом поиске, потому что оператор ищет теми
 * словами, которые видит на экране.
 */

import { COUNTERPARTY_NONE, OPERATION_KIND_NONE } from "@/lib/fiscal/constants";
import type { FiscalDocumentRow } from "@/lib/hooks/use-fiscal-documents";

export type FiscalFilters = {
  /** Подстрока: номер учётный и регистрационный, имя и БИН контрагента. */
  query: string;
  stateCodes: string[];
  docTypeCodes: string[];
  operationKindCodes: string[];
  /** БИН контрагента; COUNTERPARTY_NONE — нерезиденты без идентификатора. */
  counterparties: string[];
  currencies: string[];
  /** Границы по дате регистрации, включительно, формат ГГГГ-ММ-ДД. */
  dateFrom: string;
  dateTo: string;
};

export const EMPTY_FISCAL_FILTERS: FiscalFilters = {
  query: "",
  stateCodes: [],
  docTypeCodes: [],
  operationKindCodes: [],
  counterparties: [],
  currencies: [],
  dateFrom: "",
  dateTo: "",
};

export function activeFilterCount(f: FiscalFilters): number {
  return (
    (f.query.trim() ? 1 : 0) +
    (f.stateCodes.length ? 1 : 0) +
    (f.docTypeCodes.length ? 1 : 0) +
    (f.operationKindCodes.length ? 1 : 0) +
    (f.counterparties.length ? 1 : 0) +
    (f.currencies.length ? 1 : 0) +
    (f.dateFrom ? 1 : 0) +
    (f.dateTo ? 1 : 0)
  );
}

/**
 * Каноническое имя нужно и поиску: оператор набирает то написание,
 * которое видит в списке, а в самом документе может лежать другое.
 * Поэтому в область поиска входят оба.
 */
export function matchesQuery(
  row: FiscalDocumentRow,
  needle: string,
  canonicalName?: string,
): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    row.doc_number_display,
    row.registration_number,
    row.counterparty_name,
    row.counterparty_identifier,
    canonicalName,
  ];
  return haystack.some((v) => v != null && v.toLowerCase().includes(q));
}

export function filterFiscalRows(
  rows: FiscalDocumentRow[],
  filters: FiscalFilters,
  canonicalNameById?: Map<string, string>,
): FiscalDocumentRow[] {
  const {
    query, stateCodes, docTypeCodes, operationKindCodes,
    counterparties, currencies, dateFrom, dateTo,
  } = filters;

  return rows.filter((r) => {
    if (stateCodes.length && !stateCodes.includes(r.state_code)) return false;
    if (docTypeCodes.length && !docTypeCodes.includes(r.doc_type_code)) return false;

    if (operationKindCodes.length) {
      // Пустой вид операции — полноценное значение фильтра: таких
      // документов 6051 из 6979, без этой грани фильтр был бы
      // односторонним.
      const code = r.operation_kind_code ?? OPERATION_KIND_NONE;
      if (!operationKindCodes.includes(code)) return false;
    }

    if (counterparties.length) {
      // Нерезиденты приезжают без идентификатора (27 документов) и
      // группировке по БИНу не поддаются — им отведено отдельное
      // значение фильтра, иначе они выпадали бы из любой выборки.
      const id = r.counterparty_identifier ?? COUNTERPARTY_NONE;
      if (!counterparties.includes(id)) return false;
    }

    if (currencies.length && !currencies.includes(r.currency_code)) return false;

    // registration_date хранится без часового пояса и приезжает как
    // «2023-05-05T09:57:12». Сравниваем по первым десяти символам:
    // это дата как её видит оператор, без сдвигов на зону.
    const day = r.registration_date.slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;

    const canonical = r.counterparty_identifier
      ? canonicalNameById?.get(r.counterparty_identifier)
      : undefined;
    return matchesQuery(r, query, canonical);
  });
}

/**
 * Итоги по валютам.
 *
 * Единого итога нет и не будет: 158 документов выписаны не в тенге, а
 * пересчёт по fx_rate — отдельное решение, которое сейчас не принято.
 * Складывать разные валюты нельзя, показывать только тенге — врать
 * умолчанием. Поэтому по строке на валюту.
 */
export type CurrencyTotal = { currency: string; count: number; amount: number };

export function currencyTotals(rows: FiscalDocumentRow[]): CurrencyTotal[] {
  const acc = new Map<string, CurrencyTotal>();
  for (const r of rows) {
    const key = r.currency_code;
    const cur = acc.get(key) ?? { currency: key, count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += r.total_amount ?? 0;
    acc.set(key, cur);
  }
  // Тенге первым как валюта подавляющего большинства, дальше по убыванию
  // количества — чтобы строка читалась слева направо по значимости.
  return [...acc.values()].sort((a, b) => {
    if (a.currency === "KZT") return -1;
    if (b.currency === "KZT") return 1;
    return b.count - a.count;
  });
}

/** Значения перечислений, реально встречающиеся в загруженной вкладке. */
export function facetOptions(
  rows: FiscalDocumentRow[],
  codeKey: "state_code" | "doc_type_code",
  labelKey: "state_label" | "doc_type_label",
): { value: string; label: string; count: number }[] {
  const acc = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    const code = r[codeKey];
    const entry = acc.get(code);
    if (entry) entry.count += 1;
    // Синоним берём из первой встреченной строки: показываем то, что
    // видит оператор, а сравниваем всё равно по коду.
    else acc.set(code, { label: r[labelKey] ?? code, count: 1 });
  }
  return [...acc.entries()]
    .map(([value, v]) => ({ value, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);
}

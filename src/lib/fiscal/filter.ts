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

import { COUNTERPARTY_NONE } from "@/lib/fiscal/constants";
import type { FiscalDocumentRow } from "@/lib/hooks/use-fiscal-documents";

export type FiscalFilters = {
  /** Подстрока: номер учётный и регистрационный, имя и БИН сторон. */
  query: string;
  /** БИН поставщика — поля 13/14 бланка. */
  suppliers: string[];
  /** БИН получателя — поля 22/23 бланка. */
  recipients: string[];
  /** Границы по дате регистрации, включительно, формат ГГГГ-ММ-ДД. */
  dateFrom: string;
  dateTo: string;
};

export const EMPTY_FISCAL_FILTERS: FiscalFilters = {
  query: "",
  suppliers: [],
  recipients: [],
  dateFrom: "",
  dateTo: "",
};

export function activeFilterCount(f: FiscalFilters): number {
  return (
    (f.query.trim() ? 1 : 0) +
    (f.suppliers.length ? 1 : 0) +
    (f.recipients.length ? 1 : 0) +
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
    row.supplier_name,
    row.supplier_identifier,
    row.recipient_name,
    row.recipient_identifier,
    canonicalName,
  ];
  return haystack.some((v) => v != null && v.toLowerCase().includes(q));
}

export function filterFiscalRows(
  rows: FiscalDocumentRow[],
  filters: FiscalFilters,
  canonicalNameById?: Map<string, string>,
): FiscalDocumentRow[] {
  const { query, suppliers, recipients, dateFrom, dateTo } = filters;

  return rows.filter((r) => {
    // Поставщик и получатель — стороны бланка (поля 13/14 и 22/23).
    // Сравниваем по БИНу: один контрагент приезжает под разными
    // написаниями, по тексту его не собрать.
    if (suppliers.length) {
      const id = r.supplier_identifier ?? COUNTERPARTY_NONE;
      if (!suppliers.includes(id)) return false;
    }
    if (recipients.length) {
      const id = r.recipient_identifier ?? COUNTERPARTY_NONE;
      if (!recipients.includes(id)) return false;
    }

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

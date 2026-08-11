"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";
import { FISCAL_TABS, fiscalTab, type FiscalTabKey } from "@/lib/fiscal/constants";

/**
 * Данные реестра фискальных документов.
 *
 * Первичный разрез (вкладка + актуальность) уходит в БД: тянуть 4626
 * строк ЭСФ ради того, чтобы показать 4297, незачем. Всё остальное —
 * поиск, состояние, тип, контрагент, период, валюта — фильтруется в
 * браузере поверх уже загруженной вкладки: так отклик мгновенный, как
 * на других экранах, а объём вкладки этого не запрещает.
 */

export type FiscalDocumentRow = {
  id: string;
  doc_kind: string;
  direction_code: string;
  registration_number: string;
  doc_number_display: string | null;
  registration_date: string;
  state_code: string;
  state_label: string | null;
  doc_type_code: string;
  doc_type_label: string | null;
  operation_kind_code: string | null;
  operation_kind_label: string | null;
  counterparty_identifier: string | null;
  counterparty_name: string | null;
  supplier_identifier: string | null;
  supplier_name: string | null;
  recipient_identifier: string | null;
  recipient_name: string | null;
  total_amount: number | null;
  currency_code: string;
  is_void: boolean;
  is_superseded: boolean;
  line_count: number;
};

const LIST_SELECT = `
  id, doc_kind, direction_code, registration_number, doc_number_display,
  registration_date, state_code, state_label, doc_type_code, doc_type_label,
  operation_kind_code, operation_kind_label, counterparty_identifier,
  counterparty_name, supplier_identifier, supplier_name,
  recipient_identifier, recipient_name,
  total_amount, currency_code, is_void, is_superseded, line_count
`;

/** Актуальная позиция: не замещена более поздним исправлением и не гашена. */
function applyActualFilter<T extends { eq: (c: string, v: boolean) => T }>(q: T): T {
  return q.eq("is_superseded", false).eq("is_void", false);
}

export function useFiscalDocuments(tab: FiscalTabKey, showChain: boolean) {
  const sb = useRef(createClient());
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    rows: FiscalDocumentRow[];
    error: string | null;
  }>({ key: "", rows: [], error: null });

  // Признак загрузки ВЫВОДИТСЯ из того, совпадает ли загруженный срез с
  // запрошенным, а не выставляется отдельным setState в теле эффекта.
  // Так нет лишнего каскада рендеров, и — важнее — при переключении
  // вкладки не мелькают чужие строки, подписанные новым заголовком.
  const key = `${tab}|${showChain ? "chain" : "actual"}|${nonce}`;

  useEffect(() => {
    let cancelled = false;
    const def = fiscalTab(tab);

    void fetchAllPaginated<FiscalDocumentRow>((from, to) => {
      let q = sb.current
        .from("fiscal_document")
        .select(LIST_SELECT)
        .eq("doc_kind", def.docKind);
      if (def.direction) q = q.eq("direction_code", def.direction);
      if (!showChain) q = applyActualFilter(q);
      return q.order("registration_date", { ascending: false }).range(from, to);
    }).then(({ data, error }) => {
      if (cancelled) return;
      setLoaded({ key, rows: error ? [] : data, error: error?.message ?? null });
    });

    return () => {
      cancelled = true;
    };
  }, [key, tab, showChain]);

  const fresh = loaded.key === key;
  return {
    rows: fresh ? loaded.rows : [],
    loading: !fresh,
    error: fresh ? loaded.error : null,
    reload: () => setNonce((n) => n + 1),
  };
}

/**
 * Счётчики всех трёх вкладок сразу — чтобы числа на неактивных
 * вкладках были настоящими, а не появлялись только после клика.
 * Возвращает и «всего», и «актуальных»: разница показывается в
 * подписи переключателя цепочки.
 */
export type FiscalTabCounts = Record<FiscalTabKey, { total: number; actual: number }>;

const EMPTY_COUNTS: FiscalTabCounts = {
  "snt-in": { total: 0, actual: 0 },
  "snt-out": { total: 0, actual: 0 },
  esf: { total: 0, actual: 0 },
};

export function useFiscalTabCounts() {
  const sb = useRef(createClient());
  const [counts, setCounts] = useState<FiscalTabCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const client = sb.current;

    const one = async (key: FiscalTabKey, actual: boolean) => {
      const def = fiscalTab(key);
      let q = client
        .from("fiscal_document")
        .select("id", { count: "exact", head: true })
        .eq("doc_kind", def.docKind);
      if (def.direction) q = q.eq("direction_code", def.direction);
      if (actual) q = applyActualFilter(q);
      const { count } = await q;
      return count ?? 0;
    };

    void Promise.all(
      FISCAL_TABS.flatMap((t) => [one(t.key, false), one(t.key, true)]),
    ).then((values) => {
      if (cancelled) return;
      const next = { ...EMPTY_COUNTS };
      FISCAL_TABS.forEach((t, i) => {
        next[t.key] = { total: values[i * 2], actual: values[i * 2 + 1] };
      });
      setCounts(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { counts, loading };
}

/**
 * Каноническое имя контрагента по БИНу.
 *
 * Один и тот же контрагент приезжает из 1С под разными написаниями: 37
 * БИНов из 207 имеют больше одного варианта, рекорд — четыре у АО
 * «Международный аэропорт Алматы». Группировать и искать нужно по
 * идентификатору, показывать — одно имя. Выбор канона живёт в
 * представлении fiscal_counterparty, а не здесь: по нему же строится
 * фильтр, а завтра — выгрузки.
 */
export type FiscalCounterparty = {
  counterparty_identifier: string;
  canonical_name: string;
  name_variants: number;
  doc_count: number;
};

/**
 * Postgres не выводит NOT NULL сквозь представление, поэтому в
 * сгенерированных типах все колонки вью — nullable. Представление
 * отбрасывает строки без идентификатора само (`WHERE
 * counterparty_identifier IS NOT NULL`), но верить типу на слово
 * нельзя: нормализуем на границе и отбрасываем то, что не прошло.
 */
type RawCounterparty = {
  counterparty_identifier: string | null;
  canonical_name: string | null;
  name_variants: number | null;
  doc_count: number | null;
};

export function useFiscalCounterparties() {
  const sb = useRef(createClient());
  const [rows, setRows] = useState<FiscalCounterparty[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchAllPaginated<RawCounterparty>((from, to) =>
      sb.current
        .from("fiscal_counterparty")
        .select("counterparty_identifier, canonical_name, name_variants, doc_count")
        .order("canonical_name")
        .range(from, to),
    ).then(({ data }) => {
      if (cancelled) return;
      setRows(
        data.flatMap((r) =>
          r.counterparty_identifier
            ? [{
                counterparty_identifier: r.counterparty_identifier,
                canonical_name: r.canonical_name ?? r.counterparty_identifier,
                name_variants: r.name_variants ?? 1,
                doc_count: r.doc_count ?? 0,
              }]
            : [],
        ),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = new Map(rows.map((r) => [r.counterparty_identifier, r]));
  return { rows, byId, loading };
}

/**
 * Стороны для фильтров: поставщики и получатели по ВСЕМ документам, а не
 * по одной вкладке. Фильтр стоит над вкладками и действует на все три,
 * значит и список значений должен быть общим.
 *
 * Группировка по БИНу, подпись — самое частое написание: один и тот же
 * контрагент приезжает из 1С под разными вариантами имени, и собрать
 * его по тексту нельзя.
 */
export type FiscalParty = { identifier: string; name: string; doc_count: number };

type PartyRow = {
  supplier_identifier: string | null;
  supplier_name: string | null;
  recipient_identifier: string | null;
  recipient_name: string | null;
};

function collapse(rows: PartyRow[], idKey: keyof PartyRow, nameKey: keyof PartyRow): FiscalParty[] {
  const acc = new Map<string, { names: Map<string, number>; n: number }>();
  for (const r of rows) {
    const id = (r[idKey] ?? "").trim();
    if (!id) continue;
    const e = acc.get(id) ?? { names: new Map<string, number>(), n: 0 };
    e.n += 1;
    const nm = (r[nameKey] ?? "").trim();
    if (nm) e.names.set(nm, (e.names.get(nm) ?? 0) + 1);
    acc.set(id, e);
  }
  return [...acc.entries()]
    .map(([identifier, e]) => ({
      identifier,
      // Тай-брейк по алфавиту: при равном счёте подпись иначе прыгала бы.
      name:
        [...e.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
        identifier,
      doc_count: e.n,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export function useFiscalParties() {
  const sb = useRef(createClient());
  const [suppliers, setSuppliers] = useState<FiscalParty[]>([]);
  const [recipients, setRecipients] = useState<FiscalParty[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchAllPaginated<PartyRow>((from, to) =>
      sb.current
        .from("fiscal_document")
        .select("supplier_identifier, supplier_name, recipient_identifier, recipient_name")
        .range(from, to),
    ).then(({ data }) => {
      if (cancelled) return;
      setSuppliers(collapse(data, "supplier_identifier", "supplier_name"));
      setRecipients(collapse(data, "recipient_identifier", "recipient_name"));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { suppliers, recipients, loading };
}

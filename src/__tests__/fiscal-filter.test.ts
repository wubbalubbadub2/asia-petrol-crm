import { describe, expect, it } from "vitest";

import { COUNTERPARTY_NONE, stateTone } from "@/lib/fiscal/constants";
import {
  currencyTotals,
  filterFiscalRows,
  EMPTY_FISCAL_FILTERS,
  type FiscalFilters,
} from "@/lib/fiscal/filter";
import type { FiscalDocumentRow } from "@/lib/hooks/use-fiscal-documents";

let seq = 0;
const doc = (over: Partial<FiscalDocumentRow> = {}): FiscalDocumentRow => ({
  id: `d${++seq}`,
  doc_kind: "snt",
  direction_code: "Входящий",
  registration_number: `KZ-SNT-3020-200240037215-2025-${seq}`,
  doc_number_display: String(100 + seq),
  registration_date: "2025-06-15T10:00:00",
  state_code: "ПодтвержденПолучателем",
  state_label: "Подтвержден получателем",
  doc_type_code: "Первичная",
  doc_type_label: "Первичная",
  operation_kind_code: null,
  operation_kind_label: null,
  counterparty_identifier: "950440001445",
  counterparty_name: 'Акционерное общество "Международный аэропорт Алматы"',
  supplier_identifier: "230340005167",
  supplier_name: 'ТОО "Sky Oil Company"',
  recipient_identifier: "200240037215",
  recipient_name: 'ТОО "АРҚА ПРОФ"',
  total_amount: 1000,
  currency_code: "KZT",
  is_void: false,
  is_superseded: false,
  line_count: 1,
  ...over,
});

const withFilters = (over: Partial<FiscalFilters>): FiscalFilters => ({
  ...EMPTY_FISCAL_FILTERS,
  ...over,
});

describe("стороны бланка — фильтр по БИНу", () => {
  const rows = [
    doc({ supplier_identifier: "230340005167", supplier_name: 'ТОО "Sky Oil Company"' }),
    doc({ supplier_identifier: "230340005167", supplier_name: 'ТОО «Sky Oil Company»' }),
    doc({ supplier_identifier: "060440001855", supplier_name: 'ТОО "САУТС - ОЙЛ"' }),
    doc({ supplier_identifier: null, supplier_name: null }),
  ];

  it("выбор поставщика собирает все написания его имени", () => {
    const out = filterFiscalRows(rows, withFilters({ suppliers: ["230340005167"] }));
    expect(out).toHaveLength(2);
    expect(new Set(out.map((r) => r.supplier_name)).size).toBe(2);
  });

  it("документы без БИНа поставщика имеют своё значение фильтра", () => {
    const out = filterFiscalRows(rows, withFilters({ suppliers: [COUNTERPARTY_NONE] }));
    expect(out).toHaveLength(1);
  });

  it("получатель фильтруется независимо от поставщика", () => {
    const rows2 = [
      doc({ recipient_identifier: "950440001445" }),
      doc({ recipient_identifier: "041040002401" }),
    ];
    expect(filterFiscalRows(rows2, withFilters({ recipients: ["950440001445"] }))).toHaveLength(1);
  });

  it("поставщик и получатель складываются, а не заменяют друг друга", () => {
    const rows2 = [
      doc({ supplier_identifier: "A", recipient_identifier: "X" }),
      doc({ supplier_identifier: "A", recipient_identifier: "Y" }),
      doc({ supplier_identifier: "B", recipient_identifier: "X" }),
    ];
    const out = filterFiscalRows(rows2, withFilters({ suppliers: ["A"], recipients: ["X"] }));
    expect(out).toHaveLength(1);
  });
});

describe("поиск", () => {
  const rows = [
    doc({ doc_number_display: "590511", registration_number: "KZ-SNT-6004-230340005167-20230505-35833567" }),
    doc({ doc_number_display: "225", registration_number: "KZ-SNT-3020-200240037215-20251221-50229974" }),
  ];

  it("находит по учётному номеру", () => {
    expect(filterFiscalRows(rows, withFilters({ query: "590511" }))).toHaveLength(1);
  });

  it("находит по полному регистрационному", () => {
    const out = filterFiscalRows(rows, withFilters({ query: "50229974" }));
    expect(out).toHaveLength(1);
    expect(out[0].doc_number_display).toBe("225");
  });

  it("находит по БИНу контрагента", () => {
    expect(filterFiscalRows(rows, withFilters({ query: "950440001445" }))).toHaveLength(2);
  });

  it("находит по наименованию поставщика и получателя", () => {
    expect(filterFiscalRows(rows, withFilters({ query: "Sky Oil" }))).toHaveLength(2);
    expect(filterFiscalRows(rows, withFilters({ query: "АРҚА" }))).toHaveLength(2);
  });

  it("находит по каноническому имени, даже если в документе написание другое", () => {
    // Оператор набирает то, что видит в списке; в самом документе
    // может лежать любое из четырёх написаний.
    const rows2 = [doc({ counterparty_name: "АО \"Международный Аэропорт Алматы\"" })];
    const canon = new Map([["950440001445", 'Акционерное общество "Международный аэропорт Алматы"']]);
    expect(filterFiscalRows(rows2, withFilters({ query: "Акционерное общество" }), canon)).toHaveLength(1);
  });

  it("регистр не важен", () => {
    expect(filterFiscalRows(rows, withFilters({ query: "kz-snt-6004" }))).toHaveLength(1);
  });
});

describe("период по дате регистрации", () => {
  const rows = [
    doc({ registration_date: "2025-06-15T23:50:00" }),
    doc({ registration_date: "2025-06-16T00:10:00" }),
    doc({ registration_date: "2025-07-01T12:00:00" }),
  ];

  it("границы включительно и без сдвига на часовой пояс", () => {
    // Дата хранится без зоны; сравнение по первым десяти символам —
    // ровно то, что видит оператор, никакого UTC.
    const out = filterFiscalRows(rows, withFilters({ dateFrom: "2025-06-15", dateTo: "2025-06-16" }));
    expect(out).toHaveLength(2);
  });

  it("одна граница работает без второй", () => {
    expect(filterFiscalRows(rows, withFilters({ dateFrom: "2025-07-01" }))).toHaveLength(1);
    expect(filterFiscalRows(rows, withFilters({ dateTo: "2025-06-15" }))).toHaveLength(1);
  });
});

describe("итоги по валютам", () => {
  const rows = [
    doc({ currency_code: "KZT", total_amount: 100 }),
    doc({ currency_code: "KZT", total_amount: 200 }),
    doc({ currency_code: "USD", total_amount: 50 }),
    doc({ currency_code: "RUB", total_amount: 10 }),
    doc({ currency_code: "USD", total_amount: 5 }),
  ];

  it("считает по каждой валюте отдельно и не смешивает", () => {
    const totals = currencyTotals(rows);
    expect(totals).toEqual([
      { currency: "KZT", count: 2, amount: 300 },
      { currency: "USD", count: 2, amount: 55 },
      { currency: "RUB", count: 1, amount: 10 },
    ]);
  });

  it("тенге всегда первым", () => {
    expect(currencyTotals([...rows].reverse())[0].currency).toBe("KZT");
  });

  it("пустая сумма считается нулём, а документ всё равно считается", () => {
    const totals = currencyTotals([doc({ currency_code: "KZT", total_amount: null })]);
    expect(totals[0]).toEqual({ currency: "KZT", count: 1, amount: 0 });
  });
});

describe("тон бейджа состояния", () => {
  it("гашеные состояния красные", () => {
    expect(stateTone("Аннулирован")).toBe("void");
    expect(stateTone("Отозван")).toBe("void");
    expect(stateTone("АннулированПриОтзывеСНТ")).toBe("void");
  });

  it("рабочие состояния зелёные и синие", () => {
    expect(stateTone("ПодтвержденПолучателем")).toBe("ok");
    expect(stateTone("ПринятОтПоставщика")).toBe("ok");
    expect(stateTone("ДоставленПолучателю")).toBe("info");
    expect(stateTone("ПринятСервером")).toBe("info");
  });

  it("незнакомый код не притворяется нормальным и не роняет строку", () => {
    expect(stateTone("НовоеСостояниеИзБудущейВерсии")).toBe("unknown");
    expect(stateTone(null)).toBe("unknown");
  });

  it("синоним тоном не управляет", () => {
    // Тон берётся из кода; текст «Принят от поставщика» кодом не является.
    expect(stateTone("Принят от поставщика")).toBe("unknown");
  });
});

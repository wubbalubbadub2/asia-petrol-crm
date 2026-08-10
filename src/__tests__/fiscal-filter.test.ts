import { describe, expect, it } from "vitest";

import { COUNTERPARTY_NONE, OPERATION_KIND_NONE, stateTone } from "@/lib/fiscal/constants";
import {
  currencyTotals,
  facetOptions,
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

describe("фильтр по перечислениям идёт по коду, а не по синониму", () => {
  // Боевое расхождение: 64 документа несут код «Исправленная» при
  // синониме «Исправленная (аннулированная, отклоненная)». Фильтр,
  // написанный по тексту, потерял бы их все.
  const rows = [
    doc({ doc_type_code: "Исправленная", doc_type_label: "Исправленная (аннулированная, отклоненная)" }),
    doc({ doc_type_code: "Первичная", doc_type_label: "Первичная" }),
  ];

  it("код ловит документ, у которого синоним написан иначе", () => {
    const out = filterFiscalRows(rows, withFilters({ docTypeCodes: ["Исправленная"] }));
    expect(out).toHaveLength(1);
    expect(out[0].doc_type_label).toBe("Исправленная (аннулированная, отклоненная)");
  });

  it("синоним значением фильтра не является", () => {
    const out = filterFiscalRows(rows, withFilters({
      docTypeCodes: ["Исправленная (аннулированная, отклоненная)"],
    }));
    expect(out).toHaveLength(0);
  });

  it("то же для состояния", () => {
    const rows2 = [
      doc({ state_code: "ПринятОтПоставщика", state_label: "Принят от поставщика" }),
      doc({ state_code: "Отозван", state_label: "Отозван" }),
    ];
    expect(filterFiscalRows(rows2, withFilters({ stateCodes: ["ПринятОтПоставщика"] }))).toHaveLength(1);
    expect(filterFiscalRows(rows2, withFilters({ stateCodes: ["Принят от поставщика"] }))).toHaveLength(0);
  });
});

describe("вид операции", () => {
  const rows = [
    doc({ operation_kind_code: "Ввоз", operation_kind_label: "Ввоз товаров на территорию РК" }),
    doc({ operation_kind_code: "Реализация", operation_kind_label: "Реализация товаров" }),
    doc({ operation_kind_code: null }),
    doc({ operation_kind_code: null }),
  ];

  it("«Ввоз» вытаскивается одним действием", () => {
    const out = filterFiscalRows(rows, withFilters({ operationKindCodes: ["Ввоз"] }));
    expect(out).toHaveLength(1);
    expect(out[0].operation_kind_code).toBe("Ввоз");
  });

  it("пустой вид операции — полноценное значение фильтра", () => {
    // Таких документов 6051 из 6979; без этой грани фильтр был бы
    // односторонним.
    const out = filterFiscalRows(rows, withFilters({ operationKindCodes: [OPERATION_KIND_NONE] }));
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.operation_kind_code === null)).toBe(true);
  });
});

describe("контрагент — по БИНу, не по имени", () => {
  // Один БИН под разными написаниями: в базе 37 таких из 207,
  // рекорд — четыре варианта.
  const rows = [
    doc({ counterparty_identifier: "950440001445", counterparty_name: 'Акционерное общество "Международный аэропорт Алматы"' }),
    doc({ counterparty_identifier: "950440001445", counterparty_name: "АО \"Международный Аэропорт Алматы\"" }),
    doc({ counterparty_identifier: "950440001445", counterparty_name: "Акционерное общество Международный аэропорт Алматы" }),
    doc({ counterparty_identifier: "130640000443", counterparty_name: 'ТОО "ТумарМунай"' }),
    doc({ counterparty_identifier: null, counterparty_name: "GEOWAX PTE.LTD " }),
  ];

  it("выбор одного БИНа собирает все написания", () => {
    const out = filterFiscalRows(rows, withFilters({ counterparties: ["950440001445"] }));
    expect(out).toHaveLength(3);
    expect(new Set(out.map((r) => r.counterparty_name)).size).toBe(3);
  });

  it("нерезиденты без БИНа не выпадают: у них своё значение фильтра", () => {
    const out = filterFiscalRows(rows, withFilters({ counterparties: [COUNTERPARTY_NONE] }));
    expect(out).toHaveLength(1);
    expect(out[0].counterparty_name).toBe("GEOWAX PTE.LTD ");
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

describe("списки значений фильтров", () => {
  it("собираются по коду, подписываются синонимом, сортируются по частоте", () => {
    const rows = [
      doc({ doc_type_code: "Обычный", doc_type_label: "Обычный" }),
      doc({ doc_type_code: "Обычный", doc_type_label: "Обычный" }),
      doc({ doc_type_code: "Исправленная", doc_type_label: "Исправленная (аннулированная, отклоненная)" }),
    ];
    const opts = facetOptions(rows, "doc_type_code", "doc_type_label");
    expect(opts).toEqual([
      { value: "Обычный", label: "Обычный", count: 2 },
      { value: "Исправленная", label: "Исправленная (аннулированная, отклоненная)", count: 1 },
    ]);
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

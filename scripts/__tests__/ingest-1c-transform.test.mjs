// Тесты разбора выгрузки 1С. Фикстуры — урезанные копии боевых
// документов из .data/payload-5.json (файл в .gitignore, в тесты
// попадают только структура и проверенные аномалии).

import { describe, expect, it } from "vitest";

import {
  canonical,
  contentHash,
  docKey,
  groupByPosition,
  lotIndex,
  rejectReason,
  supersededKeys,
  toDocumentRow,
  toLineRows,
  formFields,
} from "../lib/ingest-1c-transform.mjs";

/** Входящая СНТ: минимальный валидный документ. */
function sntDoc(over = {}) {
  return {
    doc_kind: "snt",
    registration_number: "KZ-SNT-6004-230340005167-20230505-35833567",
    registration_date: "2023-05-05T09:57:12",
    direction: "Входящий",
    doc_type: "Первичная",
    doc_type_code: "Первичная",
    status: "Подтвержден",
    status_code: "Подтвержден",
    state: "Подтвержден получателем",
    state_code: "ПодтвержденПолучателем",
    is_void: false,
    operation_kind: null,
    operation_kind_code: null,
    issue_date: "2023-05-05T00:00:00",
    shipment_date: "2023-05-05T00:00:00",
    related_registration_number: null,
    counterparty: { role: "supplier", identifier: "230340005167", name: 'ТОО "Sky Oil Company"' },
    own_party: { role: "recipient", identifier: "200240037215", name: 'ТОО "АРҚА ПРОФ"' },
    total_amount: 13772000,
    currency_code: "KZT",
    fx_rate: 1,
    lines: [
      {
        table: "ДанныеПоНефтепродуктам",
        line_no: 1,
        snt_line_no: 1,
        pin_code: "18500034245",
        name: "Топливо для реактивных двигателей марки ТС-1",
        quantity: 59.744,
        unit: "т",
        storage_unit: null,
        conversion_rate: 1,
        net_weight: 59744,
        price: 196428.57,
        amount_net: 12296428.57,
        amount: 13772000,
        vat_amount: 1475571.43,
      },
    ],
    payload: {
      header: { "НомерСНТ": "590511", "Номер": "-В-000000000000000000000000004" },
      tables: {
        "ДанныеПоНефтепродуктам": [
          { "НомерСтроки": 1, "ДополнительныйИдентификатор": 480930131 },
        ],
      },
    },
    ...over,
  };
}

/**
 * СНТ на ввоз в том виде, в каком её отдаёт обработка 1.5.0:
 * направление «Исходящий» (документ выписан нами в ИС ЭСФ), но роль
 * нашей стороны — recipient (товар получаем мы), а поставщик —
 * российский нерезидент без БИН. Именно на таких документах ломается
 * любое допущение «роль = функция направления».
 */
function importSntDoc(over = {}) {
  return sntDoc({
    registration_number: "KZ-SNT-3020-200240037215-20231112-52175696",
    direction: "Исходящий",
    operation_kind: "Ввоз товаров на территорию РК",
    operation_kind_code: "Ввоз",
    own_party: { role: "recipient", identifier: null, name: 'ООО "ВОСТОКЭНЕРГОТРЕЙД" ' },
    counterparty: {
      role: "supplier",
      identifier: "200240037215",
      name: 'ТОО "АРҚА ПРОФ"',
    },
    ...over,
  });
}

describe("канонический JSON и хеш", () => {
  it("не зависит от порядка ключей", () => {
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
    expect(contentHash({ x: { q: 1, p: 2 }, y: [1, 2] })).toBe(
      contentHash({ y: [1, 2], x: { p: 2, q: 1 } }),
    );
  });

  it("сохраняет порядок элементов массива — это данные, а не ключи", () => {
    expect(contentHash({ a: [1, 2] })).not.toBe(contentHash({ a: [2, 1] }));
  });

  it("меняется при изменении значения — на этом держится дедуп landing", () => {
    const a = sntDoc();
    const b = sntDoc({ state_code: "Аннулирован" });
    expect(contentHash(a)).not.toBe(contentHash(b));
    expect(contentHash(a)).toBe(contentHash(sntDoc()));
  });
});

describe("правила отклонения", () => {
  it("валидный документ проходит", () => {
    expect(rejectReason(sntDoc())).toBeNull();
  });

  it("нет own_party.identifier — отклонён (в первом файле 8 таких)", () => {
    expect(rejectReason(importSntDoc())).toBe("no_own_identifier");
  });

  it("пустая строка в identifier — тоже нет идентификатора", () => {
    const doc = sntDoc({ own_party: { role: "recipient", identifier: "   ", name: "X" } });
    expect(rejectReason(doc)).toBe("no_own_identifier");
  });

  it("строка СНТ без snt_line_no роняет весь документ", () => {
    const doc = sntDoc();
    doc.lines.push({ ...doc.lines[0], line_no: 2, snt_line_no: null });
    expect(rejectReason(doc)).toBe("snt_line_without_snt_line_no");
  });

  it("у ЭСФ пустой snt_line_no — норма, а не ошибка", () => {
    const doc = sntDoc({ doc_kind: "esf", registration_number: "ESF-200240037215-20231027-44571663" });
    doc.lines[0].snt_line_no = null;
    doc.lines[0].table = "Товары";
    expect(rejectReason(doc)).toBeNull();
  });

  it("незнакомое направление отклоняется, а не проваливается тихо", () => {
    expect(rejectReason(sntDoc({ direction: "Входящая" }))).toBe("unknown_direction");
    expect(rejectReason(sntDoc({ direction: null }))).toBe("unknown_direction");
  });

  it("незнакомый вид документа отклоняется", () => {
    expect(rejectReason(sntDoc({ doc_kind: "avr" }))).toBe("unknown_doc_kind");
  });

  it("документ без строк валиден — в первом файле 118 таких СНТ", () => {
    expect(rejectReason(sntDoc({ lines: [] }))).toBeNull();
  });
});

describe("строка fiscal_document", () => {
  const row = toDocumentRow(sntDoc(), "11111111-1111-1111-1111-111111111111", "2026-08-10T00:00:00.000Z");

  it("не отправляет вычисляемые и служебные колонки", () => {
    // is_void — GENERATED ALWAYS, PostgREST на неё ругнётся;
    // is_superseded ставит отдельный проход; first_seen_at живёт
    // на DEFAULT, иначе повторный запуск затирал бы дату первой встречи.
    expect(row).not.toHaveProperty("is_void");
    expect(row).not.toHaveProperty("is_superseded");
    expect(row).not.toHaveProperty("first_seen_at");
  });

  it("хранит и код, и синоним перечисления раздельно", () => {
    const doc = sntDoc({
      doc_type: "Исправленная (аннулированная, отклоненная)",
      doc_type_code: "Исправленная",
      status: "Отправленный",
      status_code: "Созданный",
    });
    const r = toDocumentRow(doc, null, "now");
    expect(r.doc_type_code).toBe("Исправленная");
    expect(r.doc_type_label).toBe("Исправленная (аннулированная, отклоненная)");
    expect(r.status_code).toBe("Созданный");
    expect(r.status_label).toBe("Отправленный");
  });

  it("даты: отметка времени как пришла, DATE-поля без времени", () => {
    expect(row.registration_date).toBe("2023-05-05T09:57:12");
    expect(row.issue_date).toBe("2023-05-05");
    expect(row.shipment_date).toBe("2023-05-05");
  });

  it("сумма и курс остаются в валюте документа", () => {
    const usd = toDocumentRow(
      sntDoc({ currency_code: "USD", fx_rate: 478.12, total_amount: 100000 }),
      null,
      "now",
    );
    expect(usd.total_amount).toBe(100000);
    expect(usd.currency_code).toBe("USD");
    expect(usd.fx_rate).toBe(478.12);
  });

  it("ключ документа собирается из own_party.identifier, а не из шапки файла", () => {
    expect(row.source_org_code).toBe("200240037215");
  });

  // С версии обработки 1.5.0 роль и направление расходятся у СНТ на
  // ввоз. Роль приходит готовой — вычислять её на нашей стороне нельзя.
  it("роль сторон переносится как есть, даже когда противоречит направлению", () => {
    const doc = importSntDoc({
      own_party: { role: "recipient", identifier: "200240037215", name: 'ТОО "АРҚА ПРОФ"' },
      counterparty: { role: "supplier", identifier: null, name: 'ООО "ВОСТОКЭНЕРГОТРЕЙД" ' },
    });
    const r = toDocumentRow(doc, null, "now");
    expect(r.direction_code).toBe("Исходящий");
    expect(r.own_party_role_code).toBe("recipient");
    expect(r.counterparty_role_code).toBe("supplier");
  });

  it("направление переносится как есть и роль на него не влияет", () => {
    expect(row.direction_code).toBe("Входящий");
    expect(row.own_party_role_code).toBe("recipient");
  });

  it("человекочитаемый номер у СНТ — НомерСНТ, у ЭСФ — Номер", () => {
    expect(row.doc_number_display).toBe("590511");
    const esf = toDocumentRow(sntDoc({ doc_kind: "esf" }), null, "now");
    expect(esf.doc_number_display).toBe("-В-000000000000000000000000004");
  });
});

describe("строки документа", () => {
  it("quantity и net_weight переносятся как есть, в разных единицах", () => {
    const [line] = toLineRows(sntDoc(), "doc-1");
    expect(line.quantity).toBe(59.744);
    expect(line.unit).toBe("т");
    expect(line.net_weight).toBe(59744);
  });

  it("source_lot_id берётся из табличной части по номеру строки", () => {
    const [line] = toLineRows(sntDoc(), "doc-1");
    expect(line.source_lot_id).toBe("480930131");
  });

  it("нулевой идентификатор партии — это «не заполнено», а не партия", () => {
    const doc = sntDoc();
    doc.payload.tables["ДанныеПоНефтепродуктам"][0]["ДополнительныйИдентификатор"] = 0;
    expect(toLineRows(doc, "doc-1")[0].source_lot_id).toBeNull();
    expect(lotIndex(doc).size).toBe(0);
  });

  it("строка без соответствия в табличной части остаётся без партии", () => {
    const doc = sntDoc();
    doc.lines.push({ ...doc.lines[0], line_no: 7 });
    expect(toLineRows(doc, "doc-1")[1].source_lot_id).toBeNull();
  });
});

describe("supersession", () => {
  const rows = [
    { source_org_code: "200240037215", doc_kind: "snt", registration_number: "A", related_registration_number: null },
    { source_org_code: "200240037215", doc_kind: "snt", registration_number: "B", related_registration_number: "A" },
  ];

  it("помечается тот, на кого ссылаются, а не тот, кто ссылается", () => {
    const keys = supersededKeys(rows);
    expect(keys.has(docKey("200240037215", "snt", "A"))).toBe(true);
    expect(keys.has(docKey("200240037215", "snt", "B"))).toBe(false);
  });

  it("ссылка не перескакивает на другой вид документа", () => {
    const keys = supersededKeys(rows);
    expect(keys.has(docKey("200240037215", "esf", "A"))).toBe(false);
  });

  it("ссылка не перескакивает на другую организацию", () => {
    const keys = supersededKeys(rows);
    expect(keys.has(docKey("990740000683", "snt", "A"))).toBe(false);
  });
});

describe("свод позиции бланка", () => {
  // Воспроизводит СНТ KZ-SNT-3020-200240037215-20251221-50229974:
  // одна позиция ИС ЭСФ разложена 1С по партиям виртуального склада.
  const lines = [
    { line_no: 1, snt_line_no: 1, name: "ТС-1", pin_code: "18500034245", unit: "т", price: 553682.81, quantity: 94.912, amount_net: 52551142.71, amount: 58857279.83, vat_amount: 6306137.12 },
    { line_no: 2, snt_line_no: 1, name: "ТС-1", pin_code: "18500034245", unit: "т", price: 553682.81, quantity: 0.8, amount_net: 442946.25, amount: 496099.8, vat_amount: 53153.55 },
    { line_no: 3, snt_line_no: 2, name: "ТС-1", pin_code: "18500034245", unit: "т", price: 553571.43, quantity: 0.281, amount_net: 155553.57, amount: 174220, vat_amount: 18666.43 },
  ];

  it("группирует по snt_line_no, а не по line_no", () => {
    const groups = groupByPosition(lines);
    expect(groups).toHaveLength(2);
    expect(groups[0].snt_line_no).toBe(1);
    expect(groups[0].lines).toHaveLength(2);
  });

  it("складывает количество и суммы внутри позиции", () => {
    const [first] = groupByPosition(lines);
    expect(first.quantity).toBeCloseTo(95.712, 6);
    expect(first.amount).toBeCloseTo(59353379.63, 2);
    expect(first.vat_amount).toBeCloseTo(6359290.67, 2);
  });

  it("у ЭСФ, где snt_line_no пуст, каждая строка остаётся своей позицией", () => {
    const esf = [
      { line_no: 1, snt_line_no: null, quantity: 1, amount: 10 },
      { line_no: 2, snt_line_no: null, quantity: 2, amount: 20 },
    ];
    expect(groupByPosition(esf)).toHaveLength(2);
  });
});

describe("поля печатного бланка (00143)", () => {
  it("раздел B и C: поставщик и получатель хранятся явно, как в бланке", () => {
    const doc = sntDoc();
    doc.payload.header["ПоставщикИдентификатор"] = "230340005167";
    doc.payload.header["ПоставщикНаименование"] = 'ТОО "Sky Oil Company"';
    doc.payload.header["ПолучательИдентификатор"] = "200240037215";
    doc.payload.header["АдресОтправки"] = "г. Алматы, ул. Майлина 2";
    doc.payload.header["СкладОтправкиИдентификатор"] = "6509523";
    const r = toDocumentRow(doc, null, "now");
    // Поля 13, 14, 20, 21, 22 бланка — не выведенные «наша сторона»
    // и «контрагент», а стороны так, как они там названы.
    expect(r.supplier_identifier).toBe("230340005167");
    expect(r.supplier_name).toBe('ТОО "Sky Oil Company"');
    expect(r.recipient_identifier).toBe("200240037215");
    expect(r.supplier_address).toBe("г. Алматы, ул. Майлина 2");
    expect(r.supplier_warehouse_id).toBe("6509523");
  });

  it("раздел D: грузоотправитель и грузополучатель — отдельные стороны", () => {
    const doc = sntDoc();
    doc.payload.header["ГрузоотправительИдентификатор"] = "160840001662";
    doc.payload.header["ГрузоотправительНаименование"] = 'ТОО "Kyzylorda Refinery"';
    doc.payload.header["ГрузополучательИдентификатор"] = "5614086658";
    doc.payload.header["ГрузополучательНерезидент"] = true;
    const r = toDocumentRow(doc, null, "now");
    expect(r.shipper_identifier).toBe("160840001662");
    expect(r.consignee_identifier).toBe("5614086658");
    expect(r.consignee_is_nonresident).toBe(true);
    // И это НЕ то же самое, что поставщик с получателем.
    expect(r.shipper_identifier).not.toBe(r.supplier_identifier);
  });

  it("раздел E: номер вагона переносится как есть, со всеми номерами", () => {
    const doc = sntDoc();
    doc.payload.header["ЖелезнодорожныйТранспорт"] = true;
    doc.payload.header["НомерВагона"] = "75165282, 74966805, 73051385";
    const r = toDocumentRow(doc, null, "now");
    expect(r.transport_rail).toBe(true);
    expect(r.wagon_number).toBe("75165282, 74966805, 73051385");
  });

  it("раздел F: номер договора и дата", () => {
    const doc = sntDoc();
    doc.payload.header["ДоговорПоставкиНомер"] = "78-14-2121-1";
    doc.payload.header["ДоговорПоставкиДата"] = "2023-12-28T00:00:00";
    doc.payload.header["ДоговорПоставкиУсловияПоставки"] = "FCA";
    const r = toDocumentRow(doc, null, "now");
    expect(r.contract_number).toBe("78-14-2121-1");
    expect(r.contract_date).toBe("2023-12-28");
    expect(r.delivery_terms).toBe("FCA");
  });

  it("отсутствующий признак даёт null, а не false", () => {
    // Иначе «нет данных» неотличимо от «явно указано нет».
    const r = toDocumentRow(sntDoc(), null, "now");
    expect(r.has_alcohol).toBeNull();
    expect(r.transport_rail).toBeNull();
  });

  it("раздел G1: колонки строки достаются из сырой табличной части", () => {
    const doc = sntDoc();
    Object.assign(doc.payload.tables["ДанныеПоНефтепродуктам"][0], {
      "ПризнакПроисхождения": "4",
      "КодТНВЭД": "2710192100",
      "СтавкаНДС": "12%",
      "СтавкаНДСЧисло": 12,
      "ИдентификаторТовара": "19.20.25.01-2710192100<567189459>{18500034245}",
      "Товар": "Керосин ТС-1 (18500034245 )",
    });
    const [line] = toLineRows(doc, "doc-1");
    expect(line.origin_sign).toBe("4");
    expect(line.tnved_code).toBe("2710192100");   // колонка 4 бланка
    expect(line.vat_rate).toBe("12%");            // колонка 12
    expect(line.vat_rate_percent).toBe(12);
    expect(line.product_identifier).toContain("{18500034245}"); // колонка 15
    expect(line.product_1c_name).toBe("Керосин ТС-1 (18500034245 )");
    // pin_code — колонка 18 «Код товара», не ТН ВЭД.
    expect(line.pin_code).toBe("18500034245");
    expect(line.pin_code).not.toBe(line.tnved_code);
  });

  it("табличные части, кроме товарной, сохраняются целиком", () => {
    const doc = sntDoc();
    doc.payload.tables["ДанныеОГрузе1_2"] = [
      { "НомерПутевогоЛиста": "00000029385", "ФИОВодителя": "Дуйсембин М", "НомерТТН": "00000029385" },
    ];
    const r = toDocumentRow(doc, null, "now");
    expect(Object.keys(r.extra_tables)).toEqual(["ДанныеОГрузе1_2"]);
    expect(r.extra_tables["ДанныеОГрузе1_2"][0]["ФИОВодителя"]).toBe("Дуйсембин М");
    // Товарная часть в extra_tables не дублируется.
    expect(r.extra_tables["ДанныеПоНефтепродуктам"]).toBeUndefined();
  });

  it("документ без дополнительных табличных частей даёт null", () => {
    expect(toDocumentRow(sntDoc(), null, "now").extra_tables).toBeNull();
  });
});

describe("стороны у ЭСФ", () => {
  it("берутся из табличных частей, когда в шапке их нет", () => {
    // У ЭСФ «Поставщики» и «Получатели» — табличные части, а не поля
    // шапки. Без запаса фильтр по поставщику на вкладке ЭСФ был бы пуст.
    const doc = sntDoc({ doc_kind: "esf", registration_number: "ESF-200240037215-20231027-44571663" });
    doc.lines[0].snt_line_no = null;
    doc.lines[0].table = "Товары";
    delete doc.payload.header["ПоставщикИдентификатор"];
    delete doc.payload.header["ПолучательИдентификатор"];
    doc.payload.tables = {
      "Товары": [{ "НомерСтроки": 1 }],
      "Поставщики": [{ "НомерСтроки": 1, "ПоставщикИдентификатор": "990740000683", "ПоставщикНаименование": 'АО "ForteBank"' }],
      "Получатели": [{ "НомерСтроки": 1, "ПолучательИдентификатор": "200240037215", "ПолучательНаименование": 'ТОО "АРҚА ПРОФ"' }],
    };
    const r = toDocumentRow(doc, null, "now");
    expect(r.supplier_identifier).toBe("990740000683");
    expect(r.supplier_name).toBe('АО "ForteBank"');
    expect(r.recipient_identifier).toBe("200240037215");
  });

  it("шапка имеет приоритет над табличной частью", () => {
    const doc = sntDoc();
    doc.payload.header["ПоставщикИдентификатор"] = "111111111111";
    doc.payload.tables["Поставщики"] = [{ "ПоставщикИдентификатор": "222222222222" }];
    expect(toDocumentRow(doc, null, "now").supplier_identifier).toBe("111111111111");
  });
});

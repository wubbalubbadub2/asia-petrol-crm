// scripts/lib/ingest-1c-transform.mjs
//
// Чистые преобразования выгрузки 1С (СНТ и ЭСФ) в строки таблиц
// fiscal_document / fiscal_document_line. Ни ввода-вывода, ни сети —
// чтобы правила отклонения и разбора можно было проверить тестами без
// базы: scripts/__tests__/ingest-1c-transform.test.mjs.
//
// Схема — supabase/migrations/00138_fiscal_documents_1c.sql,
// вызывающий скрипт — scripts/ingest-1c-payload.mjs.

import { createHash } from "node:crypto";

export const DIRECTIONS = new Set(["Входящий", "Исходящий"]);
export const DOC_KINDS = new Set(["snt", "esf"]);

/**
 * Канонический JSON: ключи объектов отсортированы рекурсивно,
 * сериализация без пробелов. Порядок полей 1С не гарантирует, а без
 * канонизации хеш прыгал бы от перестановки ключей и дедуп landing
 * перестал бы работать.
 */
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export const contentHash = (doc) => sha256(canonical(doc));

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Пустая строка и пробельный мусор — это NULL, а не значение. */
export const str = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/** Числа кладём как пришли; нечисловой мусор — NULL, а не 0. */
export const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** «2023-05-05T00:00:00» → «2023-05-05». Времени в DATE-полях нет. */
export const dateOnly = (v) => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);

/** «2023-05-05T09:57:12» — местное время 1С, кладём в TIMESTAMP как есть. */
export const stamp = (v) => (typeof v === "string" && v.length >= 10 ? v : null);

export const docKey = (org, kind, reg) => `${org}|${kind}|${reg}`;

/**
 * Причина отклонения документа либо null. Порядок проверок — от ключа
 * к деталям, чтобы в статистике отклонений первой всплывала настоящая
 * причина, а не сопутствующая.
 */
export function rejectReason(doc) {
  if (!DOC_KINDS.has(doc?.doc_kind)) return "unknown_doc_kind";
  // own_party.identifier — это БИН нашей стороны и часть ключа
  // документа. Без него документ некуда положить.
  if (!str(doc.own_party?.identifier)) return "no_own_identifier";
  if (!str(doc.registration_number)) return "missing_required_field";
  if (!str(doc.registration_date)) return "missing_required_field";
  // Мужской род — как в выгрузке. Парного *_code у поля нет, поэтому
  // «Входящая» здесь была бы новым, неизвестным значением.
  if (!DIRECTIONS.has(doc.direction)) return "unknown_direction";
  if (!str(doc.doc_type_code) || !str(doc.status_code) || !str(doc.state_code)) {
    return "missing_required_field";
  }
  if (!str(doc.currency_code) || num(doc.fx_rate) === null) return "missing_required_field";
  // Строка СНТ без номера позиции ИС ЭСФ роняет весь документ: без него
  // не собрать позицию бланка, а частично загруженный СНТ хуже явно
  // отклонённого.
  if (doc.doc_kind === "snt") {
    for (const line of doc.lines || []) {
      if (num(line?.snt_line_no) === null) return "snt_line_without_snt_line_no";
    }
  }
  return null;
}

/** Человекочитаемый номер: у СНТ — НомерСНТ, у ЭСФ — Номер. Не ключ. */
export function displayNumber(doc) {
  const h = doc.payload?.header || {};
  return str(doc.doc_kind === "snt" ? h["НомерСНТ"] : h["Номер"]);
}

/**
 * Партия виртуального склада ИС ЭСФ по номеру строки табличной части.
 * Входящая СНТ партию создаёт, исходящая с неё списывает — один
 * идентификатор связывает приход с расходом. В нормализованных lines
 * обработка его не отдаёт, поэтому достаём из сырой табличной части.
 */
export function lotIndex(doc) {
  const map = new Map();
  for (const table of Object.values(doc.payload?.tables || {})) {
    if (!Array.isArray(table)) continue;
    for (const row of table) {
      const lineNo = num(row?.["НомерСтроки"]);
      const lot = str(row?.["ДополнительныйИдентификатор"]);
      // 0 — «не заполнено», а не идентификатор партии.
      if (lineNo !== null && lot !== null && lot !== "0") map.set(lineNo, lot);
    }
  }
  return map;
}

/** Булево из 1С: отсутствующее поле — null, а не false. */
export const bool = (v) => (v === true || v === false ? v : null);

/** Товарная табличная часть документа: у СНТ одна, у ЭСФ другая. */
export const PRODUCT_TABLE = { snt: "ДанныеПоНефтепродуктам", esf: "Товары" };

/** Сырая строка табличной части по номеру строки — чтобы забрать колонки бланка. */
export function rawLineIndex(doc) {
  const map = new Map();
  const table = doc.payload?.tables?.[PRODUCT_TABLE[doc.doc_kind]];
  if (!Array.isArray(table)) return map;
  for (const row of table) {
    const n = num(row?.["НомерСтроки"]);
    if (n !== null) map.set(n, row);
  }
  return map;
}

/**
 * Табличные части, кроме товарной: ТоварыВС и ДанныеОГрузе1_2 (путевой
 * лист, ТТН, водитель, маршрут). Их не разложить в колонки — состав
 * плавает, а документов с ними единицы, — но и терять нельзя: в
 * landing они под is_admin(), с карточки не видны.
 */
export function extraTables(doc) {
  const main = PRODUCT_TABLE[doc.doc_kind];
  const out = {};
  for (const [name, rows] of Object.entries(doc.payload?.tables || {})) {
    if (name === main) continue;
    if (Array.isArray(rows) && rows.length) out[name] = rows;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Строка fiscal_document. Намеренно НЕ содержит:
 *   is_void       — вычисляемая колонка из state_code;
 *   is_superseded — ставится отдельным проходом, иначе повторный
 *                   запуск сбрасывал бы уже проставленный флаг;
 *   first_seen_at — на вставке сработает DEFAULT, на конфликте
 *                   PostgREST обновит только перечисленные колонки.
 */
export function toDocumentRow(doc, payloadId, seenAt) {
  return {
    payload_id: payloadId,
    source_org_code: str(doc.own_party.identifier),
    doc_kind: doc.doc_kind,
    registration_number: str(doc.registration_number),
    registration_date: stamp(doc.registration_date),
    issue_date: dateOnly(doc.issue_date),
    shipment_date: dateOnly(doc.shipment_date),
    direction_code: doc.direction,
    doc_type_code: str(doc.doc_type_code),
    doc_type_label: str(doc.doc_type),
    status_code: str(doc.status_code),
    status_label: str(doc.status),
    state_code: str(doc.state_code),
    state_label: str(doc.state),
    operation_kind_code: str(doc.operation_kind_code),
    operation_kind_label: str(doc.operation_kind),
    own_party_name: str(doc.own_party.name),
    // Роль приходит в пакете готовой — берём как есть и НЕ выводим из
    // направления. С версии обработки 1.5.0 они расходятся: у СНТ на
    // ввоз direction = «Исходящий» (документ выписан нами в ИС ЭСФ),
    // а own_party.role = «recipient» (товар получаем мы).
    own_party_role_code: str(doc.own_party.role),
    counterparty_identifier: str(doc.counterparty?.identifier),
    counterparty_name: str(doc.counterparty?.name),
    counterparty_role_code: str(doc.counterparty?.role),
    total_amount: num(doc.total_amount),
    currency_code: str(doc.currency_code),
    fx_rate: num(doc.fx_rate),
    related_registration_number: str(doc.related_registration_number),
    related_snt_registration_number: str(doc.related_snt_registration_number),
    doc_number_display: displayNumber(doc),
    line_count: (doc.lines || []).length,
    last_seen_at: seenAt,
    ...formFields(doc),
  };
}

/**
 * Поля печатного бланка СНТ, разложенные по разделам (миграция 00143).
 *
 * Имена колонок следуют разделам и номерам полей БЛАНКА, а не именам
 * обработки 1С: клиент сверяет экран с печатной формой. Соответствие
 * «поле бланка → поле выгрузки» записано в COMMENT ON COLUMN.
 *
 * Отсутствующее в шапке поле даёт null само: у ЭСФ схема шапки другая,
 * и половина этих реквизитов там просто не встречается.
 */
export function formFields(doc) {
  const h = doc.payload?.header || {};
  // У ЭСФ стороны лежат не в шапке, а в табличных частях «Поставщики» и
  // «Получатели» — там же те же имена полей. Без этого запаса
  // supplier_* и recipient_* заполнялись бы только у СНТ (2353 из 6979),
  // и фильтр по поставщику на вкладке ЭСФ был бы пустым.
  const party = (table, key) => {
    if (h[key] != null && h[key] !== "") return h[key];
    const rows = doc.payload?.tables?.[table];
    return Array.isArray(rows) && rows.length ? rows[0]?.[key] : null;
  };
  const sup = (key) => party("Поставщики", key);
  const rec = (key) => party("Получатели", key);
  return {
    // Раздел A
    import_kind: str(h["ВидВвоза"]),
    export_kind: str(h["ВидВывоза"]),
    movement_kind: str(h["ВидПеремещения"]),
    has_ethyl_alcohol: bool(h["ЕстьЭтиловыйСпирт"]),
    has_wine_material: bool(h["ЕстьВиноматериал"]),
    has_beer: bool(h["ЕстьПивоПивныеНапитки"]),
    has_alcohol: bool(h["ЕстьАлкоголь"]),
    has_oil_products: bool(h["ЕстьНефтепродукты"]),
    has_biofuel: bool(h["ЕстьБиотопливо"]),
    has_tobacco: bool(h["ЕстьТабачныеИзделия"]),
    has_marked_goods: bool(h["ЕстьДругиеТоварыЦифроваяМаркировка"]),
    has_export_control: bool(h["ЕстьТоварыЭК"]),

    // Раздел B — поставщик (поля 13–21)
    supplier_identifier: str(sup("ПоставщикИдентификатор")),
    supplier_name: str(sup("ПоставщикНаименование")),
    supplier_is_nonresident: bool(sup("ПоставщикНерезидент")),
    supplier_branch_bin: str(h["ПоставщикБИНСтруктурногоПодразделения"]),
    supplier_country_code: str(h["ПоставщикКодСтраны"]),
    supplier_ship_country_code: str(h["ПоставщикКодСтраныОтправки"]),
    supplier_address: str(h["АдресОтправки"]),
    supplier_warehouse_id: str(h["СкладОтправкиИдентификатор"]),
    supplier_warehouse_name: str(h["СкладОтправитель"]),

    // Раздел C — получатель (поля 22–30)
    recipient_identifier: str(rec("ПолучательИдентификатор")),
    recipient_name: str(rec("ПолучательНаименование")),
    recipient_is_nonresident: bool(rec("ПолучательНерезидент")),
    recipient_branch_bin: str(h["ПолучательБИНСтруктурногоПодразделения"]),
    recipient_country_code: str(h["ПолучательКодСтраны"]),
    recipient_delivery_country_code: str(h["ПолучательКодСтраныДоставки"]),
    recipient_address: str(h["АдресДоставки"]),
    recipient_warehouse_id: str(h["СкладДоставкиИдентификатор"]),
    recipient_warehouse_name: str(h["СкладПолучатель"]),
    recipient_is_retailer: bool(h["ПолучательРозничныйРеализатор"]),

    // Раздел D — грузоотправитель и грузополучатель (поля 31–36, D1)
    shipper_identifier: str(h["ГрузоотправительИдентификатор"]),
    shipper_name: str(h["ГрузоотправительНаименование"]),
    shipper_country_code: str(h["ГрузоотправительКодСтраныОтправки"]),
    shipper_is_nonresident: bool(h["ГрузоотправительНерезидент"]),
    shipper_note: str(h["ГрузоотправительДополнительныеСведения"]),
    consignee_identifier: str(h["ГрузополучательИдентификатор"]),
    consignee_name: str(h["ГрузополучательНаименование"]),
    consignee_country_code: str(h["ГрузополучательКодСтраныОтправки"]),
    consignee_is_nonresident: bool(h["ГрузополучательНерезидент"]),
    consignee_note: str(h["ГрузополучательДополнительныеСведения"]),

    // Раздел E — перевозка (поля 37–39)
    carrier_name: str(h["ПеревозчикНаименование"]),
    carrier_identifier: str(h["ПеревозчикИдентификатор"]),
    transport_road: bool(h["АвтомобильныйТранспорт"]),
    transport_rail: bool(h["ЖелезнодорожныйТранспорт"]),
    transport_air: bool(h["ВоздушныйТранспорт"]),
    transport_sea: bool(h["МорскойТранспорт"]),
    transport_pipeline: bool(h["Трубопровод"]),
    transport_other: bool(h["ПрочийТранспорт"]),
    vehicle_number: str(h["НомерТС"]),
    trailer_number: str(h["ГосномерПрицепа"]),
    wagon_number: str(h["НомерВагона"]),
    seal_number: str(h["НомерОттискаПломбы"]),

    // Раздел F — договор (поля 40–44)
    contract_number: str(h["ДоговорПоставкиНомер"]),
    contract_date: dateOnly(h["ДоговорПоставкиДата"]),
    contract_text: str(h["ДоговорПоставки"]),
    contract_registry_number: str(h["УникальныйНомерВалютногоКонтроля"]),
    payment_terms: str(h["ДоговорПоставкиУсловияОплаты"]),
    delivery_terms: str(h["ДоговорПоставкиУсловияПоставки"]),
    without_contract: bool(h["БезДоговора"]),

    // Разделы L, M, N — отпуск, приёмка, отметки ОГД
    issued_by_name: str(h["ФИОВыписывающегоСНТ"]),
    signature_type: str(h["ТипПодписи"]),
    author: str(h["Автор"]),
    accepted_at: stamp(h["ДатаПриема"]),
    accepted_by_identifier: str(h["ПриемПроизвел"]),
    accepted_by_name: str(h["ФИОПодтвердившегоСНТ"]),
    revoked_at: stamp(h["ДатаОтзыва"]),
    proxy_release_number: str(h["НомерДоверенностиОтпуск"]),
    proxy_release_date: dateOnly(h["ДатаДоверенностиОтпуск"]),
    proxy_receipt_number: str(h["НомерДоверенностиПриемка"]),
    proxy_receipt_date: dateOnly(h["ДатаДоверенностиПриемка"]),
    driver_name: str(h["ФИОВодителя"]),
    driver_iin: str(h["ИИНВодителя"]),
    ogd_code_dispatch: str(h["КодОГДОтправкиG6"]),
    ogd_code_delivery: str(h["КодОГДДоставкиG6"]),

    // Служебное 1С — в бланке не печатается
    source_doc_basis: str(h["ДокументОснование"]),
    source_doc_number: str(h["Номер"]),
    source_ref: str(h["Ссылка"]),
    source_identifier: str(h["Идентификатор"]),
    source_organization: str(h["Организация"]),
    status_note: str(h["Причина"]),
    matching_status: str(h["СтатусСопоставленияДляСНТ"]),
    extra_tables: extraTables(doc),
  };
}

/**
 * Строки документа. quantity и net_weight переносятся как есть, в своих
 * единицах: на одной строке они приходят в разных (т и кг), сверять и
 * приводить их нельзя.
 */
export function toLineRows(doc, documentId) {
  const lots = lotIndex(doc);
  const rawByLine = rawLineIndex(doc);
  return (doc.lines || []).map((l) => {
    // Колонки раздела G1, которых нет в нормализованных lines —
    // достаём из сырой табличной части по номеру строки.
    const raw = rawByLine.get(num(l.line_no)) || {};
    return {
      document_id: documentId,
      table_name: str(l.table),
      line_no: num(l.line_no),
      snt_line_no: num(l.snt_line_no),
      pin_code: str(l.pin_code),
      name: str(l.name),
      source_lot_id: lots.get(num(l.line_no)) ?? null,
      quantity: num(l.quantity),
      unit: str(l.unit),
      net_weight: num(l.net_weight),
      storage_unit: str(l.storage_unit),
      conversion_rate: num(l.conversion_rate),
      price: num(l.price),
      amount_net: num(l.amount_net),
      amount: num(l.amount),
      vat_amount: num(l.vat_amount),

      // Раздел G1 бланка
      origin_sign: str(raw["ПризнакПроисхождения"]),           // колонка 2
      tnved_code: str(raw["КодТНВЭД"]),                        // колонка 4
      unit_code: str(raw["ЕдиницаИзмеренияКод"]),
      excise_rate: str(raw["СтавкаАкциза"]),                   // колонка 10
      excise_rate_amount: num(raw["СтавкаАкцизаЧисло"]),
      excise_amount: num(raw["СуммаАкциза"]),                  // колонка 11
      vat_rate: str(raw["СтавкаНДС"]),                         // колонка 12
      vat_rate_percent: num(raw["СтавкаНДСЧисло"]),
      without_vat: bool(raw["БезНДС"]),
      product_identifier: str(raw["ИдентификаторТовара"]),     // колонка 15
      declaration_number: str(raw["НомерЗаявленияВРамкахТС"]), // колонка 16
      declaration_position: str(raw["НомерПозицииВДекларацииИлиЗаявлении"]), // колонка 17
      extra_info: str(raw["ДополнительнаяИнформация"]),        // колонка 19
      product_name_eaeu: str(raw["ТоварНаименованиеВРамкахТС"]),
      product_1c_name: str(raw["Товар"]),
      origin_source: str(raw["ИсточникПроисхождения"]),
    };
  });
}

/** Строка landing-таблицы. first_seen_at не включаем — см. toDocumentRow. */
export function toLandingRow(doc, hash, reason, source, runId, seenAt) {
  return {
    content_sha256: hash,
    payload: doc,
    source_org_code: reason ? null : str(doc.own_party.identifier),
    doc_kind: DOC_KINDS.has(doc.doc_kind) ? doc.doc_kind : null,
    registration_number: str(doc.registration_number),
    file_org_code: str(source?.org_code),
    file_base_ref: str(source?.base_ref),
    config_version: str(source?.config_version),
    processing_version: str(source?.processing_version),
    ingest_status: reason ? "rejected" : "accepted",
    reject_reason: reason,
    ingest_run_id: runId,
    last_seen_at: seenAt,
  };
}

/**
 * Ключи документов, которые кто-то исправляет. Документ считается
 * исправленным, если существует документ ТОЙ ЖЕ организации и ТОГО ЖЕ
 * вида, чей related_registration_number равен его регистрационному
 * номеру.
 */
export function supersededKeys(rows) {
  const keys = new Set();
  for (const r of rows) {
    if (!r.related_registration_number) continue;
    keys.add(docKey(r.source_org_code, r.doc_kind, r.related_registration_number));
  }
  return keys;
}

/** Свод позиции бланка: группа строк с одним snt_line_no. */
export function groupByPosition(lines) {
  const groups = new Map();
  for (const l of lines) {
    const key = l.snt_line_no ?? l.line_no;
    if (!groups.has(key)) {
      groups.set(key, {
        snt_line_no: l.snt_line_no ?? null,
        name: l.name,
        pin_code: l.pin_code,
        unit: l.unit,
        price: l.price,
        quantity: 0,
        amount_net: 0,
        amount: 0,
        vat_amount: 0,
        lines: [],
      });
    }
    const g = groups.get(key);
    g.quantity += l.quantity ?? 0;
    g.amount_net += l.amount_net ?? 0;
    g.amount += l.amount ?? 0;
    g.vat_amount += l.vat_amount ?? 0;
    g.lines.push(l);
  }
  return [...groups.values()];
}

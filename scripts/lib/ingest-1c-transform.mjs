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
  };
}

/**
 * Строки документа. quantity и net_weight переносятся как есть, в своих
 * единицах: на одной строке они приходят в разных (т и кг), сверять и
 * приводить их нельзя.
 */
export function toLineRows(doc, documentId) {
  const lots = lotIndex(doc);
  return (doc.lines || []).map((l) => ({
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
  }));
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

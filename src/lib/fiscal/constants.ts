/**
 * Константы реестра фискальных документов (СНТ и ЭСФ).
 *
 * Главное правило экрана: показываем СИНОНИМ (`state_label`,
 * `doc_type_label`, `operation_kind_label`), а фильтруем и красим по
 * КОДУ (`state_code`, `doc_type_code`, `operation_kind_code`).
 * Расхождение между ними реальное и проверенное: 64 документа несут
 * код «Исправленная» при синониме «Исправленная (аннулированная,
 * отклоненная)», ещё один — код «ВозвратТоваров» при синониме «На
 * возврат товаров». Условие, написанное по тексту, потеряло бы их.
 */

export type FiscalTabKey = "snt-in" | "snt-out" | "esf";

export type FiscalTab = {
  key: FiscalTabKey;
  label: string;
  docKind: "snt" | "esf";
  /** У вкладки ЭСФ направление не различается — там оба. */
  direction?: "Входящий" | "Исходящий";
};

/**
 * Вкладки разводятся по `direction_code`, а НЕ по роли нашей стороны.
 * Причина не семантическая, а рабочая: клиент сверяет экран с журналом
 * 1С, где импортная СНТ лежит в журнале продаж. Если у нас она уедет во
 * «входящие», человек увидит расхождение между двумя экранами и не
 * поймёт, какой из них врёт.
 *
 * Следствие, о котором надо помнить: у СНТ на ввоз `direction_code`
 * равен «Исходящий» при `own_party_role_code` = recipient. Такие
 * документы вытаскиваются фильтром «Вид операции → Ввоз».
 */
export const FISCAL_TABS: FiscalTab[] = [
  { key: "snt-in", label: "Входящие СНТ", docKind: "snt", direction: "Входящий" },
  { key: "snt-out", label: "Исходящие СНТ", docKind: "snt", direction: "Исходящий" },
  { key: "esf", label: "ЭСФ", docKind: "esf" },
];

export const DEFAULT_FISCAL_TAB: FiscalTabKey = "snt-in";

export function fiscalTab(key: string | null | undefined): FiscalTab {
  return FISCAL_TABS.find((t) => t.key === key) ?? FISCAL_TABS[0];
}

/** Тон бейджа состояния. Ключ — `state_code`, никогда не синоним. */
export type StateTone = "ok" | "info" | "void" | "warn" | "unknown";

const STATE_TONES: Record<string, StateTone> = {
  ПодтвержденПолучателем: "ok",
  ПринятОтПоставщика: "ok",
  ДоставленПолучателю: "info",
  ПринятСервером: "info",
  Аннулирован: "void",
  Отозван: "void",
  // Отдельное состояние: в множество {Аннулирован, Отозван} оно НЕ
  // входит и is_void по нему false — источник считает так же. Но по
  // смыслу это гашение, поэтому тон тот же, а фильтр «актуальные» его
  // не прячет.
  АннулированПриОтзывеСНТ: "void",
  ОтклоненПолучателем: "warn",
};

/** Неизвестный код не роняет строку и не притворяется нормальным. */
export function stateTone(code: string | null | undefined): StateTone {
  if (!code) return "unknown";
  return STATE_TONES[code] ?? "unknown";
}

export const STATE_TONE_CLASS: Record<StateTone, string> = {
  ok: "bg-green-50 text-green-700 ring-green-600/20",
  info: "bg-blue-50 text-blue-700 ring-blue-600/20",
  void: "bg-red-50 text-red-700 ring-red-600/20",
  warn: "bg-amber-50 text-amber-700 ring-amber-600/20",
  unknown: "bg-stone-100 text-stone-600 ring-stone-500/20",
};

/**
 * Виды операции для фильтра. Список ЗАДАН, а не собран из выборки:
 * «Ввоз» должен присутствовать в фильтре, даже когда под ним ноль
 * документов. Сейчас там ровно ноль — все восемь импортных СНТ
 * отклонены загрузчиком (см. предупреждение о недогруженных). Собери мы
 * список из данных, грань появилась бы только после перевыгрузки, и до
 * тех пор восемь документов на 792 млн ₸ нельзя было бы даже
 * попытаться найти.
 */
export const OPERATION_KINDS: { code: string; label: string }[] = [
  { code: "Реализация", label: "Реализация товаров" },
  { code: "Вывоз", label: "Вывоз товаров с территории РК" },
  { code: "Ввоз", label: "Ввоз товаров на территорию РК" },
  { code: "Перемещение", label: "Перемещение товаров" },
];

/** Псевдо-значение фильтра: документы без вида операции (их 6051). */
export const OPERATION_KIND_NONE = "__none__";

/** Псевдо-значение фильтра контрагентов: нерезиденты без БИН (их 27). */
export const COUNTERPARTY_NONE = "__none__";

export const REJECT_REASON_LABELS: Record<string, string> = {
  no_own_identifier: "не заполнен БИН нашей стороны",
  snt_line_without_snt_line_no: "у строки СНТ пуст номер позиции ИС ЭСФ",
  unknown_doc_kind: "неизвестный вид документа",
  unknown_direction: "неизвестное направление",
  missing_required_field: "не заполнено обязательное поле",
};

export function rejectReasonLabel(code: string | null | undefined): string {
  if (!code) return "причина не указана";
  return REJECT_REASON_LABELS[code] ?? code;
}

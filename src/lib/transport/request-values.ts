import { MONTHS_RU } from "@/lib/constants/months-ru";
import { TEMPLATE_ROWS } from "@/lib/transport/template-rows";
import type { TemplateValue } from "@/lib/transport/fill-template";

/**
 * Значения для строк заявки — ровно в том виде, в каком они попадут в
 * документ.
 *
 * Форматирование списано с заявки ОРТ от 27.03.2026, чтобы бланк не
 * отличался от привычного: «455 тн (7 вц)», «221066, 27101967»,
 * «март 2026 г.», грузополучатель с ИНН через запятую, две оплаты
 * отдельными строками внутри одной ячейки.
 *
 * Модуль намеренно ничего не знает ни про базу, ни про Word: на вход —
 * уже разрешённые названия из справочников, на выход — текст. Поэтому
 * форматирование целиком закрыто тестом.
 */

export type RequestDocumentInput = {
  /** Дата составления, ISO `гггг-мм-дд`. */
  date: string;
  fuelName?: string | null;
  tonnage?: number | null;
  wagons?: number | null;
  cargoPurpose?: string | null;
  stationName?: string | null;
  stationCode?: string | null;
  siding?: string | null;
  carrierName?: string | null;
  consigneeName?: string | null;
  consigneeBin?: string | null;
  consigneeCode?: string | null;
  consigneeAddress?: string | null;
  consigneeOkpo?: string | null;
  etsngCode?: string | null;
  gngCode?: string | null;
  specialMarks?: string | null;
  consignorName?: string | null;
  wagonOwnerName?: string | null;
  kzhPayerName?: string | null;
  krgPayerName?: string | null;
  routeText?: string | null;
  buyerName?: string | null;
  periodMonth?: number | null;
  periodYear?: number | null;
};

const CARGO_PURPOSE_LABELS: Record<string, string> = {
  export: "Экспорт",
  import: "Импорт",
  domestic: "Внутренний",
};

const s = (v: string | null | undefined) => (v ?? "").trim();

/**
 * Тоннаж без хвостовых нулей: в базе `DECIMAL(14,4)`, а в документе
 * должно стоять «455», а не «455.0000».
 */
export function formatTonnage(t: number | null | undefined): string {
  if (t == null || !Number.isFinite(t)) return "";
  return String(Number(t.toFixed(3)));
}

/** «455 тн (7 вц)», без вагонов — просто «455 тн». */
export function formatQuantity(
  tonnage: number | null | undefined,
  wagons: number | null | undefined,
): string {
  const t = formatTonnage(tonnage);
  if (!t) return "";
  return wagons ? `${t} тн (${wagons} вц)` : `${t} тн`;
}

/** Дата в шапке документа: «Заявка от 27.03.2026 г.» — год полный. */
export function formatRequestDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/**
 * «Август 2026 г.» — с заглавной.
 *
 * В справочнике месяцы лежат строчными («август»), а во всех настоящих
 * заявках период написан с большой буквы: «Август 2026 г.»,
 * «Сентябрь 2026 г.». Разница видна в готовом документе, поэтому
 * приводим здесь, а не правим общий справочник — он питает ещё и
 * таблицы CRM, где строчные уместны.
 */
export function formatPeriod(
  month: number | null | undefined,
  year: number | null | undefined,
): string {
  if (!month || !year) return "";
  const name = MONTHS_RU[month - 1];
  if (!name) return "";
  return `${name[0].toUpperCase()}${name.slice(1)} ${year} г.`;
}

/** «ОсОО «Ромашка», ИНН 010092009» — ИНН только если он есть. */
function formatConsignee(name: string, bin: string): string {
  if (!name) return "";
  return bin ? `${name}, ИНН ${bin}` : name;
}

/**
 * Ячейка «Экспедитор по ЖД» — две оплаты в одной клетке, как в образце.
 * Пустая сторона строку не занимает.
 */
function formatRailwayPayers(kzh: string, krg: string): string[] {
  const lines: string[] = [];
  if (kzh) lines.push(`Оплата по КЗХ – ${kzh}`);
  if (krg) lines.push(`Оплата по КРГ груженый и порожний пробег: ${krg}`);
  return lines;
}

/**
 * Значения всех 19 строк. Порядок совпадает с `TEMPLATE_ROWS`, но
 * заполнение идёт по названию строки, а не по порядку.
 */
export function buildTemplateValues(input: RequestDocumentInput): TemplateValue[] {
  const codes = [s(input.etsngCode), s(input.gngCode)].filter(Boolean).join(", ");

  const byLabel: Record<string, string[]> = {
    "Наименование нефтепродукта": [s(input.fuelName)],
    "Кол-во в тоннах": [formatQuantity(input.tonnage, input.wagons)],
    "Назначение груза": [CARGO_PURPOSE_LABELS[s(input.cargoPurpose)] ?? ""],
    "Станция назначения": [s(input.stationName)],
    "Код станции": [s(input.stationCode)],
    "Тупик": [s(input.siding)],
    "Наименование железной дороги": [s(input.carrierName)],
    "Грузополучатель": [formatConsignee(s(input.consigneeName), s(input.consigneeBin))],
    "Код грузополучателя": [s(input.consigneeCode)],
    "Адрес грузополучателя": [s(input.consigneeAddress)],
    "Код ОКПО получателя": [s(input.consigneeOkpo)],
    "Код ЕТСНГ, ГНГ": [codes],
    "Особые отметки": s(input.specialMarks).split("\n"),
    "Грузоотправитель": [s(input.consignorName)],
    "Принадлежность вагонов": [s(input.wagonOwnerName)],
    "Экспедитор по ЖД": formatRailwayPayers(s(input.kzhPayerName), s(input.krgPayerName)),
    "Маршрут транспортировки": [s(input.routeText)],
    "Покупатель": [s(input.buyerName)],
    "Период перевозки": [formatPeriod(input.periodMonth, input.periodYear)],
  };

  return TEMPLATE_ROWS.map((label) => ({
    label,
    lines: byLabel[label] ?? [""],
  }));
}

/** Имя файла: «Заявка 12 от 27.03.2026 ОсОО Ромашка.docx». */
export function documentFileName(
  requestNumber: number | null | undefined,
  iso: string,
  companyName: string | null | undefined,
  ext: "docx" | "pdf",
): string {
  const parts = ["Заявка"];
  if (requestNumber) parts.push(String(requestNumber));
  const d = formatRequestDate(iso);
  if (d) parts.push(`от ${d}`);
  const co = s(companyName).replace(/[\\/:*?"<>|]/g, " ").trim();
  if (co) parts.push(co);
  return `${parts.join(" ")}.${ext}`;
}

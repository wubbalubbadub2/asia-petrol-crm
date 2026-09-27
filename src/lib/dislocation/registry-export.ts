/**
 * Реестр сверхнормативов в формате экспедитора PTC (колонки A–R, как в
 * июльских реестрах «<Компания> ОсОО - Июль 2026»), плюс три колонки
 * для сверки: накладная, сделка, «требует проверки».
 *
 * Чистая функция: строки представления `rail_demurrage_registry` →
 * массив ячеек. Сама книга собирается в `@/lib/exports/demurrage-registry-excel`.
 */
import type { RegistryRow } from "@/lib/dislocation/types";

export const REGISTRY_HEADERS = [
  "Клиент",
  "Станция отправления",
  "Станция назначения",
  "Груз",
  "Вагон №",
  "Дата приб на ст погрузки",
  "Дата отправки",
  "Дата приб на ст выгрузки",
  "Дата след отправки (порож)",
  "Нормативное количество дней на погрузку",
  "Нормативное количество дней на выгрузку",
  "Ставка за пользование вагонами",
  "Кол-во сверхнормативных дней при наливе",
  "Кол-во сверхнормативных дней при сливе",
  "Итого дней",
  "Итого сумма",
  "Примечание",
  "Валюта",
  "Накладная",
  "Сделка",
  "Требует проверки",
] as const;

export type RegistryCell = string | number | Date | null;

const MONTHS_NOMINATIVE = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** `2026-08-11` → Date в UTC-полночь: часовой пояс машины не сдвигает дату. */
function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

export function buildRegistrySheetRows(rows: RegistryRow[]): RegistryCell[][] {
  const sorted = [...rows].sort(
    (a, b) =>
      (a.departure_station_name ?? "").localeCompare(b.departure_station_name ?? "", "ru") ||
      a.wagon_number.localeCompare(b.wagon_number),
  );
  return sorted.map((r) => {
    const m = monthIndex(r.month);
    const year = r.month.slice(0, 4);
    const notes: string[] = [];
    if (r.loaded_waybill_date && r.loaded_waybill_date.slice(0, 7) !== r.month.slice(0, 7)) {
      notes.push(`сутки ${MONTHS_GENITIVE[m]}`);
    }
    if (!r.unloading_final) notes.push("незавершенная перевозка");
    const days = r.loading_overage_days + r.unloading_overage_days;
    return [
      `${r.company_group_name ?? r.forwarder_name} - ${MONTHS_NOMINATIVE[m]} ${year}`,
      r.departure_station_name,
      r.destination_station_name,
      r.cargo_name,
      r.wagon_number,
      toDate(r.loading_arrival),
      toDate(r.loading_departure),
      toDate(r.unloading_arrival),
      toDate(r.unloading_departure),
      r.loading_norm,
      r.unloading_norm,
      r.rate,
      r.loading_overage_days,
      r.unloading_overage_days,
      days,
      r.amount,
      notes.join(", "),
      r.currency,
      r.loaded_waybill_number,
      r.deal_code,
      r.needs_check ? "да" : "",
    ];
  });
}

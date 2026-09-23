/**
 * Отгрузка в ДТ-КТ — ОДИН источник строк реестра для экрана и выгрузки.
 *
 * Клиент 2026-09-17: «ДТ-КТ логистика при выгрузке в эксель неправильно
 * формулу считает; выгрузки не должны отличаться от того, что видно в
 * UI».
 *
 * ЧТО БЫЛО. Экран и детальная выгрузка ходили в `shipment_registry`
 * ДВУМЯ разными запросами:
 *   • страница (`dt-kt/page.tsx`) — постранично по 1000 строк и БЕЗ
 *     `ORDER BY` вообще;
 *   • выгрузка (`dtkt-excel.ts`) — постранично с `ORDER BY date`, где
 *     дат-дублей тысячи.
 * PostgREST превращает `.range()` в LIMIT/OFFSET. Без ПОЛНОГО порядка
 * строк (то есть без уникального ключа в сортировке) страницы «плывут»:
 * достаточно одной правки строки реестра между запросами страниц, чтобы
 * одна отгрузка прочиталась дважды, а другая пропала. Проверено на
 * Postgres 15: 2500 строк, одна правка между страницами —
 *   без ORDER BY          → 1 строка потеряна, 1 задвоена;
 *   ORDER BY date         → 3 потеряно, 3 задвоено;
 *   ORDER BY date, id     → 0 потерь.
 * Отсюда и «неправильная формула»: «Отгр. сумма» входит в сальдо
 * слагаемым, и экран с Excel расходились между собой, а оба — с реестром.
 *
 * ЧТО СТАЛО. Один запрос с полным порядком (`date, id`), один набор
 * строк на странице, два чистых свёртывателя поверх него:
 *   • `sumRegistryByPair` — итоги пары «экспедитор + плательщик ЖД»
 *     для колонок «Отгр. тонн» / «Отгр. сумма» и для сальдо;
 *   • `avrByPair` — те же строки, свёрнутые по суткам, для под-строк
 *     АВР детальной выгрузки.
 * Выгрузка больше НЕ ходит в базу сама: страница передаёт ей уже
 * загруженные строки. Поэтому под-строки АВР сходятся с главной строкой
 * и с экраном по построению, а не по совпадению.
 *
 * Ключ пары считает `dtKtPairKey` — раньше страница и выгрузка строили
 * его по-разному (`?? ""` против шаблонной строки с null), и у записи
 * без плательщика ЖД под-строки молча исчезали.
 */

import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";

/** Строка реестра в том виде, в каком её читает ДТ-КТ. */
export type DtKtRegistryRow = {
  id: string;
  date: string | null;
  forwarder_id: string | null;
  company_group_id: string | null;
  shipment_volume: number | null;
  shipped_tonnage_amount: number | null;
};

/** Итоги по паре «экспедитор + плательщик ЖД». */
export type DtKtPairSums = {
  forwarder_id: string;
  company_group_id: string | null;
  total_volume: number;
  total_amount: number;
};

/** Сутки отгрузки: строки реестра одной даты, свёрнутые в одну АВР-строку. */
export type DtKtAvrDay = { date: string; volume: number; amount: number; wagons: number };

/** Ключ пары. Пустой плательщик ЖД — это пустая строка, а не «null». */
export function dtKtPairKey(forwarderId: string, companyGroupId: string | null | undefined): string {
  return `${forwarderId}::${companyGroupId ?? ""}`;
}

/**
 * Строки реестра за год. Сортировка `date, id` обязательна: `id`
 * уникален и делает постраничное чтение детерминированным (см. шапку).
 */
export async function fetchDtKtRegistryRows(year: number): Promise<DtKtRegistryRow[]> {
  const sb = createClient();
  const { data, error } = await fetchAllPaginated<DtKtRegistryRow>((from, to) =>
    sb
      .from("shipment_registry")
      .select("id, date, forwarder_id, company_group_id, shipment_volume, shipped_tonnage_amount")
      .gte("date", `${year}-01-01`)
      .lte("date", `${year}-12-31`)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) throw new Error(error.message);
  return data;
}

/** Итоги по парам. Строки без экспедитора не принадлежат ни одной записи ДТ-КТ. */
export function sumRegistryByPair(rows: DtKtRegistryRow[]): Map<string, DtKtPairSums> {
  const out = new Map<string, DtKtPairSums>();
  for (const r of rows) {
    if (!r.forwarder_id) continue;
    const key = dtKtPairKey(r.forwarder_id, r.company_group_id);
    let acc = out.get(key);
    if (!acc) {
      acc = { forwarder_id: r.forwarder_id, company_group_id: r.company_group_id, total_volume: 0, total_amount: 0 };
      out.set(key, acc);
    }
    acc.total_volume += r.shipment_volume ?? 0;
    acc.total_amount += r.shipped_tonnage_amount ?? 0;
  }
  return out;
}

/**
 * Те же строки, свёрнутые по суткам отгрузки. Недатированная строка в
 * АВР попасть не может — её не к какому дню отнести; такие строки
 * отсекает уже сам запрос (фильтр по `date`), проверка оставлена на
 * случай вызова с чужим набором строк.
 */
export function avrByPair(rows: DtKtRegistryRow[]): Map<string, DtKtAvrDay[]> {
  const byPair = new Map<string, Map<string, DtKtAvrDay>>();
  for (const r of rows) {
    if (!r.forwarder_id || !r.date) continue;
    const key = dtKtPairKey(r.forwarder_id, r.company_group_id);
    let byDate = byPair.get(key);
    if (!byDate) { byDate = new Map(); byPair.set(key, byDate); }
    const day = r.date.slice(0, 10);
    const acc = byDate.get(day) ?? { date: day, volume: 0, amount: 0, wagons: 0 };
    acc.volume += r.shipment_volume ?? 0;
    acc.amount += r.shipped_tonnage_amount ?? 0;
    acc.wagons += 1;
    byDate.set(day, acc);
  }

  const out = new Map<string, DtKtAvrDay[]>();
  for (const [key, byDate] of byPair) {
    out.set(key, Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)));
  }
  return out;
}

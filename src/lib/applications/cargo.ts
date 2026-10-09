/**
 * Подстановки груза в «Заявке» (00183).
 *
 * Клиент 2026-10-09: «при выборе вида ГСМ и % серы автоматом должны
 * выходить все коды: ЕТСНГ, ГНГ, ТН ВЭД». ЕТСНГ живёт на виде ГСМ
 * (справочник «Виды ГСМ»), ГНГ и ТН ВЭД — в «Кодах по видам ГСМ» строкой
 * «вид + % серы». Подставленное остаётся правимым: если справочник
 * молчит, поле не затирается.
 */

export type FuelRef = { id: string; name: string; etsng_code?: string | null };
export type FuelCodeRef = {
  fuel_type_id: string;
  sulfur_percent: number | null;
  gng_code: string | null;
  tnved_code: string | null;
};

export type CargoCodes = { etsng: string; gng: string; tnved: string };

const clean = (v: string | null | undefined) => (v ?? "").trim();

/** Строки «Кодов по видам ГСМ» выбранного вида. */
export function fuelCodeRows(fuelCodes: FuelCodeRef[], fuelTypeId: string): FuelCodeRef[] {
  if (!fuelTypeId) return [];
  return fuelCodes.filter((c) => c.fuel_type_id === fuelTypeId);
}

/**
 * Варианты «% серы» для вида — по строкам справочника, по возрастанию,
 * без повторов. Строка без серы в список не попадает: она значит
 * «коды вида без уточнения серы» и берётся, когда сера не выбрана.
 */
export function sulfurOptions(fuelCodes: FuelCodeRef[], fuelTypeId: string): number[] {
  const values = fuelCodeRows(fuelCodes, fuelTypeId)
    .map((c) => c.sulfur_percent)
    .filter((v): v is number => v != null);
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

/** «% серы» → строка для select (одинаково для 1.5 и «1.500» из БД). */
export function sulfurKey(v: number | null | undefined): string {
  return v == null ? "" : String(Number(v));
}

/**
 * Коды груза по виду ГСМ и % серы.
 *  - ЕТСНГ — с вида ГСМ.
 *  - ГНГ / ТН ВЭД — строка «вид + сера». Сера не выбрана: строка без
 *    серы, а если такой нет и строка у вида одна — она (как в заявке на
 *    перевозку). Несколько строк и сера не выбрана — коды пустые:
 *    угадывать нечего.
 */
export function applicationCargoCodes(
  fuels: FuelRef[],
  fuelCodes: FuelCodeRef[],
  fuelTypeId: string,
  sulfur: number | null,
): CargoCodes {
  if (!fuelTypeId) return { etsng: "", gng: "", tnved: "" };
  const etsng = clean(fuels.find((f) => f.id === fuelTypeId)?.etsng_code);
  const rows = fuelCodeRows(fuelCodes, fuelTypeId);
  let row: FuelCodeRef | undefined;
  if (sulfur != null) {
    row = rows.find((c) => c.sulfur_percent != null && Number(c.sulfur_percent) === Number(sulfur));
  } else {
    row = rows.find((c) => c.sulfur_percent == null) ?? (rows.length === 1 ? rows[0] : undefined);
  }
  return { etsng, gng: clean(row?.gng_code), tnved: clean(row?.tnved_code) };
}

/**
 * Что писать в поле кода после подстановки: найденный код, а если
 * справочник пуст — то, что уже стоит (как «Код станции»).
 */
export function codeOnPick(current: string, resolved: string): string {
  return resolved !== "" ? resolved : current;
}

/** «Продукт» для списка и поиска: вид ГСМ + сера, если указана. */
export function productLabel(fuelName: string | null | undefined, sulfur: number | null): string {
  const name = clean(fuelName);
  if (name === "") return "";
  return sulfur == null ? name : `${name}, сера ${String(Number(sulfur)).replace(".", ",")}%`;
}

/**
 * Грузоотправитель при выборе станции отправления: «Грузоотправитель»
 * станции из справочника, а если у станции его нет — что уже выбрано.
 */
export function consignorOnStation(current: string, stationFactoryId: string | null | undefined): string {
  return stationFactoryId ? stationFactoryId : current;
}

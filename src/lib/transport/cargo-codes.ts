/**
 * Коды груза для заявки на перевозку — откуда берутся (владелец 2026-10-08).
 *
 *   1. Пара «завод + продукт» (transport_cargo_codes, 00155) — главный
 *      источник: у одного мазута на разных заводах разные ГНГ.
 *   2. Пары нет — по виду ГСМ: ЕТСНГ с самого вида (fuel_types.etsng_code),
 *      ГНГ из «Кодов по видам ГСМ» (fuel_type_codes, 00182), но только если
 *      у вида РОВНО одна строка. Несколько строк (разная сера) — логист
 *      выбирает руками: по сере сделки сопоставлять нельзя, она там текст.
 */
export type PairCode = { factory_id: string; fuel_type_id: string; etsng_code: string | null; gng_code: string | null };
export type FuelCode = { fuel_type_id: string; gng_code: string | null };
export type FuelWithEtsng = { id: string; etsng_code?: string | null };

export type ResolvedCodes = { etsng: string; gng: string; source: "pair" | "fuel" | "none" };

export function resolveCargoCodes(
  pairs: PairCode[],
  fuelCodes: FuelCode[],
  fuels: FuelWithEtsng[],
  factoryId: string,
  fuelTypeId: string,
): ResolvedCodes {
  if (!fuelTypeId) return { etsng: "", gng: "", source: "none" };
  const pair = factoryId
    ? pairs.find((c) => c.factory_id === factoryId && c.fuel_type_id === fuelTypeId)
    : undefined;
  if (pair && ((pair.etsng_code ?? "") !== "" || (pair.gng_code ?? "") !== "")) {
    return { etsng: pair.etsng_code ?? "", gng: pair.gng_code ?? "", source: "pair" };
  }
  const etsng = (fuels.find((f) => f.id === fuelTypeId)?.etsng_code ?? "").trim();
  const rows = fuelCodes.filter((c) => c.fuel_type_id === fuelTypeId && (c.gng_code ?? "").trim() !== "");
  const gng = rows.length === 1 ? (rows[0].gng_code ?? "").trim() : "";
  if (etsng === "" && gng === "") return { etsng: "", gng: "", source: "none" };
  return { etsng, gng, source: "fuel" };
}

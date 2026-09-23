/**
 * Формула цены строки-варианта — зеркало SQL-функции `apply_price_formula`
 * (миграция 00164).
 *
 *   цена = ROUND((котировка − скидка) × курс × коэффициент барелизации, 3)
 *
 * Клиент (WhatsApp, 2026-09-18/19): «Цена нефти долл/тонна = (Котировка
 * Brent долл/баррель (среднемесячная или на дату, как по договору) минус
 * скидка в долл/баррель) * коэффициент барелизации».
 *
 * ЕДИНИЦЫ: котировка и скидка — доллары за баррель, коэффициент —
 * баррелей в тонне (≈7,6 для Brent), цена — доллары за тонну. Скидка
 * вычитается ДО умножения (согласовано 2026-09-19).
 *
 * ПУСТЫЕ МНОЖИТЕЛИ = 1: без коэффициента формула остаётся прежней
 * (цена = котировка − скидка), поэтому существующие сделки не меняются.
 * Курс участвует только в режиме «Формульная вручную» — там он и был.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Предварительную цену считает интерфейс, а
 * окончательную — Postgres. Две копии формулы уже расходились в этом
 * проекте; здесь копия ровно одна, и тест сверяет её с теми же числами,
 * что и БД-тест 21_barrel_ratio.
 */

/**
 * Цена строки отгрузки при правке в таблице «Фикс цена».
 *
 * Клиент 2026-09-23, KZ/26/276: «со стороны покупателя не села цена для
 * подсчёта сумм в отгрузки». Причина — правка ЛЮБОГО поля строки
 * (объёма, скидки) пересчитывала цену как «котировка − скидка», а у
 * сделки с фиксированной ценой котировки нет: цена приходит из SQL.
 * Пересчёт затирал её в NULL вместе с суммой.
 *
 * Правило: без котировки цену НЕ ТРОГАЕМ — она не из этой формулы.
 * С котировкой считаем как раньше, через общую формулу.
 */
export function shipmentRowPrice(
  quotation: number | null | undefined,
  discount: number | null | undefined,
  current: number | null | undefined,
): number | null {
  if (quotation == null || !Number.isFinite(quotation)) return current ?? null;
  return applyPriceFormula(quotation, discount, null, null);
}

export function applyPriceFormula(
  quotation: number | null | undefined,
  discount: number | null | undefined,
  fxRate: number | null | undefined,
  barrelRatio: number | null | undefined,
): number | null {
  if (quotation == null || !Number.isFinite(quotation)) return null;
  const d = discount != null && Number.isFinite(discount) ? discount : 0;
  // Ноль — это «не заполнено», а не «умножить на ноль»: нулевой множитель
  // обнулил бы цену. В базе ноль запрещён CHECK'ом, здесь — тем же правилом.
  const fx = fxRate != null && Number.isFinite(fxRate) && fxRate !== 0 ? fxRate : 1;
  const ratio = barrelRatio != null && Number.isFinite(barrelRatio) && barrelRatio !== 0 ? barrelRatio : 1;
  // Три знака, как в SQL (00166): клиент считает «цена × объём» по цене,
  // которую видит, и сумма обязана сходиться с его Excel. Половинка —
  // от нуля, как ROUND в Postgres (цены положительные).
  return Math.round((quotation - d) * fx * ratio * 1000) / 1000;
}

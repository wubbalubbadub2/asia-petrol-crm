/**
 * Формульная цена без котировки — нерабочая строка.
 *
 * Клиент 2026-09-18: «нужно сделать обязательное заполнение котировки
 * при выборе формульной цены — если выбрали формульную, то пока не
 * выберут котировку, дальнейшее действие запрещено».
 *
 * Почему это важно не только для порядка в форме: автоподбор цены
 * (`autoprice_registry_insert`, 00148) ищет котировку по
 * `quotation_type_id` строки-варианта. Пустой тип — и строки реестра
 * приезжают без цены, а сумма отгрузки остаётся нулём, пока кто-нибудь
 * не заметит.
 *
 * Требование касается ТОЛЬКО тира «Формульная» (`priceTierOf` →
 * `formula`): «Фикс / Вручную» и «Формульная вручную» цену получают
 * руками, там котировка остаётся необязательной (её и раньше писали
 * ради истории — operator 2026-06-24).
 */

import { encodePriceMode, priceTierOf, type TriggerBasisLite } from "@/lib/constants/deal-types";

export const QUOTATION_REQUIRED_MESSAGE = "Выберите котировку — при формульной цене она обязательна";

/** Нужен ли этому режиму цены выбранный тип котировки. */
export function requiresQuotationType(
  priceCondition: string | null | undefined,
  triggerBasis: TriggerBasisLite | null | undefined,
): boolean {
  return priceTierOf(encodePriceMode(priceCondition, triggerBasis)) === "formula";
}

/** Строка-вариант в формульном режиме, но котировка не выбрана. */
export function quotationTypeMissing(line: {
  price_condition?: string | null;
  trigger_basis?: TriggerBasisLite | null;
  quotation_type_id?: string | null;
}): boolean {
  return requiresQuotationType(line.price_condition, line.trigger_basis) && !line.quotation_type_id;
}

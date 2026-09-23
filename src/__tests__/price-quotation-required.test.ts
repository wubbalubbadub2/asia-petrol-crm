/**
 * Формульная цена без котировки не сохраняется.
 *
 * Клиент 2026-09-18: «нужно сделать обязательное заполнение котировки
 * при выборе формульной цены — если выбрали формульную, то пока не
 * выберут котировку, дальнейшее действие запрещено».
 *
 * Тест держит САМО ПРАВИЛО: какие режимы цены требуют котировку.
 * Форма создания сделки и редактор строк-вариантов зовут эти же
 * функции — и для блокировки сохранения, и для красной пометки поля,
 * и для запрета перевода стадии в «Окончательную».
 */
import { describe, it, expect } from "vitest";
import { requiresQuotationType, quotationTypeMissing } from "@/lib/deals/price-validation";
import { PRICE_MODES, decodePriceMode, priceTierOf, type PriceMode } from "@/lib/constants/deal-types";

describe("какие режимы требуют котировку", () => {
  it.each(PRICE_MODES.map((m) => [m.value, m.label] as const))("%s — %s", (mode) => {
    const dec = decodePriceMode(mode as PriceMode);
    const expected = priceTierOf(mode as PriceMode) === "formula";
    expect(requiresQuotationType(dec.price_condition, dec.trigger_basis)).toBe(expected);
  });

  it("ручные режимы котировку не требуют — цену там вводят руками", () => {
    expect(requiresQuotationType("manual", null)).toBe(false);
    expect(requiresQuotationType("manual_formula", null)).toBe(false);
  });

  it("все формульные подтипы требуют — включая триггер по обеим датам", () => {
    expect(requiresQuotationType("average_month", null)).toBe(true);
    expect(requiresQuotationType("avg_to_date", null)).toBe(true);
    expect(requiresQuotationType("fixed", null)).toBe(true);
    expect(requiresQuotationType("manual_in_formula", null)).toBe(true);
    expect(requiresQuotationType("trigger", "shipment_date")).toBe(true);
    expect(requiresQuotationType("trigger", "border_crossing_date")).toBe(true);
  });
});

describe("строка-вариант: чего не хватает", () => {
  it("формульная без котировки — блокируем", () => {
    expect(quotationTypeMissing({ price_condition: "average_month", quotation_type_id: null })).toBe(true);
    expect(quotationTypeMissing({ price_condition: "trigger", trigger_basis: "shipment_date", quotation_type_id: "" })).toBe(true);
  });

  it("формульная с котировкой — пропускаем", () => {
    expect(quotationTypeMissing({ price_condition: "average_month", quotation_type_id: "qt-1" })).toBe(false);
  });

  it("ручная без котировки — пропускаем, это законно", () => {
    expect(quotationTypeMissing({ price_condition: "manual", quotation_type_id: null })).toBe(false);
    expect(quotationTypeMissing({ price_condition: "manual_formula", quotation_type_id: null })).toBe(false);
  });
});

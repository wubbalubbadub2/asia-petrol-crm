/**
 * Формула цены с коэффициентом барелизации — интерфейсная копия.
 *
 * Клиент (WhatsApp, 2026-09-18/19): «Цена нефти долл/тонна = (Котировка
 * Brent долл/баррель (среднемесячная или на дату, как по договору) минус
 * скидка в долл/баррель) * коэффициент барелизации».
 *
 * Предварительную цену считает интерфейс, окончательную — Postgres.
 * Числа здесь СПЕЦИАЛЬНО те же, что в БД-тесте
 * `supabase/tests/21_barrel_ratio.test.sql`: если формулы разойдутся,
 * упадёт один из двух тестов.
 */
import { describe, it, expect } from "vitest";
import { applyPriceFormula, shipmentRowPrice } from "@/lib/deals/price-formula";

describe("цена = (котировка − скидка) × курс × коэффициент", () => {
  it("Brent 90,83725 × 7,6 — цена приложения КГ/26/502", () => {
    // 690.3631 → три знака (00166): 690.363, как в SQL-функции.
    expect(applyPriceFormula(90.83725, 0, null, 7.6)).toBe(690.363);
  });

  it("цена всегда с тремя знаками — как в Excel клиента", () => {
    expect(applyPriceFormula(236.15625, 10, null, null)).toBe(226.156);
    expect(applyPriceFormula(100.0005, 0, null, null)).toBe(100.001);
  });

  it("скидка вычитается ДО умножения", () => {
    expect(applyPriceFormula(90, 2, null, 7.6)).toBeCloseTo(668.8, 4);
    // Если бы скидку вычитали после перевода в тонны, вышло бы 682.
    expect(applyPriceFormula(90, 2, null, 7.6)).not.toBeCloseTo(682, 4);
  });

  it("без коэффициента формула прежняя — существующие сделки не меняются", () => {
    expect(applyPriceFormula(525.98, 20.5, null, null)).toBeCloseTo(505.48, 4);
    expect(applyPriceFormula(525.98, 20.5, null, undefined)).toBeCloseTo(505.48, 4);
  });

  it("«Формульная вручную»: курс и коэффициент перемножаются оба", () => {
    expect(applyPriceFormula(100, 10, 2, 7.6)).toBeCloseTo(1368, 4);
  });

  it("ноль трактуется как «не заполнено», а не как «умножить на ноль»", () => {
    expect(applyPriceFormula(100, 10, 0, 0)).toBeCloseTo(90, 4);
  });

  it("нет котировки — нет цены", () => {
    expect(applyPriceFormula(null, 5, null, 7.6)).toBeNull();
    expect(applyPriceFormula(undefined, 5, null, 7.6)).toBeNull();
    expect(applyPriceFormula(Number.NaN, 5, null, 7.6)).toBeNull();
  });

  it("пустая скидка считается нулём", () => {
    expect(applyPriceFormula(90.83725, null, null, 7.6)).toBe(690.363);
  });
});

// KZ/26/276 (клиент 2026-09-23): «со стороны покупателя не села цена для
// подсчёта сумм в отгрузки». Правка объёма в таблице «Фикс цена»
// пересчитывала цену как «котировка − скидка», а у фиксированной цены
// котировки нет — цена и сумма обнулялись.
describe("shipmentRowPrice: правка строки не стирает фиксированную цену", () => {
  it("без котировки цена строки сохраняется", () => {
    expect(shipmentRowPrice(null, 0, 388700)).toBe(388700);
    expect(shipmentRowPrice(undefined, 0, 388700)).toBe(388700);
  });

  it("без котировки и без прежней цены — пусто", () => {
    expect(shipmentRowPrice(null, 0, null)).toBeNull();
  });

  it("с котировкой считается по общей формуле", () => {
    expect(shipmentRowPrice(525.98, 20.5, 999)).toBe(505.48);
  });

  it("нулевая котировка — это значение, а не «пусто»", () => {
    expect(shipmentRowPrice(0, 0, 388700)).toBe(0);
  });
});

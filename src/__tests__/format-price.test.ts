import { describe, it, expect } from "vitest";
import { formatMoney, formatPrice, formatPriceOrBlank } from "@/lib/format";

// Клиент 2026-09-04: «во всех ценах нужно чтобы после запятой было
// 3 цифры». Речь о цене за тонну; суммы, оплаты, сальдо остаются с 2
// знаками (правило 2026-07-07).
describe("formatPrice — цена за тонну, 3 знака", () => {
  it("дописывает нули до трёх знаков", () => {
    expect(formatPrice(896.5)).toBe("896,500");
    expect(formatPrice(1234.5678)).toBe("1 234,568");
  });

  it("ноль виден как 0,000; пусто — пустая строка", () => {
    expect(formatPrice(0)).toBe("0,000");
    expect(formatPrice(null)).toBe("");
    expect(formatPrice(undefined)).toBe("");
  });

  it("*OrBlank прячет ноль", () => {
    expect(formatPriceOrBlank(0)).toBe("");
    expect(formatPriceOrBlank(0.123)).toBe("0,123");
  });

  it("суммы по-прежнему с 2 знаками", () => {
    expect(formatMoney(896.5)).toBe("896,50");
  });
});

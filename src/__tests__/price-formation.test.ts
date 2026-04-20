import { describe, it, expect } from "vitest";
import { calculatePrice, getDateRange } from "@/lib/calculations/price-formation";

describe("Price Formation Calculator", () => {
  describe("Average Month mode", () => {
    it("calculates price as monthly average minus discount", () => {
      const result = calculatePrice({
        mode: "average_month",
        discount: 10,
        monthlyAverage: 500,
      });
      expect(result.quotation).toBe(500);
      expect(result.discount).toBe(10);
      expect(result.price).toBe(490);
      expect(result.label).toBe("Средний месяц");
    });

    it("returns null price when no monthly average", () => {
      const result = calculatePrice({
        mode: "average_month",
        discount: 10,
        monthlyAverage: null,
      });
      expect(result.quotation).toBeNull();
      expect(result.price).toBeNull();
    });

    it("handles zero discount", () => {
      const result = calculatePrice({
        mode: "average_month",
        discount: 0,
        monthlyAverage: 350,
      });
      expect(result.price).toBe(350);
    });
  });

  describe("Fixed Date mode", () => {
    it("calculates price from fixed date quotation", () => {
      const result = calculatePrice({
        mode: "fixed",
        discount: 15,
        fixedDatePrice: 600,
      });
      expect(result.quotation).toBe(600);
      expect(result.price).toBe(585);
      expect(result.label).toBe("Фикс цена на дату");
    });

    it("returns null when no fixed date price", () => {
      const result = calculatePrice({
        mode: "fixed",
        discount: 15,
        fixedDatePrice: null,
      });
      expect(result.price).toBeNull();
    });
  });

  describe("Trigger mode", () => {
    it("calculates average over trigger period", () => {
      const result = calculatePrice({
        mode: "trigger",
        discount: 5,
        triggerPrices: [100, 200, 300],
        triggerDays: 35,
      });
      expect(result.quotation).toBe(200); // avg of 100, 200, 300
      expect(result.price).toBe(195); // 200 - 5
      expect(result.label).toBe("Триггер (35 дней)");
    });

    it("returns null for empty trigger prices", () => {
      const result = calculatePrice({
        mode: "trigger",
        discount: 5,
        triggerPrices: [],
        triggerDays: 35,
      });
      expect(result.quotation).toBeNull();
      expect(result.price).toBeNull();
    });

    it("uses default 35 days when not specified", () => {
      const result = calculatePrice({
        mode: "trigger",
        discount: 0,
        triggerPrices: [400],
      });
      expect(result.label).toBe("Триггер (35 дней)");
    });
  });

  describe("getDateRange", () => {
    it("calculates date range from start + days", () => {
      const range = getDateRange("2026-01-15", 35);
      expect(range.start).toBe("2026-01-15");
      // setUp forces TZ=UTC, so "2026-01-15T00:00:00" + 35 days = 2026-02-19.
      expect(range.end).toBe("2026-02-19");
    });

    it("handles month boundary", () => {
      const range = getDateRange("2026-03-20", 40);
      expect(range.end).toBe("2026-04-29"); // 2026-03-20 + 40 days in UTC
    });
  });

  // Edge-case sweep per the Phase 1.3 plan — null quotation, negative
  // discount, empty trigger price list. These codify the behaviour the
  // UI depends on when incomplete data is entered.
  describe("edge cases", () => {
    it("null monthlyAverage yields null price, preserves discount", () => {
      const r = calculatePrice({ mode: "average_month", discount: 10, monthlyAverage: null });
      expect(r.quotation).toBeNull();
      expect(r.price).toBeNull();
      expect(r.discount).toBe(10);
    });

    it("null fixedDatePrice yields null price", () => {
      const r = calculatePrice({ mode: "fixed", discount: 5, fixedDatePrice: null });
      expect(r.quotation).toBeNull();
      expect(r.price).toBeNull();
    });

    it("empty triggerPrices array yields null quotation", () => {
      const r = calculatePrice({ mode: "trigger", discount: 0, triggerPrices: [] });
      expect(r.quotation).toBeNull();
      expect(r.price).toBeNull();
    });

    it("negative discount is treated as a bonus (added back to price)", () => {
      // Intentional corner: a user may enter -10 to model a markup.
      // calculatePrice subtracts it literally → price = quotation - (-10) = quotation + 10.
      const r = calculatePrice({ mode: "average_month", discount: -10, monthlyAverage: 500 });
      expect(r.quotation).toBe(500);
      expect(r.price).toBe(510);
    });

    it("trigger mode averages a long price list without losing precision", () => {
      const prices = Array.from({ length: 40 }, (_, i) => 400 + i * 0.25); // 400, 400.25, ..., 409.75
      const r = calculatePrice({ mode: "trigger", discount: 0, triggerPrices: prices, triggerDays: 40 });
      // Arithmetic mean is (first + last) / 2 = (400 + 409.75) / 2 = 404.875
      expect(r.quotation).toBeCloseTo(404.875, 10);
      expect(r.label).toBe("Триггер (40 дней)");
    });
  });
});

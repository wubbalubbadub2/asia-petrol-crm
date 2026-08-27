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
    // Окно включает сам startDate: «35 дней» = стартовая дата и ещё 34.
    it("calculates date range from start + days", () => {
      const range = getDateRange("2026-01-15", 35);
      expect(range.start).toBe("2026-01-15");
      expect(range.end).toBe("2026-02-18"); // Jan 15 + 34 days ahead
    });

    it("handles month boundary", () => {
      const range = getDateRange("2026-03-20", 40);
      expect(range.end).toBe("2026-04-28"); // Mar 20 + 39 days ahead
    });

    // Регрессия: конец окна считался локальной полуночью, а снимался
    // через toISOString() (UTC), и в разных таймзонах выходили разные
    // даты — Asia/Almaty давала 2026-02-18, а UTC (CI) 2026-02-19.
    // Граница окна кормит среднее по котировкам, то есть цену, поэтому
    // она обязана быть одинаковой у всех.
    it("не зависит от таймзоны браузера", () => {
      const tz = process.env.TZ;
      try {
        const ends = ["UTC", "Asia/Almaty", "America/New_York", "Pacific/Kiritimati"].map((z) => {
          process.env.TZ = z;
          return getDateRange("2026-01-15", 35).end;
        });
        expect(new Set(ends).size).toBe(1);
        expect(ends[0]).toBe("2026-02-18");
      } finally {
        process.env.TZ = tz;
      }
    });

    it("граница: окно в 1 день — это сам startDate", () => {
      expect(getDateRange("2026-01-15", 1).end).toBe("2026-01-15");
    });

    it("граница: 0 дней не даёт конец раньше начала", () => {
      expect(getDateRange("2026-01-15", 0).end).toBe("2026-01-15");
    });

    it("граница: високосный февраль", () => {
      // 2028 — високосный: 20.02 + 9 дней включительно = 29.02.
      expect(getDateRange("2028-02-20", 10).end).toBe("2028-02-29");
    });
  });
});

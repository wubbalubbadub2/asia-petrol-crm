import { describe, it, expect } from "vitest";
import { FxRates, prevDayISO, type FxRateRow } from "@/lib/fx/rates";

// НБ РК публикует USD→KZT, НБ КР — USD→KGS. base всегда USD (пивот).
const ROWS: FxRateRow[] = [
  { date: "2026-07-16", base_currency: "USD", quote_currency: "KZT", rate: 468 },
  { date: "2026-07-17", base_currency: "USD", quote_currency: "KZT", rate: 470 },
  { date: "2026-07-20", base_currency: "USD", quote_currency: "KZT", rate: 475 },
  { date: "2026-07-17", base_currency: "USD", quote_currency: "KGS", rate: 87 },
];

describe("prevDayISO", () => {
  it("переходит через границу месяца", () => {
    expect(prevDayISO("2026-08-01")).toBe("2026-07-31");
    expect(prevDayISO("2026-07-21")).toBe("2026-07-20");
  });
});

describe("FxRates.rateOn", () => {
  it("берёт курс своего дня для прошлых дат", () => {
    const fx = new FxRates(ROWS, "2026-07-21");
    expect(fx.rateOn("KZT", "2026-07-17")).toBe(470);
  });

  it("на СЕГОДНЯ берёт вчерашний зафиксированный курс", () => {
    // сегодня 2026-07-21, курс за 21-е ещё не зафиксирован
    const withToday: FxRateRow[] = [
      ...ROWS,
      { date: "2026-07-21", base_currency: "USD", quote_currency: "KZT", rate: 999 },
    ];
    const fx = new FxRates(withToday, "2026-07-21");
    expect(fx.rateOn("KZT", "2026-07-21")).toBe(475);
  });

  it("на выходных подтягивает последний рабочий день", () => {
    const fx = new FxRates(ROWS, "2026-07-21");
    expect(fx.rateOn("KZT", "2026-07-19")).toBe(470);
  });

  it("USD к USD всегда 1", () => {
    const fx = new FxRates(ROWS, "2026-07-21");
    expect(fx.rateOn("USD", "2026-07-17")).toBe(1);
  });

  it("нет курса раньше первой записи — null", () => {
    const fx = new FxRates(ROWS, "2026-07-21");
    expect(fx.rateOn("KZT", "2026-01-01")).toBeNull();
    expect(fx.rateOn("RUB", "2026-07-17")).toBeNull();
  });
});

describe("FxRates.convert", () => {
  const fx = new FxRates(ROWS, "2026-07-21");

  it("USD → KZT умножает", () => {
    expect(fx.convert(100, "USD", "KZT", "2026-07-17", null)).toBe(47000);
  });

  it("KZT → USD делит", () => {
    expect(fx.convert(47000, "KZT", "USD", "2026-07-17", null)).toBe(100);
  });

  it("KGS → KZT идёт через USD", () => {
    // 87 сом = 1 USD = 470 тенге
    expect(fx.convert(87, "KGS", "KZT", "2026-07-17", null)).toBeCloseTo(470, 6);
  });

  it("одинаковые валюты возвращают сумму как есть", () => {
    expect(fx.convert(123.45, "KZT", "KZT", null, null)).toBe(123.45);
  });

  it("без даты берёт среднемесячный курс", () => {
    // июль: (468 + 470 + 475) / 3 = 471
    expect(fx.convert(1, "USD", "KZT", null, { year: 2026, month: 7 })).toBeCloseTo(471, 6);
  });

  it("нет курса — null, а не ноль", () => {
    expect(fx.convert(100, "USD", "KZT", "2026-01-01", null)).toBeNull();
    expect(fx.convert(100, "USD", "RUB", "2026-07-17", null)).toBeNull();
    expect(fx.convert(null, "USD", "KZT", "2026-07-17", null)).toBeNull();
  });
});

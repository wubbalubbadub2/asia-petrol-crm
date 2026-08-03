import { describe, it, expect } from "vitest";
import { excelDate, DETAIL_COLUMNS, DEBT_COLUMNS } from "@/lib/exports/passport-detail-excel";

// Клиент 2026-08-03: «даты в экспорте не в формате даты — нельзя
// фильтровать по месяцу». Excel группирует автофильтр по году/месяцу
// только у date-typed ячеек, поэтому каждая дата-колонка детального
// паспорта обязана отдавать Date (UTC-полночь), не текст dd.mm.yy.

type AnyCol = {
  key: string;
  numFmt?: string;
  readShip?: (deal: never, s: never) => unknown;
};

const col = (cols: readonly AnyCol[], key: string): AnyCol => {
  const c = cols.find((c) => c.key === key);
  if (!c) throw new Error(`column ${key} not found`);
  return c;
};

const ship = {
  loading_date: "2026-07-08",
  date: "2026-07-15",
  shipment_volume: 60,
} as never;
const sub = {
  ship,
  supPay: { amount: 100, payment_date: "2026-07-20" },
  buyPay: { amount: 50, payment_date: "2026-07-25" },
} as never;
const emptySub = { ship: null, supPay: null, buyPay: null } as never;
const deal = {
  supplier_deferral_mode: "shipment",
  supplier_deferral_days: 5,
  buyer_deferral_mode: "other",
  buyer_planned_pay_date: "2026-09-01",
} as never;

describe("excelDate", () => {
  it("maps a date-only ISO string to UTC midnight of that calendar day", () => {
    expect(excelDate("2026-07-08").getTime()).toBe(Date.UTC(2026, 6, 8));
  });

  it("ignores any time component", () => {
    expect(excelDate("2026-07-08T15:30:00").getTime()).toBe(Date.UTC(2026, 6, 8));
  });
});

describe("passport-detail export date columns", () => {
  const cases: Array<[readonly AnyCol[], string, number]> = [
    [DETAIL_COLUMNS, "supplier_snt_date", Date.UTC(2026, 6, 8)],
    [DETAIL_COLUMNS, "supplier_payment_date", Date.UTC(2026, 6, 20)],
    [DETAIL_COLUMNS, "buyer_snt_date", Date.UTC(2026, 6, 15)],
    [DETAIL_COLUMNS, "buyer_payment_date", Date.UTC(2026, 6, 25)],
    // shipment-режим: loading_date 08.07 + 5 дней отсрочки = 13.07
    [DEBT_COLUMNS, "sup_planned", Date.UTC(2026, 6, 13)],
    // other-режим: ручная плановая дата 01.09
    [DEBT_COLUMNS, "buy_planned", Date.UTC(2026, 8, 1)],
  ];

  it.each(cases.map(([cols, key, ts]) => [key, cols, ts] as const))(
    "%s writes a real Date cell with dd.mm.yy format",
    (key, cols, ts) => {
      const c = col(cols, key);
      expect(c.numFmt).toBe("dd.mm.yy");
      const v = c.readShip!(deal, sub);
      expect(v).toBeInstanceOf(Date);
      expect((v as Date).getTime()).toBe(ts);
    },
  );

  it.each(["supplier_snt_date", "supplier_payment_date", "buyer_snt_date", "buyer_payment_date"])(
    "%s stays empty when the sub-row part is missing",
    (key) => {
      expect(col(DETAIL_COLUMNS, key).readShip!(deal, emptySub)).toBe("");
    },
  );
});

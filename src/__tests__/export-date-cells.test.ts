import { describe, it, expect } from "vitest";
import { excelDate, DETAIL_COLUMNS, buildDebtColumns } from "@/lib/exports/passport-detail-excel";

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
  id: "ship-1",
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

// С 00141 выгрузка не считает срок сама — она рендерит то, что отдало
// представление deal_payment_terms. Поэтому колонки долгов строятся из
// карты «отгрузка+сторона → срок», и тест подсовывает её напрямую.
// Значения повторяют прежний смысл: у поставщика вход. СНТ 08.07 + 5
// дней = 13.07, у покупателя режим «прочее» с ручной датой 01.09.
const DEBT_COLUMNS = buildDebtColumns(new Map([
  ["ship-1|supplier", {
    shipment_id: "ship-1", side: "supplier" as const, deferral_days: 5,
    date_basis: "auto" as const, deferral_mode: "shipment",
    planned_pay_date: "2026-07-13", days_to_pay: -10,
  }],
  ["ship-1|buyer", {
    shipment_id: "ship-1", side: "buyer" as const, deferral_days: null,
    date_basis: "manual" as const, deferral_mode: "other",
    planned_pay_date: "2026-09-01", days_to_pay: 40,
  }],
]));

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
    // Плановая дата приезжает из представления и рендерится как Date.
    [DEBT_COLUMNS, "sup_planned", Date.UTC(2026, 6, 13)],
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

  it("плановая дата пуста, когда представление не дало строку по отгрузке", () => {
    const empty = buildDebtColumns(new Map());
    expect(col(empty, "sup_planned").readShip!(deal, sub)).toBe("");
    expect(col(empty, "buy_planned").readShip!(deal, sub)).toBe("");
  });

  it("«Дата начала отсрочки» показывает, откуда взялась дата", () => {
    expect(col(DEBT_COLUMNS, "sup_defer_basis").readShip!(deal, sub)).toBe("от даты отгрузки");
  });

  it("режим «прочее» показывает заметку сделки", () => {
    const withNote = { ...(deal as object), buyer_deferral_note: "по графику" } as never;
    expect(col(DEBT_COLUMNS, "buy_defer_basis").readShip!(withNote, sub)).toBe("по графику");
  });
});

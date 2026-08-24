import { describe, it, expect } from "vitest";
import { DTKT_SHORT_COLUMNS, DTKT_DETAIL_COLUMNS, excelDate } from "@/lib/exports/dtkt-excel";

const row = {
  forwarderId: "fw-1",
  companyGroupId: "cg-1",
  forwarder: "PTC - Operator",
  companyGroup: "TENGRI WAY",
  year: 2026,
  openingBalance: -32340.2,
  payment: 228825,
  shippedVolume: 3200.5,
  shippedAmount: 204087.56,
  refund: null,
  fines: null,
  surcharge: 21940,
  ogem: null,
  saldo: -35137.64,
  payments: [
    { date: "2026-03-12", amount: 128825, currency: "USD", description: "аванс" },
    { date: "2026-05-04", amount: 100000, currency: "USD", description: null },
  ],
};

const sub = {
  pay: row.payments[0],
  avr: { date: "2026-03-31", volume: 1200.125, amount: 84087.56, wagons: 17 },
};

const keys = (cols: { key: string }[]) => cols.map((c) => c.key);

describe("выгрузка ДТ-КТ — сокращённый вариант", () => {
  it("повторяет колонки экранной таблицы", () => {
    expect(keys(DTKT_SHORT_COLUMNS)).toEqual([
      "forwarder", "company_group", "year",
      "opening", "payment", "shipped_volume", "shipped_amount",
      "refund", "fines", "surcharge", "ogem", "saldo",
    ]);
  });

  it("не содержит колонок детализации", () => {
    for (const k of ["pay_date", "pay_currency", "avr_date", "avr_wagons", "pay_note"]) {
      expect(keys(DTKT_SHORT_COLUMNS)).not.toContain(k);
    }
  });

  it("под-строк не рисует — читателей под-строк нет", () => {
    expect(DTKT_SHORT_COLUMNS.every((c) => c.readSub === undefined)).toBe(true);
  });
});

describe("выгрузка ДТ-КТ — детальный вариант", () => {
  it("добавляет даты оплат и АВР к тем же колонкам", () => {
    expect(keys(DTKT_DETAIL_COLUMNS)).toEqual([
      "forwarder", "company_group", "year",
      "opening", "pay_date", "payment", "pay_currency",
      "avr_date", "shipped_volume", "shipped_amount", "avr_wagons",
      "refund", "fines", "surcharge", "ogem", "saldo", "pay_note",
    ]);
  });

  it("детализация оплат: дата, сумма, валюта, назначение", () => {
    const by = (k: string) => DTKT_DETAIL_COLUMNS.find((c) => c.key === k)!;
    expect(by("pay_date").readSub!(row, sub)).toEqual(new Date("2026-03-12"));
    expect(by("payment").readSub!(row, sub)).toBe(128825);
    expect(by("pay_currency").readSub!(row, sub)).toBe("USD");
    expect(by("pay_note").readSub!(row, sub)).toBe("аванс");
  });

  it("детализация АВР: дата, тонны, сумма и число вагонов в сутках", () => {
    const by = (k: string) => DTKT_DETAIL_COLUMNS.find((c) => c.key === k)!;
    expect(by("avr_date").readSub!(row, sub)).toEqual(new Date("2026-03-31"));
    expect(by("shipped_volume").readSub!(row, sub)).toBe(1200.125);
    expect(by("shipped_amount").readSub!(row, sub)).toBe(84087.56);
    expect(by("avr_wagons").readSub!(row, sub)).toBe(17);
  });

  it("колонки детализации в главной строке пустые — там итоги записи", () => {
    for (const k of ["pay_date", "pay_currency", "avr_date", "avr_wagons", "pay_note"]) {
      expect(DTKT_DETAIL_COLUMNS.find((c) => c.key === k)!.read(row)).toBeNull();
    }
  });
});

describe("выгрузка ДТ-КТ — величины и знак", () => {
  it("сальдо печатается как есть, без пересчёта в экспорте", () => {
    for (const cols of [DTKT_SHORT_COLUMNS, DTKT_DETAIL_COLUMNS]) {
      expect(cols.find((c) => c.key === "saldo")!.read(row)).toBe(-35137.64);
    }
  });

  it("«Сальдо 1 янв.» отдаётся со своим знаком", () => {
    expect(DTKT_SHORT_COLUMNS.find((c) => c.key === "opening")!.read(row)).toBe(-32340.2);
  });

  it("в «Итого» попадают деньги и тонны, но не год", () => {
    const totals = DTKT_SHORT_COLUMNS.filter((c) => c.total).map((c) => c.key);
    expect(totals).toEqual([
      "opening", "payment", "shipped_volume", "shipped_amount",
      "refund", "fines", "surcharge", "ogem", "saldo",
    ]);
    expect(totals).not.toContain("year");
  });

  it("даты уходят в Excel объектом Date, а не строкой", () => {
    expect(excelDate("2026-03-12")).toBeInstanceOf(Date);
    expect(excelDate(null)).toBeNull();
    expect(excelDate("не дата")).toBeNull();
  });
});

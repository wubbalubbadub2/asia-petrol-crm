import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  buildDtKtWorkbook,
  DTKT_SHORT_COLUMNS,
  DTKT_DETAIL_COLUMNS,
  type DtKtExportRow,
  type DtKtAvrRow,
} from "@/lib/exports/dtkt-excel";

// Проверка на СОБРАННОЙ книге, а не на массиве описаний колонок:
// dtkt-excel-columns стережёт порядок колонок, а этот файл — что в
// ячейках стоит то же, что на экране, и что под-строки детального
// варианта сходятся с главной строкой до копейки.

// PTC - Operator / TENGRI WAY — запись, на которой бухгалтерия сверяла
// сальдо: −32 340,20 + 204 087,56 + 21 940,00 − 228 825,00 = −35 137,64.
const tengri: DtKtExportRow = {
  forwarderId: "fw-ptc",
  companyGroupId: "cg-tengri",
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
    { date: "2026-05-04", amount: 100000, currency: "USD", description: null },
    { date: "2026-03-12", amount: 128825, currency: "USD", description: "аванс" },
  ],
};

// Вторая пара — с положительным сальдо и одной оплатой против трёх АВР.
const arka: DtKtExportRow = {
  forwarderId: "fw-ptc",
  companyGroupId: "cg-arka",
  forwarder: "PTC - Operator",
  companyGroup: "Арқа Проф",
  year: 2026,
  openingBalance: -18519154,
  payment: 1000,
  shippedVolume: 10,
  shippedAmount: 5000,
  refund: 100,
  fines: 200,
  surcharge: null,
  ogem: 300,
  saldo: -18514554,
  payments: [{ date: "2026-02-01", amount: 1000, currency: "KZT", description: "по акту" }],
};

const avr: Map<string, DtKtAvrRow[]> = new Map([
  ["fw-ptc::cg-tengri", [
    { date: "2026-02-28", volume: 1200.125, amount: 84087.56, wagons: 17 },
    { date: "2026-04-30", volume: 2000.375, amount: 120000, wagons: 29 },
  ]],
  ["fw-ptc::cg-arka", [
    { date: "2026-01-10", volume: 4, amount: 2000, wagons: 1 },
    { date: "2026-01-20", volume: 3, amount: 1500, wagons: 1 },
    { date: "2026-01-30", volume: 3, amount: 1500, wagons: 1 },
  ]],
]);

const rows = [tengri, arka];
const idx = (cols: { key: string }[], key: string) => cols.findIndex((c) => c.key === key) + 1;

function sheet(variant: "short" | "detail") {
  const wb = buildDtKtWorkbook(ExcelJS, rows, { year: 2026, variant }, avr);
  return wb.getWorksheet(1)!;
}

describe("книга ДТ-КТ — сокращённый вариант", () => {
  const ws = sheet("short");
  const c = (key: string) => idx(DTKT_SHORT_COLUMNS, key);

  it("шапка стоит во второй строке, первая занята заголовком со знаком", () => {
    expect(String(ws.getCell(1, 1).value)).toContain("плюс — мы должны экспедитору");
    expect(ws.getRow(2).getCell(c("saldo")).value).toBe("Сальдо");
  });

  it("под-строк нет: строка на запись плюс «Итого»", () => {
    // 2 служебные + 2 записи + итог
    expect(ws.rowCount).toBe(5);
    expect(ws.getCell(5, 1).value).toBe("Итого");
  });

  it("печатает сальдо страницы, а не пересчитывает его", () => {
    expect(ws.getRow(3).getCell(c("saldo")).value).toBe(-35137.64);
    expect(ws.getRow(3).getCell(c("opening")).value).toBe(-32340.2);
  });

  it("минус выделен красным — как в таблице на экране", () => {
    const font = ws.getRow(3).getCell(c("saldo")).font;
    expect(font?.color?.argb).toBe("FFB91C1C");
    expect(font?.bold).toBe(true);
  });

  it("«Итого» складывает только главные строки", () => {
    expect(ws.getCell(5, c("saldo")).value).toBeCloseTo(-35137.64 + -18514554, 2);
    expect(ws.getCell(5, c("payment")).value).toBeCloseTo(228825 + 1000, 2);
    expect(ws.getCell(5, c("shipped_volume")).value).toBeCloseTo(3200.5 + 10, 3);
    // Год не деньги — не суммируется.
    expect(ws.getCell(5, c("year")).value).toBeNull();
  });

  it("автофильтр стоит на строке шапки", () => {
    expect(ws.autoFilter).toEqual({
      from: { row: 2, column: 1 },
      to: { row: 2, column: DTKT_SHORT_COLUMNS.length },
    });
  });
});

describe("книга ДТ-КТ — детальный вариант", () => {
  const ws = sheet("detail");
  const c = (key: string) => idx(DTKT_DETAIL_COLUMNS, key);

  it("под-строк ровно столько, сколько в длинном из двух списков", () => {
    // TENGRI: 2 оплаты / 2 АВР → 2; Арқа: 1 оплата / 3 АВР → 3
    expect(ws.rowCount).toBe(2 + (1 + 2) + (1 + 3) + 1);
  });

  it("под-строки свёрнуты в группу, главная строка остаётся на виду", () => {
    expect(ws.getRow(3).outlineLevel).toBe(0);
    expect(ws.getRow(4).outlineLevel).toBe(1);
    expect(ws.getRow(5).outlineLevel).toBe(1);
    expect(ws.getRow(6).outlineLevel).toBe(0);
  });

  it("кнопка «свернуть» стоит на самой записи, а не на следующей", () => {
    // Без summaryBelow=false Excel считает итог нижним и вешает кнопку
    // группы на следующую главную строку.
    expect((ws.properties as { outlineProperties?: { summaryBelow?: boolean } }).outlineProperties)
      .toEqual({ summaryBelow: false, summaryRight: false });
  });

  it("оплаты идут по возрастанию даты, а не в порядке прилёта из базы", () => {
    expect(ws.getRow(4).getCell(c("pay_date")).value).toEqual(new Date("2026-03-12T00:00:00Z"));
    expect(ws.getRow(5).getCell(c("pay_date")).value).toEqual(new Date("2026-05-04T00:00:00Z"));
  });

  it("даты — настоящие Date в UTC-полночь: иначе Excel не фильтрует по месяцу", () => {
    const d = ws.getRow(4).getCell(c("avr_date")).value as Date;
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(ws.getRow(4).getCell(c("avr_date")).numFmt).toBe("dd.mm.yy");
  });

  it("сумма оплат в под-строках сходится с колонкой «Оплата» главной строки", () => {
    const main = ws.getRow(3).getCell(c("payment")).value as number;
    const subs = [4, 5].map((r) => (ws.getRow(r).getCell(c("payment")).value as number) ?? 0);
    expect(subs.reduce((a, b) => a + b, 0)).toBeCloseTo(main, 2);
  });

  it("АВР в под-строках сходятся с «Отгр. сумма» и «Отгр. тонн» главной строки", () => {
    const rowsOf = (main: number, subs: number[]) => ({
      amount: subs.reduce((a, r) => a + ((ws.getRow(r).getCell(c("shipped_amount")).value as number) ?? 0), 0),
      volume: subs.reduce((a, r) => a + ((ws.getRow(r).getCell(c("shipped_volume")).value as number) ?? 0), 0),
      mainAmount: ws.getRow(main).getCell(c("shipped_amount")).value as number,
      mainVolume: ws.getRow(main).getCell(c("shipped_volume")).value as number,
    });
    const t = rowsOf(3, [4, 5]);
    expect(t.amount).toBeCloseTo(t.mainAmount, 2);
    expect(t.volume).toBeCloseTo(t.mainVolume, 3);
    const a = rowsOf(6, [7, 8, 9]);
    expect(a.amount).toBeCloseTo(a.mainAmount, 2);
    expect(a.volume).toBeCloseTo(a.mainVolume, 3);
  });

  it("короткий список добивается пустыми ячейками, а не сдвигом второго", () => {
    // У Арқа одна оплата против трёх АВР: во 2-й и 3-й под-строке
    // оплата пуста, а АВР на месте.
    expect(ws.getRow(7).getCell(c("pay_date")).value).not.toBeNull();
    expect(ws.getRow(8).getCell(c("pay_date")).value).toBeNull();
    expect(ws.getRow(8).getCell(c("avr_date")).value).not.toBeNull();
    expect(ws.getRow(9).getCell(c("avr_wagons")).value).toBe(1);
  });

  it("«Итого» не удваивается под-строками", () => {
    const total = ws.rowCount;
    expect(ws.getCell(total, 1).value).toBe("Итого");
    expect(ws.getCell(total, c("payment")).value).toBeCloseTo(228825 + 1000, 2);
    expect(ws.getCell(total, c("shipped_amount")).value).toBeCloseTo(204087.56 + 5000, 2);
  });

  it("в главной строке колонок детализации нет — только в под-строках", () => {
    for (const key of ["pay_date", "pay_currency", "avr_date", "avr_wagons", "pay_note"]) {
      expect(ws.getRow(3).getCell(c(key)).value).toBeNull();
    }
    expect(ws.getRow(4).getCell(c("pay_currency")).value).toBe("USD");
    expect(ws.getRow(4).getCell(c("pay_note")).value).toBe("аванс");
  });
});

describe("книга ДТ-КТ — пустая выборка", () => {
  it("отдаёт шапку без строки «Итого», а не падает", () => {
    const wb = buildDtKtWorkbook(ExcelJS, [], { year: 2026, variant: "detail" }, new Map());
    const ws = wb.getWorksheet(1)!;
    expect(ws.rowCount).toBe(2);
    expect(ws.getCell(2, 1).value).toBe("Экспедитор");
  });
});

// Клиент 2026-09-04: Excel открывал dtkt-saldo-short-*.xlsx только через
// «восстановить». Причина — exceljs 4.4 пишет в <sheetPr> сначала
// <pageSetUpPr fitToPage>, потом <outlinePr>, а схема OOXML требует
// обратный порядок; Excel считает файл битым. Проверка на записанном
// файле: модель книги порядка узлов не показывает.
describe("книга ДТ-КТ — файл открывается в Excel без восстановления", () => {
  it.each(["short", "detail"] as const)("%s: в <sheetPr> нет pageSetUpPr перед outlinePr", async (variant) => {
    const JSZip = (await import("jszip")).default;
    const wb = buildDtKtWorkbook(ExcelJS, rows, { year: 2026, variant }, avr);
    const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
    const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const sheetPr = xml.match(/<sheetPr>(.*?)<\/sheetPr>/)?.[1] ?? "";
    expect(sheetPr).toContain("<outlinePr");
    expect(sheetPr).not.toMatch(/<pageSetUpPr[^>]*\/>.*<outlinePr/);
  });
});

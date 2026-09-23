/**
 * ДТ-КТ: выгрузка обязана показывать то же, что экран.
 *
 * Клиент 2026-09-17: «ДТ-КТ логистика при выгрузке в эксель неправильно
 * формулу считает; выгрузки не должны отличаться от того, что видно в UI».
 *
 * Причина была не в формуле сальдо (она одна на экран и на файл —
 * `computeDtKtSaldo`), а в ДАННЫХ: экран и детальная выгрузка читали
 * `shipment_registry` двумя РАЗНЫМИ постраничными запросами, и оба без
 * полного порядка строк. Теперь строки читаются один раз, а экран и
 * выгрузка — два свёртывателя поверх одного массива. Тест закрепляет
 * именно это: сумма под-строк АВР в книге равна «Отгр. сумме» главной
 * строки, а та равна тому, что считает экран.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  sumRegistryByPair,
  avrByPair,
  dtKtPairKey,
  type DtKtRegistryRow,
} from "@/lib/dtkt/registry-sums";
import { computeDtKtSaldo } from "@/lib/dtkt/saldo";
import { buildDtKtWorkbook, DTKT_DETAIL_COLUMNS, type DtKtExportRow } from "@/lib/exports/dtkt-excel";

// Реестр: одна пара «экспедитор + плательщик ЖД» с тремя отгрузками в
// двух датах, вторая пара без плательщика ЖД (в базе такое бывает),
// и чужая строка без экспедитора.
const registry: DtKtRegistryRow[] = [
  { id: "r1", date: "2026-02-28", forwarder_id: "fw-1", company_group_id: "cg-1", shipment_volume: 60.5, shipped_tonnage_amount: 30250 },
  { id: "r2", date: "2026-02-28", forwarder_id: "fw-1", company_group_id: "cg-1", shipment_volume: 59.5, shipped_tonnage_amount: 29750 },
  { id: "r3", date: "2026-03-15", forwarder_id: "fw-1", company_group_id: "cg-1", shipment_volume: 70, shipped_tonnage_amount: 35000 },
  { id: "r4", date: "2026-03-15", forwarder_id: "fw-1", company_group_id: null, shipment_volume: 12, shipped_tonnage_amount: 6000 },
  { id: "r5", date: "2026-03-16", forwarder_id: null, company_group_id: "cg-1", shipment_volume: 99, shipped_tonnage_amount: 99999 },
];

describe("свёртка строк реестра", () => {
  const sums = sumRegistryByPair(registry);
  const avr = avrByPair(registry);

  it("итоги пары и АВР считаются из одних строк и сходятся до копейки", () => {
    for (const [key, pair] of sums) {
      const days = avr.get(key) ?? [];
      const amount = days.reduce((s, d) => s + d.amount, 0);
      const volume = days.reduce((s, d) => s + d.volume, 0);
      expect(amount).toBeCloseTo(pair.total_amount, 6);
      expect(volume).toBeCloseTo(pair.total_volume, 6);
    }
  });

  it("отгрузки одних суток складываются в одну строку АВР с числом вагонов", () => {
    const days = avr.get(dtKtPairKey("fw-1", "cg-1"))!;
    expect(days.map((d) => d.date)).toEqual(["2026-02-28", "2026-03-15"]);
    expect(days[0].wagons).toBe(2);
    expect(days[0].amount).toBe(60000);
  });

  it("запись без плательщика ЖД не теряет свои отгрузки", () => {
    // Раньше экран считал ключ как `fw::`, а выгрузка — как `fw::null`,
    // и под-строки такой записи молча исчезали.
    expect(sums.get(dtKtPairKey("fw-1", null))?.total_amount).toBe(6000);
    expect(avr.get(dtKtPairKey("fw-1", null))?.length).toBe(1);
  });

  it("строка без экспедитора не принадлежит ни одной записи ДТ-КТ", () => {
    for (const key of sums.keys()) expect(key.startsWith("::")).toBe(false);
    for (const key of avr.keys()) expect(key.startsWith("::")).toBe(false);
  });
});

describe("книга ДТ-КТ повторяет цифры экрана", () => {
  const sums = sumRegistryByPair(registry);
  const pair = sums.get(dtKtPairKey("fw-1", "cg-1"))!;

  // Ровно то, что делает страница: сальдо из общей формулы, отгрузка —
  // из той же свёртки, что уйдёт в под-строки.
  const record = { opening_balance: -1000, refund: 0, fines: 500, surcharge_preliminary: 0, ogem: 0 };
  const payment = 40000;
  const screenSaldo = computeDtKtSaldo(record, pair.total_amount, payment);

  const row: DtKtExportRow = {
    forwarderId: "fw-1",
    companyGroupId: "cg-1",
    forwarder: "Экспедитор 1",
    companyGroup: "Группа 1",
    year: 2026,
    openingBalance: record.opening_balance,
    payment,
    shippedVolume: pair.total_volume,
    shippedAmount: pair.total_amount,
    refund: record.refund,
    fines: record.fines,
    surcharge: record.surcharge_preliminary,
    ogem: record.ogem,
    saldo: screenSaldo,
    payments: [{ date: "2026-02-01", amount: 40000, currency: "KZT", description: null }],
  };

  const wb = buildDtKtWorkbook(ExcelJS, [row], { year: 2026, variant: "detail" }, avrByPair(registry));
  const ws = wb.getWorksheet(1)!;
  const c = (key: string) => DTKT_DETAIL_COLUMNS.findIndex((x) => x.key === key) + 1;

  it("главная строка печатает сальдо экрана", () => {
    expect(ws.getRow(3).getCell(c("saldo")).value).toBe(screenSaldo);
    expect(screenSaldo).toBe(-1000 + 0 + 95000 + 500 + 0 + 0 - 40000);
  });

  it("под-строки АВР в сумме дают «Отгр. сумму» главной строки", () => {
    let amount = 0;
    let volume = 0;
    for (let r = 4; r <= ws.rowCount; r++) {
      if (ws.getCell(r, 1).value === "Итого") break;
      const a = ws.getRow(r).getCell(c("shipped_amount")).value;
      const v = ws.getRow(r).getCell(c("shipped_volume")).value;
      if (typeof a === "number") amount += a;
      if (typeof v === "number") volume += v;
    }
    expect(amount).toBeCloseTo(pair.total_amount, 6);
    expect(volume).toBeCloseTo(pair.total_volume, 6);
  });
});

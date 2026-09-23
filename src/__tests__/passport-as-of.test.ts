/**
 * Паспорт на дату (клиент 2026-09-17).
 *
 * Пересчёт живёт в Postgres (RPC passport_snapshot_as_of, миграция
 * 00160) и закрыт БД-тестом 19_passport_as_of.test.sql. На стороне
 * фронта проверять нужно ровно три вещи, в которых легко ошибиться
 * молча:
 *   • срез накрывает КАЖДУЮ денежную колонку паспорта — иначе часть
 *     цифр в файле «на 31.08» останется сегодняшней;
 *   • ничего, кроме среза, не трогается — цены и объёмы договора
 *     остаются как есть, это согласованное поведение;
 *   • шапка и имя файла говорят, что выгрузка историческая.
 */
import { describe, it, expect } from "vitest";
import {
  PASSPORT_COLUMNS,
  passportFileName,
  passportTitle,
  type ExportContext,
} from "@/lib/exports/passport-excel";
import {
  SNAPSHOT_KEYS,
  applyPassportSnapshot,
  type PassportSnapshotRow,
} from "@/lib/exports/passport-as-of";
import type { Deal } from "@/lib/hooks/use-deals";

// Сегодняшняя сделка: все rollup'ы заполнены «свежими» числами.
const today = {
  id: "deal-1",
  deal_code: "KZ/26/001",
  deal_type: "KZ",
  month: "август",
  supplier_contracted_volume: 1000,
  supplier_price: 500,
  buyer_ordered_volume: 900,
  supplier_shipped_volume: 800,
  supplier_shipped_amount: 400000,
  supplier_payment_gross: 300000,
  supplier_refund_total: 0,
  supplier_offset_total: -1000,
  supplier_payment: 299000,
  supplier_railway_amount: 5000,
  additional_expenses_amount: 2000,
  supplier_balance: 101000,
  buyer_shipped_volume: 790,
  buyer_shipped_amount: 430000,
  buyer_payment_gross: 200000,
  buyer_refund_total: 0,
  buyer_offset_total: 0,
  buyer_payment: 200000,
  buyer_debt: -230000,
  actual_shipped_volume: 790,
  invoice_amount: 15000,
  actual_tariff: 18.75,
  shipper_actual_tariff: 2.5,
} as unknown as Deal;

// Срез на дату: те же поля, но вдвое меньше — половина событий ещё не
// случилась. deal_id совпадает с id сделки.
const snapshotRow = {
  deal_id: "deal-1",
  supplier_shipped_volume: 400,
  supplier_shipped_amount: 200000,
  supplier_payment_gross: 100000,
  supplier_refund_total: 0,
  supplier_offset_total: -1000,
  supplier_payment: 99000,
  supplier_railway_amount: 2500,
  additional_expenses_amount: 1000,
  supplier_balance: 101000, // 200 000 − 99 000 + 0 (галочек «в цене» нет)
  buyer_shipped_volume: 390,
  buyer_shipped_amount: 210000,
  buyer_payment_gross: 0,
  buyer_refund_total: 0,
  buyer_offset_total: 0,
  buyer_payment: 0,
  buyer_debt: -210000,
  actual_shipped_volume: 390,
  invoice_amount: 7000,
  actual_tariff: 17.5,
  shipper_actual_tariff: 2.5,
} as PassportSnapshotRow;

describe("срез накрывает все денежные колонки паспорта", () => {
  // Колонки, которые читают поле сделки напрямую (d) => d.<поле>.
  // Из исходника колонки достаём имя поля — так тест поймает НОВУЮ
  // денежную колонку, добавленную в паспорт мимо среза.
  const directField = (read: (d: never) => unknown): string | null => {
    const m = /=>\s*(?:\(\s*)?\w+\.(\w+)/.exec(read.toString());
    return m ? m[1] : null;
  };

  // Поля сделки, у которых истории нет и срез их не меняет: договорные
  // и справочные значения (см. комментарий к миграции 00160).
  const STATIC_OK = new Set([
    "deal_code", "month", "sulfur_percent", "supplier_contract", "buyer_contract",
    "supplier_delivery_basis", "buyer_delivery_basis",
    "supplier_contracted_volume", "supplier_contracted_amount",
    "buyer_contracted_volume", "buyer_contracted_amount",
    "supplier_quotation", "buyer_quotation", "supplier_discount", "buyer_discount",
    "supplier_price", "buyer_price", "buyer_ordered_volume",
    "preliminary_tonnage", "preliminary_amount", "planned_tariff",
  ]);

  it.each(
    (PASSPORT_COLUMNS as unknown as { key: string; numFmt?: string; read: (d: never) => unknown }[])
      .filter((c) => c.numFmt)
      .map((c) => [c.key, c.read] as const),
  )("%s", (_key, read) => {
    const field = directField(read);
    if (!field) return; // вычисляемая колонка (остаток, средняя цена)
    const covered = (SNAPSHOT_KEYS as readonly string[]).includes(field) || STATIC_OK.has(field);
    expect(covered, `поле ${field} не покрыто срезом и не помечено как договорное`).toBe(true);
  });
});

describe("наложение среза на строки паспорта", () => {
  const { deals, missing } = applyPassportSnapshot([today], new Map([["deal-1", snapshotRow]]));
  const row = deals[0];

  it("подменяет rollup'ы значениями среза", () => {
    expect(missing).toEqual([]);
    expect(row.supplier_shipped_volume).toBe(400);
    expect(row.supplier_shipped_amount).toBe(200000);
    expect(row.supplier_payment_gross).toBe(100000);
    expect(row.buyer_payment_gross).toBe(0);
    expect(row.buyer_debt).toBe(-210000);
    expect(row.invoice_amount).toBe(7000);
    expect(row.actual_tariff).toBe(17.5);
  });

  it("не трогает договорные поля", () => {
    expect(row.supplier_contracted_volume).toBe(1000);
    expect(row.supplier_price).toBe(500);
    expect(row.buyer_ordered_volume).toBe(900);
    expect(row.deal_code).toBe("KZ/26/001");
  });

  it("колонки выгрузки печатают цифры среза", () => {
    const col = (key: string) => {
      const c = (PASSPORT_COLUMNS as unknown as { key: string; read: (d: Deal) => unknown }[]).find((x) => x.key === key);
      if (!c) throw new Error(`колонка ${key} потерялась`);
      return c;
    };
    expect(col("supplier_payment").read(row)).toBe(100000);
    expect(col("supplier_offset").read(row)).toBe(-1000);
    expect(col("buyer_shipped_amount").read(row)).toBe(210000);
    // Остаток считается на лету: заявлено (договорное) − отгружено (срез).
    expect(col("buyer_remainder").read(row)).toBe(900 - 390);
  });

  it("сделку без среза в файл не пускает", () => {
    const other = { ...today, id: "deal-2" } as Deal;
    const res = applyPassportSnapshot([today, other], new Map([["deal-1", snapshotRow]]));
    expect(res.deals.map((d) => d.id)).toEqual(["deal-1"]);
    expect(res.missing).toEqual(["deal-2"]);
  });

  it("не мутирует исходную строку", () => {
    expect(today.supplier_shipped_volume).toBe(800);
  });
});

describe("шапка и имя файла", () => {
  const base: ExportContext = { dealType: "KZ", year: 2026 };

  it("обычная выгрузка не изменилась", () => {
    expect(passportTitle(base, "Паспорт KZ", 25)).toBe("Паспорт KZ · 2026  ·  25 сделок");
    expect(passportFileName(base)).toMatch(/^passport-kz-2026-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("выгрузка на дату подписана датой среза", () => {
    const ctx: ExportContext = { ...base, asOf: "2026-08-31" };
    const title = passportTitle(ctx, "Паспорт KZ", 25);
    expect(title).toContain("Паспорт KZ на 31.08.2026");
    expect(title).toContain("25 сделок");
    // Оговорка про текущие цены обязана быть в файле, а не только в диалоге.
    expect(title).toContain("цены и объёмы договора — текущие");
    expect(passportFileName(ctx)).toBe("passport-kz-2026-as-of-2026-08-31.xlsx");
  });
});

import { describe, it, expect } from "vitest";
import { PASSPORT_COLUMNS } from "@/lib/exports/passport-excel";
import { DETAIL_COLUMNS } from "@/lib/exports/passport-detail-excel";

/**
 * Клиент 2026-08-05: «нужно вывести в таблицу два поле: Оплата,
 * Возврат/Перерасчет». В выгрузке паспорта «Оплата» — БРУТТО
 * (payment_type='payment'), возвраты и перезачёты идут отдельной
 * колонкой положительным числом (миграция 00137).
 */
type AnyCol = { key: string; header: string; read?: (d: never) => unknown };

const COLS = PASSPORT_COLUMNS as unknown as AnyCol[];

describe("Паспорт (Excel): оплата отдельно от возвратов", () => {
  it("колонка возвратов есть по обеим сторонам", () => {
    for (const key of ["supplier_refund", "buyer_refund"]) {
      const col = COLS.find((c) => c.key === key);
      expect(col, `нет колонки ${key}`).toBeDefined();
      expect(col!.header).toBe("Возврат/Перезачет");
    }
  });

  it("возврат стоит сразу после оплаты своей стороны", () => {
    for (const [pay, refund] of [
      ["supplier_payment", "supplier_refund"],
      ["buyer_payment", "buyer_refund"],
    ]) {
      const i = COLS.findIndex((c) => c.key === pay);
      const j = COLS.findIndex((c) => c.key === refund);
      expect(j).toBe(i + 1);
    }
  });

  it("«Оплата» читает брутто, а не нетто", () => {
    const sup = COLS.find((c) => c.key === "supplier_payment")!;
    const buy = COLS.find((c) => c.key === "buyer_payment")!;
    expect(String(sup.read)).toContain("supplier_payment_gross");
    expect(String(buy.read)).toContain("buyer_payment_gross");
  });

  it("«Возврат/Перезачет» читает свою rollup-колонку", () => {
    expect(String(COLS.find((c) => c.key === "supplier_refund")!.read)).toContain("supplier_refund_total");
    expect(String(COLS.find((c) => c.key === "buyer_refund")!.read)).toContain("buyer_refund_total");
  });
});

const DETAIL = DETAIL_COLUMNS as unknown as Array<{
  key: string; header: string; read?: (d: never) => unknown; readShip?: (d: never, s: never) => unknown;
}>;

describe("Паспорт детальный (Excel): оплата отдельно от возвратов", () => {
  it("колонка возвратов есть по обеим сторонам и стоит после оплаты", () => {
    for (const [pay, refund] of [
      ["supplier_payment", "supplier_refund"],
      ["buyer_payment", "buyer_refund"],
    ]) {
      const i = DETAIL.findIndex((c) => c.key === pay);
      const j = DETAIL.findIndex((c) => c.key === refund);
      expect(j, `нет колонки ${refund}`).toBeGreaterThan(-1);
      expect(j).toBe(i + 1);
      expect(DETAIL[j].header).toBe("Возврат/Перезачет");
    }
  });

  it("под-строки маршрутизируются по типу платежа, а не по знаку", () => {
    for (const key of ["supplier_payment", "supplier_refund", "buyer_payment", "buyer_refund"]) {
      expect(String(DETAIL.find((c) => c.key === key)!.readShip)).toContain("isRefundKind");
    }
  });
});

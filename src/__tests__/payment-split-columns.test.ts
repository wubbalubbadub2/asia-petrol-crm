import { describe, it, expect } from "vitest";
import { PASSPORT_COLUMNS } from "@/lib/exports/passport-excel";
import { DETAIL_COLUMNS } from "@/lib/exports/passport-detail-excel";

/**
 * Клиент 2026-08-05: «нужно вывести в таблицу два поля: Оплата,
 * Возврат/Перерасчет». Клиент 2026-08-12/13: тип оплаты убран —
 * возврат пишется минусовой оплатой, перезачёт стал взаимозачётом,
 * колонку «Возврат/Перезачет» убрать везде.
 *
 * Поэтому теперь проверяем: «Оплата» по-прежнему брутто, рядом стоит
 * «Взаимозачет», а колонки возвратов нет ни в одной выгрузке.
 */
type AnyCol = { key: string; header: string; read?: (d: never) => unknown };

const COLS = PASSPORT_COLUMNS as unknown as AnyCol[];

describe("Паспорт (Excel): оплата и взаимозачёт", () => {
  it("колонки возвратов больше нет", () => {
    for (const key of ["supplier_refund", "buyer_refund"]) {
      expect(COLS.find((c) => c.key === key), `колонка ${key} должна быть убрана`).toBeUndefined();
    }
    expect(COLS.some((c) => c.header === "Возврат/Перезачет")).toBe(false);
  });

  it("«Взаимозачет» стоит сразу после оплаты своей стороны", () => {
    for (const [pay, offset] of [
      ["supplier_payment", "supplier_offset"],
      ["buyer_payment", "buyer_offset"],
    ]) {
      const i = COLS.findIndex((c) => c.key === pay);
      const j = COLS.findIndex((c) => c.key === offset);
      expect(j, `нет колонки ${offset}`).toBeGreaterThan(-1);
      expect(j).toBe(i + 1);
      expect(COLS[j].header).toBe("Взаимозачет");
    }
  });

  it("«Оплата» читает брутто, а не нетто", () => {
    expect(String(COLS.find((c) => c.key === "supplier_payment")!.read)).toContain("supplier_payment_gross");
    expect(String(COLS.find((c) => c.key === "buyer_payment")!.read)).toContain("buyer_payment_gross");
  });

  it("«Взаимозачет» читает свою rollup-колонку", () => {
    expect(String(COLS.find((c) => c.key === "supplier_offset")!.read)).toContain("supplier_offset_total");
    expect(String(COLS.find((c) => c.key === "buyer_offset")!.read)).toContain("buyer_offset_total");
  });
});

const DETAIL = DETAIL_COLUMNS as unknown as Array<{
  key: string; header: string; read?: (d: never) => unknown; readShip?: (d: never, s: never) => unknown;
}>;

describe("Паспорт детальный (Excel): оплата и взаимозачёт", () => {
  it("колонки возвратов больше нет", () => {
    for (const key of ["supplier_refund", "buyer_refund"]) {
      expect(DETAIL.find((c) => c.key === key), `колонка ${key} должна быть убрана`).toBeUndefined();
    }
    expect(DETAIL.some((c) => c.header === "Возврат/Перезачет")).toBe(false);
  });

  it("«Взаимозачет» стоит сразу после оплаты своей стороны", () => {
    for (const [pay, offset] of [
      ["supplier_payment", "supplier_offset"],
      ["buyer_payment", "buyer_offset"],
    ]) {
      const i = DETAIL.findIndex((c) => c.key === pay);
      const j = DETAIL.findIndex((c) => c.key === offset);
      expect(j, `нет колонки ${offset}`).toBeGreaterThan(-1);
      expect(j).toBe(i + 1);
      expect(DETAIL[j].header).toBe("Взаимозачет");
    }
  });

  it("под-строка взаимозачёта берётся по типу записи, а не по знаку суммы", () => {
    for (const key of ["supplier_offset", "buyer_offset"]) {
      expect(String(DETAIL.find((c) => c.key === key)!.readShip)).toContain('"offset"');
    }
  });
});

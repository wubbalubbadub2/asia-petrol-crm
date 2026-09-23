/**
 * Клиент 2026-09-04: «во всех ценах нужно чтобы после запятой было
 * 3 цифры» — колонки цены за тонну в выгрузках паспорта.
 *
 * Клиент 2026-09-08 распространил правило на все деньги, а 2026-09-22
 * отыграл назад для СУММ: «для котировки, цены и тоннажа оставить 3
 * знака после запятой, а всем суммам кроме цен и объёма поставить 2».
 * Поэтому котировки и скидки здесь по-прежнему с 3 знаками (они входят
 * в формулу цены), а суммы — с 2. Общий инвариант по всем выгрузкам
 * держит money-decimals.test.ts.
 */
import { describe, it, expect } from "vitest";
import { PASSPORT_COLUMNS } from "@/lib/exports/passport-excel";
import { DETAIL_COLUMNS } from "@/lib/exports/passport-detail-excel";

type Col = { key: string; header: string; numFmt?: string };

const variants: [string, readonly Col[]][] = [
  ["краткий паспорт", PASSPORT_COLUMNS as unknown as Col[]],
  ["детальный паспорт", DETAIL_COLUMNS as unknown as Col[]],
];

const PRICE_KEY = /(^|_)(preliminary_price|final_price|price|avg_price)$/;

describe.each(variants)("%s: цена за тонну с 3 знаками", (_name, cols) => {
  const priceCols = cols.filter((c) => PRICE_KEY.test(c.key));

  it("колонки цены найдены", () => {
    expect(priceCols.map((c) => c.key)).toEqual(expect.arrayContaining(["supplier_price", "buyer_price"]));
  });

  it.each(priceCols.map((c) => [c.key, c] as const))("%s → #,##0.000", (_key, col) => {
    expect(col.numFmt).toBe("#,##0.000");
  });

  it("котировки и скидки — с 3 знаками (входят в формулу цены)", () => {
    for (const key of ["supplier_quotation", "supplier_discount"]) {
      const col = cols.find((c) => c.key === key);
      expect(col, key).toBeDefined();
      expect(col!.numFmt, key).toMatch(/^#,##0\.000(;|$)/);
    }
  });

  it("суммы — с 2 знаками (клиент 2026-09-22)", () => {
    for (const key of ["supplier_amount", "buyer_amount"]) {
      const col = cols.find((c) => c.key === key);
      expect(col, key).toBeDefined();
      // Суммы идут с красным минусом — важны только знаки после точки.
      expect(col!.numFmt, key).toMatch(/^#,##0\.00(;|$)/);
    }
  });
});

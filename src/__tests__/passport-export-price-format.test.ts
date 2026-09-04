/**
 * Клиент 2026-09-04: «во всех ценах нужно чтобы после запятой было
 * 3 цифры». В выгрузках паспорта это колонки цены за тонну; суммы,
 * котировки, скидки и тарифы остаются с 2 знаками.
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

  it("суммы и котировки остаются с 2 знаками", () => {
    for (const key of ["supplier_amount", "supplier_quotation", "supplier_discount", "buyer_amount"]) {
      const col = cols.find((c) => c.key === key);
      expect(col, key).toBeDefined();
      // Суммы идут с красным минусом, котировки без — важны только 2 знака.
      expect(col!.numFmt, key).toMatch(/^#,##0\.00(;|$)/);
    }
  });
});

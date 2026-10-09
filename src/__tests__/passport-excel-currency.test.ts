// @vitest-environment node
/**
 * Валюта сторон в обеих выгрузках паспорта.
 *
 * Клиент 2026-10-09: «При выгрузке паспорта в Эксель нужно что бы
 * отображалась валюта». Деньги в выгрузке без валюты читаются неверно:
 * у поставщика KZT, у покупателя USD, у логистов — третья. Тест держит
 * наличие, блок и место колонок «Валюта» — сразу после «Базис» у
 * поставщика и покупателя и после плательщика жд тарифа у логистов.
 */
import { describe, it, expect } from "vitest";
import { passportColumns } from "@/lib/exports/passport-excel";
import { detailColumns } from "@/lib/exports/passport-detail-excel";

type Col = { key: string; header: string; band?: string; read: (d: never) => unknown; readShip?: (d: never, s: never) => unknown };

const variants: [string, readonly Col[]][] = [
  ["краткий паспорт", passportColumns("KG") as unknown as Col[]],
  ["детальный паспорт", detailColumns("KG") as unknown as Col[]],
];

const deal = { supplier_currency: "KZT", buyer_currency: "USD", logistics_currency: "RUB" } as never;
const blank = { supplier_currency: "", buyer_currency: null, logistics_currency: undefined } as never;

describe.each(variants)("%s: колонки «Валюта»", (_name, cols) => {
  const at = (key: string) => cols.findIndex((c) => c.key === key);
  const col = (key: string) => {
    const c = cols.find((x) => x.key === key);
    if (!c) throw new Error(`колонка ${key} потерялась`);
    return c;
  };

  it("есть у каждой стороны, в своём блоке", () => {
    for (const [key, band] of [
      ["supplier_currency", "supplier"],
      ["buyer_currency", "buyer"],
      ["logistics_currency", "logistics"],
    ] as const) {
      expect(col(key).header).toBe("Валюта");
      expect(col(key).band).toBe(band);
    }
  });

  it("стоят сразу после «Базис» и после плательщика жд тарифа", () => {
    expect(at("supplier_currency")).toBe(at("supplier_basis") + 1);
    expect(at("buyer_currency")).toBe(at("buyer_basis") + 1);
    expect(at("logistics_currency")).toBe(at("logistics_company_group") + 1);
  });

  it("читают валюту стороны сделки", () => {
    expect(col("supplier_currency").read(deal)).toBe("KZT");
    expect(col("buyer_currency").read(deal)).toBe("USD");
    expect(col("logistics_currency").read(deal)).toBe("RUB");
  });

  it("пустая валюта — пустая ячейка, а не null", () => {
    expect(col("supplier_currency").read(blank)).toBe("");
    expect(col("buyer_currency").read(blank)).toBe("");
    expect(col("logistics_currency").read(blank)).toBe("");
  });
});

describe("детальный паспорт: под-строки показывают ту же валюту", () => {
  const cols = detailColumns("KG") as unknown as Col[];
  const col = (key: string) => {
    const c = cols.find((x) => x.key === key);
    if (!c) throw new Error(`колонка ${key} потерялась`);
    return c;
  };
  const sub = { ship: null } as never;

  it("валюта под-строки = валюта стороны сделки", () => {
    expect(col("supplier_currency").readShip!(deal, sub)).toBe("KZT");
    expect(col("buyer_currency").readShip!(deal, sub)).toBe("USD");
    expect(col("logistics_currency").readShip!(deal, sub)).toBe("RUB");
  });
});

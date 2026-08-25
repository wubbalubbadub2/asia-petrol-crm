/**
 * Суммы 2 и 3 в выгрузках паспорта.
 *
 * Клиент 2026-08-15 расписал три суммы и чьи они: «Сумма 1 — это раздел
 * логистов, сумма 2,3 менеджер, должны быть отображены со стороны
 * поставщика». На экране это закреплено passport-column-order.test.ts, а
 * в выгрузках — не было: 25.08 клиент не нашёл «Сумма ЖД (поставщик)» и
 * «Сумма грузоотправления» в детальном паспорте КЗ. В кратком они были,
 * но висели в конце блока «Логистика», то есть порядок расходился с
 * экраном.
 *
 * Тест держит и наличие, и место, и блок — в обеих выгрузках сразу.
 */
import { describe, it, expect } from "vitest";
import { PASSPORT_COLUMNS } from "@/lib/exports/passport-excel";
import { DETAIL_COLUMNS } from "@/lib/exports/passport-detail-excel";

type Col = { key: string; header: string; band?: string; read: (d: never) => unknown; readShip?: (d: never, s: never) => unknown };

const variants: [string, readonly Col[]][] = [
  ["краткий паспорт", PASSPORT_COLUMNS as unknown as Col[]],
  ["детальный паспорт", DETAIL_COLUMNS as unknown as Col[]],
];

describe.each(variants)("%s: суммы 2 и 3", (_name, cols) => {
  const at = (key: string) => cols.findIndex((c) => c.key === key);
  const col = (key: string) => {
    const c = cols.find((x) => x.key === key);
    if (!c) throw new Error(`колонка ${key} потерялась`);
    return c;
  };

  it("обе колонки на месте", () => {
    expect(col("supplier_railway_amount").header).toBe("Сумма ЖД (поставщик)");
    expect(col("additional_expenses_amount").header).toBe("Сумма грузоотправления");
  });

  it("стоят со стороны поставщика, а не у логистов", () => {
    expect(col("supplier_railway_amount").band).toBe("supplier");
    expect(col("additional_expenses_amount").band).toBe("supplier");
    // Сумма 1 осталась у логистов — там ей и место.
    expect(col("invoice_amount").band).toBe("logistics");
  });

  it("идут подряд перед «Балансом», как на экране", () => {
    expect(at("additional_expenses_amount")).toBe(at("supplier_railway_amount") + 1);
    expect(at("supplier_balance")).toBe(at("additional_expenses_amount") + 1);
  });

  it("читают роллапы сделки, а не считают сами", () => {
    const deal = { supplier_railway_amount: 12345.67, additional_expenses_amount: 890.12 } as never;
    expect(col("supplier_railway_amount").read(deal)).toBe(12345.67);
    expect(col("additional_expenses_amount").read(deal)).toBe(890.12);
  });
});

describe("детальный паспорт: под-строки сумм 2 и 3", () => {
  const col = (key: string) => {
    const c = (DETAIL_COLUMNS as unknown as Col[]).find((x) => x.key === key);
    if (!c) throw new Error(`колонка ${key} потерялась`);
    return c;
  };

  // Обе величины вагонные: в реестре они лежат на строке отгрузки, а на
  // сделке — их сумма. Значит под-строка обязана показывать величину
  // ЭТОГО вагона, иначе детализация не сойдётся с главной строкой.
  const sub = { ship: { supplier_railway_amount: 500, additional_expenses: 250 } } as never;
  const empty = { ship: null } as never;

  it("берут величину своего вагона из реестра", () => {
    expect(col("supplier_railway_amount").readShip!(null as never, sub)).toBe(500);
    expect(col("additional_expenses_amount").readShip!(null as never, sub)).toBe(250);
  });

  it("пустая отгрузка не роняет выгрузку", () => {
    expect(col("supplier_railway_amount").readShip!(null as never, empty)).toBeNull();
    expect(col("additional_expenses_amount").readShip!(null as never, empty)).toBeNull();
  });
});

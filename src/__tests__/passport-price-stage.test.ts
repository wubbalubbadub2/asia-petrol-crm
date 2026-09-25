/**
 * «Цена финальная» пустая, пока цену не зафиксировали.
 *
 * Клиент 2026-09-18: «в некоторых сделках стадия цены предварительная,
 * но в эксель выгрузке заносится как финальная. Финальная должна быть
 * пустым, пока её не забили».
 *
 * Почему это случалось: пока строка-вариант в стадии 'preliminary',
 * `deals.supplier_price` / `deals.buyer_price` хранят ТУ ЖЕ
 * предварительную цену (проверено на базе 18.09.2026: у всех 1133
 * незафиксированных сделок цена сделки совпадает с ценой строки-
 * варианта до копейки). Колонка окончательной цены читала это поле
 * напрямую — и одна и та же цифра стояла в «Цена предв.» и в «Цена
 * оконч.», как будто цену уже согласовали.
 *
 * Тест держит обе выгрузки паспорта — краткую и детальную (её же
 * использует вариант «долги»), обе стороны и под-строки.
 */
import { describe, it, expect } from "vitest";
import { PASSPORT_COLUMNS } from "@/lib/exports/passport-excel";
import { DETAIL_COLUMNS } from "@/lib/exports/passport-detail-excel";
import type { Deal } from "@/lib/hooks/use-deals";

type Col = {
  key: string;
  read: (d: Deal) => unknown;
  readShip?: (d: Deal, s: never) => unknown;
};

const col = (cols: readonly unknown[], key: string): Col => {
  const c = (cols as Col[]).find((x) => x.key === key);
  if (!c) throw new Error(`колонка ${key} потерялась`);
  return c;
};

// Сделка с НЕзафиксированной ценой: цена сделки равна цене строки-
// варианта, снапшота предварительной цены ещё нет.
const preliminary = {
  id: "d1",
  supplier_price: 505.48,
  buyer_price: 690.362,
  supplier_lines: [{ id: "sl1", is_default: true, price: 505.48, price_stage: "preliminary", preliminary_price: null }],
  buyer_lines: [{ id: "bl1", is_default: true, price: 690.362, price_stage: "preliminary", preliminary_price: null }],
} as unknown as Deal;

// Зафиксированная: в строке лежит снапшот предварительной, а в сделке —
// окончательная цена.
const final = {
  id: "d2",
  supplier_price: 511.2,
  buyer_price: 700.5,
  supplier_lines: [{ id: "sl2", is_default: true, price: 511.2, price_stage: "final", preliminary_price: 505.48 }],
  buyer_lines: [{ id: "bl2", is_default: true, price: 700.5, price_stage: "final", preliminary_price: 690.362 }],
} as unknown as Deal;

const variants: [string, readonly unknown[], string][] = [
  ["краткий паспорт", PASSPORT_COLUMNS, "Цена финальная"],
  ["детальный паспорт", DETAIL_COLUMNS, "Цена финальная"],
];

describe.each(variants)("%s", (_name, cols) => {
  it("предварительная стадия — финальная цена пустая", () => {
    expect(col(cols, "supplier_price").read(preliminary)).toBeNull();
    expect(col(cols, "buyer_price").read(preliminary)).toBeNull();
  });

  it("предварительная стадия — предварительная цена на месте", () => {
    expect(col(cols, "supplier_preliminary_price").read(preliminary)).toBe(505.48);
    expect(col(cols, "buyer_preliminary_price").read(preliminary)).toBe(690.362);
  });

  it("цена зафиксирована — печатаются обе: снапшот и финальная", () => {
    expect(col(cols, "supplier_preliminary_price").read(final)).toBe(505.48);
    expect(col(cols, "supplier_price").read(final)).toBe(511.2);
    expect(col(cols, "buyer_preliminary_price").read(final)).toBe(690.362);
    expect(col(cols, "buyer_price").read(final)).toBe(700.5);
  });

  it("строк-вариантов нет — стадию определить нечем, обе цены пустые", () => {
    const noLines = { id: "d3", supplier_price: 100, buyer_price: 200 } as unknown as Deal;
    expect(col(cols, "supplier_price").read(noLines)).toBeNull();
    expect(col(cols, "supplier_preliminary_price").read(noLines)).toBeNull();
  });
});

describe("детальный паспорт: под-строки отгрузок", () => {
  const ship = (extra: Record<string, unknown>) => ({ ship: { loading_volume: 60, shipment_volume: 59, ...extra } }) as never;

  it("цена в под-строке молчит, пока стадия предварительная", () => {
    expect(col(DETAIL_COLUMNS, "supplier_price").readShip!(preliminary, ship({ fx_supplier_price: 505.48 }))).toBeNull();
    expect(col(DETAIL_COLUMNS, "buyer_price").readShip!(preliminary, ship({ fx_buyer_price: 690.362 }))).toBeNull();
  });

  it("после фиксации под-строка печатает цену (в т.ч. пересчитанную в валюту отчёта)", () => {
    expect(col(DETAIL_COLUMNS, "supplier_price").readShip!(final, ship({ fx_supplier_price: 1000 }))).toBe(1000);
    expect(col(DETAIL_COLUMNS, "buyer_price").readShip!(final, ship({}))).toBe(700.5);
  });

  it("цена под-строки — цена ЭТОЙ отгрузки из deal_shipment_prices, если она есть", () => {
    expect(col(DETAIL_COLUMNS, "buyer_price").readShip!(final, ship({ buyer_ship_price: 226.156 }))).toBe(226.156);
    expect(col(DETAIL_COLUMNS, "supplier_price").readShip!(final, ship({ supplier_ship_price: 505.48 }))).toBe(505.48);
    // В валютном режиме главнее уже пересчитанная цена.
    expect(col(DETAIL_COLUMNS, "buyer_price").readShip!(final, ship({ buyer_ship_price: 226.156, fx_buyer_price: 1000 }))).toBe(1000);
  });

  it("суммы по вагону — как в БД (00166), стадия на них не влияет", () => {
    // Клиент 2026-09-22: строки выгрузки были «цена сделки × тоннаж» и не
    // сходились с итогом сделки, который складывается из
    // deal_shipment_prices.amount. Теперь под-строка печатает ту же сумму,
    // что вошла в итог; без строки цены — пусто (её нет и в итоге).
    expect(col(DETAIL_COLUMNS, "supplier_shipped_amount").readShip!(preliminary, ship({ supplier_ship_amount: 30328.8 }))).toBe(30328.8);
    expect(col(DETAIL_COLUMNS, "buyer_shipped_amount").readShip!(preliminary, ship({ buyer_ship_amount: 13117.048 }))).toBe(13117.048);
    expect(col(DETAIL_COLUMNS, "buyer_shipped_amount").readShip!(preliminary, ship({}))).toBeNull();
  });
});

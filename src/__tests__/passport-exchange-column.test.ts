/**
 * Колонка «Биржа» показывает выбранную котировку + переименование
 * «Цена оконч.» → «Цена финальная».
 *
 * Клиент 2026-09-18:
 *   • «столбец биржа не показывает какая котировка — когда они выбирают
 *     котировку при формировании цены, она должна отображаться в
 *     столбце биржа»;
 *   • «окончательную цену нужно переименовать на финальную».
 *
 * Почему колонка пустовала: печатался только биржевой базис
 * (`quotation_product_types.basis`), а он заполнен не у всех котировок —
 * на 18.09.2026 из 16 типов у двух базиса нет вовсе («ВГО 2%» и
 * «BRENT DTD (Platts)»). На сделках с этими котировками «Биржа» и была
 * пустой, хотя котировка выбрана.
 */
import { describe, it, expect } from "vitest";
import { DETAIL_COLUMNS } from "@/lib/exports/passport-detail-excel";
import { PASSPORT_COLUMNS } from "@/lib/exports/passport-excel";
import type { Deal } from "@/lib/hooks/use-deals";

type Col = { key: string; header: string; read: (d: Deal) => unknown };

const col = (cols: readonly unknown[], key: string): Col => {
  const c = (cols as Col[]).find((x) => x.key === key);
  if (!c) throw new Error(`колонка ${key} потерялась`);
  return c;
};

const dealWith = (quotationType: unknown) => ({
  id: "d1",
  supplier_lines: [{ id: "l1", is_default: true, quotation_type: quotationType }],
  buyer_lines: [{ id: "l2", is_default: true, quotation_type: quotationType }],
}) as unknown as Deal;

describe("«Биржа» в детальной выгрузке", () => {
  it("котировка с базисом — печатаются обе части", () => {
    const d = dealWith({ name: "МАЗУТ 1,0% Fuel oil", basis: "CIF NWE" });
    expect(col(DETAIL_COLUMNS, "supplier_exchange").read(d)).toBe("МАЗУТ 1,0% Fuel oil · CIF NWE");
    expect(col(DETAIL_COLUMNS, "buyer_exchange").read(d)).toBe("МАЗУТ 1,0% Fuel oil · CIF NWE");
  });

  it("котировка без базиса — печатается название, а не пустая ячейка", () => {
    // Именно этот случай клиент и увидел: BRENT DTD basis не имеет.
    const d = dealWith({ name: "BRENT DTD (Platts)", basis: "" });
    expect(col(DETAIL_COLUMNS, "supplier_exchange").read(d)).toBe("BRENT DTD (Platts)");
  });

  it("исторические строки без названия — остаётся базис", () => {
    const d = dealWith({ basis: "FOB Rotterdam" });
    expect(col(DETAIL_COLUMNS, "supplier_exchange").read(d)).toBe("FOB Rotterdam");
  });

  it("котировка не выбрана — ячейка пустая", () => {
    expect(col(DETAIL_COLUMNS, "supplier_exchange").read(dealWith(null))).toBe("");
    expect(col(DETAIL_COLUMNS, "supplier_exchange").read({ id: "d2" } as unknown as Deal)).toBe("");
  });
});

describe("заголовок финальной цены", () => {
  it("краткий паспорт называет её «Цена финальная», как и детальный", () => {
    expect(col(PASSPORT_COLUMNS, "supplier_price").header).toBe("Цена финальная");
    expect(col(PASSPORT_COLUMNS, "buyer_price").header).toBe("Цена финальная");
    expect(col(DETAIL_COLUMNS, "supplier_price").header).toBe("Цена финальная");
    expect(col(DETAIL_COLUMNS, "buyer_price").header).toBe("Цена финальная");
  });

  it("предварительная цена своё название сохранила", () => {
    expect(col(PASSPORT_COLUMNS, "supplier_preliminary_price").header).toBe("Цена предв.");
    expect(col(DETAIL_COLUMNS, "buyer_preliminary_price").header).toBe("Цена предв.");
  });
});

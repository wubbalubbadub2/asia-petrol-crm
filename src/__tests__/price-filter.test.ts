// @vitest-environment node
import { describe, it, expect } from "vitest";
import { priceKey, priceOptions, matchesPrice } from "@/lib/deals/price-filter";

// Клиент 2026-10-07: фильтр по ценам — поставщика и покупателя.
describe("фильтр паспорта по цене", () => {
  it("ключ — цена с 3 знаками, как на экране", () => {
    expect(priceKey(771)).toBe("771.000");
    expect(priceKey("771.0004")).toBe("771.000");
    expect(priceKey(null)).toBeNull();
    expect(priceKey("")).toBeNull();
  });

  it("пункты уникальные, по возрастанию числа, подпись как в паспорте", () => {
    const opts = priceOptions([1200, 771, null, 771.0001, 95.5]);
    expect(opts.map((o) => o.value)).toEqual(["95.500", "771.000", "1200.000"]);
    expect(opts.map((o) => o.label.replace(/ /g, " "))).toEqual(["95,500", "771,000", "1 200,000"]);
  });

  it("выбранная цена остаётся в списке, даже если её больше нет", () => {
    expect(priceOptions([771], ["500.000"]).map((o) => o.value)).toEqual(["500.000", "771.000"]);
  });

  it("совпадение; без выбора — всё подходит; сделка без цены не подходит", () => {
    expect(matchesPrice(771, [])).toBe(true);
    expect(matchesPrice(771, ["771.000"])).toBe(true);
    expect(matchesPrice(772, ["771.000"])).toBe(false);
    expect(matchesPrice(null, ["771.000"])).toBe(false);
  });
});

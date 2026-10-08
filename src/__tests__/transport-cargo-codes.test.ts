// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveCargoCodes } from "@/lib/transport/cargo-codes";

// Владелец 2026-10-08: пара «завод + продукт» главнее; нет пары — коды
// вида ГСМ, ГНГ только при одной строке в «Кодах по видам ГСМ».
describe("resolveCargoCodes", () => {
  const pairs = [{ factory_id: "F1", fuel_type_id: "M", etsng_code: "221066", gng_code: "27101966" }];
  const fuels = [{ id: "M", etsng_code: "221066" }, { id: "D", etsng_code: "221067" }, { id: "G", etsng_code: null }];
  const fuelCodes = [
    { fuel_type_id: "M", gng_code: "27101967" },
    { fuel_type_id: "M", gng_code: "27101968" },
    { fuel_type_id: "D", gng_code: "27101943" },
  ];

  it("пара есть — берём её, даже если у вида свои коды", () => {
    expect(resolveCargoCodes(pairs, fuelCodes, fuels, "F1", "M")).toEqual({ etsng: "221066", gng: "27101966", source: "pair" });
  });

  it("пары нет, у вида одна строка — ЕТСНГ с вида, ГНГ из кодов", () => {
    expect(resolveCargoCodes(pairs, fuelCodes, fuels, "F2", "D")).toEqual({ etsng: "221067", gng: "27101943", source: "fuel" });
  });

  it("пары нет, у вида две строки — ГНГ пусто, ЕТСНГ есть", () => {
    expect(resolveCargoCodes(pairs, fuelCodes, fuels, "F2", "M")).toEqual({ etsng: "221066", gng: "", source: "fuel" });
  });

  it("ни пары, ни кодов вида — пусто", () => {
    expect(resolveCargoCodes(pairs, fuelCodes, fuels, "F2", "G")).toEqual({ etsng: "", gng: "", source: "none" });
    expect(resolveCargoCodes(pairs, fuelCodes, fuels, "F1", "")).toEqual({ etsng: "", gng: "", source: "none" });
  });

  it("завод не выбран — коды вида всё равно подставляются", () => {
    expect(resolveCargoCodes(pairs, fuelCodes, fuels, "", "D").source).toBe("fuel");
  });
});

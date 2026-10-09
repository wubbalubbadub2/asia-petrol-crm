// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applicationCargoCodes,
  codeOnPick,
  consignorOnStation,
  productLabel,
  sulfurKey,
  sulfurOptions,
} from "@/lib/applications/cargo";

// Клиент 2026-10-09: «при выборе вида ГСМ и % серы автоматом должны
// выходить все коды: ЕТСНГ, ГНГ, ТН ВЭД».
const fuels = [
  { id: "M", name: "Мазут", etsng_code: "221066" },
  { id: "D", name: "ДТ", etsng_code: null },
  { id: "G", name: "АИ-92", etsng_code: " 211085 " },
];
const codes = [
  { fuel_type_id: "M", sulfur_percent: 1.5, gng_code: "27101967", tnved_code: "2710196201" },
  { fuel_type_id: "M", sulfur_percent: 1, gng_code: "27101966", tnved_code: null },
  { fuel_type_id: "M", sulfur_percent: 1.5, gng_code: "dup", tnved_code: "dup" }, // повтор серы — в опциях один раз
  { fuel_type_id: "D", sulfur_percent: null, gng_code: "27101943", tnved_code: "2710194300" },
  { fuel_type_id: "G", sulfur_percent: 0.05, gng_code: "27101241", tnved_code: null },
];

describe("sulfurOptions", () => {
  it("по возрастанию, без повторов, без строки «без серы»", () => {
    expect(sulfurOptions(codes, "M")).toEqual([1, 1.5]);
    expect(sulfurOptions(codes, "D")).toEqual([]);
    expect(sulfurOptions(codes, "")).toEqual([]);
  });
  it("ключ серы одинаков для 1.5 и «1.500» из БД", () => {
    expect(sulfurKey(1.5)).toBe("1.5");
    expect(sulfurKey(Number("1.500"))).toBe("1.5");
    expect(sulfurKey(null)).toBe("");
  });
});

describe("applicationCargoCodes", () => {
  it("вид + сера — ЕТСНГ с вида, ГНГ и ТН ВЭД из строки по сере", () => {
    expect(applicationCargoCodes(fuels, codes, "M", 1.5)).toEqual({ etsng: "221066", gng: "27101967", tnved: "2710196201" });
    expect(applicationCargoCodes(fuels, codes, "M", 1)).toEqual({ etsng: "221066", gng: "27101966", tnved: "" });
  });
  it("сера не выбрана: строка без серы, либо единственная строка вида", () => {
    expect(applicationCargoCodes(fuels, codes, "D", null)).toEqual({ etsng: "", gng: "27101943", tnved: "2710194300" });
    expect(applicationCargoCodes(fuels, codes, "G", null)).toEqual({ etsng: "211085", gng: "27101241", tnved: "" });
  });
  it("сера не выбрана, строк несколько — ГНГ/ТН ВЭД пустые, ЕТСНГ есть", () => {
    expect(applicationCargoCodes(fuels, codes, "M", null)).toEqual({ etsng: "221066", gng: "", tnved: "" });
  });
  it("серы такой нет в справочнике — только ЕТСНГ", () => {
    expect(applicationCargoCodes(fuels, codes, "M", 3)).toEqual({ etsng: "221066", gng: "", tnved: "" });
  });
  it("вид не выбран — всё пусто", () => {
    expect(applicationCargoCodes(fuels, codes, "", 1.5)).toEqual({ etsng: "", gng: "", tnved: "" });
  });
});

describe("codeOnPick", () => {
  it("найденный код перекрывает, пустой — оставляет прежний", () => {
    expect(codeOnPick("", "221066")).toBe("221066");
    expect(codeOnPick("111111", "221066")).toBe("221066");
    expect(codeOnPick("111111", "")).toBe("111111");
  });
});

describe("productLabel", () => {
  it("вид + сера запятой, без серы — только вид", () => {
    expect(productLabel("Мазут", 1.5)).toBe("Мазут, сера 1,5%");
    expect(productLabel("Мазут", 1)).toBe("Мазут, сера 1%");
    expect(productLabel("Мазут", null)).toBe("Мазут");
    expect(productLabel(null, 1.5)).toBe("");
  });
});

describe("consignorOnStation", () => {
  it("грузоотправитель станции перекрывает, без него — прежний", () => {
    expect(consignorOnStation("", "F1")).toBe("F1");
    expect(consignorOnStation("F0", "F1")).toBe("F1");
    expect(consignorOnStation("F0", null)).toBe("F0");
  });
});

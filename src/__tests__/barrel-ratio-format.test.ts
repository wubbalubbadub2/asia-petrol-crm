import { describe, it, expect } from "vitest";
import { formatBarrelRatio } from "@/lib/format";

/**
 * Клиент 2026-10-13: «сколько знаков ввели — столько и показывать» для
 * коэффициента барелизации. База хранит NUMERIC(14,6) и отдаёт
 * `7.712700`, то есть число введённых знаков не помнит. Поэтому
 * показываем хранимое число без хвостовых нулей, не больше шести знаков.
 */
describe("formatBarrelRatio", () => {
  it.each([
    [7.7127, "7,7127"],
    [7.747, "7,747"],
    [7.7470, "7,747"],
    [7.679123, "7,679123"],
    [7.6, "7,6"],
    [8, "8"],
  ])("%s → %s", (v, want) => {
    expect(formatBarrelRatio(v)).toBe(want);
  });

  it("пустое значение — пустая строка", () => {
    expect(formatBarrelRatio(null)).toBe("");
    expect(formatBarrelRatio(undefined)).toBe("");
  });
});

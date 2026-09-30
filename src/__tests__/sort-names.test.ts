// @vitest-environment node
import { describe, it, expect } from "vitest";
import { compareNames, sortByName } from "@/lib/sort-names";

describe("compareNames — сначала английские, потом русские", () => {
  it("латиница раньше кириллицы, внутри по алфавиту без учёта регистра", () => {
    const names = ["Таур Импекс", "sammit Oil", "Агентские", "Afiyat Energy LLC", "POLARIM TRADE LP", "Петровектор", "EcoRef Trade"];
    expect([...names].sort(compareNames)).toEqual([
      "Afiyat Energy LLC", "EcoRef Trade", "POLARIM TRADE LP", "sammit Oil",
      "Агентские", "Петровектор", "Таур Импекс",
    ]);
  });

  it("кавычки и пробелы в начале не влияют", () => {
    expect(["«Ойл Инвест»", "\"Zhongda\"", " Агентские"].sort(compareNames))
      .toEqual(["\"Zhongda\"", " Агентские", "«Ойл Инвест»"]);
  });

  it("цифры раньше букв, числа по значению; пустое — в конце", () => {
    expect(["Б", "", "A", "10 станция", "2 станция"].sort(compareNames))
      .toEqual(["2 станция", "10 станция", "A", "Б", ""]);
  });

  it("sortByName сортирует по видимому имени и не меняет исходный массив", () => {
    const rows = [
      { id: "1", short_name: null, full_name: "ТОО \"Б\"" },
      { id: "2", short_name: "Zeta", full_name: "ТОО \"Zeta\"" },
      { id: "3", short_name: "Альфа", full_name: "АО \"Альфа\"" },
    ];
    const sorted = sortByName(rows, (r) => r.short_name || r.full_name);
    expect(sorted.map((r) => r.id)).toEqual(["2", "3", "1"]);
    expect(rows[0].id).toBe("1");
  });
});

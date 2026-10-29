import { describe, expect, it } from "vitest";
import {
  buyerLineName, companyGroupLineName, companyGroupLineNote, orderCompanyGroupLines,
} from "@/lib/hooks/use-company-group-lines";

// Варианты цены группы компаний (00183), клиент 2026-10-29, пример KG/26/736:
// 450 $ к «Варианту 3» покупателя → отгружено 956,007 т на 430 203,15.
// toLocaleString("ru-RU") разделяет тысячи неразрывным пробелом.
const nb = (s: string) => s.replace(/(\d) (\d)/g, "$1\u00a0$2");

describe("варианты цены группы компаний — подписи", () => {
  const lines = orderCompanyGroupLines([
    { id: "c", is_default: false, position: 3 },
    { id: "a", is_default: true, position: 1 },
    { id: "b", is_default: false, position: 2 },
  ]);

  it("«★ Основной» первым, остальные — «Вариант N» по порядку", () => {
    expect(lines.map((l) => companyGroupLineName(l, lines))).toEqual(["★ Основной", "Вариант 2", "Вариант 3"]);
  });

  it("примечание как у поставщика: отгружено, сумма, цена", () => {
    expect(companyGroupLineNote(450, { volume: 956.007, amount: 430203.15, is_linked: true }, "$"))
      .toBe(nb("Отгружено по этому варианту: 956,007 тонн · Сумма: 430 203,15 $ (по цене 450,000)"));
    expect(companyGroupLineNote(440, { volume: 1000, amount: 440000, is_linked: false }, "$"))
      .toBe(nb("Объём: 1 000,000 тонн · Сумма: 440 000,00 $ (по цене 440,000)"));
    expect(companyGroupLineNote(450, { volume: null, amount: null, is_linked: false }, "$")).toBeNull();
  });

  it("вариант покупателя называется, как в его карточке", () => {
    const buyer = [
      { id: "b1", is_default: true, position: 1, price: 623.25 },
      { id: "b3", is_default: false, position: 3, price: 616.75 },
      { id: "b2", is_default: false, position: 2, price: 600.25 },
    ];
    expect(["b1", "b2", "b3", "x"].map((id) => buyerLineName(id, buyer))).toEqual(["Основной", "Вариант 2", "Вариант 3", "—"]);
  });
});

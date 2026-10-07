// @vitest-environment node
import { describe, it, expect } from "vitest";
import { numberInputText } from "@/components/deals/deal-lines-editor";

// Клиент 2026-10-07: «после запятой идёт 4 значения, должно быть 3 по
// котировкам». Средняя котировка приходит из БД неокруглённой и так и
// хранится (00067/00166) — округляем только текст в поле.
describe("numberInputText — поле «Котировка значение»", () => {
  it("котировка — 3 знака в поле", () => {
    expect(numberInputText(593.34652, 3)).toBe("593.347");
    expect(numberInputText(593.3465, 3)).toBe("593.347");
  });

  it("лишние нули не дописываются", () => {
    expect(numberInputText(600.5, 3)).toBe("600.5");
    expect(numberInputText(600, 3)).toBe("600");
  });

  it("без editDecimals — как есть (курс, коэффициент баррелизации)", () => {
    expect(numberInputText(0.0021276, undefined)).toBe("0.0021276");
  });

  it("половина — от нуля, как ROUND в Postgres", () => {
    expect(numberInputText(1.0005, 3)).toBe("1.001");
    expect(numberInputText(-593.3465, 3)).toBe("-593.347");
  });

  it("крошечные числа с экспонентой не дают NaN", () => {
    expect(numberInputText(1e-7, 3)).toBe("0");
  });

  it("пусто — пустая строка", () => {
    expect(numberInputText(null, 3)).toBe("");
  });
});

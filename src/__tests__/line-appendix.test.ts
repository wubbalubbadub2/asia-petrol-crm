// @vitest-environment node
import { describe, it, expect } from "vitest";
import { effectiveAppendix, appendixLabel, appendixOptions, NO_APPENDIX } from "@/lib/deals/line-appendix";

// Клиент 2026-10-08: «опять нету выбора по приложению в реестрах» —
// у вариантов поле пустое, номер приложения живёт в сделке.
describe("приложение варианта для выбора в реестре", () => {
  const main = { appendix: null, is_default: true };
  const second = { appendix: "Прил. 2", is_default: false };
  const emptySecond = { appendix: "  ", is_default: false };

  it("основной вариант без подписи берёт номер приложения сделки", () => {
    expect(effectiveAppendix(main, "1 от 06.10.2026")).toBe("1 от 06.10.2026");
    expect(appendixLabel(main, "1 от 06.10.2026")).toBe("1 от 06.10.2026");
  });

  it("своя подпись важнее номера сделки", () => {
    expect(effectiveAppendix({ appendix: "Прил. 1", is_default: true }, "1 от 06.10.2026")).toBe("Прил. 1");
  });

  it("не основной вариант без подписи — «(без приложения)»", () => {
    expect(effectiveAppendix(emptySecond, "1 от 06.10.2026")).toBeNull();
    expect(appendixLabel(emptySecond, "1 от 06.10.2026")).toBe(NO_APPENDIX);
  });

  it("нет ни подписи, ни номера у сделки — «(без приложения)»", () => {
    expect(appendixLabel(main, null)).toBe(NO_APPENDIX);
    expect(appendixLabel(main, "  ")).toBe(NO_APPENDIX);
  });

  it("список для быстрого выбора — уникальный, с обеих сторон", () => {
    expect(appendixOptions([main, second], "1 от 06.10.2026", [main], "1 от 06.10.2026"))
      .toEqual(["1 от 06.10.2026", "Прил. 2"]);
    expect(appendixOptions([main], null, [emptySecond], null)).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { suggestWagons, WAGON_NORM_TONNES } from "@/components/transport/request-form";

// Клиент 25.08.2026: «норма всегда 58-60 тонн на вагон, можно брать
// всегда 60 и дать возможность поменять вручную». Расчёт только
// ПОДСКАЗЫВАЕТ: в образце ОРТ 455 тн уехали в 7 вагонов (65 тн на
// вагон), то есть норма на практике плавает, и число менеджер правит
// руками. Поэтому тест стережёт две вещи: округление всегда вверх —
// остаток тоже занимает вагон, — и что пустой тоннаж не даёт нуля
// вагонов в документе.

describe("подсказка по вагонам", () => {
  it("норма — 60 тонн", () => {
    expect(WAGON_NORM_TONNES).toBe(60);
  });

  it("округляет вверх: остаток тоже занимает вагон", () => {
    expect(suggestWagons(455)).toBe(8);   // 7.58 → 8
    expect(suggestWagons(420)).toBe(7);   // ровно 7
    expect(suggestWagons(421)).toBe(8);
    expect(suggestWagons(1)).toBe(1);
  });

  it("пустой или бессмысленный тоннаж не даёт вагонов", () => {
    for (const v of [null, undefined, 0, -100, NaN]) {
      expect(suggestWagons(v as number)).toBeNull();
    }
  });
});

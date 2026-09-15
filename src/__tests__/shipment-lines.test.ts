/**
 * Итог в попапе отгрузок.
 *
 * Клиент 2026-09-15: «по сумме отгруженного тоннажа в сделках
 * (покупатель, поставщик) нужно сделать summary внизу, как с оплатами
 * делали». В попапе оплат итог был, в попапе отгрузок — нет: только
 * список дат и объёмов.
 *
 * Тест держит сам итог и два правила вокруг него: в сумму идут только
 * строки с объёмом по нужному полю (у отгрузки бывает заполнена лишь
 * одна сторона), и порядок строк — по возрастанию даты.
 */
import { describe, it, expect } from "vitest";
import { shipmentLines, type ShipmentLine } from "@/lib/deals/shipment-lines";

const row = (date: string | null, loading: number | null, shipment: number | null): ShipmentLine =>
  ({ date, loading_volume: loading, shipment_volume: shipment });

describe("попап отгрузок: итог внизу", () => {
  it("складывает показанные строки и печатает итог последней строкой", () => {
    const out = shipmentLines(
      [row("2026-08-25", null, 54.8), row("2026-08-28", null, 56.1)],
      "shipment_volume",
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("2 отгрузки");
    expect(lines[1]).toBe("25.08.26: 54,800");
    expect(lines[2]).toBe("28.08.26: 56,100");
    expect(lines.at(-1)).toBe("Итого: 110,900");
  });

  it("строки без объёма по этому полю в сумму не идут", () => {
    // У строки заполнен только входящий объём — для стороны покупателя
    // (shipment_volume) её быть не должно ни в списке, ни в итоге.
    const out = shipmentLines(
      [row("2026-08-25", 100, null), row("2026-08-26", null, 20)],
      "shipment_volume",
    );
    expect(out).toContain("1 отгрузка");
    expect(out).not.toContain("100,000");
    expect(out.split("\n").at(-1)).toBe("Итого: 20,000");
  });

  it("считает по входящему объёму для стороны поставщика", () => {
    const out = shipmentLines(
      [row("2026-08-25", 100, null), row("2026-08-26", 20.5, null)],
      "loading_volume",
    );
    expect(out.split("\n").at(-1)).toBe("Итого: 120,500");
  });

  it("сортирует по дате, а не по порядку в массиве", () => {
    const out = shipmentLines(
      [row("2026-09-01", null, 3), row("2026-08-01", null, 1), row("2026-08-15", null, 2)],
      "shipment_volume",
    );
    const lines = out.split("\n");
    expect(lines.slice(1, 4)).toEqual(["01.08.26: 1,000", "15.08.26: 2,000", "01.09.26: 3,000"]);
    expect(lines.at(-1)).toBe("Итого: 6,000");
  });

  it("пустой список остаётся прежним сообщением, без итога", () => {
    expect(shipmentLines([], "shipment_volume")).toBe("Нет отгрузок");
    expect(shipmentLines([row("2026-08-01", 5, null)], "shipment_volume")).toBe("Нет отгрузок");
  });

  it("разделитель не короче самой длинной строки — итог встаёт под столбцом", () => {
    const out = shipmentLines([row("2026-08-25", null, 1234.5)], "shipment_volume");
    const lines = out.split("\n");
    const sep = lines.at(-2)!;
    expect(sep).toMatch(/^─+$/);
    expect(sep.length).toBeGreaterThanOrEqual(lines[1].length);
    expect(sep.length).toBeGreaterThanOrEqual(lines.at(-1)!.length);
  });
});

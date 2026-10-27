import { describe, expect, it } from "vitest";
import { roundedIncoming, roundedTonnage } from "@/lib/exports/registry-excel";

// «Округл.» в реестре и выгрузке — та же база, что у Суммы 1 в БД
// (00182): ТОЛЬКО исходящее СНТ. Входящее — для сравнения (естественная
// убыль), базой не служит. Клиент через владельца 2026-10-27, KG и KZ.
describe("roundedTonnage: база — только исходящее СНТ", () => {
  it("входящее 960, исходящее 957,4 → 958 (тариф 99,61 даёт 95 426,38)", () => {
    const r = roundedTonnage({ registry_type: "KG", loading_volume: 960, shipment_volume: 957.4 });
    expect(r).toBe(958);
    expect(Math.round(r! * 99.61 * 100) / 100).toBe(95426.38);
  });

  it("KZ с обоими объёмами тоже берёт исходящее", () => {
    expect(roundedTonnage({ registry_type: "KZ", loading_volume: 60.4, shipment_volume: 59 })).toBe(59);
  });

  it("вагон с одним исходящим 60,047 → 61", () => {
    expect(roundedTonnage({ registry_type: "KG", loading_volume: null, shipment_volume: 60.047 })).toBe(61);
  });

  it("только входящее (KG/26/652, 419,391 т) → пусто, а не 420", () => {
    expect(roundedTonnage({ registry_type: "KG", loading_volume: 419.391, shipment_volume: null })).toBeNull();
    expect(roundedTonnage({ registry_type: "KZ", loading_volume: 419.391, shipment_volume: null })).toBeNull();
  });

  it("без округления отдаёт исходящее как есть", () => {
    expect(roundedTonnage({ registry_type: "KG", loading_volume: 60.4, shipment_volume: 59.2, round_volume: false })).toBe(59.2);
  });

  it("ручной округл главнее, в том числе на строке только со входящим", () => {
    expect(roundedTonnage({ registry_type: "KG", loading_volume: 60.4, shipment_volume: 59, rounded_volume_override: 50 })).toBe(50);
    expect(roundedTonnage({ registry_type: "KG", loading_volume: 100.5, shipment_volume: null, rounded_volume_override: 100 })).toBe(100);
  });

  it("без объёмов — пусто", () => {
    expect(roundedTonnage({ registry_type: "KG", loading_volume: null, shipment_volume: null })).toBeNull();
  });
});

// Клиент 2026-09-22: «нужно показывать входящее СНТ тоже в округлении».
// Отдельная колонка рядом с входящим — она показывает округление ТОЛЬКО
// входящего и не подменяется ни исходящим, ни ручным «округл.».
describe("roundedIncoming: округление входящего СНТ", () => {
  it("округляет входящее вверх", () => {
    expect(roundedIncoming({ loading_volume: 56.8 })).toBe(57);
  });

  it("не подставляет исходящее, когда входящего нет", () => {
    expect(roundedIncoming({ loading_volume: null })).toBeNull();
  });

  it("тумблер «без округления» выключает и её", () => {
    expect(roundedIncoming({ loading_volume: 56.8, round_volume: false })).toBe(56.8);
  });

  it("ручной «округл.» её не подменяет — он про базу суммы", () => {
    expect(roundedIncoming({ loading_volume: 56.8, rounded_volume_override: 50 } as { loading_volume: number })).toBe(57);
  });
});

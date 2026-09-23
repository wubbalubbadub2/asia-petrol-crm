import { describe, expect, it } from "vitest";
import { roundedIncoming, roundedTonnage } from "@/lib/exports/registry-excel";

// «Округл.» в реестре и выгрузке — та же база, что у Суммы 1 в БД
// (00165): входящее СНТ, если оно есть, иначе исходящее. Тип реестра
// на выбор базы не влияет.
describe("roundedTonnage: база — входящее, если есть, иначе исходящее", () => {
  it("KG с обоими объёмами берёт входящее", () => {
    expect(roundedTonnage({ registry_type: "KG", loading_volume: 60.4, shipment_volume: 59 })).toBe(61);
  });

  it("KG без входящего берёт исходящее", () => {
    expect(roundedTonnage({ registry_type: "KG", loading_volume: null, shipment_volume: 59.2 })).toBe(60);
  });

  it("KZ без входящего берёт исходящее, а не пусто", () => {
    expect(roundedTonnage({ registry_type: "KZ", loading_volume: null, shipment_volume: 59.2 })).toBe(60);
  });

  it("KZ с обоими объёмами берёт входящее", () => {
    expect(roundedTonnage({ registry_type: "KZ", loading_volume: 60.4, shipment_volume: 59 })).toBe(61);
  });

  it("без округления отдаёт объём как есть", () => {
    expect(roundedTonnage({ registry_type: "KG", loading_volume: 60.4, shipment_volume: 59, round_volume: false })).toBe(60.4);
  });

  it("ручной округл главнее обоих объёмов", () => {
    expect(roundedTonnage({ registry_type: "KG", loading_volume: 60.4, shipment_volume: 59, rounded_volume_override: 50 })).toBe(50);
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

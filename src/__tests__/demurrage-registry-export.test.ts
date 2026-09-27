// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildRegistrySheetRows, REGISTRY_HEADERS } from "@/lib/dislocation/registry-export";
import type { RegistryRow } from "@/lib/dislocation/types";

const BASE: RegistryRow = {
  forwarder_id: "f",
  forwarder_name: "PTC Operator",
  wagon_number: "90000001",
  loaded_waybill_number: "Д1",
  loaded_waybill_date: "2026-08-11",
  departure_station_id: "s1",
  destination_station_id: "s2",
  departure_station_name: "Шагыр",
  destination_station_name: "Карабалта",
  cargo_name: "Нефть сырая",
  company_group_name: "ОРТ",
  deal_code: "KG/26/700",
  loading_key: "l",
  unloading_key: "u",
  loading_arrival: "2026-08-01",
  loading_departure: "2026-08-11",
  unloading_arrival: "2026-08-14",
  unloading_departure: "2026-08-15",
  loading_norm: 3,
  unloading_norm: 2,
  rate: 35,
  currency: "USD",
  unloading_final: true,
  needs_check: false,
  month: "2026-08-01",
  loading_overage_days: 8,
  unloading_overage_days: 0,
  amount: 280,
};

describe("buildRegistrySheetRows", () => {
  it("колонки A–R как в реестре PTC, плюс накладная, сделка и проверка", () => {
    expect(REGISTRY_HEADERS.slice(0, 18)).toEqual([
      "Клиент", "Станция отправления", "Станция назначения", "Груз", "Вагон №",
      "Дата приб на ст погрузки", "Дата отправки", "Дата приб на ст выгрузки",
      "Дата след отправки (порож)", "Нормативное количество дней на погрузку",
      "Нормативное количество дней на выгрузку", "Ставка за пользование вагонами",
      "Кол-во сверхнормативных дней при наливе", "Кол-во сверхнормативных дней при сливе",
      "Итого дней", "Итого сумма", "Примечание", "Валюта",
    ]);
    expect(REGISTRY_HEADERS.slice(18)).toEqual(["Накладная", "Сделка", "Требует проверки"]);
  });

  it("строка цикла: даты как Date, O = M + N, P = сумма", () => {
    const [row] = buildRegistrySheetRows([BASE]);
    expect(row[0]).toBe("ОРТ - Август 2026");
    expect(row[4]).toBe("90000001");
    expect(row[5]).toEqual(new Date(Date.UTC(2026, 7, 1)));
    expect(row[8]).toEqual(new Date(Date.UTC(2026, 7, 15)));
    expect(row.slice(9, 18)).toEqual([3, 2, 35, 8, 0, 8, 280, "", "USD"]);
    expect(row.slice(18)).toEqual(["Д1", "KG/26/700", ""]);
  });

  it("незавершённая перевозка и сутки другого месяца — в примечании", () => {
    const [row] = buildRegistrySheetRows([
      { ...BASE, unloading_final: false, unloading_departure: null, month: "2026-09-01" },
    ]);
    expect(row[8]).toBeNull();
    expect(row[16]).toBe("сутки сентября, незавершенная перевозка");
  });

  it("без компании группы — экспедитор; требует проверки — «да»", () => {
    const [row] = buildRegistrySheetRows([{ ...BASE, company_group_name: null, needs_check: true }]);
    expect(row[0]).toBe("PTC Operator - Август 2026");
    expect(row[20]).toBe("да");
  });

  it("сортировка: станция отправления, вагон", () => {
    const rows = buildRegistrySheetRows([
      { ...BASE, wagon_number: "2", departure_station_name: "Темир" },
      { ...BASE, wagon_number: "9" },
      { ...BASE, wagon_number: "1" },
    ]);
    // «Темир» раньше «Шагыр» по алфавиту.
    expect(rows.map((r) => r[4])).toEqual(["2", "1", "9"]);
  });
});

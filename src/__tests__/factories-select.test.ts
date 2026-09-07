import { describe, it, expect } from "vitest";
import { FACTORIES_LIST_SELECT } from "@/lib/refs/factories-select";

/**
 * Регрессия 2026-09-07: справочник «Заводы» не грузился —
 * «Could not embed because more than one relationship was found for
 * 'factories' and 'stations'». Связей две: stations.default_factory_id
 * (00022) и factories.departure_station_id (00154), поэтому
 * встраивание станции без указания ключа PostgREST не разрешает.
 */
describe("справочник заводов — выборка", () => {
  it("станция отправления встраивается по явному ключу", () => {
    expect(FACTORIES_LIST_SELECT).toContain("departure_station:stations!departure_station_id(");
    expect(FACTORIES_LIST_SELECT).not.toMatch(/stations\(/);
  });

  it("колонки формы на месте", () => {
    for (const col of ["id", "name", "code", "departure_station_id", "is_active"]) {
      expect(FACTORIES_LIST_SELECT).toMatch(new RegExp(`(^|, )${col}(,|$)`));
    }
  });
});

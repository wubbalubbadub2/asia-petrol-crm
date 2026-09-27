// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  parseSnapshotAtFromFileName,
  normalizeStationName,
  collectStationNames,
  toUploadRows,
} from "@/lib/dislocation/upload";
import type { DislocationRow } from "@/lib/parsers/dislocation";

const ROW: DislocationRow = {
  fileRowNumber: 1,
  sheetRow: 2,
  wagonNumber: "70524723",
  departureStation: "Шагыр (Эксп.)",
  currentStation: "Кара-Балта",
  destinationStation: "Кара-Балта",
  departureDate: "2026-08-18",
  waybillNumber: "Д0394175",
  waybillDate: "2026-08-18",
  lastOperationAt: "2026-08-20T15:01:00",
  operationCode: "ИСКП",
  operationName: "Исключение вагона из состава поезда",
  loadState: "Груж",
  cargoName: "Нефть",
  cargoCodeEtsng: "201005",
  weightTons: 57.28,
  shipperName: null,
  consigneeName: "ZHONGDA",
  wagonState: "Под выгрузкой",
  idleSinceOperation: 0.75,
  idleAtStation: 0.75,
  wagonOwner: "PTC Holding ТОО",
  marker: "Шагыр-Кара-Балта",
};

describe("parseSnapshotAtFromFileName", () => {
  it("берёт дату и время из имени рассылки 1С", () => {
    expect(
      parseSnapshotAtFromFileName("Рассылка дислокации_ SINGULARITY Темир  мазут  от 11.08.2026 9_42_14 (2).xlsx"),
    ).toBe("2026-08-11T09:42:14");
  });

  it("время в 16:39", () => {
    expect(parseSnapshotAtFromFileName("Рассылка дислокации от 01.09.2026 16_39_41.xlsx")).toBe(
      "2026-09-01T16:39:41",
    );
  });

  it("без времени — полночь", () => {
    expect(parseSnapshotAtFromFileName("дислокация 04.09.2026.xlsx")).toBe("2026-09-04T00:00:00");
  });

  it("без даты — null", () => {
    expect(parseSnapshotAtFromFileName("dislocation.xlsx")).toBeNull();
  });
});

describe("normalizeStationName", () => {
  it("совпадает с rail_norm_station в базе", () => {
    expect(normalizeStationName("  Шагыр   (Эксп.) ")).toBe("шагыр (эксп.)");
    expect(normalizeStationName("Актобе ІІ")).toBe("актобе іі");
    expect(normalizeStationName("Ёлка")).toBe("елка");
  });

  it("пустое → null", () => {
    expect(normalizeStationName("   ")).toBeNull();
    expect(normalizeStationName(null)).toBeNull();
  });
});

describe("collectStationNames", () => {
  it("собирает все три станции без повторов, по нормализованному имени", () => {
    const names = collectStationNames([ROW, { ...ROW, currentStation: "кара-балта " }]);
    expect(names).toEqual([
      { alias: "кара-балта", sample: "Кара-Балта" },
      { alias: "шагыр (эксп.)", sample: "Шагыр (Эксп.)" },
    ]);
  });
});

describe("toUploadRows", () => {
  it("отдаёт ключи функции rail_upload_dislocation", () => {
    expect(toUploadRows([ROW])).toEqual([
      {
        wagon_number: "70524723",
        departure_station: "Шагыр (Эксп.)",
        current_station: "Кара-Балта",
        destination_station: "Кара-Балта",
        waybill_number: "Д0394175",
        waybill_date: "2026-08-18",
        last_operation_at: "2026-08-20T15:01:00",
        operation_code: "ИСКП",
        operation_name: "Исключение вагона из состава поезда",
        load_state: "Груж",
        cargo_name: "Нефть",
        weight_tons: 57.28,
        idle_at_station: 0.75,
        wagon_owner: "PTC Holding ТОО",
        marker: "Шагыр-Кара-Балта",
      },
    ]);
  });
});

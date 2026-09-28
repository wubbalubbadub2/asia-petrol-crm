// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseAnyDislocationSheet, parseTrackingSnapshotAt } from "@/lib/parsers/dislocation-tracking";

/** Шапка и строки — из реального файла Prologistic «dislocation_2026-08-27_14-09.xlsx». */
const HEADER = [
  "Номер вагона / контейнера", "Код дороги отправления", "Код станции отправления", "Станция отправления",
  "Код дороги назначения", "Код станции назначения", "Станция назначения", "Дата и время отправки",
  "Дата и время последней операции", "Код дороги последней операции", "Код станции последней операции",
  "Станция последней операции", "Операция", "Расстояние до станции назначения, км", "Груз", "Индекс поезда",
  "Главная группа", "Вес груза, т.", "Примечание", "Дата примерного прибытия", "Состояние слежения",
  "Дни без движения", "Код операции", "Тип слежения", "Номер платформы", "Ваш комментарий к вагону",
  "Контейнера в вагоне", "Грузоподъёмность вагона, т.", "Модель вагона", "Номер поезда", "Объём кузова",
];
// 46254 = 20.08.2026 в эпохе Excel (46245 = 11.08.2026, см. dislocation-parser.test.ts).
const EMPTY = [
  51241891, "68", "706304", "Тараз, КЗХ", "68", "697406", "Шагыр, КЗХ", 46254 + (22 * 60 + 46) / 1440,
  "24.08.2026 9:37:00", "68", "697406", "Шагыр, КЗХ", "Исключение вагона из состава поезда", 0,
  "Вагоны железнодорожные, перевозимые на своих осях, не поименованные в алфавите (421034), 0 т.", null,
  "цистерны", 0, null, "24.08.2026", "На слежении", 3.3, "ИСКП", "Постоянное", null, null, null, 66,
  "15-150-02", null, "74",
];
const LOADED = [
  51343895, "68", "710600", "Шагыр (эксп.), КЗХ", "70", "715905", "Кара-Балта, КРГ", "23.08.2026 16:56:00",
  "26.08.2026 1:09:00", "70", "715905", "Кара-Балта, КРГ", "Исключение вагона из состава поезда", 0,
  "Нефть сырая (201005), 57.28 т.", null, "цистерны", 57.28, null, "26.08.2026", "На слежении", 1.7, "ИСКП",
  "Постоянное", null, null, null, 66, "15-1443-06", null, "73.1",
];
const FOOTER = [null, "Дата создания: 27.08.2026, 14:09:25"];

describe("parseAnyDislocationSheet — формат слежения Prologistic", () => {
  const res = parseAnyDislocationSheet([HEADER, EMPTY, LOADED, [], FOOTER]);

  it("читает вагоны, пропускает подвал", () => {
    expect(res.missingColumns).toEqual([]);
    expect(res.rows.map((r) => r.wagonNumber)).toEqual(["51241891", "51343895"]);
    expect(res.errors).toEqual([]);
  });

  it("станции без суффикса дороги — как в рассылке 1С", () => {
    expect(res.rows[1].departureStation).toBe("Шагыр (эксп.)");
    expect(res.rows[1].currentStation).toBe("Кара-Балта");
    expect(res.rows[0].destinationStation).toBe("Шагыр");
  });

  it("груж/порож — по весу груза", () => {
    expect(res.rows[0].loadState).toBe("Порож");
    expect(res.rows[1].loadState).toBe("Груж");
  });

  it("номера накладной нет — рейс по дате отправки, «б/н»", () => {
    expect(res.rows[0].waybillNumber).toBe("б/н 2026-08-20 22:46");
    expect(res.rows[0].waybillDate).toBe("2026-08-20");
    expect(res.rows[1].waybillNumber).toBe("б/н 2026-08-23 16:56");
  });

  it("операция, время, простой", () => {
    expect(res.rows[1].lastOperationAt).toBe("2026-08-26T01:09:00");
    expect(res.rows[1].operationCode).toBe("ИСКП");
    expect(res.rows[1].operationName).toBe("Исключение вагона из состава поезда");
    expect(res.rows[1].idleAtStation).toBe(1.7);
    expect(res.rows[1].weightTons).toBe(57.28);
  });

  it("дата снимка — из подвала «Дата создания»", () => {
    expect(res.snapshotAt).toBe("2026-08-27T14:09:25");
  });
});

describe("parseAnyDislocationSheet — рассылка 1С по-прежнему", () => {
  it("не путает форматы: без шапки 1С и без шапки слежения — нет колонки вагона", () => {
    expect(parseAnyDislocationSheet([["что-то"], ["ещё"]]).missingColumns).toEqual(["номер вагона"]);
  });
});

describe("parseTrackingSnapshotAt", () => {
  it("имя файла Prologistic", () => {
    expect(parseTrackingSnapshotAt("dislocation_2026-09-03_14-10.xlsx")).toBe("2026-09-03T14:10:00");
  });
  it("чужое имя — null", () => {
    expect(parseTrackingSnapshotAt("Рассылка дислокации от 04.09.2026 9_39_49.xlsx")).toBeNull();
  });
});

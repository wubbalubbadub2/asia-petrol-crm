import { describe, it, expect } from "vitest";
import {
  parseDislocationSheet,
  parseSnapshotDateFromFileName,
  parseDislocationDate,
  parseDislocationDateTime,
  parseDislocationNumber,
} from "@/lib/parsers/dislocation";

/**
 * Шапка и строки — как в реальном файле клиента (образец от 11.08.2026,
 * лист TDSheet, 29 колонок A–AC).
 */
const HEADER = [
  "№ п/п",
  "Номер вагона",
  "Станция отправления",
  "Станция текущей дислокации",
  "Станция назначения",
  "Дата отправления",
  "Накладная №",
  "Дата жд-накл",
  "Дата и время последней операции",
  "Операция",
  "Наименование операции(полное)",
  "Отд.дор.назн.",
  "Груж\\Порож",
  "Груз ГВЦ",
  "Код груза ЕТСНГ",
  "Вес груза, тонны",
  "Срок доставки (ЭТРАН, RT)",
  "Расстояние осталось (от текущей станции)",
  "Расстояние всего (от станции отправления)",
  "Грузоотправитель наименование организации",
  "Грузополучатель наименование организации",
  "Состояние вагона",
  "Номер поезда",
  "Индекс поезда",
  "Модель вагона",
  "Простой от последней операции",
  "Простой на станции дислокации",
  "Собственник (по данным ЭТРАН, ГВЦ)",
  "Признак 3",
];

/** Гружёный вагон в пути: Темир → Кара-Балта, накладная от 07.08. */
const LOADED_ROW = [
  1, "73933442", "Темир", "Арыс 1", "Кара-Балта", "07.08.2026", "20620353",
  "07.08.2026", "11.08.2026 7:38:00", "ИСКП", "Исключение вагона из состава поезда",
  "КРГ", "Груж", "Мазут топочный", "221066", "63.44", "12.08.2026 5:00:00", "493",
  "1857", "00000000", "ОСОО  CHINA PETROL COMPANY   ZHONGDA", "Груж ход", null, null,
  "15-1547-03", "0.08", "0.17", "PTC Holding ТОО", "Темир-Карабалта 1200*20 мазут",
];

/** Порожний рейс Махамбет → Темир: вагон подан под погрузку в Темире. */
const EMPTY_ROW = [
  29, "75029314", "Махамбет", "Темир", "Темир", "06.08.2026", "ЭЛ981533",
  "06.08.2026", "08.08.2026 9:35:00", "ПВПП", "Подача вагона на подъездной путь",
  "НОД-11  (Актюбинск)", "Порож", "Вагоны железнодорожные порожние", "421208", "0",
  "08.08.2026 5:00:00", "0", "492", "TOO  PTC OPERATOR", "00000000", "Под погрузкой",
  null, null, "15-1547-03", "3", "3", "PTC Holding ТОО", "Темир-Карабалта 20вц мазут",
];

const TOTALS_ROW = ["Итого", null, null, null, null, null, null, null, null, null,
  null, null, null, null, null, "2144.14"];

describe("parseSnapshotDateFromFileName", () => {
  it("берёт дату из имени рассылки", () => {
    expect(
      parseSnapshotDateFromFileName(
        "Рассылка дислокации_ SINGULARITY Темир  мазут  от 11.08.2026 9_42_14 (2).xlsx",
      ),
    ).toBe("2026-08-11");
  });

  it("берёт последнюю дату, если в имени их несколько", () => {
    expect(parseSnapshotDateFromFileName("план 01.08.2026 факт от 11.08.2026.xlsx")).toBe(
      "2026-08-11",
    );
  });

  it("возвращает null, если даты в имени нет", () => {
    expect(parseSnapshotDateFromFileName("дислокация.xlsx")).toBeNull();
  });
});

describe("parseDislocationDate", () => {
  it("разбирает ДД.ММ.ГГГГ", () => {
    expect(parseDislocationDate("07.08.2026")).toBe("2026-08-07");
  });

  it("разбирает Excel-серийную дату без сдвига по таймзоне", () => {
    // 46245 = 11.08.2026 в эпохе Excel (1899-12-30).
    expect(parseDislocationDate(46245)).toBe("2026-08-11");
  });

  it("не путает день и месяц", () => {
    expect(parseDislocationDate("11.08.2026")).toBe("2026-08-11");
  });

  it("пустое значение → null", () => {
    expect(parseDislocationDate("")).toBeNull();
    expect(parseDislocationDate(null)).toBeNull();
  });
});

describe("parseDislocationDateTime", () => {
  it("разбирает дату со временем", () => {
    expect(parseDislocationDateTime("11.08.2026 7:38:00")).toBe("2026-08-11T07:38:00");
  });

  it("дата без времени → полночь", () => {
    expect(parseDislocationDateTime("11.08.2026")).toBe("2026-08-11T00:00:00");
  });
});

describe("parseDislocationNumber", () => {
  it("принимает точку и запятую", () => {
    expect(parseDislocationNumber("63.44")).toBe(63.44);
    expect(parseDislocationNumber("63,44")).toBe(63.44);
  });

  it("ноль остаётся нулём, а не null", () => {
    expect(parseDislocationNumber("0")).toBe(0);
  });

  it("пустое и нечисловое → null", () => {
    expect(parseDislocationNumber("")).toBeNull();
    expect(parseDislocationNumber("—")).toBeNull();
  });
});

describe("parseDislocationSheet", () => {
  it("разбирает гружёный вагон целиком", () => {
    const { rows, errors, missingColumns } = parseDislocationSheet([HEADER, LOADED_ROW]);
    expect(missingColumns).toEqual([]);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fileRowNumber: 1,
      sheetRow: 2,
      wagonNumber: "73933442",
      departureStation: "Темир",
      currentStation: "Арыс 1",
      destinationStation: "Кара-Балта",
      departureDate: "2026-08-07",
      waybillNumber: "20620353",
      waybillDate: "2026-08-07",
      lastOperationAt: "2026-08-11T07:38:00",
      operationCode: "ИСКП",
      operationName: "Исключение вагона из состава поезда",
      loadState: "Груж",
      cargoName: "Мазут топочный",
      cargoCodeEtsng: "221066",
      weightTons: 63.44,
      wagonState: "Груж ход",
      idleSinceOperation: 0.08,
      idleAtStation: 0.17,
      wagonOwner: "PTC Holding ТОО",
      marker: "Темир-Карабалта 1200*20 мазут",
    });
  });

  it("заглушку 00000000 в грузоотправителе считает пустым значением", () => {
    const { rows } = parseDislocationSheet([HEADER, LOADED_ROW]);
    expect(rows[0].shipperName).toBeNull();
    expect(rows[0].consigneeName).toBe("ОСОО CHINA PETROL COMPANY ZHONGDA");
  });

  it("у порожнего рейса заполнен грузоотправитель, а получатель — заглушка", () => {
    const { rows } = parseDislocationSheet([HEADER, EMPTY_ROW]);
    expect(rows[0].shipperName).toBe("TOO PTC OPERATOR");
    expect(rows[0].consigneeName).toBeNull();
  });

  it("порожний рейс: станция погрузки лежит в «станции назначения»", () => {
    const { rows } = parseDislocationSheet([HEADER, EMPTY_ROW]);
    expect(rows[0]).toMatchObject({
      loadState: "Порож",
      departureStation: "Махамбет",
      destinationStation: "Темир",
      currentStation: "Темир",
      wagonState: "Под погрузкой",
    });
  });

  it("пропускает строку «Итого»", () => {
    const { rows, errors } = parseDislocationSheet([HEADER, LOADED_ROW, TOTALS_ROW]);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("пропускает пустые строки", () => {
    const { rows, errors } = parseDislocationSheet([HEADER, [], LOADED_ROW, [null, null]]);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("номер вагона не из 8 цифр → ошибка строки, а не молчаливый пропуск", () => {
    const bad = [...LOADED_ROW];
    bad[1] = "7393344";
    const { rows, errors } = parseDislocationSheet([HEADER, bad]);
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ sheetRow: 2, message: "номер вагона не 8 цифр: 7393344" }]);
  });

  it("находит шапку, если выше неё есть строки заголовка рассылки", () => {
    const { rows, missingColumns } = parseDislocationSheet([
      ["Дислокация вагонов на 11.08.2026"],
      [],
      HEADER,
      LOADED_ROW,
    ]);
    expect(missingColumns).toEqual([]);
    expect(rows[0].sheetRow).toBe(4);
  });

  it("сообщает о нехватке обязательных колонок вместо частичного импорта", () => {
    const header = [...HEADER];
    header[3] = "Что-то своё";
    header[8] = "Ещё своё";
    const { rows, missingColumns } = parseDislocationSheet([header, LOADED_ROW]);
    expect(rows).toEqual([]);
    expect(missingColumns).toEqual(["станциятекущейдислокации", "датаивремяпоследнейоперации"]);
  });

  it("без колонки с номером вагона файл не принимается", () => {
    const { missingColumns } = parseDislocationSheet([["А", "Б"], [1, 2]]);
    expect(missingColumns).toEqual(["номер вагона"]);
  });

  it("не путает «Груз ГВЦ» с «Грузоотправителем»", () => {
    const { rows } = parseDislocationSheet([HEADER, LOADED_ROW]);
    expect(rows[0].cargoName).toBe("Мазут топочный");
  });
});

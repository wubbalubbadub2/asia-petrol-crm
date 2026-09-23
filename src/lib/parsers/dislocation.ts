/**
 * Парсер ежедневного файла дислокации вагонов (выгрузка 1С, лист `TDSheet`).
 *
 * Образец клиента 01.09.2026 — «Рассылка дислокации_ SINGULARITY Темир
 * мазут от 11.08.2026 9_42_14.xlsx»: шапка в строке 1, 29 колонок A–AC,
 * данные со строки 2, последняя строка — «Итого» с суммой веса.
 *
 * Что важно знать о формате (проверено на реальном файле):
 *
 *   • Даты снимка (даты дислокации) в файле НЕТ — только в имени файла
 *     («от 11.08.2026 9_42_14»). Колонка «Дата и время последней операции»
 *     не годится: у части вагонов она на несколько дней старше снимка.
 *   • «Дата отправления» во всех 48 строках образца равна «Дате жд-накл»,
 *     в том числе у вагонов, физически стоящих на станции погрузки. То есть
 *     это дата накладной, а НЕ факт ухода со станции. Факт отправления
 *     определяется сравнением снимков за разные дни, здесь мы его не считаем.
 *   • У порожнего рейса (Груж\Порож = «Порож») станция отправления — это
 *     станция, откуда вагон едет порожняком, а станция погрузки лежит в
 *     колонке «Станция назначения».
 *   • Грузоотправитель/грузополучатель: заполнено одно из двух, второе —
 *     заглушка `00000000`. Заглушку превращаем в null.
 *
 * Колонки ищем по тексту шапки, а не по позиции: у экспедиторов порядок
 * и набор колонок со временем разъезжается, а имена устойчивее.
 */

/** Одна строка дислокации — один вагон на дату снимка. */
export type DislocationRow = {
  /** № п/п в файле (колонка A). Нужен только для сообщений об ошибках. */
  fileRowNumber: number | null;
  /** Номер строки в листе (1-based, как в Excel). */
  sheetRow: number;
  wagonNumber: string;
  departureStation: string | null;
  currentStation: string | null;
  destinationStation: string | null;
  /** Дата отправления по накладной, ISO. Не факт ухода со станции. */
  departureDate: string | null;
  waybillNumber: string | null;
  waybillDate: string | null;
  /** Дата и время последней операции, ISO `YYYY-MM-DDTHH:mm:ss` без таймзоны. */
  lastOperationAt: string | null;
  operationCode: string | null;
  operationName: string | null;
  /** `Груж` | `Порож` как в файле. */
  loadState: string | null;
  cargoName: string | null;
  cargoCodeEtsng: string | null;
  weightTons: number | null;
  shipperName: string | null;
  consigneeName: string | null;
  wagonState: string | null;
  /** Простой от последней операции, дробные дни. */
  idleSinceOperation: number | null;
  /** Простой на станции дислокации, дробные дни. */
  idleAtStation: number | null;
  wagonOwner: string | null;
  /** «Признак 3» — пометка маршрута/разнарядки («Темир-Карабалта 20вц мазут»). */
  marker: string | null;
};

export type DislocationParseError = {
  sheetRow: number;
  message: string;
};

export type ParsedDislocation = {
  rows: DislocationRow[];
  errors: DislocationParseError[];
  /** Колонки, которых не хватило в шапке. Непустой список = файл не годится. */
  missingColumns: string[];
};

/** Заглушка вместо БИН/наименования в выгрузке 1С. */
const PLACEHOLDER_ORG = /^0+$/;

/** Ключ поля → варианты написания шапки (нормализованные). */
const COLUMN_ALIASES: Record<keyof ColumnMap, string[]> = {
  fileRowNumber: ["nn", "nпп", "№пп"],
  wagonNumber: ["номервагона", "вагон"],
  departureStation: ["станцияотправления"],
  currentStation: ["станциятекущейдислокации", "станциядислокации"],
  destinationStation: ["станцияназначения"],
  departureDate: ["датаотправления"],
  waybillNumber: ["накладная", "накладная№", "№накладной", "номернакладной"],
  waybillDate: ["датажднакл", "датажднакладной", "датаждн"],
  lastOperationAt: ["датаивремяпоследнейоперации", "датапоследнейоперации"],
  operationCode: ["операция"],
  operationName: ["наименованиеоперацииполное", "наименованиеоперации"],
  loadState: ["гружпорож", "груженыйпорожний"],
  cargoName: ["грузгвц", "наименованиегруза", "груз"],
  cargoCodeEtsng: ["кодгрузаетснг", "кодетснг"],
  weightTons: ["весгрузатонны", "весгруза"],
  shipperName: ["грузоотправительнаименованиеорганизации", "грузоотправитель"],
  consigneeName: ["грузополучательнаименованиеорганизации", "грузополучатель"],
  wagonState: ["состояниевагона"],
  idleSinceOperation: ["простойотпоследнейоперации"],
  idleAtStation: ["простойнастанциидислокации"],
  wagonOwner: ["собственникподаннымэтрангвц", "собственник"],
  marker: ["признак3", "признак"],
};

/** Без этих колонок файл бессмысленен — импорт не запускаем. */
const REQUIRED: (keyof ColumnMap)[] = [
  "wagonNumber",
  "currentStation",
  "lastOperationAt",
];

type ColumnMap = {
  fileRowNumber: number;
  wagonNumber: number;
  departureStation: number;
  currentStation: number;
  destinationStation: number;
  departureDate: number;
  waybillNumber: number;
  waybillDate: number;
  lastOperationAt: number;
  operationCode: number;
  operationName: number;
  loadState: number;
  cargoName: number;
  cargoCodeEtsng: number;
  weightTons: number;
  shipperName: number;
  consigneeName: number;
  wagonState: number;
  idleSinceOperation: number;
  idleAtStation: number;
  wagonOwner: number;
  marker: number;
};

/** Шапка → ключ сравнения: без регистра, пробелов и знаков. */
function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s .,:;()\\/\-_"'«»]/g, "");
}

/**
 * Дата снимка из имени файла: «… от 11.08.2026 9_42_14 (2).xlsx» → 2026-08-11.
 * В самом файле её нет, поэтому это единственный автоматический источник —
 * пользователь всё равно подтверждает дату руками при загрузке.
 */
export function parseSnapshotDateFromFileName(fileName: string): string | null {
  const matches = [...fileName.matchAll(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/g)];
  if (matches.length === 0) return null;
  // Берём ПОСЛЕДНЮЮ дату в имени: маршрут в начале может содержать свою.
  const m = matches[matches.length - 1];
  return isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Excel-серийная дата → части календаря. Считаем в UTC и достаём части
 * тоже в UTC: локальная таймзона машины не должна сдвигать дату отгрузки.
 */
function fromExcelSerial(serial: number): Date {
  // Эпоха 1899-12-30 (учитывает баг Lotus с 1900 годом).
  return new Date(Math.round(serial * 86400000) + Date.UTC(1899, 11, 30));
}

function partsOf(d: Date) {
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
    ss: d.getUTCSeconds(),
  };
}

/** `07.08.2026` / Excel-серийная / Date → `2026-08-07`. */
export function parseDislocationDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const p = partsOf(value);
    return isoDate(p.y, p.m, p.d);
  }
  if (typeof value === "number") {
    const p = partsOf(fromExcelSerial(value));
    return isoDate(p.y, p.m, p.d);
  }
  const text = String(value).trim();
  if (!text) return null;
  const dmy = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (dmy) return isoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return isoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  return null;
}

/**
 * `11.08.2026 7:38:00` → `2026-08-11T07:38:00`. Без таймзоны: время операции
 * приходит в местном времени дороги, переводить его некуда и незачем.
 */
export function parseDislocationDateTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (value instanceof Date || typeof value === "number") {
    const p = partsOf(value instanceof Date ? value : fromExcelSerial(value));
    const date = isoDate(p.y, p.m, p.d);
    return date ? `${date}T${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}` : null;
  }
  const text = String(value).trim();
  const date = parseDislocationDate(text);
  if (!date) return null;
  const time = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!time) return `${date}T00:00:00`;
  return `${date}T${pad(Number(time[1]))}:${pad(Number(time[2]))}:${pad(Number(time[3] ?? 0))}`;
}

/** `63,44` / `63.44` / число → 63.44. Пустое и нечисловое → null. */
export function parseDislocationNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/ |\s/g, "").replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim().replace(/\s+/g, " ");
  return s === "" ? null : s;
}

/** Наименование организации: заглушку `00000000` считаем пустым значением. */
function orgName(value: unknown): string | null {
  const s = text(value);
  if (s == null) return null;
  return PLACEHOLDER_ORG.test(s) ? null : s;
}

/** Номер вагона: 8 цифр. Пробелы и апострофы из Excel убираем. */
function wagonNumber(value: unknown): string | null {
  const s = text(value);
  if (s == null) return null;
  const digits = s.replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

function mapColumns(header: unknown[]): { map: Partial<ColumnMap>; missing: string[] } {
  const normalized = header.map(normalizeHeader);
  const map: Partial<ColumnMap> = {};
  // Сначала точные совпадения по всем полям, только потом — по префиксу.
  // Иначе короткий алиас «груз» перехватит колонку «грузоотправитель…».
  for (const match of [
    (h: string, alias: string) => h === alias,
    (h: string, alias: string) => h !== "" && h.startsWith(alias),
  ]) {
    for (const key of Object.keys(COLUMN_ALIASES) as (keyof ColumnMap)[]) {
      if (map[key] !== undefined) continue;
      for (const alias of COLUMN_ALIASES[key]) {
        const idx = normalized.findIndex(
          (h, i) => match(h, alias) && !Object.values(map).includes(i),
        );
        if (idx >= 0) {
          map[key] = idx;
          break;
        }
      }
    }
  }
  const missing = REQUIRED.filter((key) => map[key] === undefined).map(
    (key) => COLUMN_ALIASES[key][0],
  );
  return { map, missing };
}

/**
 * Разбирает лист дислокации, полученный из `XLSX.utils.sheet_to_json(ws,
 * { header: 1 })`: первая строка — шапка, дальше строки вагонов.
 *
 * Строку «Итого» и любую строку без валидного номера вагона пропускаем:
 * первая — служебная, вторые попадают в `errors` для показа пользователю.
 */
export function parseDislocationSheet(sheet: unknown[][]): ParsedDislocation {
  const errors: DislocationParseError[] = [];
  const rows: DislocationRow[] = [];

  const headerIdx = sheet.findIndex(
    (row) => Array.isArray(row) && row.some((c) => normalizeHeader(c) === "номервагона"),
  );
  if (headerIdx < 0) {
    return { rows, errors, missingColumns: ["номер вагона"] };
  }

  const { map, missing } = mapColumns(sheet[headerIdx]);
  if (missing.length > 0) return { rows, errors, missingColumns: missing };

  const at = (row: unknown[], key: keyof ColumnMap): unknown => {
    const idx = map[key];
    return idx === undefined ? null : row[idx];
  };

  for (let i = headerIdx + 1; i < sheet.length; i++) {
    const row = sheet[i];
    const sheetRow = i + 1;
    if (!Array.isArray(row) || row.every((c) => c == null || String(c).trim() === "")) continue;

    const first = text(at(row, "fileRowNumber"));
    if (first != null && /^итого/i.test(first)) continue;

    const wagon = wagonNumber(at(row, "wagonNumber"));
    if (wagon == null) {
      const raw = text(at(row, "wagonNumber"));
      // Строка итогов без № п/п: номера вагона нет, но есть вес — не ошибка.
      if (raw == null && text(at(row, "currentStation")) == null) continue;
      errors.push({
        sheetRow,
        message: raw == null ? "нет номера вагона" : `номер вагона не 8 цифр: ${raw}`,
      });
      continue;
    }

    rows.push({
      fileRowNumber: parseDislocationNumber(at(row, "fileRowNumber")),
      sheetRow,
      wagonNumber: wagon,
      departureStation: text(at(row, "departureStation")),
      currentStation: text(at(row, "currentStation")),
      destinationStation: text(at(row, "destinationStation")),
      departureDate: parseDislocationDate(at(row, "departureDate")),
      waybillNumber: text(at(row, "waybillNumber")),
      waybillDate: parseDislocationDate(at(row, "waybillDate")),
      lastOperationAt: parseDislocationDateTime(at(row, "lastOperationAt")),
      operationCode: text(at(row, "operationCode")),
      operationName: text(at(row, "operationName")),
      loadState: text(at(row, "loadState")),
      cargoName: text(at(row, "cargoName")),
      cargoCodeEtsng: text(at(row, "cargoCodeEtsng")),
      weightTons: parseDislocationNumber(at(row, "weightTons")),
      shipperName: orgName(at(row, "shipperName")),
      consigneeName: orgName(at(row, "consigneeName")),
      wagonState: text(at(row, "wagonState")),
      idleSinceOperation: parseDislocationNumber(at(row, "idleSinceOperation")),
      idleAtStation: parseDislocationNumber(at(row, "idleAtStation")),
      wagonOwner: text(at(row, "wagonOwner")),
      marker: text(at(row, "marker")),
    });
  }

  return { rows, errors, missingColumns: [] };
}

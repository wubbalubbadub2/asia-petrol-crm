/**
 * Второй формат дислокации — выгрузка системы слежения Prologistic
 * («dislocation_2026-08-27_14-09.xlsx», лист «Dislocation», 31 колонка).
 *
 * Отличия от рассылки 1С (проверено на 4 файлах клиента, 27.08–09.09.2026):
 *   • номера накладной НЕТ — рейс определяем по «Дата и время отправки»:
 *     у одного рейса она одинакова во всех снимках. В накладную пишем
 *     «б/н ГГГГ-ММ-ДД ЧЧ:ММ», дату накладной — дата отправки;
 *   • колонки «Груж\Порож» нет — гружёный, если вес груза > 0;
 *   • станции с суффиксом дороги («Шагыр, КЗХ») — суффикс снимаем, чтобы
 *     работали те же сопоставления станций, что и для файлов 1С;
 *   • дата снимка есть в подвале: «Дата создания: 27.08.2026, 14:09:25».
 *
 * `parseAnyDislocationSheet` сам выбирает формат по шапке.
 */
import {
  parseDislocationSheet,
  parseDislocationDate,
  parseDislocationDateTime,
  parseDislocationNumber,
  type DislocationRow,
  type ParsedDislocation,
} from "@/lib/parsers/dislocation";

export type ParsedAnyDislocation = ParsedDislocation & {
  /** Дата и время снимка из самого файла, если формат её хранит. */
  snapshotAt: string | null;
};

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s .,:;()\\/\-_"'«»]/g, "");
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim().replace(/\s+/g, " ");
  return s === "" ? null : s;
}

/** «Шагыр (эксп.), КЗХ» → «Шагыр (эксп.)». */
function station(value: unknown): string | null {
  const s = text(value);
  return s == null ? null : s.replace(/,\s*[A-ZА-ЯЁ]{2,4}$/u, "").trim();
}

const COLUMNS = {
  wagon: "номервагонаконтейнера",
  departureStation: "станцияотправления",
  destinationStation: "станцияназначения",
  dispatchedAt: "датаивремяотправки",
  lastOperationAt: "датаивремяпоследнейоперации",
  currentStation: "станцияпоследнейоперации",
  operationName: "операция",
  cargo: "груз",
  weight: "весгрузат",
  idle: "днибездвижения",
  operationCode: "кодоперации",
} as const;

/** «Дата создания: 27.08.2026, 14:09:25» → `2026-08-27T14:09:25`. */
function footerSnapshotAt(sheet: unknown[][]): string | null {
  for (const row of sheet) {
    for (const cell of row ?? []) {
      const m = String(cell ?? "").match(/Дата создания:\s*(\d{2})\.(\d{2})\.(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (m) {
        const p = (s: string) => s.padStart(2, "0");
        return `${m[3]}-${m[2]}-${m[1]}T${p(m[4])}:${m[5]}:${m[6] ?? "00"}`;
      }
    }
  }
  return null;
}

/** «dislocation_2026-09-03_14-10.xlsx» → `2026-09-03T14:10:00`. */
export function parseTrackingSnapshotAt(fileName: string): string | null {
  const m = fileName.match(/(\d{4})-(\d{2})-(\d{2})[_ T](\d{2})-(\d{2})(?:-(\d{2}))?/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}` : null;
}

function parseTrackingSheet(sheet: unknown[][], headerIdx: number): ParsedAnyDislocation {
  const header = sheet[headerIdx].map(norm);
  const col = {} as Record<keyof typeof COLUMNS, number>;
  for (const [key, name] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    col[key] = header.findIndex((h) => h === name);
  }
  const missing = (["wagon", "currentStation", "lastOperationAt", "dispatchedAt"] as const)
    .filter((k) => col[k] < 0)
    .map((k) => COLUMNS[k]);
  const snapshotAt = footerSnapshotAt(sheet);
  if (missing.length) return { rows: [], errors: [], missingColumns: missing, snapshotAt };

  const at = (row: unknown[], k: keyof typeof COLUMNS) => (col[k] >= 0 ? row[col[k]] : null);
  const rows: DislocationRow[] = [];
  const errors: ParsedDislocation["errors"] = [];

  for (let i = headerIdx + 1; i < sheet.length; i++) {
    const row = sheet[i];
    if (!Array.isArray(row) || row.every((c) => c == null || String(c).trim() === "")) continue;
    const raw = text(at(row, "wagon"));
    if (raw == null) continue; // подвал «Дата создания: …»
    const digits = raw.replace(/\D/g, "");
    if (digits.length !== 8) {
      errors.push({ sheetRow: i + 1, message: `номер вагона не 8 цифр: ${raw}` });
      continue;
    }
    const dispatchedAt = parseDislocationDateTime(at(row, "dispatchedAt"));
    const weight = parseDislocationNumber(at(row, "weight"));
    rows.push({
      fileRowNumber: null,
      sheetRow: i + 1,
      wagonNumber: digits,
      departureStation: station(at(row, "departureStation")),
      currentStation: station(at(row, "currentStation")),
      destinationStation: station(at(row, "destinationStation")),
      departureDate: parseDislocationDate(at(row, "dispatchedAt")),
      waybillNumber: dispatchedAt ? `б/н ${dispatchedAt.slice(0, 10)} ${dispatchedAt.slice(11, 16)}` : null,
      waybillDate: dispatchedAt ? dispatchedAt.slice(0, 10) : null,
      lastOperationAt: parseDislocationDateTime(at(row, "lastOperationAt")),
      operationCode: text(at(row, "operationCode")),
      operationName: text(at(row, "operationName")),
      loadState: weight != null && weight > 0 ? "Груж" : "Порож",
      cargoName: text(at(row, "cargo")),
      cargoCodeEtsng: null,
      weightTons: weight,
      shipperName: null,
      consigneeName: null,
      wagonState: null,
      idleSinceOperation: parseDislocationNumber(at(row, "idle")),
      idleAtStation: parseDislocationNumber(at(row, "idle")),
      wagonOwner: null,
      marker: null,
    });
  }
  return { rows, errors, missingColumns: [], snapshotAt };
}

/** Рассылка 1С или выгрузка слежения — формат по шапке. */
export function parseAnyDislocationSheet(sheet: unknown[][]): ParsedAnyDislocation {
  const trackingHeader = sheet.findIndex(
    (row) => Array.isArray(row) && row.some((c) => norm(c) === COLUMNS.wagon),
  );
  if (trackingHeader >= 0) return parseTrackingSheet(sheet, trackingHeader);
  return { ...parseDislocationSheet(sheet), snapshotAt: null };
}

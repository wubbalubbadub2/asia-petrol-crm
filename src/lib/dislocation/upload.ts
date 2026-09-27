/**
 * Подготовка файла дислокации к загрузке в базу (миграция 00174).
 *
 * Разбор листа — в `@/lib/parsers/dislocation`. Здесь то, что нужно между
 * разбором и вызовом `rail_upload_dislocation`: дата и время снимка из имени
 * файла, нормализация названий станций (та же, что `rail_norm_station` в
 * базе) и строки в ключах функции.
 */
import type { DislocationRow } from "@/lib/parsers/dislocation";

/**
 * «… от 11.08.2026 9_42_14 (2).xlsx» → `2026-08-11T09:42:14`.
 * Время дороги местное, без часового пояса. Нет времени — полночь.
 * Берём ПОСЛЕДНЮЮ дату в имени: маршрут в начале может содержать свою.
 */
export function parseSnapshotAtFromFileName(fileName: string): string | null {
  const re = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:[\s_]+(\d{1,2})[_:.](\d{2})(?:[_:.](\d{2}))?)?/g;
  const matches = [...fileName.matchAll(re)];
  if (matches.length === 0) return null;
  const m = matches[matches.length - 1];
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const hh = m[4] != null ? Number(m[4]) : 0;
  const mm = m[5] != null ? Number(m[5]) : 0;
  const ss = m[6] != null ? Number(m[6]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}T${p(hh)}:${p(mm)}:${p(ss)}`;
}

/** Та же нормализация, что `rail_norm_station` в 00174. */
export function normalizeStationName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const s = name.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  return s === "" ? null : s;
}

export type StationName = {
  /** Нормализованное имя — ключ справочника соответствий. */
  alias: string;
  /** Как написано в файле — показываем пользователю. */
  sample: string;
};

/** Все станции файла (отправления, текущая, назначения) без повторов. */
export function collectStationNames(rows: DislocationRow[]): StationName[] {
  const byAlias = new Map<string, string>();
  for (const r of rows) {
    for (const raw of [r.departureStation, r.currentStation, r.destinationStation]) {
      const alias = normalizeStationName(raw);
      if (alias && raw && !byAlias.has(alias)) byAlias.set(alias, raw.trim());
    }
  }
  return [...byAlias.entries()]
    .map(([alias, sample]) => ({ alias, sample }))
    .sort((a, b) => a.alias.localeCompare(b.alias, "ru"));
}

/** Строка в ключах `jsonb_to_recordset` функции `rail_upload_dislocation`. */
export type UploadRow = {
  wagon_number: string;
  departure_station: string | null;
  current_station: string | null;
  destination_station: string | null;
  waybill_number: string | null;
  waybill_date: string | null;
  last_operation_at: string | null;
  operation_code: string | null;
  operation_name: string | null;
  load_state: string | null;
  cargo_name: string | null;
  weight_tons: number | null;
  idle_at_station: number | null;
  wagon_owner: string | null;
  marker: string | null;
};

export function toUploadRows(rows: DislocationRow[]): UploadRow[] {
  return rows.map((r) => ({
    wagon_number: r.wagonNumber,
    departure_station: r.departureStation,
    current_station: r.currentStation,
    destination_station: r.destinationStation,
    waybill_number: r.waybillNumber,
    waybill_date: r.waybillDate,
    last_operation_at: r.lastOperationAt,
    operation_code: r.operationCode,
    operation_name: r.operationName,
    load_state: r.loadState,
    cargo_name: r.cargoName,
    weight_tons: r.weightTons,
    idle_at_station: r.idleAtStation,
    wagon_owner: r.wagonOwner,
    marker: r.marker,
  }));
}

/** SHA-256 содержимого файла — повторная загрузка того же файла запрещена. */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

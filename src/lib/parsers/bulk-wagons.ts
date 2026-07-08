/**
 * Parses a multi-line paste (from Excel or hand-typed) into wagon rows.
 *
 * Column order (client request, 2026-06-17 — matches their Excel registries):
 *   дата   №_накладной   №_вагона   объём
 *
 * Input examples (one row per line):
 *   05.11.2025\tЭД0012345\t51742534\t54,719   → full row
 *   05.11.2025\tЭД0012345\t51742534           → no volume
 *   51742534                                    → bare wagon (legacy paste)
 *
 * Legacy auto-detection: if no cell on the row parses as a date, we
 * fall back to the previous order (wagon, volume, date, waybill) so old
 * pastes still work.
 *
 * Volume column maps to either `shipment_volume` or `loading_volume` at
 * save time (UI toggle).
 *
 * Accepts:
 *   - Column separator: tab preferred; falls back to 2+ spaces, then single whitespace
 *   - Decimal separator: `,` or `.` (both converted to dot)
 *   - Date formats: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD → ISO YYYY-MM-DD
 *   - Leading/trailing whitespace trimmed per line and per cell
 *   - Empty lines skipped
 *   - First row skipped only if it has zero digits anywhere (clear header).
 *     Any digit-bearing first row is treated as data.
 */

export type ParsedWagon = {
  wagon: string;
  volume: number | null;
  date: string | null; // ISO YYYY-MM-DD or null
  waybill: string | null;
  error?: string;
};

function splitLine(line: string): string[] {
  let cells: string[];
  // Prefer tab (Excel paste)
  if (line.includes("\t")) {
    cells = line.split("\t").map((c) => c.trim());
  } else {
    // Fallback: two-or-more spaces
    const multi = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (multi.length > 1) cells = multi;
    // Last resort: single whitespace
    else cells = line.split(/\s+/).map((c) => c.trim()).filter(Boolean);
  }
  // Trim TRAILING empty cells only. Preserve leading/middle empties
  // (they distinguish NEW-3 «дата | вагон | объём» from NEW-4
  // «дата | накладная | вагон | объём» when накладная is intentionally
  // blank). But a trailing empty comes from Excel paste with a hanging
  // tab and used to shift the parser into NEW-4 layout mode, corrupting
  // wagon/waybill assignments (operator bug 2026-07-08).
  while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

// Post-process: glue consecutive cells that form a comma-separated
// wagon list with spaces after the commas. Operator paste pattern
// (2026-06-28):
//
//   «23.06.2026 51409076, 75039669, 54887898 167,801»
//                      ↑   ↑   ↑
//   trailing commas + spaces are how Excel exports «multi-wagon»
//   cells when the operator copies a row.
//
// splitLine sees the spaces and produces 5 cells; the row should be
// 3 cells (date / multi-wagon / volume). This pass merges
// «12345678,» + «12345679,» + «12345680» → «12345678,12345679,12345680»
// when:
//
//   - cur matches /^[\d,]+,$/  (digit-and-comma chain ending in comma)
//   - next cell matches /^\d+,?$/  (pure digit run, optionally with one
//     trailing comma)
//
// Conservative on purpose. Cells with dots (dates / decimals),
// letters (waybill numbers), or stray punctuation never trigger the
// merge, so 4-col / 3-col / legacy pastes are untouched. The volume
// «167,801» at the end never matches the merge pattern either — its
// internal comma is the decimal separator, not a trailing comma.
function mergeMultiWagonCells(cells: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < cells.length) {
    let cur = cells[i];
    while (
      /^[\d,]+,$/.test(cur) &&
      i + 1 < cells.length &&
      /^\d+,?$/.test(cells[i + 1])
    ) {
      i++;
      cur += cells[i];
    }
    out.push(cur);
    i++;
  }
  return out;
}

function parseVolume(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Verify that (y, m, d) describes a real calendar date. JavaScript's Date
// constructor silently rolls over invalid components (Feb 31 → Mar 3), so
// we round-trip through Date and compare the parts back to the input.
function isRealDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // ISO already
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (m) {
    const [, y, mo, d] = m;
    if (!isRealDate(+y, +mo, +d)) return null;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD.MM.YYYY or DD/MM/YYYY
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(trimmed);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? `20${y}` : y;
    if (!isRealDate(+year, +mo, +d)) return null;
    return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}

// Pattern-only check (not value validity). «10.15.2026» matches because
// it has the DD.MM.YYYY shape even though month 15 isn't real. Used by
// the layout sniffer so that an invalid date in position 0 STILL routes
// the row through the new (дата → накладная → вагон → объём) layout —
// otherwise the row silently falls back to the legacy mapping and the
// user gets a confusing «wagon = 10.15.2026» error.
function looksLikeDate(raw: string | undefined): boolean {
  if (!raw) return false;
  const t = raw.trim();
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(t) || /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(t);
}

function looksLikeHeader(cells: string[]): boolean {
  // A header row has zero numeric content. If any cell carries a digit
  // (wagon number, volume, date, waybill) the row is data, not a header.
  // Earlier "first cell starts with non-digit alpha" logic silently dropped
  // real rows whose first cell happened to start with a letter.
  return cells.length > 0 && cells.every((c) => !/\d/.test(c));
}

export function parseBulkWagons(raw: string): ParsedWagon[] {
  if (!raw) return [];
  const rawLines = raw.split(/\r?\n/);
  const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  // Header auto-skip (only examine first line)
  const firstCells = splitLine(lines[0]);
  const startIdx = looksLikeHeader(firstCells) ? 1 : 0;

  const out: ParsedWagon[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const cells = mergeMultiWagonCells(splitLine(lines[i]));

    // Auto-detect order. Three layouts are supported:
    //   NEW-4  (2026-06-17) — дата | накладная | вагон | объём
    //   NEW-3  (2026-06-26) — дата | вагон | объём        (без накладной)
    //   LEGACY            — вагон | объём | дата | накладная
    //
    // Sniff position 0 against the DATE PATTERN (not full validity).
    // An invalid date like «10.15.2026» still SHAPED like a date — we
    // route through the new layout and surface a date-format error
    // instead of silently treating the date string as the wagon number
    // (operator complaint 2026-06-24).
    //
    // When the first cell is a date AND there are exactly 3 cells, the
    // operator meant «дата → вагон → объём» (no waybill). Distinguish
    // from NEW-4 by counting cells: 3 → NEW-3, 4+ → NEW-4. Falls
    // through to LEGACY when cell[0] doesn't look like a date.
    const cell0IsDate = looksLikeDate(cells[0]);
    const isNew4 = cell0IsDate && cells.length >= 4;
    const isNew3 = cell0IsDate && cells.length === 3;

    let wagon: string;
    let volumeRaw: string | undefined;
    let dateRaw: string | undefined;
    let waybillRaw: string | undefined;

    if (isNew4) {
      dateRaw = cells[0];
      waybillRaw = cells[1];
      wagon = (cells[2] ?? "").replace(/\s/g, "");
      volumeRaw = cells[3];
    } else if (isNew3) {
      dateRaw = cells[0];
      waybillRaw = undefined;
      wagon = (cells[1] ?? "").replace(/\s/g, "");
      volumeRaw = cells[2];
    } else {
      wagon = (cells[0] ?? "").replace(/\s/g, "");
      volumeRaw = cells[1];
      dateRaw = cells[2];
      waybillRaw = cells[3];
    }

    const row: ParsedWagon = {
      wagon,
      volume: parseVolume(volumeRaw),
      date: parseDate(dateRaw),
      waybill: waybillRaw ? waybillRaw.trim() || null : null,
    };

    if (!wagon) {
      row.error = "Пустой № вагона";
    } else if (/[,.]/.test(wagon)) {
      // Wagon numbers are always plain digits (7-8 chars). A comma or
      // dot inside means the volume value leaked into the wagon column
      // — happens when the paste layout is misaligned (e.g. extra
      // trailing tab). Flag it so the row can't be silently saved.
      row.error = `«${wagon}» не похоже на номер вагона (запятая/точка). Проверьте порядок колонок.`;
    } else if (volumeRaw && row.volume == null) {
      row.error = `Не удалось прочитать объём: "${volumeRaw}"`;
    } else if (dateRaw && row.date == null) {
      row.error = `Неверный формат даты: "${dateRaw}"`;
    }

    out.push(row);
  }
  return out;
}

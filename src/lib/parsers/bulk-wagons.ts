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
  // Prefer tab (Excel paste)
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  // Fallback: two-or-more spaces
  const multi = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
  if (multi.length > 1) return multi;
  // Last resort: single whitespace
  return line.split(/\s+/).map((c) => c.trim()).filter(Boolean);
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
    const cells = splitLine(lines[i]);

    // Auto-detect order. The new (2026-06-17) Excel layout is
    //   дата | накладная | вагон | объём
    // The legacy layout was
    //   вагон | объём | дата | накладная
    // Sniff position 0 against the DATE PATTERN (not full validity).
    // An invalid date like «10.15.2026» still SHAPED like a date, so
    // operator who typed it that way clearly meant the new layout —
    // we route through the new layout and surface a date-format error
    // in the date column instead of silently treating the date string
    // as the wagon number (operator complaint 2026-06-24). Legacy
    // pastes (bare wagon first) still hit the fallback.
    const isNewLayout = looksLikeDate(cells[0]) && cells.length >= 2;

    let wagon: string;
    let volumeRaw: string | undefined;
    let dateRaw: string | undefined;
    let waybillRaw: string | undefined;

    if (isNewLayout) {
      dateRaw = cells[0];
      waybillRaw = cells[1];
      wagon = (cells[2] ?? "").replace(/\s/g, "");
      volumeRaw = cells[3];
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
    } else if (volumeRaw && row.volume == null) {
      row.error = `Не удалось прочитать объём: "${volumeRaw}"`;
    } else if (dateRaw && row.date == null) {
      row.error = `Неверный формат даты: "${dateRaw}"`;
    }

    out.push(row);
  }
  return out;
}

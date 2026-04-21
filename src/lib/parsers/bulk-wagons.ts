/**
 * Parses a multi-line paste (from Excel or hand-typed) into wagon rows.
 *
 * Input examples (one row per line):
 *   51742534                                           → wagon only
 *   51742534\t54,719                                   → wagon + volume
 *   51742534\t54.719\t05.11.2025                       → wagon + volume + date
 *   51742534\t54.719\t05.11.2025\tЭД0012345            → wagon + volume + date + waybill #
 *
 * Column order: wagon, volume, date, waybill. Volume column maps to either
 * `shipment_volume` or `loading_volume` at save time (UI toggle).
 *
 * Accepts:
 *   - Column separator: tab preferred; falls back to 2+ spaces, then single whitespace
 *   - Decimal separator: `,` or `.` (both converted to dot)
 *   - Date formats: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD → ISO YYYY-MM-DD
 *   - Leading/trailing whitespace trimmed per line and per cell
 *   - Empty lines skipped
 *   - First row skipped if it looks like a header (first cell is non-numeric text)
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

function looksLikeHeader(cells: string[]): boolean {
  const first = cells[0] ?? "";
  // Headers typically have at least one alpha char and don't start with a digit
  return /[A-Za-zА-Яа-яЁё]/.test(first) && !/^\d/.test(first);
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
    const wagon = (cells[0] ?? "").replace(/\s/g, "");
    const volumeRaw = cells[1];
    const dateRaw = cells[2];
    const waybillRaw = cells[3];

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

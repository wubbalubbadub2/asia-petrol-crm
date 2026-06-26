/**
 * Parse a user-typed number, tolerating both `.` and `,` as decimal
 * separator (operator request 2026-06-26 — Russian locale users type
 * «293,246» and expect it to land as 293.246 in Postgres).
 *
 * Returns `null` for empty/blank inputs and for inputs that can't
 * sensibly be parsed (NaN). NEVER returns the raw string — that's the
 * whole point: parseFloat() stops at the first comma, so a naive
 * `parseFloat("293,246")` yields 293 and silently drops the decimals,
 * but a path that skips parseFloat entirely (e.g. the Field component
 * when isNumeric=false) sends the literal "293,246" to the DB and
 * Postgres rejects it with «invalid input syntax for type numeric».
 *
 * Strips spaces (thousand separators) and converts only the LAST
 * occurrence of `,` or `.` to the decimal separator, so inputs like
 * «1 234,56» and «1.234,56» both parse to 1234.56.
 */
export function parseNum(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Remove all whitespace (thousand separators).
  let s = trimmed.replace(/\s/g, "");

  // If both `,` and `.` are present, the LAST one is the decimal
  // separator; everything else is a thousands separator.
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const decIdx = Math.max(lastDot, lastComma);
    const intPart = s.slice(0, decIdx).replace(/[.,]/g, "");
    const fracPart = s.slice(decIdx + 1);
    s = `${intPart}.${fracPart}`;
  } else if (lastComma !== -1) {
    // Only commas — treat the LAST one as decimal, earlier as thousands.
    const intPart = s.slice(0, lastComma).replace(/,/g, "");
    const fracPart = s.slice(lastComma + 1);
    s = `${intPart}.${fracPart}`;
  }
  // Only dots, or no separators — leave as is.

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

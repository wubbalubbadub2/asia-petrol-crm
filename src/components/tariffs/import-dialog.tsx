"use client";

// Excel import for /tariffs.
//
// Row source is a client-provided monthly rate sheet (пример:
// «Ставки Singularity июль 2026.xlsx»). Column order is not guaranteed —
// classifyHeader() maps each header cell to a logical role by pattern,
// so the sheet can be re-ordered freely between files. Extraneous
// columns (Ж/Д тарифы, Нормативы Грузия/Азербайджан, etc.) are simply
// ignored — we only touch the 5 fields tariffs cares about.
//
// Month + year are parsed from the filename (extractMonthYear). If a
// filename doesn't carry them, the form falls back to the current
// month/year and the operator can override before importing.

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, FileSpreadsheet, X, CheckCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

type Station = { id: string; name: string };
type Forwarder = { id: string; name: string };
type FuelType = { id: string; name: string };

type Refs = {
  stations: Station[];
  forwarders: Forwarder[];
  fuelTypes: FuelType[];
};

const MONTHS_RU_FULL = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

// Short-form months (client files may drop the last syllable, e.g.
// "янв 2026", "фев.xlsx"). Order matches the full-form array so a
// found index maps 1:1 to MONTHS_RU_FULL for storage.
const MONTHS_RU_ABBR = [
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function extractMonthYear(filename: string): { month?: string; year?: number } {
  const lower = filename.toLowerCase();
  let idx = MONTHS_RU_FULL.findIndex((m) => lower.includes(m));
  if (idx < 0) idx = MONTHS_RU_ABBR.findIndex((m) => lower.includes(m));
  const month = idx >= 0 ? MONTHS_RU_FULL[idx] : undefined;
  const yearMatch = lower.match(/20\d{2}/);
  const year = yearMatch ? Number(yearMatch[0]) : undefined;
  return { month, year };
}

type ColRole = "departure" | "destination" | "fuel" | "tariff" | "forwarder";

// Header → role. Regex-anchored to survive false positives from other
// columns that share substrings:
//   • "Норматив на погрузку (назначением Грузия)" contains "назначен"
//     but doesn't start with "станция"/"ст.", so it won't map to
//     destination.
//   • "Ж.Д. тарифы по территории" is *not* the rate column — we prefer
//     "ставк" as the tariff signal.
function classifyHeader(h: string): ColRole | null {
  const n = h.toLowerCase().trim().replace(/\s+/g, " ");
  if (/^(станция|ст\.?)\s+отправлен/.test(n)) return "departure";
  if (/^(станция|ст\.?)\s+назначен/.test(n)) return "destination";
  if (n === "груз" || /^товар/.test(n) || n === "гсм") return "fuel";
  if (/ставк/.test(n)) return "tariff";
  if (/^экспедитор/.test(n)) return "forwarder";
  return null;
}

// Loose name match: lower-case, trim, strip the «ст.»/«станция» prefix
// that every station in /spravochnik carries («ст. Текесу», «ст.Бухара»)
// but Excel rate sheets omit («Текесу»), swap dashes for spaces (so
// «Арыс-1» collapses onto «Арыс 1»), collapse whitespace, drop
// punctuation. Applied on both the DB side and the Excel side so the
// two representations end up identical.
//
// If two DB rows normalize to the same key we take the first — the
// /spravochnik owner is expected to dedupe those.
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^(станция|ст\.?)\s*/i, "")
    .replace(/[-–—_]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.,;:()"'`]/g, "")
    // Roman numerals I/II/III written as standalone words normalize to
    // arabic digits so «Бишкек I» matches «Бишкек 1» exactly. Covers
    // both Latin «i» (U+0069) and Cyrillic «і» (U+0456) since eyeballs
    // can't tell them apart in a mixed-script client file. Order iii
    // → ii → i so «ii» doesn't turn into «11».
    .replace(/\b[iі]{3}\b/g, "3")
    .replace(/\b[iі]{2}\b/g, "2")
    .replace(/\b[iі]\b/g, "1")
    .trim();
}

// Digits-only fingerprint. Used to gate fuzzy matching: «Арыс 1» and
// «Арыс 2» normalize to strings 1 char apart (85% similar), but they
// are different real-world stations. If digitsOf(a) !== digitsOf(b),
// reject fuzzy — an insertion/deletion of a digit is almost always a
// distinct route, not a typo.
function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

// Classic Levenshtein with the two-row rolling optimization. Called
// per (candidate × query), so N stations × M rows = ~15k calls on a
// typical monthly sheet — fine at O(len_a × len_b) with strings of
// ~15 chars.
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Normalized-Levenshtein similarity gated by three cheap heuristics:
//   • digitsOf must be identical — «Арыс 1» never matches «Арыс 2».
//   • length delta ≤ 2 — «мазут» never bridges to «мазутный М-100».
//   • shortest side must be ≥ 5 chars — for «Ош» a 1-char edit is
//     already 50% distance; short names must match exactly.
// Threshold 0.8 chosen so «токмок» vs «токмак» (5/6 = 0.833) is
// accepted as a typo while «арыс» vs «арыс 1» is not (extra token).
function isFuzzyMatch(a: string, b: string, threshold = 0.8): boolean {
  if (a === b) return true;
  if (digitsOf(a) !== digitsOf(b)) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  if (Math.min(a.length, b.length) < 5) return false;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length) >= threshold;
}

type NormRef = { id: string; name: string; norm: string };

function normalizeRefs<T extends { id: string; name: string }>(items: T[]): NormRef[] {
  return items.map((it) => ({ id: it.id, name: it.name, norm: normalizeName(it.name) }));
}

type MatchResult = { id: string; name: string; exact: boolean } | null;

// Two-pass matcher: exact-normalized first (O(N) scan on precomputed
// keys, hits in the common case), then a fuzzy sweep that picks the
// single best candidate above the threshold. Returns the resolved
// name so the preview can show the operator which DB entity a fuzzy
// input was collapsed onto — otherwise a bad match would silently
// land the tariff on the wrong station.
function matchByName(text: string, norms: NormRef[]): MatchResult {
  const q = normalizeName(text);
  if (!q) return null;
  const exact = norms.find((c) => c.norm === q);
  if (exact) return { id: exact.id, name: exact.name, exact: true };
  let bestScore = 0;
  let best: NormRef | null = null;
  for (const c of norms) {
    if (!isFuzzyMatch(q, c.norm)) continue;
    const d = levenshtein(q, c.norm);
    const score = 1 - d / Math.max(q.length, c.norm.length);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ? { id: best.id, name: best.name, exact: false } : null;
}

type ParsedRow = {
  rowIndex: number;
  departureText: string;
  destinationText: string;
  fuelText: string;
  forwarderText: string;
  tariff: number | null;
  departureId: string | null;
  destinationId: string | null;
  fuelId: string | null;
  forwarderId: string | null; // null means "не указан" — legal
  // Names of the DB entities the row was matched against. Populated
  // for every non-null match (exact or fuzzy). The preview surfaces
  // these when they differ from the Excel text so the operator can
  // catch a wrong fuzzy match before importing.
  departureMatch: string | null;
  destinationMatch: string | null;
  fuelMatch: string | null;
  forwarderMatch: string | null;
  fuzzyDeparture: boolean;
  fuzzyDestination: boolean;
  fuzzyFuel: boolean;
  fuzzyForwarder: boolean;
  status: "ok" | "skip";
  reasons: string[];
};

function classify(rows: string[][], refs: Refs): ParsedRow[] {
  if (rows.length === 0) return [];
  const headerRow = rows[0].map((c) => String(c ?? ""));
  const roles = headerRow.map(classifyHeader);
  const idxOf: Record<ColRole, number> = {
    departure: roles.indexOf("departure"),
    destination: roles.indexOf("destination"),
    fuel: roles.indexOf("fuel"),
    tariff: roles.indexOf("tariff"),
    forwarder: roles.indexOf("forwarder"),
  };
  const stNorms = normalizeRefs(refs.stations);
  const fwNorms = normalizeRefs(refs.forwarders);
  const fuelNorms = normalizeRefs(refs.fuelTypes);
  const out: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw || raw.every((c) => c == null || String(c).trim() === "")) continue;
    const cell = (idx: number) => (idx >= 0 && raw[idx] != null ? String(raw[idx]).trim() : "");
    const departureText = cell(idxOf.departure);
    const destinationText = cell(idxOf.destination);
    const fuelText = cell(idxOf.fuel);
    const forwarderText = cell(idxOf.forwarder);
    const tariffRaw = cell(idxOf.tariff);
    const tariff = tariffRaw ? parseFloat(tariffRaw.replace(",", ".")) : null;

    const dep = departureText ? matchByName(departureText, stNorms) : null;
    const dst = destinationText ? matchByName(destinationText, stNorms) : null;
    const fuel = fuelText ? matchByName(fuelText, fuelNorms) : null;
    const fw = forwarderText ? matchByName(forwarderText, fwNorms) : null;

    const reasons: string[] = [];
    if (!tariff || !Number.isFinite(tariff)) reasons.push("нет ставки");
    if (departureText && !dep) reasons.push(`ст. отпр. «${departureText}» не найдена`);
    if (destinationText && !dst) reasons.push(`ст. назн. «${destinationText}» не найдена`);
    if (fuelText && !fuel) reasons.push(`груз «${fuelText}» не найден`);
    if (forwarderText && !fw) reasons.push(`экспедитор «${forwarderText}» не найден`);
    // Не пускаем строку, если нет ставки или хотя бы одна станция/груз
    // указаны текстом, но не сматчились — иначе получим полу-заполненный
    // тариф без FK, который потом никак не найти.
    const canInsert =
      tariff != null &&
      Number.isFinite(tariff) &&
      (!departureText || !!dep) &&
      (!destinationText || !!dst) &&
      (!fuelText || !!fuel) &&
      (!forwarderText || !!fw);

    out.push({
      rowIndex: i,
      departureText,
      destinationText,
      fuelText,
      forwarderText,
      tariff: tariff != null && Number.isFinite(tariff) ? tariff : null,
      departureId: dep?.id ?? null,
      destinationId: dst?.id ?? null,
      fuelId: fuel?.id ?? null,
      forwarderId: fw?.id ?? null,
      departureMatch: dep?.name ?? null,
      destinationMatch: dst?.name ?? null,
      fuelMatch: fuel?.name ?? null,
      forwarderMatch: fw?.name ?? null,
      fuzzyDeparture: !!dep && !dep.exact,
      fuzzyDestination: !!dst && !dst.exact,
      fuzzyFuel: !!fuel && !fuel.exact,
      fuzzyForwarder: !!fw && !fw.exact,
      status: canInsert ? "ok" : "skip",
      reasons,
    });
  }
  return out;
}

export function ImportTariffsDialog({
  open,
  onClose,
  onImported,
  refs,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  refs: Refs;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  // Operator overrides for the auto-matched values. Keyed by
  // `${rowIndex}:${field}`; the special sentinel «"" (empty string)»
  // means the operator explicitly cleared the field so we don't fall
  // back to the auto-match on the next render. `null` in the value
  // slot is legal (forwarder can be blank), so we can't overload
  // "map.has(key)" with a null-marker.
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [month, setMonth] = useState<string>(MONTHS_RU_FULL[new Date().getMonth()]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset local state whenever the dialog closes so re-opening it
  // doesn't leak the previous file's preview.
  useEffect(() => {
    if (!open) {
      setFileName(null);
      setRows([]);
      setOverrides(new Map());
      setMonth(MONTHS_RU_FULL[new Date().getMonth()]);
      setYear(new Date().getFullYear());
    }
  }, [open]);

  const stationOpts = useMemo(
    () => refs.stations.map((s) => ({ value: s.id, label: s.name })),
    [refs.stations],
  );
  const forwarderOpts = useMemo(
    () => refs.forwarders.map((f) => ({ value: f.id, label: f.name })),
    [refs.forwarders],
  );
  const fuelOpts = useMemo(
    () => refs.fuelTypes.map((f) => ({ value: f.id, label: f.name })),
    [refs.fuelTypes],
  );

  function setOverride(rowIdx: number, field: "dep" | "dst" | "fuel" | "fw", id: string) {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(`${rowIdx}:${field}`, id);
      return next;
    });
  }
  function readOverride(
    rowIdx: number,
    field: "dep" | "dst" | "fuel" | "fw",
    fallback: string | null,
  ): string | null {
    const key = `${rowIdx}:${field}`;
    if (overrides.has(key)) {
      const v = overrides.get(key)!;
      return v === "" ? null : v;
    }
    return fallback;
  }

  // Re-derive per-row status from the overrides on every render. Cheap
  // (linear over ~50 rows) and keeps the import button count in sync
  // with what the operator has fixed manually.
  const effectiveRows = useMemo(() => {
    return rows.map((r) => {
      const depId = readOverride(r.rowIndex, "dep", r.departureId);
      const dstId = readOverride(r.rowIndex, "dst", r.destinationId);
      const fuelId = readOverride(r.rowIndex, "fuel", r.fuelId);
      const fwId = readOverride(r.rowIndex, "fw", r.forwarderId);
      const canInsert =
        r.tariff != null &&
        Number.isFinite(r.tariff) &&
        (!r.departureText || !!depId) &&
        (!r.destinationText || !!dstId) &&
        (!r.fuelText || !!fuelId) &&
        (!r.forwarderText || !!fwId);
      return { row: r, depId, dstId, fuelId, fwId, status: canInsert ? "ok" as const : "skip" as const };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, overrides]);

  async function handleFile(f: File) {
    setParsing(true);
    try {
      setFileName(f.name);
      const guess = extractMonthYear(f.name);
      if (guess.month) setMonth(guess.month);
      if (guess.year) setYear(guess.year);

      const XLSX = await import("xlsx");
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // header: 1 → array-of-arrays; keeps original column order so
      // classifyHeader() can walk indices instead of relying on
      // sheet_to_json's kv default (which collapses duplicate headers).
      const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false, defval: null });
      const parsed = classify(aoa, refs);
      setRows(parsed);
      const okCount = parsed.filter((r) => r.status === "ok").length;
      const skipCount = parsed.length - okCount;
      toast.success(`Распознано ${parsed.length} строк — готово к импорту: ${okCount}${skipCount ? `, пропущено: ${skipCount}` : ""}`);
    } catch (err) {
      toast.error(`Ошибка чтения файла: ${(err as Error).message}`);
    } finally {
      setParsing(false);
    }
  }

  function pickFile() {
    inputRef.current?.click();
  }
  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  async function handleImport() {
    const okRows = effectiveRows.filter((e) => e.status === "ok");
    if (okRows.length === 0) {
      toast.error("Нет строк для импорта");
      return;
    }
    if (!month || !year) {
      toast.error("Укажите месяц и год");
      return;
    }
    setImporting(true);
    const sb = createClient();
    // Batch insert one write per file — same rate sheet is usually
    // <100 rows and Supabase happily handles a single .insert with
    // the whole array. If duplicates hit the (station×station×fw×fuel
    // ×month×year) UNIQUE index the whole batch rolls back and we
    // surface the DB error to the operator so they can decide whether
    // to delete the previous month's row and re-import.
    const payload = okRows.map((e) => ({
      destination_station_id: e.dstId,
      departure_station_id: e.depId,
      forwarder_id: e.fwId,
      fuel_type_id: e.fuelId,
      month,
      year,
      planned_tariff: e.row.tariff,
    }));
    const { error } = await sb.from("tariffs").insert(payload);
    setImporting(false);
    if (error) {
      const dup = /duplicate|unique/i.test(error.message);
      toast.error(dup
        ? `Часть строк уже есть за ${month} ${year}. Удалите старые тарифы или измените месяц/год. (${error.message})`
        : `Ошибка импорта: ${error.message}`);
      return;
    }
    toast.success(`Импортировано ${okRows.length} тарифов`);
    onImported();
    onClose();
  }

  const okCount = useMemo(() => effectiveRows.filter((e) => e.status === "ok").length, [effectiveRows]);
  const skipCount = effectiveRows.length - okCount;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Импорт тарифов из Excel</DialogTitle>
        </DialogHeader>

        {/* Step 1: file upload */}
        {rows.length === 0 && (
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            className="rounded-lg border-2 border-dashed border-stone-300 bg-stone-50/50 p-8 text-center transition-colors hover:border-amber-400 hover:bg-amber-50/30"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={onInput}
              className="hidden"
            />
            {fileName ? (
              <div className="space-y-2">
                <FileSpreadsheet className="h-8 w-8 text-green-600 mx-auto" />
                <p className="text-[13px] font-medium text-stone-700">{fileName}</p>
                {parsing && <p className="text-[12px] text-amber-600">Обработка...</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-8 w-8 text-stone-400 mx-auto" />
                <p className="text-[13px] text-stone-600">
                  Перетащите Excel файл или{" "}
                  <button
                    onClick={pickFile}
                    className="text-amber-600 font-medium hover:underline"
                  >
                    выберите файл
                  </button>
                </p>
                <p className="text-[11px] text-stone-400">
                  Мы попробуем определить месяц и год по имени файла
                  <br />
                  (пример: «Ставки Singularity июль 2026.xlsx»)
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 2: month/year + preview */}
        {rows.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3 rounded-md border border-stone-200 bg-stone-50/40 p-3">
              <div className="flex items-center gap-2 text-[12px] text-stone-600">
                <FileSpreadsheet className="h-4 w-4 text-green-600" />
                <span className="font-medium">{fileName}</span>
              </div>
              <div className="ml-auto flex flex-wrap items-end gap-2">
                <div>
                  <Label className="text-[11px] text-stone-500">Месяц</Label>
                  <select
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
                  >
                    {MONTHS_RU_FULL.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-[11px] text-stone-500">Год</Label>
                  <Input
                    type="number"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    className="h-8 w-24 text-[13px] font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-green-700">
                <CheckCircle className="h-3 w-3" /> К импорту: {okCount}
              </span>
              {skipCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-amber-700">
                  <AlertTriangle className="h-3 w-3" /> Пропущено: {skipCount}
                </span>
              )}
            </div>

            <div className="max-h-[45vh] overflow-auto rounded-md border border-stone-200">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-stone-50">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium text-stone-600 w-8">#</th>
                    <th className="px-2 py-1 text-left font-medium text-stone-600">Ст. отправления</th>
                    <th className="px-2 py-1 text-left font-medium text-stone-600">Ст. назначения</th>
                    <th className="px-2 py-1 text-left font-medium text-stone-600">Груз</th>
                    <th className="px-2 py-1 text-left font-medium text-stone-600">Экспедитор</th>
                    <th className="px-2 py-1 text-right font-medium text-stone-600">Ставка</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveRows.map((e) => {
                    const r = e.row;
                    // Editable cell. Three visual modes based on the
                    // current effective FK (which folds in operator
                    // overrides):
                    //  • exact auto-match → plain text, no selector
                    //  • fuzzy auto-match or manual override → text
                    //    + a picker underneath so the operator can
                    //    swap to a different DB entity if the guess
                    //    is wrong
                    //  • unresolved → red text + empty picker
                    const cell = (
                      field: "dep" | "dst" | "fuel" | "fw",
                      text: string,
                      currentId: string | null,
                      autoMatchedId: string | null,
                      autoMatchedName: string | null,
                      wasFuzzy: boolean,
                      options: { value: string; label: string }[],
                    ) => {
                      if (!text) return <span className="text-stone-300">—</span>;
                      const isExactAuto =
                        currentId === autoMatchedId && !!currentId && !wasFuzzy;
                      const isManual =
                        overrides.has(`${r.rowIndex}:${field}`);
                      // Plain (no editor) when the auto-match was exact
                      // and the operator hasn't touched it — 90% of rows
                      // in a well-maintained справочник fall here, so we
                      // avoid mounting one SearchableSelect per cell.
                      if (isExactAuto && !isManual) {
                        return <span className="text-stone-700">{text}</span>;
                      }
                      const textColor = currentId
                        ? isManual
                          ? "text-blue-700"
                          : "text-amber-700"
                        : "text-red-600";
                      return (
                        <div className="space-y-0.5">
                          <div className={`text-[11px] ${textColor}`}>{text}</div>
                          {wasFuzzy && !isManual && autoMatchedName && (
                            <div className="text-[9px] text-amber-600 leading-tight">
                              → {autoMatchedName}
                            </div>
                          )}
                          <SearchableSelect
                            value={currentId ?? ""}
                            onChange={(v) => setOverride(r.rowIndex, field, v)}
                            options={options}
                            placeholder={isManual ? "выбрано вручную" : "— выбрать —"}
                            searchPlaceholder="Поиск…"
                            triggerClassName="h-6 text-[11px] px-1.5"
                          />
                        </div>
                      );
                    };
                    return (
                      <tr
                        key={r.rowIndex}
                        className={`border-t ${e.status === "skip" ? "bg-red-50/30" : ""}`}
                      >
                        <td className="px-2 py-1 text-stone-400 tabular-nums align-top">{r.rowIndex}</td>
                        <td className="px-2 py-1 align-top min-w-[160px]">
                          {cell("dep", r.departureText, e.depId, r.departureId, r.departureMatch, r.fuzzyDeparture, stationOpts)}
                        </td>
                        <td className="px-2 py-1 align-top min-w-[200px]">
                          {cell("dst", r.destinationText, e.dstId, r.destinationId, r.destinationMatch, r.fuzzyDestination, stationOpts)}
                        </td>
                        <td className="px-2 py-1 align-top min-w-[130px]">
                          {cell("fuel", r.fuelText, e.fuelId, r.fuelId, r.fuelMatch, r.fuzzyFuel, fuelOpts)}
                        </td>
                        <td className="px-2 py-1 align-top min-w-[130px]">
                          {cell("fw", r.forwarderText, e.fwId, r.forwarderId, r.forwarderMatch, r.fuzzyForwarder, forwarderOpts)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums text-stone-700 align-top">
                          {r.tariff != null
                            ? r.tariff.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
                            : <span className="text-red-600">нет</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-stone-500 leading-relaxed">
              <span className="text-amber-700">Оранжевым</span> — значения, найденные приблизительно;
              «→» показывает автоматически подобранное имя из справочника.{" "}
              <span className="text-red-600">Красным</span> — значения, которых не нашлось.{" "}
              <span className="text-blue-700">Синим</span> — значения, выбранные вручную.{" "}
              Любую ячейку с оранжевой/красной/синей подписью можно поправить через выпадающий список под текстом.
              Строки без выбранного значения (кроме экспедитора) будут пропущены.
            </p>
          </div>
        )}

        <div className="flex gap-2 mt-2">
          {rows.length > 0 && (
            <Button
              onClick={handleImport}
              disabled={importing || okCount === 0}
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
            >
              {importing ? "Импорт..." : `Импортировать ${okCount} тарифов`}
            </Button>
          )}
          {rows.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setRows([]);
                setFileName(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              <X className="h-4 w-4 mr-1" />
              Другой файл
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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

// Loose name match: lower-case, trim, collapse whitespace, drop most
// punctuation. Enough for the free-hand naming clients tend to use
// ("Актобе 2" vs "Актобе-2" vs "актобе  2") without pulling in a full
// fuzzy library. If two DB rows normalize to the same key we take the
// first — the /spravochnik owner is expected to dedupe those.
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:()"'`]/g, "");
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
  status: "ok" | "skip";
  reasons: string[];
};

function buildLookup<T extends { id: string; name: string }>(items: T[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of items) {
    const key = normalizeName(it.name);
    if (!m.has(key)) m.set(key, it.id);
  }
  return m;
}

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
  const stLookup = buildLookup(refs.stations);
  const fwLookup = buildLookup(refs.forwarders);
  const fuelLookup = buildLookup(refs.fuelTypes);
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

    const departureId = departureText ? (stLookup.get(normalizeName(departureText)) ?? null) : null;
    const destinationId = destinationText ? (stLookup.get(normalizeName(destinationText)) ?? null) : null;
    const fuelId = fuelText ? (fuelLookup.get(normalizeName(fuelText)) ?? null) : null;
    const forwarderId = forwarderText ? (fwLookup.get(normalizeName(forwarderText)) ?? null) : null;

    const reasons: string[] = [];
    if (!tariff || !Number.isFinite(tariff)) reasons.push("нет ставки");
    if (departureText && !departureId) reasons.push(`ст. отпр. «${departureText}» не найдена`);
    if (destinationText && !destinationId) reasons.push(`ст. назн. «${destinationText}» не найдена`);
    if (fuelText && !fuelId) reasons.push(`груз «${fuelText}» не найден`);
    if (forwarderText && !forwarderId) reasons.push(`экспедитор «${forwarderText}» не найден`);
    // Не пускаем строку, если нет ставки или хотя бы одна станция/груз
    // указаны текстом, но не сматчились — иначе получим полу-заполненный
    // тариф без FK, который потом никак не найти.
    const canInsert =
      tariff != null &&
      Number.isFinite(tariff) &&
      (!departureText || !!departureId) &&
      (!destinationText || !!destinationId) &&
      (!fuelText || !!fuelId) &&
      (!forwarderText || !!forwarderId);

    out.push({
      rowIndex: i,
      departureText,
      destinationText,
      fuelText,
      forwarderText,
      tariff: tariff != null && Number.isFinite(tariff) ? tariff : null,
      departureId,
      destinationId,
      fuelId,
      forwarderId,
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
      setMonth(MONTHS_RU_FULL[new Date().getMonth()]);
      setYear(new Date().getFullYear());
    }
  }, [open]);

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
    const okRows = rows.filter((r) => r.status === "ok");
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
    const payload = okRows.map((r) => ({
      destination_station_id: r.destinationId,
      departure_station_id: r.departureId,
      forwarder_id: r.forwarderId,
      fuel_type_id: r.fuelId,
      month,
      year,
      planned_tariff: r.tariff,
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

  const okCount = useMemo(() => rows.filter((r) => r.status === "ok").length, [rows]);
  const skipCount = rows.length - okCount;

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
                    <th className="px-2 py-1 text-left font-medium text-stone-600">Заметки</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.rowIndex}
                      className={`border-t ${r.status === "skip" ? "bg-amber-50/40" : ""}`}
                    >
                      <td className="px-2 py-1 text-stone-400 tabular-nums">{r.rowIndex}</td>
                      <td className={`px-2 py-1 ${r.departureText && !r.departureId ? "text-red-600" : "text-stone-700"}`}>
                        {r.departureText || <span className="text-stone-300">—</span>}
                      </td>
                      <td className={`px-2 py-1 ${r.destinationText && !r.destinationId ? "text-red-600" : "text-stone-700"}`}>
                        {r.destinationText || <span className="text-stone-300">—</span>}
                      </td>
                      <td className={`px-2 py-1 ${r.fuelText && !r.fuelId ? "text-red-600" : "text-stone-700"}`}>
                        {r.fuelText || <span className="text-stone-300">—</span>}
                      </td>
                      <td className={`px-2 py-1 ${r.forwarderText && !r.forwarderId ? "text-red-600" : "text-stone-700"}`}>
                        {r.forwarderText || <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums text-stone-700">
                        {r.tariff != null
                          ? r.tariff.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
                          : <span className="text-red-600">нет</span>}
                      </td>
                      <td className="px-2 py-1 text-[10px] text-amber-700">
                        {r.reasons.join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-stone-500">
              Красным выделены значения, которых нет в справочнике — их нужно сначала добавить
              в разделе <span className="font-medium">Справочник</span>, затем повторить импорт.
              Пропущенные строки не будут добавлены.
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

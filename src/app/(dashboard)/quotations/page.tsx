"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, ArrowLeft, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useQuotationProductTypes,
  useQuotations,
  type Quotation,
  type QuotationProductType,
} from "@/lib/hooks/use-quotations";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { getColumnsForProduct, type QuotationColumn } from "@/lib/constants/quotation-columns";
import { useRole } from "@/lib/hooks/use-role";
import { createClient } from "@/lib/supabase/client";
import { PriceCalculator } from "@/components/quotations/price-calculator";
import { QuotationSummary } from "@/components/quotations/quotation-summary";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

// --- Helpers ---
function getDaysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const daysCount = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysCount; d++) {
    days.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return days;
}
// Excel-style DD.MM.YYYY date label; matches the operator's source
// files (`01.06.2026`, not `1`). Keeps the column narrow because the
// number remains tabular and same-width across rows.
function formatDateDMY(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y}`;
}
function isWeekend(dateStr: string): boolean { const d = new Date(dateStr + "T00:00:00").getDay(); return d === 0 || d === 6; }
// Russian-locale 3-decimal format with comma separator
// («896,500» instead of «896.500») — copied from Excel's General
// number format on the source files.
const NUM_FMT = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
  useGrouping: false,
});
function fmtNum(n: number | null | undefined): string {
  return n == null ? "" : NUM_FMT.format(n);
}

// --- Editable Text Cell (for comments) ---
// Free-form text is the only column that stays left-aligned (Excel
// would do the same — only numerics get centered). Same font size as
// the numeric cells so the grid reads as one rhythm instead of mixed
// tiers.
function EditableTextQCell({ value, onSave, disabled }: { value: string | null; onSave: (val: string | null) => void; disabled: boolean }) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  if (disabled) return <span className="text-[11px] text-stone-500 truncate block">{value ?? ""}</span>;
  if (!editing) return (
    <button onClick={() => { setLocalVal(value ?? ""); setEditing(true); }}
      className="w-full text-left text-[11px] hover:bg-amber-100/40 cursor-text min-h-[18px] truncate text-stone-700">
      {value ?? ""}
    </button>
  );
  return (
    <input autoFocus value={localVal} onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => { setEditing(false); const v = localVal.trim() || null; if (v !== value) onSave(v as unknown as string | null); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-full border border-amber-400 px-1 py-0 text-[11px] bg-amber-50 focus:outline-none" />
  );
}

// --- Editable Cell ---
// Excel parity: numbers center-aligned, 3 decimals with Russian
// comma decimal separator («896,500») — matches the operator's
// `files/Котировки/*.xlsx` display format exactly.
function EditableCell({ value, onSave, disabled }: { value: number | null; onSave: (val: number | null) => void; disabled: boolean }) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const display = fmtNum(value);
  if (disabled) return <span className="font-mono text-[11px] tabular-nums text-stone-500">{display}</span>;
  if (!editing) return (
    <button onClick={() => { setLocalVal(value?.toString() ?? ""); setEditing(true); }}
      className="w-full text-center font-mono text-[11px] tabular-nums hover:bg-amber-100/40 cursor-text min-h-[18px]">
      {display}
    </button>
  );
  return (
    <input autoFocus type="number" step="0.01" value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => { setEditing(false); const num = localVal.trim() === "" ? null : parseFloat(localVal); if (num !== value) onSave(num); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-full border border-amber-400 px-0.5 py-0 text-[11px] font-mono text-center bg-amber-50 focus:outline-none" />
  );
}

// --- Add Product Type Dialog ---
function AddProductTypeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState(""); const [subName, setSubName] = useState(""); const [basis, setBasis] = useState(""); const [saving, setSaving] = useState(false);
  async function handleSave() {
    if (!name.trim()) { toast.error("Введите наименование"); return; }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("quotation_product_types").insert({ name: name.trim(), sub_name: subName.trim() || null, basis: basis.trim() || null, sort_order: 100 });
    if (error) toast.error(`Ошибка: ${error.message}`);
    else { toast.success("Тип котировки добавлен"); setName(""); setSubName(""); setBasis(""); onClose(); }
    setSaving(false);
  }
  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Добавить тип котировки</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Наименование</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ГАЗОЙЛЬ 0,1%" /></div>
          <div><Label>Подвид</Label><Input value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="CIF NWE/Basis ARA" /></div>
          <div><Label>Базис</Label><Input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="FOB Rotterdam" /></div>
          <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Сохранение..." : "Добавить"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Product Type Card (drill-down detail) ---
function QuotationDetail({ productType, onBack }: { productType: QuotationProductType; onBack: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { data: quotations, upsert, reload } = useQuotations(year, month);
  const { isWritable } = useRole();
  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const quotMap = useMemo(() => {
    const map: Record<string, Quotation> = {};
    for (const q of quotations) if (q.product_type_id === productType.id) map[q.date] = q;
    return map;
  }, [quotations, productType.id]);

  // Product-specific columns from Excel format
  const PRICE_COLS = useMemo(() => getColumnsForProduct(productType.name), [productType.name]);
  // Editable numeric (≠ comment, ≠ formula) and formula columns are
  // surfaced separately in the footer — split here so the render stays
  // declarative. Recomputed only when PRICE_COLS changes (product
  // switch), not on every keystroke.
  const editableNumericCols = useMemo(
    () => PRICE_COLS.filter((c) => c.editable && c.key !== "comment"),
    [PRICE_COLS],
  );
  const formulaCols = useMemo(
    () => PRICE_COLS.filter((c) => c.formula === "avg"),
    [PRICE_COLS],
  );
  // Show days that already have data + days the user manually added
  // via «+ день». If the month has nothing yet (initial population),
  // fall back to all weekdays so the user has something to click
  // into. Matches Excel: the operator's spreadsheets only list days
  // that were actually quoted — empty rows for unquoted trading days
  // are skipped entirely.
  const [extraDays, setExtraDays] = useState<Set<string>>(new Set());
  useEffect(() => { setExtraDays(new Set()); }, [year, month]);
  const visibleDays = useMemo(() => {
    const set = new Set<string>();
    for (const d of days) {
      if (quotMap[d]) set.add(d);
      if (extraDays.has(d)) set.add(d);
    }
    if (set.size === 0) {
      for (const d of days) if (!isWeekend(d)) set.add(d);
    }
    return Array.from(set).sort();
  }, [days, quotMap, extraDays]);
  // The next addable day = first weekday in the month that isn't
  // already visible. Fallback for browsers that don't expose
  // `input.showPicker()` — the «+ день» button just adds the next
  // empty weekday in that case.
  const nextAddableDay = useMemo(() => {
    const visible = new Set(visibleDays);
    return days.find((d) => !isWeekend(d) && !visible.has(d)) ?? null;
  }, [days, visibleDays]);
  // The hidden date input that the «+ день» button drives via
  // showPicker(). Kept off-screen with sr-only so screen readers
  // still find it.
  const addDayInputRef = useRef<HTMLInputElement>(null);
  // Index of the column where Excel parks every per-column average
  // value (the first editable numeric column — column C in the
  // operator's spreadsheets, regardless of which column the data
  // actually comes from). Adjusts automatically for products with a
  // different lead column.
  const firstNumericColIdx = useMemo(
    () => PRICE_COLS.findIndex((c) => c.editable && c.key !== "comment"),
    [PRICE_COLS],
  );

  function getAvg(field: string): number | null {
    if (field === "comment") return null;
    // For formula columns, recompute per-day then average
    const formulaCol = PRICE_COLS.find((c) => c.key === field && c.formula === "avg");
    if (formulaCol) {
      const srcKeys = formulaCol.avgOf ?? PRICE_COLS.filter((c) => c.editable && c.key !== "comment").map((c) => c.key);
      const dayAvgs: number[] = [];
      for (const q of Object.values(quotMap)) {
        const vals = srcKeys.map((k) => (q as Record<string, unknown>)[k] as number | null).filter((v): v is number => v != null);
        if (vals.length >= 2) dayAvgs.push(vals.reduce((a, b) => a + b, 0) / vals.length);
      }
      return dayAvgs.length > 0 ? dayAvgs.reduce((a, b) => a + b, 0) / dayAvgs.length : null;
    }
    const vals = Object.values(quotMap).map((q) => (q as Record<string, unknown>)[field] as number | null).filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  // Auto-calculate formula columns (Среднее) when editable columns change
  // Excel formula: =IF(((price1+price2)/2)=0,"",((price1+price2)/2))
  function handleCellSave(day: string, field: string, val: number | null) {
    upsert(productType.id, day, field, val);

    // Check if any formula column needs recalculation
    const formulaCols = PRICE_COLS.filter((c) => c.formula === "avg");
    if (formulaCols.length === 0) return;

    const q = quotMap[day];
    for (const fc of formulaCols) {
      // Use specific avgOf fields if defined, otherwise average all editable
      const sourceCols = fc.avgOf
        ? PRICE_COLS.filter((c) => fc.avgOf!.includes(c.key))
        : PRICE_COLS.filter((c) => c.editable && c.key !== "comment");
      const values = sourceCols.map((c) => {
        if (c.key === field) return val;
        return (q as Record<string, unknown> | undefined)?.[c.key] as number | null ?? null;
      }).filter((v): v is number => v != null);
      if (values.length >= 2) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        upsert(productType.id, day, fc.key, avg);
      }
    }
  }

  function prevMonth() { if (month === 1) { setMonth(12); setYear(year - 1); } else setMonth(month - 1); }
  function nextMonth() { if (month === 12) { setMonth(1); setYear(year + 1); } else setMonth(month + 1); }

  // Excel export — user picks which columns to include first. Defaults
  // to every column on screen; sticky per-session selection lives in the
  // dialog's own state so re-exporting the same product doesn't force
  // them to re-check the same boxes.
  const [exporting, setExporting] = useState(false);
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(() => PRICE_COLS.map((c) => c.key));
  // Reset selection when the product (and thus column list) changes.
  useEffect(() => {
    setSelectedColumns(PRICE_COLS.map((c) => c.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productType.id]);

  // Column selection used to be operator-chosen before export
  // (checkbox dialog), but operator 2026-06-23: «Столбцы при выгрузке
  // должны оставаться. Столбцы не изменны, а выбор идёт тока строки».
  // Always export every column the product carries — only month / row
  // scope is variable. The dialog and checkbox state stay around to
  // avoid a wider refactor but no longer gate the export.
  async function openExportDialog() {
    if (exporting) return;
    setExporting(true);
    try {
      const { exportQuotationsToExcel } = await import("@/lib/exports/quotations-excel");
      const n = await exportQuotationsToExcel({
        productTypeId: productType.id,
        productName: productType.name,
        // No columnKeys override → export all PRICE_COLS for the product.
      });
      toast.success(`Файл готов: ${n} строк`);
    } catch (e) {
      toast.error(`Не удалось экспортировать: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  // Kept for backward-compat with any inline dialog references that
  // weren't ripped out — no longer reachable via UI.
  async function runExport() {
    await openExportDialog();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h2 className="text-lg font-bold">{productType.name}</h2>
          {productType.sub_name && <p className="text-[12px] text-stone-500">{productType.sub_name}</p>}
        </div>
        <Button size="sm" variant="outline" onClick={openExportDialog} disabled={exporting} title="Экспорт котировок этой категории в Excel">
          {exporting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
          Excel
        </Button>
        {/* «+ день»: button opens the native HTML date picker pinned
            to the visible month — so the operator can insert ANY
            date (Excel-style backfill), including a gap between
            existing rows or a weekend. Falls back to «next unquoted
            weekday» if the browser doesn't support showPicker(). */}
        {isWritable && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const input = addDayInputRef.current;
                if (input && typeof input.showPicker === "function") {
                  try { input.showPicker(); return; } catch { /* fall through */ }
                }
                if (nextAddableDay) {
                  setExtraDays((prev) => new Set([...prev, nextAddableDay]));
                }
              }}
              title="Добавить строку для конкретной даты"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              день
            </Button>
            <input
              ref={addDayInputRef}
              type="date"
              min={`${year}-${String(month).padStart(2, "0")}-01`}
              max={`${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`}
              className="sr-only"
              aria-label="Добавить день в котировки"
              tabIndex={-1}
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return;
                setExtraDays((prev) => new Set([...prev, val]));
                e.target.value = "";
              }}
            />
          </>
        )}

        <Dialog open={columnDialogOpen} onOpenChange={setColumnDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Колонки для выгрузки</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[12px] text-stone-500">
                <span>{productType.name}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedColumns(PRICE_COLS.map((c) => c.key))}
                    className="text-amber-600 hover:text-amber-700"
                  >
                    Выбрать все
                  </button>
                  <span className="text-stone-300">·</span>
                  <button
                    type="button"
                    onClick={() => setSelectedColumns([])}
                    className="text-stone-600 hover:text-stone-700"
                  >
                    Снять все
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                {PRICE_COLS.map((col) => {
                  const checked = selectedColumns.includes(col.key);
                  return (
                    <label
                      key={col.key}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-stone-50 cursor-pointer text-[13px]"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) => {
                          const on = c === true;
                          setSelectedColumns((prev) =>
                            on ? [...new Set([...prev, col.key])] : prev.filter((k) => k !== col.key),
                          );
                        }}
                      />
                      <span className="flex-1">{col.label}</span>
                      {col.formula === "avg" && (
                        <span className="text-[10px] text-amber-600">формула</span>
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" size="sm" onClick={() => setColumnDialogOpen(false)}>
                  Отмена
                </Button>
                <Button type="button" size="sm" onClick={runExport} disabled={selectedColumns.length === 0}>
                  <Download className="mr-1 h-3.5 w-3.5" />
                  Выгрузить ({selectedColumns.length})
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <div className="ml-auto flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium min-w-[130px] text-center capitalize">{MONTHS_RU[month - 1]} {year}</span>
          <Button variant="outline" size="sm" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {/*
        Excel-parity layout. Operator feedback: the previous table was
        «размазано» — full-screen wide, every day of the month rendered
        as its own row including weekends, one combined Среднее footer
        instead of the per-column labelled rows the operator reads from
        Excel. All of those are fixed here against the source files in
        `files/Котировки/*.xlsx` inspected via openpyxl:
        — Width: fixed colgroup (~110px per numeric col, ~130px Date,
          ~180px comment). Table is left-anchored, NOT w-full, so the
          whole sheet fits on a normal monitor without horizontal scroll.
        — Days: only trading days (Mon–Fri) are rendered. Weekend rows
          stay invisible unless a value happens to exist on them (then
          they show up so we don't hide existing data).
        — Date label: «01.06.2026» monospace, mirrors Excel.
        — Numbers: 3 dp with Russian comma separator («896,500»).
        — Footer:
          • one «in-column» row for each formula column (avg of that
            column's daily values, sits under the column);
          • then one row per editable numeric column with the label
            «Среднее {col.label}» on the left and the value centred in
            the column itself. Matches the row 20/22 pattern in the
            operator's spreadsheets.
      */}
      <div className="overflow-x-auto">
        <table className="border-collapse border border-stone-400 bg-white" style={{ fontSize: "11px", width: "max-content" }}>
          <colgroup>
            <col style={{ width: "94px" }} />
            {PRICE_COLS.map((col) => (
              <col key={col.key} style={{ width: col.key === "comment" ? "180px" : "110px" }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                colSpan={PRICE_COLS.length + 1}
                className="bg-stone-900 text-stone-50 text-center font-semibold py-1.5 px-2 border border-stone-700"
                style={{ fontSize: "12px" }}
              >
                Котировки на {productType.name} (средняя)
              </th>
            </tr>
            {/* sub_name row removed — values like «Средняя» duplicated
                the «(средняя)» in the title above and the operator's
                spreadsheets don't carry it as its own row either. */}
            <tr className="bg-stone-100">
              <th className="border border-stone-400 px-1 py-1 text-center font-bold text-stone-800">Дата</th>
              {PRICE_COLS.map((col) => (
                <th
                  key={col.key}
                  className="border border-stone-400 px-1 py-1 text-center font-bold text-stone-800 leading-tight"
                  style={{ fontSize: col.label.length > 22 ? "10px" : "11px" }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleDays.map((day) => {
              const q = quotMap[day];
              return (
                <tr key={day} className="hover:bg-amber-50/30">
                  <td className="border border-stone-300 px-1 py-px font-mono tabular-nums text-center text-stone-800">
                    {formatDateDMY(day)}
                  </td>
                  {PRICE_COLS.map((col) => {
                    if (col.key === "comment") {
                      const textVal = (q as Record<string, unknown> | undefined)?.[col.key] as string | null ?? null;
                      return (
                        <td key={col.key} className="border border-stone-300 px-1 py-px">
                          <EditableTextQCell value={textVal} disabled={!isWritable || !col.editable}
                            onSave={(val) => upsert(productType.id, day, "comment", val as unknown as number | null)} />
                        </td>
                      );
                    }
                    let cellVal = (q as Record<string, unknown> | undefined)?.[col.key] as number | null ?? null;
                    if (col.formula === "avg" && q) {
                      const srcKeys = col.avgOf ?? PRICE_COLS.filter((c) => c.editable && c.key !== "comment").map((c) => c.key);
                      const vals = srcKeys.map((k) => (q as Record<string, unknown>)[k] as number | null).filter((v): v is number => v != null);
                      cellVal = vals.length >= 2 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                    }
                    return (
                      <td key={col.key} className={`border border-stone-300 px-1 py-px text-center ${col.formula ? "bg-stone-50" : ""}`}>
                        <EditableCell value={cellVal} disabled={!isWritable || !col.editable}
                          onSave={(val) => handleCellSave(day, col.key, val)} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Per-formula-column average (Excel row 18) — value sits
                directly under the formula column, label-less so the
                column heading already tells the reader what it is. */}
            {formulaCols.length > 0 && (
              <tr className="bg-amber-50 border-t-2 border-amber-300">
                <td className="border border-stone-300 px-1 py-1"></td>
                {PRICE_COLS.map((col) => {
                  const isFormula = formulaCols.some((c) => c.key === col.key);
                  return (
                    <td
                      key={col.key}
                      className={`border border-stone-300 px-1 py-1 text-center font-mono tabular-nums ${isFormula ? "text-amber-900 font-bold" : ""}`}
                    >
                      {isFormula ? fmtNum(getAvg(col.key)) : ""}
                    </td>
                  );
                })}
              </tr>
            )}

            {/* Per-editable-column averages (Excel rows 27, 29, …) —
                label in the Date column, value parked in the FIRST
                numeric column for every average row. The operator's
                spreadsheets do exactly this: «Среднее CIF NWE Cargo»
                and «Среднее FOB Rotterdam» both land in column C,
                not under each column's own data — visually all the
                averages line up in one vertical stripe. */}
            {editableNumericCols.map((col) => {
              const avg = getAvg(col.key);
              return (
                <tr key={`avg-${col.key}`} className="bg-amber-100 font-semibold">
                  <td className="border border-amber-300 px-1.5 py-1 text-left text-amber-900 leading-tight">
                    Среднее {col.label}
                  </td>
                  {PRICE_COLS.map((c, idx) => {
                    const isTarget = idx === firstNumericColIdx;
                    return (
                      <td
                        key={c.key}
                        className="border border-amber-300 px-1 py-1 text-center font-mono tabular-nums text-amber-900"
                      >
                        {isTarget ? fmtNum(avg) : ""}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Main Page ---
const PAGE_TABS = [
  { key: "products", label: "Котировки" },
  { key: "summary", label: "Свод КОТ" },
] as const;

export default function QuotationsPage() {
  const [activeTab, setActiveTab] = useState<"products" | "summary">("products");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<QuotationProductType | null>(null);
  const { data: productTypes, loading: typesLoading, reload: reloadTypes } = useQuotationProductTypes();
  const { isWritable } = useRole();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Котировки</h1>
        <div className="flex items-center gap-2">
          {isWritable && (
            <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Тип котировки
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => reloadTypes()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Обновить
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-stone-200">
        {PAGE_TABS.map((tab) => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); setSelectedProduct(null); }}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === tab.key ? "border-amber-500 text-amber-700" : "border-transparent text-stone-500 hover:text-stone-700"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "summary" && <QuotationSummary />}

      {activeTab === "products" && !selectedProduct && (
        <>
          {typesLoading ? (
            <p className="text-muted-foreground text-sm">Загрузка...</p>
          ) : productTypes.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Нет типов котировок.</CardContent></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {productTypes.map((pt) => (
                <button key={pt.id} onClick={() => setSelectedProduct(pt)} className="text-left">
                  <Card className="group transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-amber-200">
                    <CardContent className="pt-4 pb-3">
                      <p className="text-[13px] font-medium text-stone-800 group-hover:text-amber-700">{pt.name}</p>
                      {pt.sub_name && <p className="text-[11px] text-stone-400 mt-0.5">{pt.sub_name}</p>}
                      {pt.basis && <p className="text-[10px] text-stone-400">{pt.basis}</p>}
                      <div className="mt-2 flex gap-1 flex-wrap">
                        {getColumnsForProduct(pt.name).map((col) => (
                          <span key={col.key} className={`rounded px-1.5 py-0.5 text-[9px] ${col.formula ? "bg-amber-100 text-amber-600" : "bg-stone-100 text-stone-500"}`}>
                            {col.label.length > 15 ? col.label.slice(0, 15) + "..." : col.label}
                          </span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === "products" && selectedProduct && (
        <QuotationDetail productType={selectedProduct} onBack={() => setSelectedProduct(null)} />
      )}

      <AddProductTypeDialog open={showAddDialog} onClose={() => { setShowAddDialog(false); reloadTypes(); }} />
    </div>
  );
}

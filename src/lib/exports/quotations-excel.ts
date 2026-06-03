/**
 * Quotations → Excel export.
 *
 * One sheet per calendar month («Январь 2026», …) — within each sheet
 * one row per day, columns driven by the product's column config
 * (`getColumnsForProduct`), with a bold «Среднее» footer row holding
 * the month average for each numeric/formula column. Formula columns
 * are recomputed from `avgOf` on the fly to match the on-screen
 * /quotations table exactly.
 *
 * Loaded dynamically from `/quotations` on click so exceljs stays out
 * of the initial bundle.
 */

import { createClient } from "@/lib/supabase/client";
import { getColumnsForProduct, FULL_PRICE_COLS, type QuotationColumn } from "@/lib/constants/quotation-columns";

type ProductTypeLite = {
  id: string;
  name: string;
  sub_name: string | null;
  basis: string | null;
  sort_order: number;
};

type QuotationRow = {
  id: string;
  product_type_id: string;
  date: string;
  price: number | null;
  price_fob_med: number | null;
  price_fob_rotterdam: number | null;
  price_cif_nwe: number | null;
  comment: string | null;
};

const NUM_FMT_PRICE = "#,##0.0000";
const NUM_FMT_DATE = "DD.MM.YYYY";
const HEADER_BG = "FF1C1917";
const HEADER_TEXT = "FFFAFAF9";

export type QuotationsExportFilter = {
  year?: number;          // null = all years
  productTypeId?: string; // null = all products
  productName?: string;   // optional, used in sheet name when filtered
};

// Page through the quotations table. PostgREST's Max-Rows default
// caps a single .select() at 1000 rows; pagination is the only
// client-only way to fetch everything reliably regardless of project
// settings.
async function fetchAllQuotations(
  sb: ReturnType<typeof createClient>,
  filter: QuotationsExportFilter,
): Promise<QuotationRow[]> {
  const all: QuotationRow[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    let q = sb
      .from("quotations")
      .select("id, product_type_id, date, price, price_fob_med, price_fob_rotterdam, price_cif_nwe, comment")
      .order("date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (filter.year != null) {
      q = q.gte("date", `${filter.year}-01-01`).lte("date", `${filter.year}-12-31`);
    }
    if (filter.productTypeId) {
      q = q.eq("product_type_id", filter.productTypeId);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data) break;
    all.push(...(data as QuotationRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Lower-case month names matching the page UI; sheet labels capitalize
// the first letter so «Январь 2026» reads naturally in the tab bar.
// Shared with the summary export below.
const MONTHS_RU = [
  "январь","февраль","март","апрель","май","июнь",
  "июль","август","сентябрь","октябрь","ноябрь","декабрь",
];

function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

// Recompute formula column value for a single quotation row from its
// `avgOf` source fields — mirrors the /quotations page render exactly
// (page.tsx:239-243) so the stored `price` value never leaks into the
// export.
function computeFormulaValue(q: QuotationRow, col: QuotationColumn, allCols: QuotationColumn[]): number | null {
  const srcKeys = col.avgOf ?? allCols.filter((c) => c.editable && c.key !== "comment").map((c) => c.key);
  const vals = srcKeys
    .map((k) => (q as unknown as Record<string, unknown>)[k] as number | null)
    .filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function cellNumericValue(q: QuotationRow, col: QuotationColumn, allCols: QuotationColumn[]): number | null {
  if (col.formula === "avg") return computeFormulaValue(q, col, allCols);
  return ((q as unknown as Record<string, unknown>)[col.key] as number | null) ?? null;
}

export async function exportQuotationsToExcel(filter: QuotationsExportFilter = {}): Promise<number> {
  const sb = createClient();

  const productsRes = await sb
    .from("quotation_product_types")
    .select("id, name, sub_name, basis, sort_order")
    .order("sort_order", { ascending: true });

  if (productsRes.error) throw new Error(productsRes.error.message);

  const products = (productsRes.data ?? []) as ProductTypeLite[];
  const productById = new Map(products.map((p) => [p.id, p]));
  const quotations = await fetchAllQuotations(sb, filter);

  // Filter out quotations whose product_type_id no longer exists (deleted
  // reference) and stable-sort by (date asc, product sort_order asc).
  const rows = quotations
    .filter((q) => productById.has(q.product_type_id))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const pa = productById.get(a.product_type_id)!;
      const pb = productById.get(b.product_type_id)!;
      return pa.sort_order - pb.sort_order;
    });

  // Column config follows the product's on-screen layout. If no product
  // is pinned (the legacy "export everything" path), fall back to the
  // full layout so the result is at least readable.
  const productCols: QuotationColumn[] = filter.productName
    ? getColumnsForProduct(filter.productName)
    : FULL_PRICE_COLS;

  // ── Build workbook ─────────────────────────────────────
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Singularity Trading CRM";
  wb.created = new Date();

  // Group rows by YYYY-MM. Object.keys insertion order matches first-
  // seen, but rows are already date-asc sorted above so keys come out
  // ascending naturally.
  const byMonth = new Map<string, QuotationRow[]>();
  for (const q of rows) {
    const ym = q.date.slice(0, 7); // YYYY-MM
    const bucket = byMonth.get(ym);
    if (bucket) bucket.push(q);
    else byMonth.set(ym, [q]);
  }

  // If the dataset is empty we still emit one placeholder sheet so the
  // user gets a file (and a toast that says "0 строк") instead of an
  // exceljs "must have at least one sheet" runtime error.
  if (byMonth.size === 0) {
    byMonth.set("empty", []);
  }

  const safe = (s: string) => s.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);

  // Excel max cell-formula columns is 12 + Date + Comment; the wide
  // products top out around 6, so width is fine. Anchor-date column
  // comes first.
  type Col = QuotationColumn & { numFmt?: string; width: number };
  const sheetCols: Col[] = [
    { key: "__date", label: "Дата", editable: false, numFmt: NUM_FMT_DATE, width: 12 },
    ...productCols.map((c): Col => ({
      ...c,
      numFmt: c.key === "comment" ? undefined : NUM_FMT_PRICE,
      width: c.key === "comment" ? 28 : 14,
    })),
  ];

  for (const [ym, monthRows] of byMonth) {
    let sheetName: string;
    if (ym === "empty") {
      sheetName = filter.productName ? safe(filter.productName) : "Котировки";
    } else {
      const [yStr, mStr] = ym.split("-");
      const monthIdx = parseInt(mStr, 10) - 1;
      sheetName = safe(`${capitalizeFirst(MONTHS_RU[monthIdx])} ${yStr}`);
    }

    const ws = wb.addWorksheet(sheetName, {
      views: [{ state: "frozen", ySplit: 2 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    // ── Title row ───────────────────────────────────────
    ws.getRow(1).height = 24;
    ws.mergeCells(1, 1, 1, sheetCols.length);
    const title = ws.getCell(1, 1);
    const titleParts: string[] = [];
    if (filter.productName) titleParts.push(filter.productName);
    titleParts.push(sheetName);
    titleParts.push(`${monthRows.length} строк`);
    title.value = titleParts.join("  ·  ");
    title.font = { bold: true, size: 13, color: { argb: HEADER_TEXT } };
    title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };

    // ── Header row ──────────────────────────────────────
    const headerRow = ws.getRow(2);
    headerRow.height = 22;
    sheetCols.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.label;
      cell.font = { bold: true, size: 10, color: { argb: HEADER_TEXT } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      cell.border = { bottom: { style: "medium", color: { argb: "FFD97706" } } };
      ws.getColumn(i + 1).width = c.width;
      if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
    });

    // ── Data rows ───────────────────────────────────────
    monthRows.forEach((q, rowIdx) => {
      const r = rowIdx + 3;
      const row = ws.getRow(r);
      row.height = 18;
      const isZebra = rowIdx % 2 === 1;

      sheetCols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        let value: string | number | Date | null;
        if (c.key === "__date") {
          value = q.date ? new Date(q.date + "T00:00:00Z") : null;
        } else if (c.key === "comment") {
          value = q.comment ?? "";
        } else {
          value = cellNumericValue(q, c, productCols);
        }
        cell.value = value == null ? "" : value;
        cell.font = { size: 10, name: "Calibri" };
        cell.alignment = {
          vertical: "middle",
          horizontal: c.numFmt ? "right" : "left",
        };
        cell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: isZebra ? "FFFAFAF9" : "FFFFFFFF" },
        };
        cell.border = {
          right: { style: "thin", color: { argb: "FFE7E5E4" } },
          bottom: { style: "thin", color: { argb: "FFF5F5F4" } },
        };
        if (c.numFmt) cell.numFmt = c.numFmt;
      });
    });

    // ── Среднее footer block ────────────────────────────
    // Two blank spacer rows, then one row per numeric column. Labels
    // span cols A-C (merged) so the long «Среднее CIF NWE и FOB
    // Rotterdam» strings stay readable; the month average sits in
    // col D right after the merged label.
    const firstAvgRow = monthRows.length + 3 + 2; // +2 spacer rows
    const numericCols = sheetCols.filter((c) => c.key !== "__date" && c.key !== "comment");
    const LABEL_SPAN_END = 3; // merge cols 1..3
    const VALUE_COL = 4;

    numericCols.forEach((c, idx) => {
      const r = firstAvgRow + idx;
      const row = ws.getRow(r);
      row.height = 20;

      ws.mergeCells(r, 1, r, LABEL_SPAN_END);
      const labelCell = row.getCell(1);
      // Drop a leading «Среднее » in the column label so we don't get
      // double-prefixed «Среднее Среднее CIF NWE и FOB Rotterdam» for
      // formula columns whose own header already starts with «Среднее».
      const cleanLabel = c.label.replace(/^Среднее\s+/i, "");
      labelCell.value = `Среднее ${cleanLabel}`;
      labelCell.font = { bold: true, size: 11, color: { argb: "FF92400E" }, name: "Calibri" };
      labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };

      const vals = monthRows
        .map((q) => cellNumericValue(q, c, productCols))
        .filter((v): v is number => v != null);
      const valueCell = row.getCell(VALUE_COL);
      valueCell.value = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : "";
      valueCell.font = { bold: true, size: 11, color: { argb: "FF92400E" }, name: "Calibri" };
      valueCell.alignment = { vertical: "middle", horizontal: "right" };
      valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      if (c.numFmt) valueCell.numFmt = c.numFmt;
    });

    // ── Autofilter on the header (excludes title + footer) ───
    ws.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: sheetCols.length },
    };
  }

  // ── Download ──────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const datestamp = new Date().toISOString().slice(0, 10);
  const slug = filter.productName
    ? filter.productName.toLowerCase().replace(/[^a-zа-я0-9]+/giu, "-").replace(/^-+|-+$/g, "")
    : "all";
  a.href = url;
  a.download = `quotations-${slug}${filter.year ? `-${filter.year}` : ""}-${datestamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return rows.length;
}

// ──────────────────────────────────────────────────────────────────
// Свод (summary) export — the matrix-shaped table from
// QuotationSummary: products as rows, months as column groups with
// «Ср» / «Фикс» / «Тр» sub-columns, year-average tail column.
// Month names come from the shared MONTHS_RU constant above.
// ──────────────────────────────────────────────────────────────────


type SummaryRow = {
  productId: string;
  productName: string;
  // For each 1..12 month: [avg, fixed, trigger]
  months: Array<{ avg: number | null; fixed: number | null; trigger: number | null }>;
  yearAvg: number | null;
};

export type SummaryExportInput = {
  year: number;
  triggerDays: number;
  fixedDay: number;
  rows: SummaryRow[];
};

export async function exportQuotationSummaryToExcel(input: SummaryExportInput): Promise<number> {
  const { year, triggerDays, fixedDay, rows } = input;

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Singularity Trading CRM";
  wb.created = new Date();

  const ws = wb.addWorksheet(`Свод КОТ ${year}`, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // ── Title row ────────────────────────────────────────
  const totalCols = 1 + 12 * 3 + 1; // Product + 12*(Ср,Фикс,Тр) + Год
  ws.getRow(1).height = 24;
  ws.mergeCells(1, 1, 1, totalCols);
  const title = ws.getCell(1, 1);
  title.value = `Свод котировок · ${year}  ·  Фикс день: ${fixedDay}  ·  Тригер дней: ${triggerDays}  ·  ${rows.length} продуктов`;
  title.font = { bold: true, size: 13, color: { argb: HEADER_TEXT } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };

  // ── Month band row (row 2) ───────────────────────────
  const monthBand = ws.getRow(2);
  monthBand.height = 20;
  monthBand.getCell(1).value = "Продукт";
  monthBand.getCell(1).font = { bold: true, size: 10, color: { argb: HEADER_TEXT } };
  monthBand.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
  monthBand.getCell(1).alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  for (let m = 1; m <= 12; m++) {
    const c0 = 2 + (m - 1) * 3;
    ws.mergeCells(2, c0, 2, c0 + 2);
    const cell = monthBand.getCell(c0);
    cell.value = MONTHS_RU[m - 1];
    cell.font = { bold: true, size: 10, color: { argb: HEADER_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  const yearColIdx = totalCols;
  const yearBandCell = monthBand.getCell(yearColIdx);
  yearBandCell.value = "Год";
  yearBandCell.font = { bold: true, size: 10, color: { argb: "FF92400E" } };
  yearBandCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  yearBandCell.alignment = { vertical: "middle", horizontal: "center" };

  // ── Sub-header row (row 3) ───────────────────────────
  const subRow = ws.getRow(3);
  subRow.height = 18;
  for (let m = 1; m <= 12; m++) {
    const c0 = 2 + (m - 1) * 3;
    (["Ср", "Фикс", "Тр"] as const).forEach((label, j) => {
      const cell = subRow.getCell(c0 + j);
      cell.value = label;
      cell.font = { bold: true, size: 9, color: { argb: "FF44403C" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F4" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE7E5E4" } } };
    });
  }
  subRow.getCell(yearColIdx).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  subRow.getCell(yearColIdx).border = { bottom: { style: "thin", color: { argb: "FFE7E5E4" } } };

  // ── Column widths ────────────────────────────────────
  ws.getColumn(1).width = 30;
  for (let c = 2; c <= 1 + 12 * 3; c++) ws.getColumn(c).width = 9;
  ws.getColumn(yearColIdx).width = 10;
  // Number format for all numeric columns
  for (let c = 2; c <= yearColIdx; c++) ws.getColumn(c).numFmt = NUM_FMT_PRICE;

  // ── Data rows ────────────────────────────────────────
  rows.forEach((row, rIdx) => {
    const r = rIdx + 4;
    const tr = ws.getRow(r);
    tr.height = 18;
    const nameCell = tr.getCell(1);
    nameCell.value = row.productName;
    nameCell.font = { size: 10, bold: true, name: "Calibri" };
    nameCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    nameCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    nameCell.border = { right: { style: "thin", color: { argb: "FFE7E5E4" } } };

    for (let m = 1; m <= 12; m++) {
      const c0 = 2 + (m - 1) * 3;
      const md = row.months[m - 1] ?? { avg: null, fixed: null, trigger: null };
      [md.avg, md.fixed, md.trigger].forEach((v, j) => {
        const cell = tr.getCell(c0 + j);
        cell.value = v == null ? "" : v;
        cell.font = { size: 9, name: "Calibri" };
        cell.alignment = { vertical: "middle", horizontal: "right" };
        cell.numFmt = NUM_FMT_PRICE;
        cell.border = {
          right: { style: "thin", color: { argb: "FFE7E5E4" } },
          bottom: { style: "thin", color: { argb: "FFF5F5F4" } },
        };
      });
    }
    const yearCell = tr.getCell(yearColIdx);
    yearCell.value = row.yearAvg == null ? "" : row.yearAvg;
    yearCell.font = { size: 10, bold: true, name: "Calibri", color: { argb: "FF92400E" } };
    yearCell.alignment = { vertical: "middle", horizontal: "right" };
    yearCell.numFmt = NUM_FMT_PRICE;
    yearCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF8E7" } };
  });

  // ── Download ─────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const datestamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `quotations-svod-${year}-${datestamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return rows.length;
}

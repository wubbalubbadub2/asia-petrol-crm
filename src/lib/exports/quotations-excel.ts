/**
 * Quotations → Excel export.
 *
 * Single sheet «Котировки» — one row per (date × product) combo.
 * Columns cover every numeric base the `quotations` table stores plus
 * the computed average and free-text comment. Sorted by date ascending,
 * then by product name. Includes header band, autofilter, frozen
 * header row, and zebra rows.
 *
 * Loaded dynamically from `/quotations` on click so exceljs stays out
 * of the initial bundle.
 */

import { createClient } from "@/lib/supabase/client";

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
  year?: number; // null = all years
};

export async function exportQuotationsToExcel(filter: QuotationsExportFilter = {}): Promise<number> {
  const sb = createClient();

  // Fetch product types + quotations in parallel. For "all years" the
  // dataset can be large; in practice quotations are dense daily data
  // so we just pull everything and let Excel filter client-side.
  const productsRes = await sb
    .from("quotation_product_types")
    .select("id, name, sub_name, basis, sort_order")
    .order("sort_order", { ascending: true });

  let quotationsQuery = sb
    .from("quotations")
    .select("id, product_type_id, date, price, price_fob_med, price_fob_rotterdam, price_cif_nwe, comment")
    .order("date", { ascending: true });
  if (filter.year != null) {
    quotationsQuery = quotationsQuery
      .gte("date", `${filter.year}-01-01`)
      .lte("date", `${filter.year}-12-31`);
  }
  const quotationsRes = await quotationsQuery;

  if (productsRes.error) throw new Error(productsRes.error.message);
  if (quotationsRes.error) throw new Error(quotationsRes.error.message);

  const products = (productsRes.data ?? []) as ProductTypeLite[];
  const productById = new Map(products.map((p) => [p.id, p]));
  const quotations = (quotationsRes.data ?? []) as QuotationRow[];

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

  // ── Build workbook ─────────────────────────────────────
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Asia Petrol CRM";
  wb.created = new Date();

  const sheetName = filter.year ? `Котировки ${filter.year}` : "Котировки";
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  type Col = { header: string; width: number; numFmt?: string; key: keyof FullRow };
  type FullRow = {
    date: Date;
    year: number;
    month: number;
    product: string;
    sub_name: string;
    basis: string;
    cif_nwe: number | null;
    fob_med: number | null;
    fob_rotterdam: number | null;
    average: number | null;
    comment: string;
  };
  const cols: Col[] = [
    { header: "Дата",              width: 12, key: "date",          numFmt: NUM_FMT_DATE },
    { header: "Год",               width: 7,  key: "year" },
    { header: "Месяц",             width: 7,  key: "month" },
    { header: "Тип котировки",     width: 28, key: "product" },
    { header: "Подтип",            width: 18, key: "sub_name" },
    { header: "Базис",             width: 18, key: "basis" },
    { header: "CIF NWE / Basis ARA", width: 14, key: "cif_nwe",      numFmt: NUM_FMT_PRICE },
    { header: "FOB MED",           width: 12, key: "fob_med",       numFmt: NUM_FMT_PRICE },
    { header: "FOB Rotterdam",     width: 14, key: "fob_rotterdam", numFmt: NUM_FMT_PRICE },
    { header: "Среднее",           width: 12, key: "average",       numFmt: NUM_FMT_PRICE },
    { header: "Комментарий",       width: 28, key: "comment" },
  ];

  // ── Title row ─────────────────────────────────────────
  ws.getRow(1).height = 24;
  ws.mergeCells(1, 1, 1, cols.length);
  const title = ws.getCell(1, 1);
  title.value = `Котировки${filter.year ? ` · ${filter.year}` : " · все годы"}  ·  ${rows.length} строк`;
  title.font = { bold: true, size: 13, color: { argb: HEADER_TEXT } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };

  // ── Header row ────────────────────────────────────────
  const headerRow = ws.getRow(2);
  headerRow.height = 22;
  cols.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 10, color: { argb: HEADER_TEXT } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = { bottom: { style: "medium", color: { argb: "FFD97706" } } };
    ws.getColumn(i + 1).width = c.width;
    if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
  });

  // ── Data rows ─────────────────────────────────────────
  rows.forEach((q, rowIdx) => {
    const p = productById.get(q.product_type_id)!;
    const r = rowIdx + 3;
    const row = ws.getRow(r);
    row.height = 18;
    const isZebra = rowIdx % 2 === 1;
    const [y, m] = q.date.split("-");
    const cells: Record<keyof FullRow, string | number | Date | null> = {
      date: q.date ? new Date(q.date + "T00:00:00Z") : null,
      year: parseInt(y, 10),
      month: parseInt(m, 10),
      product: p.name,
      sub_name: p.sub_name ?? "",
      basis: p.basis ?? "",
      cif_nwe: q.price_cif_nwe,
      fob_med: q.price_fob_med,
      fob_rotterdam: q.price_fob_rotterdam,
      average: q.price,
      comment: q.comment ?? "",
    };
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = cells[c.key];
      cell.value = v == null ? "" : v;
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

  // ── Autofilter on the header ──────────────────────────
  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: cols.length },
  };

  // ── Download ──────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const datestamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `quotations${filter.year ? `-${filter.year}` : "-all"}-${datestamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return rows.length;
}

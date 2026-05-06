/**
 * Passport → Excel export.
 *
 * Mirrors the column structure of <PassportTable /> but writes a styled
 * .xlsx file: grouped header bands (Сделка / Поставщик / Группы /
 * Покупатель / Логистика), per-side fill colors that match the on-screen
 * amber/purple/blue accents, frozen header rows, autosized columns,
 * thousands-separator number format, and a clear total row.
 *
 * Implementation note: exceljs is large, so this module is meant to be
 * dynamically imported from the deals page on click — keeps it out of
 * the initial bundle.
 */

import type { Deal } from "@/lib/hooks/use-deals";

type Side = "supplier" | "buyer";

type Column = {
  key: string;
  header: string;
  width: number;
  band: "deal" | "supplier" | "groups" | "buyer" | "logistics";
  numFmt?: string;
  read: (deal: Deal) => string | number | null | undefined;
};

const NUM_FMT_AMOUNT = "#,##0.00;[Red]-#,##0.00";
const NUM_FMT_VOLUME = "#,##0.000;[Red]-#,##0.000";
const NUM_FMT_PRICE = "#,##0.0000";

function fmtCompanyChain(deal: Deal): string {
  const groups = (deal.deal_company_groups ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  return groups
    .map((g) => `${g.company_group?.name ?? ""}${g.price != null ? ` ${g.price}` : ""}`)
    .filter(Boolean)
    .join(" → ");
}

function avgGroupPrice(deal: Deal): number | null {
  const prices = (deal.deal_company_groups ?? [])
    .map((g) => g.price)
    .filter((p): p is number => p != null);
  if (prices.length === 0) return null;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

const COLUMNS: Column[] = [
  // ── Сделка ─────────────────────────────────────────────
  { key: "deal_code", header: "№", width: 14, band: "deal", read: (d) => d.deal_code },
  { key: "month", header: "Месяц", width: 10, band: "deal", read: (d) => d.month },
  { key: "factory", header: "Завод", width: 14, band: "deal", read: (d) => d.factory?.name ?? "" },
  { key: "fuel", header: "ГСМ", width: 14, band: "deal", read: (d) => d.fuel_type?.name ?? "" },
  { key: "sulfur", header: "%S", width: 6, band: "deal", read: (d) => d.sulfur_percent ?? "" },

  // ── Поставщик ──────────────────────────────────────────
  { key: "supplier", header: "Поставщик", width: 22, band: "supplier", read: (d) => d.supplier?.short_name ?? d.supplier?.full_name ?? "" },
  { key: "supplier_contract", header: "Договор", width: 14, band: "supplier", read: (d) => d.supplier_contract ?? "" },
  { key: "supplier_basis", header: "Базис", width: 14, band: "supplier", read: (d) => d.supplier_delivery_basis ?? "" },
  { key: "supplier_volume", header: "Объем, т", width: 11, band: "supplier", numFmt: NUM_FMT_VOLUME, read: (d) => d.supplier_contracted_volume },
  { key: "supplier_amount", header: "Сумма дог.", width: 14, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_contracted_amount },
  { key: "supplier_price", header: "Цена", width: 11, band: "supplier", numFmt: NUM_FMT_PRICE, read: (d) => d.supplier_price },
  { key: "supplier_shipped_amount", header: "Отгр. сумма", width: 14, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_shipped_amount },
  { key: "supplier_shipped_volume", header: "Отгр., т", width: 11, band: "supplier", numFmt: NUM_FMT_VOLUME, read: (d) => d.supplier_shipped_volume },
  { key: "supplier_payment", header: "Оплата", width: 13, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_payment },
  { key: "supplier_balance", header: "Баланс", width: 13, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_balance },

  // ── Группы компании ────────────────────────────────────
  { key: "company_chain", header: "Цепочка", width: 28, band: "groups", read: (d) => fmtCompanyChain(d) },
  { key: "company_avg_price", header: "Цена гр. (avg)", width: 13, band: "groups", numFmt: NUM_FMT_PRICE, read: (d) => avgGroupPrice(d) },

  // ── Покупатель ─────────────────────────────────────────
  { key: "buyer", header: "Покупатель", width: 22, band: "buyer", read: (d) => d.buyer?.short_name ?? d.buyer?.full_name ?? "" },
  { key: "buyer_contract", header: "Договор", width: 14, band: "buyer", read: (d) => d.buyer_contract ?? "" },
  { key: "buyer_basis", header: "Базис", width: 14, band: "buyer", read: (d) => d.buyer_delivery_basis ?? "" },
  { key: "buyer_volume", header: "Объем, т", width: 11, band: "buyer", numFmt: NUM_FMT_VOLUME, read: (d) => d.buyer_contracted_volume },
  { key: "buyer_amount", header: "Сумма дог.", width: 14, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_contracted_amount },
  { key: "buyer_price", header: "Цена", width: 11, band: "buyer", numFmt: NUM_FMT_PRICE, read: (d) => d.buyer_price },
  { key: "buyer_ordered_volume", header: "Заявлено, т", width: 11, band: "buyer", numFmt: NUM_FMT_VOLUME, read: (d) => d.buyer_ordered_volume },
  { key: "buyer_shipped_volume", header: "Отгр., т", width: 11, band: "buyer", numFmt: NUM_FMT_VOLUME, read: (d) => d.buyer_shipped_volume },
  { key: "buyer_shipped_amount", header: "Отгр. сумма", width: 14, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_shipped_amount },
  { key: "buyer_payment", header: "Оплата", width: 13, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_payment },
  { key: "buyer_debt", header: "Долг / переплата", width: 14, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_debt },

  // ── Логистика ──────────────────────────────────────────
  { key: "forwarder", header: "Экспедитор", width: 18, band: "logistics", read: (d) => d.forwarder?.name ?? "" },
  { key: "logistics_company_group", header: "Группа комп.", width: 18, band: "logistics", read: (d) => d.logistics_company_group?.name ?? "" },
  { key: "preliminary_tonnage", header: "Объем план", width: 11, band: "logistics", numFmt: NUM_FMT_VOLUME, read: (d) => d.preliminary_tonnage },
  { key: "preliminary_amount", header: "Предв. сумма", width: 13, band: "logistics", numFmt: NUM_FMT_AMOUNT, read: (d) => d.preliminary_amount },
  { key: "actual_shipped_volume", header: "Факт объем", width: 11, band: "logistics", numFmt: NUM_FMT_VOLUME, read: (d) => d.actual_shipped_volume },
  { key: "invoice_amount", header: "Сумма (логистика)", width: 14, band: "logistics", numFmt: NUM_FMT_AMOUNT, read: (d) => d.invoice_amount },
  { key: "supplier_manager", header: "Менеджер", width: 16, band: "logistics", read: (d) => d.supplier_manager?.full_name ?? "" },
];

const BAND_STYLE: Record<Column["band"], { label: string; bg: string; text: string }> = {
  deal:      { label: "Сделка",          bg: "FFF1F0EE", text: "FF44403C" },
  supplier:  { label: "Поставщик",       bg: "FFFFF7E6", text: "FF92400E" },
  groups:    { label: "Группы компании", bg: "FFF3E8FF", text: "FF6B21A8" },
  buyer:     { label: "Покупатель",      bg: "FFE0F2FE", text: "FF1E40AF" },
  logistics: { label: "Логистика",       bg: "FFF4F4F3", text: "FF44403C" },
};

const HEADER_BG = "FF1C1917";    // sidebar dark
const HEADER_TEXT = "FFFAFAF9";  // background warm

export type ExportContext = {
  dealType: "KG" | "KZ" | "ALL";
  year: number;
  filters?: Record<string, string | undefined>;
};

export async function exportPassportToExcel(deals: Deal[], ctx: ExportContext): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Asia Petrol CRM";
  wb.created = new Date();

  const sheetName =
    ctx.dealType === "KG" ? "Паспорт KG" :
    ctx.dealType === "KZ" ? "Паспорт KZ" :
    "Сделки";
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // ── Title row ────────────────────────────────────────────
  ws.getRow(1).height = 24;
  ws.mergeCells(1, 1, 1, COLUMNS.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `${sheetName} · ${ctx.year}${deals.length ? `  ·  ${deals.length} сделок` : ""}`;
  titleCell.font = { bold: true, size: 13, color: { argb: HEADER_TEXT } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };

  // ── Band row ─────────────────────────────────────────────
  // Render contiguous runs of the same band as a merged cell with the
  // band label centered.
  ws.getRow(2).height = 18;
  let bandStart = 1;
  for (let i = 0; i < COLUMNS.length; i++) {
    const next = COLUMNS[i + 1];
    if (!next || next.band !== COLUMNS[i].band) {
      const band = COLUMNS[i].band;
      const style = BAND_STYLE[band];
      if (i + 1 > bandStart) {
        ws.mergeCells(2, bandStart, 2, i + 1);
      }
      const cell = ws.getCell(2, bandStart);
      cell.value = style.label;
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.font = { bold: true, size: 10, color: { argb: style.text } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: style.bg } };
      cell.border = { top: { style: "thin", color: { argb: "FFE7E5E4" } }, bottom: { style: "thin", color: { argb: "FFE7E5E4" } } };
      bandStart = i + 2;
    }
  }

  // ── Column header row ────────────────────────────────────
  const headerRow = ws.getRow(3);
  headerRow.height = 22;
  COLUMNS.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { bold: true, size: 10, color: { argb: HEADER_TEXT } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = { bottom: { style: "medium", color: { argb: "FFD97706" } } };
    ws.getColumn(idx + 1).width = col.width;
    if (col.numFmt) {
      ws.getColumn(idx + 1).numFmt = col.numFmt;
    }
  });

  // ── Data rows ────────────────────────────────────────────
  deals.forEach((deal, rowIdx) => {
    const r = rowIdx + 4;
    const row = ws.getRow(r);
    row.height = 18;
    COLUMNS.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      const v = col.read(deal);
      cell.value = v == null ? "" : v;
      cell.font = { size: 10, name: "Calibri" };
      cell.alignment = {
        vertical: "middle",
        horizontal: col.numFmt ? "right" : "left",
      };
      const isZebra = rowIdx % 2 === 1;
      const band = BAND_STYLE[col.band];
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isZebra ? band.bg : "FFFFFFFF" },
      };
      cell.border = {
        right: { style: "thin", color: { argb: "FFE7E5E4" } },
        bottom: { style: "thin", color: { argb: "FFF5F5F4" } },
      };
      if (col.numFmt) cell.numFmt = col.numFmt;
    });

    // Highlight negative balance / debt cells in red bold so accountants
    // can scan them without reading the sign.
    for (const key of ["supplier_balance", "buyer_debt"] as const) {
      const idx = COLUMNS.findIndex((c) => c.key === key);
      if (idx === -1) continue;
      const cell = row.getCell(idx + 1);
      const v = cell.value;
      if (typeof v === "number" && v < 0) {
        cell.font = { ...cell.font, bold: true, color: { argb: "FFB91C1C" } };
      }
    }
  });

  // ── Totals row (only numeric columns with meaningful sums) ───
  if (deals.length > 0) {
    const totalRow = ws.getRow(deals.length + 4);
    totalRow.height = 22;
    const TOTAL_KEYS = new Set([
      "supplier_volume", "supplier_amount", "supplier_shipped_amount",
      "supplier_shipped_volume", "supplier_payment", "supplier_balance",
      "buyer_volume", "buyer_amount", "buyer_ordered_volume",
      "buyer_shipped_volume", "buyer_shipped_amount", "buyer_payment", "buyer_debt",
      "preliminary_tonnage", "preliminary_amount", "actual_shipped_volume", "invoice_amount",
    ]);
    COLUMNS.forEach((col, idx) => {
      const cell = totalRow.getCell(idx + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      cell.font = { bold: true, size: 10 };
      cell.border = { top: { style: "medium", color: { argb: "FFD97706" } } };
      if (idx === 0) {
        cell.value = "Итого";
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      } else if (TOTAL_KEYS.has(col.key)) {
        let sum = 0;
        for (const d of deals) {
          const v = col.read(d);
          if (typeof v === "number" && Number.isFinite(v)) sum += v;
        }
        cell.value = sum;
        cell.alignment = { vertical: "middle", horizontal: "right" };
        if (col.numFmt) cell.numFmt = col.numFmt;
      }
    });
  }

  // ── Auto-filter on the column-header row ─────────────────
  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: COLUMNS.length },
  };

  // ── Download ────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const datestamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `passport-${ctx.dealType.toLowerCase()}-${ctx.year}-${datestamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Re-exports kept for tree-shake clarity at call sites.
export { type Column };
export type { Side };

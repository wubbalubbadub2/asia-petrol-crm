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

// Client canon 2026-07-07: money (сумма, цена $/т, котировка, скидка,
// тариф, FX) — 2 decimals. Volume — 3 decimals.
const NUM_FMT_AMOUNT = "#,##0.00;[Red]-#,##0.00";
const NUM_FMT_VOLUME = "#,##0.000;[Red]-#,##0.000";
const NUM_FMT_PRICE = "#,##0.00";

// Group name at a specific chain position (1..6) on a deal. Returns
// "" if that position is empty — Excel's auto-filter treats blanks as
// their own choice. Replaced the «Цепочка» one-string output 2026-06-23
// per operator request: «one column for each группа компании, не
// цепочка, so we can filter in exported excel by группа компании».
function companyAtPosition(deal: Deal, position: number): string {
  const row = (deal.deal_company_groups ?? []).find((g) => g.position === position);
  return row?.company_group?.name ?? "";
}

// Mix the fuel-type color into the band's existing fill color at low
// alpha (operator request 2026-06-23: «при выгрузке в Excel чтобы
// цветовая гамма сохранялась»). Returns an ExcelJS-shaped 8-char
// ARGB hex. Defaults to the bare `baseArgb` if any value is missing
// or malformed, so a deal without a fuel color falls back to the
// original band-zebra look.
function blendArgbWithFuel(baseArgb: string, fuelHex: string | null | undefined, fuelAlpha: number): string {
  const base = baseArgb.startsWith("FF") || baseArgb.startsWith("ff") ? baseArgb.slice(2) : baseArgb;
  if (base.length !== 6 || !fuelHex || typeof fuelHex !== "string" || !fuelHex.startsWith("#")) return `FF${base.toUpperCase()}`;
  const fuelStripped = fuelHex.length === 4
    ? fuelHex.slice(1).split("").map((c) => c + c).join("")
    : fuelHex.slice(1);
  if (fuelStripped.length !== 6) return `FF${base.toUpperCase()}`;
  const br = parseInt(base.slice(0, 2), 16);
  const bg = parseInt(base.slice(2, 4), 16);
  const bb = parseInt(base.slice(4, 6), 16);
  const fr = parseInt(fuelStripped.slice(0, 2), 16);
  const fg = parseInt(fuelStripped.slice(2, 4), 16);
  const fb = parseInt(fuelStripped.slice(4, 6), 16);
  if ([br, bg, bb, fr, fg, fb].some(Number.isNaN)) return `FF${base.toUpperCase()}`;
  const a = Math.max(0, Math.min(1, fuelAlpha));
  const mix = (b: number, f: number) => Math.round(f * a + b * (1 - a));
  const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `FF${hex(mix(br, fr))}${hex(mix(bg, fg))}${hex(mix(bb, fb))}`;
}

function avgGroupPrice(deal: Deal): number | null {
  const prices = (deal.deal_company_groups ?? [])
    .map((g) => g.price)
    .filter((p): p is number => p != null);
  if (prices.length === 0) return null;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

// Resolve the default line for a side; fall back to the first line.
// Multi-variant deals still get a representative line — accountants
// generally care about the default for the passport overview.
function defaultLine(deal: Deal, side: Side) {
  const lines = side === "supplier" ? deal.supplier_lines : deal.buyer_lines;
  if (!lines || lines.length === 0) return null;
  return lines.find((l) => l.is_default) ?? lines[0];
}

// Preliminary price for a side. While the line is still in
// 'preliminary' stage, line.price IS the preliminary number. After
// finalization, the snapshot is preserved on line.preliminary_price.
function preliminaryPrice(deal: Deal, side: Side): number | null {
  const line = defaultLine(deal, side);
  if (!line) return null;
  // line fields are optional on DealLineSnapshot now (list payload only
  // carries `id`; export enriches via fetchDealLinesForExport). Coerce
  // undefined → null so the Excel column stays nullable.
  return (line.price_stage === "final" ? line.preliminary_price : line.price) ?? null;
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
  // Quotation/discount inserted BEFORE the final price so accountants
  // can see the build-up: quotation − discount = price (client req 06.2026).
  { key: "supplier_quotation", header: "Котировка", width: 11, band: "supplier", numFmt: NUM_FMT_PRICE, read: (d) => d.supplier_quotation },
  { key: "supplier_discount", header: "Скидка", width: 10, band: "supplier", numFmt: NUM_FMT_PRICE, read: (d) => d.supplier_discount },
  // Preliminary first, then final. While stage='preliminary' the deal's
  // supplier_price == preliminary price; after finalize, the snapshot
  // moves to line.preliminary_price and supplier_price holds the final.
  { key: "supplier_preliminary_price", header: "Цена предв.", width: 11, band: "supplier", numFmt: NUM_FMT_PRICE, read: (d) => preliminaryPrice(d, "supplier") },
  { key: "supplier_price", header: "Цена оконч.", width: 11, band: "supplier", numFmt: NUM_FMT_PRICE, read: (d) => d.supplier_price },
  { key: "supplier_shipped_amount", header: "Отгр. сумма", width: 14, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_shipped_amount },
  { key: "supplier_shipped_volume", header: "Отгр., т", width: 11, band: "supplier", numFmt: NUM_FMT_VOLUME, read: (d) => d.supplier_shipped_volume },
  { key: "supplier_payment", header: "Оплата", width: 13, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_payment },
  { key: "supplier_balance", header: "Баланс", width: 13, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_balance },

  // ── Группы компании ────────────────────────────────────
  // One column per chain position (1..6) so the operator can apply
  // Excel auto-filter on a specific group at a specific step in the
  // chain. The avg-price summary stays as the last col in the band.
  // Клиент 2026-07-08: максимум бывает 3 группы в цепочке — 6 колонок
  // избыточно, оставляем 3.
  { key: "company_group_1", header: "Группа 1", width: 18, band: "groups", read: (d) => companyAtPosition(d, 1) },
  { key: "company_group_2", header: "Группа 2", width: 18, band: "groups", read: (d) => companyAtPosition(d, 2) },
  { key: "company_group_3", header: "Группа 3", width: 18, band: "groups", read: (d) => companyAtPosition(d, 3) },
  { key: "company_avg_price", header: "Цена гр. (avg)", width: 13, band: "groups", numFmt: NUM_FMT_PRICE, read: (d) => avgGroupPrice(d) },

  // ── Покупатель ─────────────────────────────────────────
  { key: "buyer", header: "Покупатель", width: 22, band: "buyer", read: (d) => d.buyer?.short_name ?? d.buyer?.full_name ?? "" },
  { key: "buyer_contract", header: "Договор", width: 14, band: "buyer", read: (d) => d.buyer_contract ?? "" },
  { key: "buyer_basis", header: "Базис", width: 14, band: "buyer", read: (d) => d.buyer_delivery_basis ?? "" },
  { key: "buyer_volume", header: "Объем, т", width: 11, band: "buyer", numFmt: NUM_FMT_VOLUME, read: (d) => d.buyer_contracted_volume },
  { key: "buyer_amount", header: "Сумма дог.", width: 14, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_contracted_amount },
  { key: "buyer_quotation", header: "Котировка", width: 11, band: "buyer", numFmt: NUM_FMT_PRICE, read: (d) => d.buyer_quotation },
  { key: "buyer_discount", header: "Скидка", width: 10, band: "buyer", numFmt: NUM_FMT_PRICE, read: (d) => d.buyer_discount },
  { key: "buyer_preliminary_price", header: "Цена предв.", width: 11, band: "buyer", numFmt: NUM_FMT_PRICE, read: (d) => preliminaryPrice(d, "buyer") },
  { key: "buyer_price", header: "Цена оконч.", width: 11, band: "buyer", numFmt: NUM_FMT_PRICE, read: (d) => d.buyer_price },
  { key: "buyer_ordered_volume", header: "Заявлено, т", width: 11, band: "buyer", numFmt: NUM_FMT_VOLUME, read: (d) => d.buyer_ordered_volume },
  // Остаток = отгружено − заявлено (operator 2026-06-23). Computed
  // on the fly from the loaded scalars so the export stays in sync
  // with the same number rendered in the passport list.
  { key: "buyer_remainder", header: "Остаток, т", width: 11, band: "buyer", numFmt: NUM_FMT_VOLUME, read: (d) => (d.buyer_shipped_volume ?? 0) - (d.buyer_ordered_volume ?? 0) },
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
  { key: "supplier_manager", header: "Коммерция", width: 16, band: "logistics", read: (d) => d.supplier_manager?.full_name ?? "" },
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
  // Enrich deals with line snapshots (DEAL_SELECT ships only `id` per
  // line for the list view's count badge) AND with the joined ref
  // names (LIST_SELECT no longer embeds factory / supplier / buyer /
  // forwarder / fuel_type / supplier_manager / logistics_company_group
  // — passport-table resolves those from the global refs cache). The
  // Excel COLUMNS still read d.supplier?.short_name etc., so we patch
  // those onto each row here from the refs maps.
  const [{ fetchDealLinesForExport }, { getGlobalRefs, getCachedRefsSync }] = await Promise.all([
    import("@/lib/hooks/use-deals"),
    import("@/lib/refs"),
  ]);
  const refs = getCachedRefsSync() ?? await getGlobalRefs();
  const supplierById = new Map(refs.suppliers.map((c) => [c.id, c]));
  const buyerById = new Map(refs.buyers.map((c) => [c.id, c]));
  const factoryById = new Map(refs.factories.map((r) => [r.id, r]));
  const fuelById = new Map(refs.fuelTypes.map((r) => [r.id, r]));
  const forwarderById = new Map(refs.forwarders.map((r) => [r.id, r]));
  const managerById = new Map(refs.managers.map((p) => [p.id, p]));
  const cgById = new Map(refs.companyGroups.map((r) => [r.id, r]));

  const lines = await fetchDealLinesForExport(deals.map((d) => d.id));
  deals = deals.map((d) => {
    const s = d.supplier_id ? supplierById.get(d.supplier_id) : null;
    const b = d.buyer_id ? buyerById.get(d.buyer_id) : null;
    const f = d.factory_id ? factoryById.get(d.factory_id) : null;
    const ft = d.fuel_type_id ? fuelById.get(d.fuel_type_id) : null;
    const fw = d.forwarder_id ? forwarderById.get(d.forwarder_id) : null;
    const sm = d.supplier_manager_id ? managerById.get(d.supplier_manager_id) : null;
    const lcg = d.logistics_company_group_id ? cgById.get(d.logistics_company_group_id) : null;
    return {
      ...d,
      supplier: s ? { full_name: s.full_name, short_name: s.short_name } : d.supplier ?? null,
      buyer: b ? { full_name: b.full_name, short_name: b.short_name } : d.buyer ?? null,
      factory: f ? { name: f.name } : d.factory ?? null,
      fuel_type: ft ? { name: ft.name, color: ft.color ?? "#6B7280" } : d.fuel_type ?? null,
      forwarder: fw ? { name: fw.name } : d.forwarder ?? null,
      supplier_manager: sm ? { full_name: sm.full_name } : d.supplier_manager ?? null,
      logistics_company_group: lcg ? { name: lcg.name } : d.logistics_company_group ?? null,
      // Enrich each company-group row in the chain with its name —
      // LIST_SELECT only embeds (id, position, company_group_id, price,
      // price_kind) for perf, so without this map-lookup fmtCompanyChain
      // would render empty strings (operator complaint 2026-06-23: «при
      // выгрузке в Excel не выходят наименования группы компании»).
      deal_company_groups: (d.deal_company_groups ?? []).map((g) => {
        if (g.company_group?.name) return g;
        const cg = g.company_group_id ? cgById.get(g.company_group_id) : null;
        return cg ? { ...g, company_group: { name: cg.name } } : g;
      }),
      supplier_lines: lines.supplier.get(d.id) ?? d.supplier_lines ?? [],
      buyer_lines: lines.buyer.get(d.id) ?? d.buyer_lines ?? [],
    };
  });

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Singularity Trading CRM";
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
    // Fuel-type color tints every cell on this row, single uniform
    // alpha — operator 2026-06-23 round 2: «нам теперь не нужно
    // чередовать цвета, использовать только цвета ГСМ, но чтобы было
    // читабельно». Dropped both the band-bg overlay and the zebra
    // alternation; rows now read as flat tinted strips of the
    // product's color, white where the fuel type has no color set.
    const fuelHex = deal.fuel_type?.color ?? null;
    COLUMNS.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      const v = col.read(deal);
      cell.value = v == null ? "" : v;
      cell.font = { size: 10, name: "Calibri" };
      cell.alignment = {
        vertical: "middle",
        horizontal: col.numFmt ? "right" : "left",
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: blendArgbWithFuel("FFFFFFFF", fuelHex, 0.12) },
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

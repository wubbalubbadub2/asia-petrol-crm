/**
 * Registry → Excel export.
 *
 * Mirrors the column structure of the /registry table but writes a
 * styled .xlsx file: title + column-header band, frozen first two
 * rows, autosized columns, ru-RU numeric formats per column, fuel-type
 * row tints (same scheme as passport-excel.ts — operator 2026-06-23:
 * «цветовая гамма должна сохраняться»), and a clear total row.
 *
 * Implementation note: exceljs is large, so this module is meant to
 * be dynamically imported from the registry page on click — keeps it
 * out of the initial bundle.
 *
 * Added 2026-06-24 per operator request: «Добавь выгрузку Реестр
 * отгрузок отдельно эксель файлом».
 */
import type { ShipmentRecord } from "@/lib/hooks/use-registry";

export type RegistryLabelMaps = {
  fuelType: Map<string, { name: string; color: string }>;
  factory: Map<string, string>;
  supplier: Map<string, string>;
  buyer: Map<string, string>;
  forwarder: Map<string, string>;
  companyGroup: Map<string, string>;
  station: Map<string, string>;
};

export type RegistryExportVariant = "pts" | "full";

export type RegistryExportContext = {
  type: "KG" | "KZ";
  year: number;
  labels: RegistryLabelMaps;
  variant: RegistryExportVariant;
  /** Цепочка групп компании по каждой сделке (позиции 1..3, всегда
   * массив длины 3, пустая строка на незаполненных позициях). Клиент
   * 2026-07-08: в полный экспорт добавлены 3 колонки «Группа N». */
  dealChains: Map<string, string[]>;
};

// Client canon 2026-07-07: tariff = money = 2 decimals.
const NUM_FMT_VOLUME = "#,##0.000";
const NUM_FMT_TARIFF = "#,##0.00";
const NUM_FMT_AMOUNT = "#,##0.00";

type Column = {
  key: string;
  header: string;
  width: number;
  numFmt?: string;
  align?: "left" | "right" | "center";
  read: (r: ShipmentRecord, l: RegistryLabelMaps, ctx?: RegistryExportContext) => string | number | null | undefined;
};

// Same rule as the on-screen ERound cell (registry/page.tsx:114).
// For KZ registry rawVolume = loading_volume, for KG = shipment_volume.
// Precedence: manual override → ceil(raw) when round_volume !== false → raw.
// Structural param + export: passport-detail-excel reuses this for its
// «Объем по счету-фактуре» per-shipment cells.
export function roundedTonnage(r: {
  registry_type: "KG" | "KZ" | null;
  loading_volume?: number | null;
  shipment_volume?: number | null;
  rounded_volume_override?: number | null;
  round_volume?: boolean | null;
}): number | null {
  if (r.rounded_volume_override != null) return r.rounded_volume_override;
  const raw = r.registry_type === "KZ" ? r.loading_volume : r.shipment_volume;
  if (raw == null) return null;
  return r.round_volume !== false ? Math.ceil(raw) : raw;
}

// PTS — вариант «для экспедитора PTC», по требованию клиента
// 2026-07-08. Меньше колонок, «Исходящее СНТ»/станции сразу после
// вагона+накладной, «Входящее СНТ» отсутствует.
const COLUMNS_PTS: Column[] = [
  { key: "deal_code",         header: "№ сделки",            width: 12, read: (r) => r.deal?.deal_code ?? "" },
  { key: "additional_month",  header: "Мес. доп",            width: 11, read: (r) => r.additional_month ?? r.deal?.month ?? "" },
  { key: "shipment_month",    header: "Мес. отгрузки",       width: 12, read: (r) => r.shipment_month ?? "" },
  { key: "date",              header: "Дата",                width: 12, read: (r) => r.date ?? "" },
  { key: "wagon_number",      header: "№ вагона",            width: 14, read: (r) => r.wagon_number ?? "" },
  { key: "waybill_number",    header: "№ ЖД накладной",      width: 16, read: (r) => r.waybill_number ?? "" },
  { key: "shipment_volume",   header: "Исходящее СНТ, т",    width: 14, numFmt: NUM_FMT_VOLUME, align: "right", read: (r) => r.shipment_volume },
  { key: "departure_station", header: "Ст. отправления",     width: 16, read: (r, l) => (r.departure_station_id && l.station.get(r.departure_station_id)) || "" },
  { key: "destination_station", header: "Ст. назначения",    width: 16, read: (r, l) => (r.destination_station_id && l.station.get(r.destination_station_id)) || "" },
  { key: "fuel_type",         header: "ГСМ",                 width: 12, read: (r, l) => (r.fuel_type_id && l.fuelType.get(r.fuel_type_id)?.name) || "" },
  { key: "factory",           header: "Завод",               width: 14, read: (r, l) => (r.factory_id && l.factory.get(r.factory_id)) || "" },
  { key: "supplier",          header: "Поставщик",           width: 22, read: (r, l) => (r.supplier_id && l.supplier.get(r.supplier_id)) || "" },
  { key: "buyer",             header: "Покупатель",          width: 22, read: (r, l) => (r.buyer_id && l.buyer.get(r.buyer_id)) || "" },
  { key: "company_group",     header: "Плательщик ж/д тарифа", width: 20, read: (r, l) => (r.company_group_id && l.companyGroup.get(r.company_group_id)) || "" },
  { key: "forwarder",         header: "Экспедитор",          width: 18, read: (r, l) => (r.forwarder_id && l.forwarder.get(r.forwarder_id)) || "" },
  { key: "supplier_appendix", header: "Прил. поставщика",    width: 14, read: (r) => r.supplier_appendix ?? "" },
  { key: "buyer_appendix",    header: "Прил. покупателя",    width: 14, read: (r) => r.buyer_appendix ?? "" },
  { key: "railway_tariff",    header: "Тариф (логисты)",     width: 14, numFmt: NUM_FMT_TARIFF, align: "right", read: (r) => r.railway_tariff },
  { key: "rounded_tonnage",   header: "округл тоннаж от экспедитора", width: 16, numFmt: NUM_FMT_VOLUME, align: "right", read: (r) => roundedTonnage(r) },
  { key: "shipped_amount",    header: "Сумма по тоннажу",    width: 16, numFmt: NUM_FMT_AMOUNT, align: "right", read: (r) => r.shipped_tonnage_amount },
  { key: "manager_tariff",    header: "Тариф (менеджер)",    width: 14, numFmt: NUM_FMT_TARIFF, align: "right", read: (r) => r.manager_tariff ?? null },
  { key: "additional_expenses", header: "Сумма грузоотправителя", width: 18, numFmt: NUM_FMT_AMOUNT, align: "right", read: (r) => r.additional_expenses ?? null },
  { key: "currency",          header: "Валюта",              width: 9,  align: "center", read: (r) => r.currency ?? r.deal?.logistics_currency ?? r.deal?.currency ?? "" },
  { key: "invoice_number",    header: "№ СФ",                width: 14, read: (r) => r.invoice_number ?? "" },
  { key: "comment",           header: "Комментарий",         width: 28, read: (r) => r.comment ?? "" },
];

// FULL — все колонки в том же порядке, как на экране в /registry
// (клиент 2026-07-08). Включает «Входящее СНТ», обе группы компании
// (продублировано под коммент как на экране), станции идут после
// тарифа/суммы. Всё как в UI, чтобы юзер получил «то что видит».
const COLUMNS_FULL: Column[] = [
  { key: "deal_code",           header: "№ сделки",         width: 12, read: (r) => r.deal?.deal_code ?? "" },
  { key: "additional_month",    header: "Мес. доп",         width: 11, read: (r) => r.additional_month ?? r.deal?.month ?? "" },
  { key: "shipment_month",      header: "Мес. отгрузки",    width: 12, read: (r) => r.shipment_month ?? "" },
  { key: "fuel_type",           header: "ГСМ",              width: 12, read: (r, l) => (r.fuel_type_id && l.fuelType.get(r.fuel_type_id)?.name) || "" },
  { key: "factory",             header: "Завод",            width: 14, read: (r, l) => (r.factory_id && l.factory.get(r.factory_id)) || "" },
  { key: "supplier",            header: "Поставщик",        width: 22, read: (r, l) => (r.supplier_id && l.supplier.get(r.supplier_id)) || "" },
  { key: "loading_volume",      header: "Входящее СНТ, т",  width: 14, numFmt: NUM_FMT_VOLUME, align: "right", read: (r) => r.loading_volume },
  { key: "buyer",               header: "Покупатель",       width: 22, read: (r, l) => (r.buyer_id && l.buyer.get(r.buyer_id)) || "" },
  // Клиент 2026-07-08: 3 колонки цепочки групп компании между
  // «Покупатель» и «Плательщик ж/д тарифа». Всегда 3 колонки, даже
  // если в сделке меньше — максимум бывает 3.
  { key: "company_group_1",     header: "Группа 1",         width: 18, read: (r, _l, ctx) => (r.deal_id && ctx?.dealChains.get(r.deal_id)?.[0]) || "" },
  { key: "company_group_2",     header: "Группа 2",         width: 18, read: (r, _l, ctx) => (r.deal_id && ctx?.dealChains.get(r.deal_id)?.[1]) || "" },
  { key: "company_group_3",     header: "Группа 3",         width: 18, read: (r, _l, ctx) => (r.deal_id && ctx?.dealChains.get(r.deal_id)?.[2]) || "" },
  { key: "company_group",       header: "Плательщик ж/д тарифа", width: 20, read: (r, l) => (r.company_group_id && l.companyGroup.get(r.company_group_id)) || "" },
  { key: "forwarder",           header: "Экспедитор",       width: 18, read: (r, l) => (r.forwarder_id && l.forwarder.get(r.forwarder_id)) || "" },
  { key: "wagon_number",        header: "№ вагона",         width: 14, read: (r) => r.wagon_number ?? "" },
  { key: "waybill_number",      header: "№ ЖД накл.",       width: 16, read: (r) => r.waybill_number ?? "" },
  { key: "shipment_volume",     header: "Исходящее СНТ, т", width: 14, numFmt: NUM_FMT_VOLUME, align: "right", read: (r) => r.shipment_volume },
  { key: "date",                header: "Дата отгр.",       width: 12, read: (r) => r.date ?? "" },
  { key: "railway_tariff",      header: "Тариф (логисты)",  width: 14, numFmt: NUM_FMT_TARIFF, align: "right", read: (r) => r.railway_tariff },
  { key: "rounded_tonnage",     header: "Округл. тоннаж",   width: 14, numFmt: NUM_FMT_VOLUME, align: "right", read: (r) => roundedTonnage(r) },
  { key: "shipped_amount",      header: "Сумма",            width: 16, numFmt: NUM_FMT_AMOUNT, align: "right", read: (r) => r.shipped_tonnage_amount },
  { key: "additional_expenses", header: "Сумма грузоотправителя", width: 18, numFmt: NUM_FMT_AMOUNT, align: "right", read: (r) => r.additional_expenses ?? null },
  { key: "currency",            header: "Валюта",           width: 9,  align: "center", read: (r) => r.currency ?? r.deal?.logistics_currency ?? r.deal?.currency ?? "" },
  { key: "destination_station", header: "Ст. назн.",        width: 16, read: (r, l) => (r.destination_station_id && l.station.get(r.destination_station_id)) || "" },
  { key: "departure_station",   header: "Ст. отпр.",        width: 16, read: (r, l) => (r.departure_station_id && l.station.get(r.departure_station_id)) || "" },
  { key: "supplier_appendix",   header: "Прил. поставщика", width: 14, read: (r) => r.supplier_appendix ?? "" },
  { key: "buyer_appendix",      header: "Прил. покупателя", width: 14, read: (r) => r.buyer_appendix ?? "" },
  { key: "invoice_number",      header: "№ СФ",             width: 14, read: (r) => r.invoice_number ?? "" },
  { key: "comment",             header: "Коммент.",         width: 28, read: (r) => r.comment ?? "" },
];

const HEADER_BG = "FF1C1917";   // sidebar dark
const HEADER_TEXT = "FFFAFAF9"; // background warm

// Mix the fuel-type color into the base fill at low alpha — copied
// from passport-excel.ts (single source would be nice but the file is
// tightly coupled to its Deal-shaped reader, so duplicating the 12-line
// helper here keeps both modules self-contained).
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

export async function exportRegistryToExcel(records: ShipmentRecord[], ctx: RegistryExportContext): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Singularity Trading CRM";
  wb.created = new Date();

  const columns = ctx.variant === "full" ? COLUMNS_FULL : COLUMNS_PTS;
  const variantSuffix = ctx.variant === "full" ? " · полный" : " · PTS";

  const sheetName = ctx.type === "KG" ? "Реестр KG" : "Реестр KZ";
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // ── Title row ────────────────────────────────────────────
  ws.getRow(1).height = 24;
  ws.mergeCells(1, 1, 1, columns.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `${sheetName}${variantSuffix} · ${ctx.year}${records.length ? `  ·  ${records.length} отгрузок` : ""}`;
  titleCell.font = { bold: true, size: 13, color: { argb: HEADER_TEXT } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };

  // ── Column header row ────────────────────────────────────
  const headerRow = ws.getRow(2);
  headerRow.height = 22;
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { bold: true, size: 10, color: { argb: HEADER_TEXT } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = { bottom: { style: "medium", color: { argb: "FFD97706" } } };
    ws.getColumn(idx + 1).width = col.width;
    if (col.numFmt) ws.getColumn(idx + 1).numFmt = col.numFmt;
  });

  // ── Data rows ────────────────────────────────────────────
  records.forEach((rec, rowIdx) => {
    const r = rowIdx + 3;
    const row = ws.getRow(r);
    row.height = 18;
    const fuelHex = (rec.fuel_type_id && ctx.labels.fuelType.get(rec.fuel_type_id)?.color) || null;
    const rowFill = blendArgbWithFuel("FFFFFFFF", fuelHex, 0.12);
    columns.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      const v = col.read(rec, ctx.labels, ctx);
      // Date columns are stored as ISO strings (yyyy-mm-dd). Convert
      // to a real Date so Excel formats and sorts by chronology rather
      // than lexicographic string order.
      if (col.key === "date" && typeof v === "string" && v) {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) {
          cell.value = d;
          cell.numFmt = "dd.mm.yyyy";
        } else {
          cell.value = v;
        }
      } else {
        cell.value = v == null || v === "" ? null : v;
      }
      cell.font = { size: 10, name: "Calibri" };
      cell.alignment = {
        vertical: "middle",
        horizontal: col.align ?? (col.numFmt ? "right" : "left"),
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      cell.border = {
        right: { style: "thin", color: { argb: "FFE7E5E4" } },
        bottom: { style: "thin", color: { argb: "FFF5F5F4" } },
      };
      if (col.numFmt && col.key !== "date") cell.numFmt = col.numFmt;
    });
  });

  // ── Totals row ───────────────────────────────────────────
  if (records.length > 0) {
    const totalRowIdx = records.length + 3;
    const totalRow = ws.getRow(totalRowIdx);
    totalRow.height = 22;
    const TOTAL_KEYS = new Set(["shipment_volume", "rounded_tonnage", "shipped_amount"]);
    columns.forEach((col, idx) => {
      const cell = totalRow.getCell(idx + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      cell.font = { bold: true, size: 10 };
      cell.border = { top: { style: "medium", color: { argb: "FFD97706" } } };
      if (idx === 0) {
        cell.value = "Итого";
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      } else if (TOTAL_KEYS.has(col.key)) {
        let sum = 0;
        for (const rec of records) {
          const v = col.read(rec, ctx.labels, ctx);
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
    from: { row: 2, column: 1 },
    to: { row: 2, column: columns.length },
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
  a.download = `registry-${ctx.type.toLowerCase()}-${ctx.variant}-${ctx.year}-${datestamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Structured SNT parser for 1C Excel exports
 *
 * Known cell positions from the 1C СНТ format:
 * A5: SNT number (учетной системы)
 * G5: Registration number in ИС ЭСФ
 * A8: Shipment date
 * G8: Registration date/time
 * N28: Supplier BIN / name area
 * BC28: Receiver BIN / name area
 * Goods table starts around row 67-71
 */

export type ParsedSNTGoods = {
  description: string | null;
  tnved_code: string | null;
  unit: string | null;
  quantity: number | null;
  price_per_unit: number | null;
  total_without_tax: number | null;
  tax_rate: number | null;
  tax_amount: number | null;
  total_with_tax: number | null;
};

export type ParsedSNT = {
  snt_number: string | null;
  registration_number: string | null;
  shipment_date: string | null;
  registration_date: string | null;
  supplier_bin: string | null;
  supplier_name: string | null;
  receiver_bin: string | null;
  receiver_name: string | null;
  goods: ParsedSNTGoods[];
  total_quantity: number | null;
  total_amount: number | null;
};

type CellMap = Record<string, unknown>;

function getCell(cells: CellMap, addr: string): string | null {
  const val = cells[addr];
  if (val == null) return null;
  return String(val).trim() || null;
}

function getNumCell(cells: CellMap, addr: string): number | null {
  const val = cells[addr];
  if (val == null) return null;
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

/**
 * Parse an SNT worksheet from 1C Excel export.
 * Accepts a flat cell map: { "A5": value, "G5": value, ... }
 */
export function parseSNT(cells: CellMap): ParsedSNT {
  // Section A: General
  const snt_number = getCell(cells, "A5");
  const registration_number = getCell(cells, "G5");
  const shipment_date = getCell(cells, "A8");
  const registration_date = getCell(cells, "G8");

  // Section B: Supplier (around row 28)
  // Try multiple positions since format varies
  const supplier_bin = getCell(cells, "N28") ?? getCell(cells, "B28") ?? getCell(cells, "A28");
  const supplier_name = getCell(cells, "N29") ?? getCell(cells, "B29") ?? getCell(cells, "N27");
  const receiver_bin = getCell(cells, "BC28") ?? getCell(cells, "AD28") ?? getCell(cells, "AD40");
  const receiver_name = getCell(cells, "BC29") ?? getCell(cells, "AD29") ?? getCell(cells, "AD41");

  // Section G6: Goods (petroleum products) — scan rows 70-90 for data
  const goods: ParsedSNTGoods[] = [];
  for (let row = 70; row <= 90; row++) {
    const desc = getCell(cells, `G${row}`);
    const qty = getNumCell(cells, `AB${row}`);
    if (!desc && !qty) continue;
    // Skip header/footer rows
    if (desc && (desc.includes("п/п") || desc.includes("Всего") || desc.includes("Признак"))) continue;

    goods.push({
      description: desc,
      tnved_code: getCell(cells, `Q${row}`),
      unit: getCell(cells, `W${row}`),
      quantity: qty,
      price_per_unit: getNumCell(cells, `AI${row}`),
      total_without_tax: getNumCell(cells, `AK${row}`),
      tax_rate: getNumCell(cells, `BA${row}`),
      tax_amount: getNumCell(cells, `BC${row}`),
      total_with_tax: getNumCell(cells, `BE${row}`),
    });
  }

  // Totals row (usually right after last goods row, or scan for "Всего")
  let total_quantity: number | null = null;
  let total_amount: number | null = null;
  for (let row = 70; row <= 95; row++) {
    const label = getCell(cells, `A${row}`);
    if (label && String(label).includes("Всего")) {
      total_quantity = getNumCell(cells, `AB${row}`);
      total_amount = getNumCell(cells, `BE${row}`);
      break;
    }
  }

  // Fallback: sum goods
  if (total_quantity == null && goods.length > 0) {
    total_quantity = goods.reduce((s, g) => s + (g.quantity ?? 0), 0);
  }
  if (total_amount == null && goods.length > 0) {
    total_amount = goods.reduce((s, g) => s + (g.total_with_tax ?? 0), 0);
  }

  return {
    snt_number,
    registration_number,
    shipment_date,
    registration_date,
    supplier_bin,
    supplier_name,
    receiver_bin,
    receiver_name,
    goods,
    total_quantity,
    total_amount,
  };
}

/**
 * Convert xlsx worksheet to flat cell map
 * Expects the output of XLSX.utils.sheet_to_json with header:1 or raw cell access
 */
export function worksheetToCellMap(worksheet: Record<string, { v?: unknown; w?: string }>): CellMap {
  const map: CellMap = {};
  for (const [addr, cell] of Object.entries(worksheet)) {
    if (addr.startsWith("!")) continue; // skip metadata keys like !ref, !merges
    map[addr] = cell?.w ?? cell?.v ?? null;
  }
  return map;
}

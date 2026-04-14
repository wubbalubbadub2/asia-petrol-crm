/**
 * Quotation column configurations per product type.
 * Matches the exact layout from Карточка.xlsx → Котировки sheet.
 *
 * Each product has different price bases.
 * The "price" field in the DB stores the Среднее (average).
 * price_cif_nwe, price_fob_med, price_fob_rotterdam are the bases.
 */

export type QuotationColumn = {
  key: string;       // DB field to store the value
  label: string;     // Column header
  editable: boolean; // Can user edit this?
  formula?: "avg";   // If set, auto-calculated
  avgOf?: string[];  // Specific fields to average (if not set, averages all editable)
};

// Full layout: products with multiple bases
export const FULL_PRICE_COLS: QuotationColumn[] = [
  { key: "price_cif_nwe", label: "CIF NWE/Basis ARA", editable: true },
  { key: "price_fob_med", label: "FOB MED", editable: true },
  { key: "price_fob_rotterdam", label: "FOB Rotterdam", editable: true },
  { key: "price", label: "Среднее CIF NWE и FOB Rotterdam", editable: false, formula: "avg", avgOf: ["price_cif_nwe", "price_fob_rotterdam"] },
];

// Products with CIF NWE Cargo + FOB Rotterdam barge
export const CARGO_BARGE_COLS: QuotationColumn[] = [
  { key: "price_cif_nwe", label: "CIF NWE Cargo", editable: true },
  { key: "price_fob_rotterdam", label: "FOB Rotterdam barge", editable: true },
  { key: "price", label: "Среднее", editable: false, formula: "avg", avgOf: ["price_cif_nwe", "price_fob_rotterdam"] },
];

// Products with single FOB basis
export const SINGLE_FOB_COLS: QuotationColumn[] = [
  { key: "price_fob_rotterdam", label: "FOB Rotterdam", editable: true },
];

export const SINGLE_FOB_NWE_COLS: QuotationColumn[] = [
  { key: "price_cif_nwe", label: "FOB NWE", editable: true },
];

export const SINGLE_FOB_MED_COLS: QuotationColumn[] = [
  { key: "price_fob_med", label: "FOB MED Italy", editable: true },
];

// CIF + FOB MED (2 cols + avg)
export const CIF_FOB_MED_COLS: QuotationColumn[] = [
  { key: "price_cif_nwe", label: "CIF NWE/Basis ARA", editable: true },
  { key: "price_fob_med", label: "FOB MED Italy", editable: true },
];

// BRENT: min, max, avg
export const BRENT_COLS: QuotationColumn[] = [
  { key: "price_fob_med", label: "мин", editable: true },
  { key: "price_fob_rotterdam", label: "макс", editable: true },
  { key: "price", label: "сред", editable: false, formula: "avg" },
];

/**
 * Map product type name to its column configuration.
 * Based on exact Excel structure from Карточка.xlsx.
 */
export function getColumnsForProduct(productName: string): QuotationColumn[] {
  const name = productName.toUpperCase();

  // ГАЗОЙЛЬ 0,1% — full layout (CIF NWE/Basis ARA, FOB MED, FOB Rotterdam, Среднее)
  if (name.includes("ГАЗОЙЛЬ")) return FULL_PRICE_COLS;

  // ВГО variants — CIF NWE Cargo + FOB Rotterdam barge + Среднее
  if (name.includes("ВГО")) return CARGO_BARGE_COLS;

  // МАЗУТ 0,5% Marine Fuel — single FOB Rotterdam barge
  if (name.includes("0,5") && name.includes("MARINE")) return SINGLE_FOB_COLS;

  // МАЗУТ 1,0% Fuel oil — full layout
  if (name.includes("1,0") && name.includes("FUEL") && !name.includes("FOB")) return FULL_PRICE_COLS;

  // МАЗУТ 3,5% (not FOB) — full layout
  if (name.includes("3,5") && !name.includes("FOB")) return FULL_PRICE_COLS;

  // МАЗУТ FOB NWE variants — single FOB NWE
  if (name.includes("FOB NWE") || name.includes("FOB NEW")) return SINGLE_FOB_NWE_COLS;

  // МАЗУТ FOB Rotterdam variants — single FOB Rotterdam
  if (name.includes("FOB ROTTERDAM") && name.includes("МАЗУТ")) return SINGLE_FOB_COLS;

  // Eurobob — single FOB Rotterdam
  if (name.includes("EUROBOB")) return SINGLE_FOB_COLS;

  // Prem Unl 10 ppm — single FOB MED Italy
  if (name.includes("PREM")) return SINGLE_FOB_MED_COLS;

  // НАФТА — full layout
  if (name.includes("НАФТА") || name.includes("NAPHTA")) return FULL_PRICE_COLS;

  // ULSD 10 ppm — CIF + FOB MED
  if (name.includes("ULSD")) return CIF_FOB_MED_COLS;

  // Jet — full layout
  if (name.includes("JET")) return FULL_PRICE_COLS;

  // BRENT — min, max, avg
  if (name.includes("BRENT")) return BRENT_COLS;

  // Default — full layout
  return FULL_PRICE_COLS;
}

export const DEAL_TYPES = ["KG", "KZ", "OIL"] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  KG: "KG — Экспорт",
  KZ: "KZ — Казахстан",
  OIL: "OIL — Нефть",
};

export const DEAL_TYPE_CURRENCY: Record<DealType, string> = {
  KG: "USD",
  KZ: "KZT",
  OIL: "USD",
};

// Flat list of underlying enum values (kept for type safety + DB selects).
export const PRICE_CONDITIONS = [
  { value: "manual", label: "Фикс / Вручную" },
  { value: "manual_formula", label: "Формульная вручную" },
  { value: "manual_in_formula", label: "Формула: Фикс цена" },
  { value: "average_month", label: "Формула: Средний месяц" },
  { value: "avg_to_date", label: "Формула: Средний на дату" },
  { value: "fixed", label: "Формула: На дату" },
  { value: "trigger", label: "Формула: Триггер" },
] as const;

// Hierarchical version for the variant card / line editor UI. The
// trigger row is split per basis so the manager picks the basis at the
// same time as the condition. Each entry maps back to (price_condition,
// trigger_basis) — the DB shape — via `decodePriceMode`.
//
// User-facing wording (per client 2026-05-21):
//   • Фикс / Вручную                   → manual entry, no quotation lookup
//   • Формула: Средний месяц           → avg of all quotations in the deal month
//   • Формула: Средний на дату         → partial-month avg from the 1st through the picked date
//   • Формула: На дату                 → single-day quotation snapshot on a specific date
//   • Формула: Фикс цена               → quotation + sub-quotation picked for record,
//                                         price typed by hand (no auto-lookup)
//   • Формула: Триггер по дате отгрузки → trigger window, basis = shipment_date,  default 37 days
//   • Формула: Триггер с пересечения границы → trigger window, basis = border_crossing_date, default 37 days
export type PriceMode =
  | "manual"
  | "manual_formula"
  | "manual_in_formula"
  | "fixed"
  | "average_month"
  | "avg_to_date"
  | "trigger_shipment"
  | "trigger_border";

export const PRICE_MODES: { value: PriceMode; label: string; group: "manual" | "manual_formula" | "formula" }[] = [
  { value: "manual",            label: "Фикс / Вручную",                              group: "manual" },
  { value: "manual_formula",    label: "Формульная вручную",                          group: "manual_formula" },
  { value: "average_month",     label: "Формула: Средний месяц",                       group: "formula" },
  { value: "avg_to_date",       label: "Формула: Средний на дату",                     group: "formula" },
  { value: "fixed",             label: "Формула: На дату",                             group: "formula" },
  { value: "manual_in_formula", label: "Формула: Фикс цена",                           group: "formula" },
  { value: "trigger_shipment",  label: "Формула: Триггер — по дате отгрузки (35-40 дн)", group: "formula" },
  { value: "trigger_border",    label: "Формула: Триггер — по дате пересечения границы (30-44 дн)", group: "formula" },
];

// ── Tier-1 / Tier-2 view over PRICE_MODES ────────────────────────
// The product owner's mental model splits price selection into two
// steps: first decide manual vs formula, then (when formula) pick the
// subtype. We keep PRICE_MODES as the authoritative flat list and
// expose helpers below for pickers that want the hierarchical UI.

export type PriceTier = "manual" | "manual_formula" | "formula";

// Display label for the tier-1 picker.
export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  manual: "Фикс / Вручную",
  manual_formula: "Формульная вручную",
  formula: "Формульная",
};

// Map a PriceMode back to its tier. Useful when seeding the tier
// picker from a persisted line.
export function priceTierOf(mode: PriceMode): PriceTier {
  if (mode === "manual") return "manual";
  if (mode === "manual_formula") return "manual_formula";
  // manual_in_formula sits under the formula tier — it's a sub-option
  // of «Подтип формулы», not its own tier.
  return "formula";
}

// Default subtype to land on when switching INTO the formula tier from
// manual. Lands on «Фикс цена» — anchor = shipment date, 0-day shift —
// which combined with the default calc_mode «Средняя по дате» reproduces
// the single-day auto-lookup behaviour managers had as the old «На дату».
export const DEFAULT_FORMULA_MODE: PriceMode = "fixed";

// «Режим расчёта» — second of TWO orthogonal dimensions filled by the
// manager when tier=formula (per Beken 2026-05-21, migration 00079).
// Defines HOW to extract a price once the target date is known:
//   • on_date   — quotation value ON the target date
//   • avg_month — AVG of the calendar month containing the target date
// This is NOT a PriceMode — it's a separate axis. Both selectors stay
// active simultaneously; there is no mutual exclusion.
export type CalcMode = "on_date" | "avg_month";

export const CALC_MODES: { value: CalcMode; label: string }[] = [
  { value: "on_date",   label: "Средняя по дате" },
  { value: "avg_month", label: "Средний месяц" },
];

// «Подтип формулы» — first of the two orthogonal dimensions. Defines
// the «target date» from which the chosen calc_mode reads:
//   • fixed            — target = anchor (shipment date, 0-day shift)
//   • trigger_shipment — target = shipment_date + N days
//   • trigger_border   — target = border_crossing_date + N days
export const FORMULA_SUBMODES: { value: PriceMode; label: string }[] = [
  { value: "fixed",            label: "Фикс цена" },
  { value: "trigger_shipment", label: "Триггер — по дате отгрузки (35-40 дн)" },
  { value: "trigger_border",   label: "Триггер — по дате пересечения границы (30-44 дн)" },
];

export type TriggerBasisLite = "shipment_date" | "border_crossing_date";

export function encodePriceMode(
  condition: string | null | undefined,
  basis: TriggerBasisLite | null | undefined,
): PriceMode {
  if (condition === "trigger") {
    return basis === "border_crossing_date" ? "trigger_border" : "trigger_shipment";
  }
  if (
    condition === "fixed" ||
    condition === "average_month" ||
    condition === "avg_to_date" ||
    condition === "manual" ||
    condition === "manual_formula" ||
    condition === "manual_in_formula"
  ) {
    return condition;
  }
  return "manual";
}

export function decodePriceMode(mode: PriceMode): {
  price_condition: "manual" | "manual_formula" | "manual_in_formula" | "fixed" | "average_month" | "avg_to_date" | "trigger";
  trigger_basis: TriggerBasisLite | null;
  trigger_days_default: number | null;
} {
  switch (mode) {
    case "manual":             return { price_condition: "manual",            trigger_basis: null, trigger_days_default: null };
    case "manual_formula":     return { price_condition: "manual_formula",    trigger_basis: null, trigger_days_default: null };
    case "manual_in_formula":  return { price_condition: "manual_in_formula", trigger_basis: null, trigger_days_default: null };
    case "average_month":      return { price_condition: "average_month",     trigger_basis: null, trigger_days_default: null };
    case "avg_to_date":        return { price_condition: "avg_to_date",       trigger_basis: null, trigger_days_default: null };
    case "fixed":              return { price_condition: "fixed",             trigger_basis: null, trigger_days_default: null };
    case "trigger_shipment":   return { price_condition: "trigger",           trigger_basis: "shipment_date",        trigger_days_default: 37 };
    case "trigger_border":     return { price_condition: "trigger",           trigger_basis: "border_crossing_date", trigger_days_default: 37 };
  }
}

export const USER_ROLES = [
  { value: "admin", label: "Администратор" },
  { value: "manager", label: "Менеджер" },
  { value: "logistics", label: "Логист" },
  { value: "accounting", label: "Бухгалтерия" },
  { value: "readonly", label: "Просмотр" },
] as const;

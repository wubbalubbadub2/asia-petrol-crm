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
  { value: "average_month", label: "Формула: Средний месяц" },
  { value: "fixed", label: "Формула: Фикс цена на дату" },
  { value: "trigger", label: "Формула: Триггер" },
] as const;

// Hierarchical version for the variant card / line editor UI. The
// trigger row is split per basis so the manager picks the basis at the
// same time as the condition. Each entry maps back to (price_condition,
// trigger_basis) — the DB shape — via `decodePriceMode`.
//
// User-facing wording (per client 2026-05-08):
//   • Фикс / Вручную                   → manual entry, no quotation lookup
//   • Формула: Средний месяц           → avg of all quotations in the deal month
//   • Формула: Триггер по дате отгрузки → trigger window, basis = shipment_date,  default 35 days (range 30-44)
//   • Формула: Триггер с пересечения границы → trigger window, basis = border_crossing_date, default 37 days (range 35-40)
//   • Формула: Фикс цена на дату        → snapshot quotation on a specific date
export type PriceMode =
  | "manual"
  | "fixed"
  | "average_month"
  | "trigger_shipment"
  | "trigger_border";

export const PRICE_MODES: { value: PriceMode; label: string; group: "manual" | "formula" }[] = [
  { value: "manual",            label: "Фикс / Вручную",                              group: "manual" },
  { value: "average_month",     label: "Формула: Средний месяц",                       group: "formula" },
  { value: "fixed",             label: "Формула: Фикс цена на дату",                   group: "formula" },
  { value: "trigger_shipment",  label: "Формула: Триггер — по дате отгрузки (30-44 дн)", group: "formula" },
  { value: "trigger_border",    label: "Формула: Триггер — с пересечения границы (35-40 дн)", group: "formula" },
];

export type TriggerBasisLite = "shipment_date" | "border_crossing_date";

export function encodePriceMode(
  condition: string | null | undefined,
  basis: TriggerBasisLite | null | undefined,
): PriceMode {
  if (condition === "trigger") {
    return basis === "border_crossing_date" ? "trigger_border" : "trigger_shipment";
  }
  if (condition === "fixed" || condition === "average_month" || condition === "manual") {
    return condition;
  }
  return "manual";
}

export function decodePriceMode(mode: PriceMode): {
  price_condition: "manual" | "fixed" | "average_month" | "trigger";
  trigger_basis: TriggerBasisLite | null;
  trigger_days_default: number | null;
} {
  switch (mode) {
    case "manual":           return { price_condition: "manual",        trigger_basis: null, trigger_days_default: null };
    case "average_month":    return { price_condition: "average_month", trigger_basis: null, trigger_days_default: null };
    case "fixed":            return { price_condition: "fixed",         trigger_basis: null, trigger_days_default: null };
    case "trigger_shipment": return { price_condition: "trigger",       trigger_basis: "shipment_date",        trigger_days_default: 35 };
    case "trigger_border":   return { price_condition: "trigger",       trigger_basis: "border_crossing_date", trigger_days_default: 37 };
  }
}

export const USER_ROLES = [
  { value: "admin", label: "Администратор" },
  { value: "manager", label: "Менеджер" },
  { value: "logistics", label: "Логист" },
  { value: "accounting", label: "Бухгалтерия" },
  { value: "readonly", label: "Просмотр" },
] as const;

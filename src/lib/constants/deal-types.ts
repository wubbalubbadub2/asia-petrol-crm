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

export const PRICE_CONDITIONS = [
  { value: "average_month", label: "Средний месяц" },
  { value: "fixed", label: "Фикс цена на дату" },
  { value: "trigger", label: "Триггер (35-40 дней)" },
  { value: "manual", label: "Вручную" },
] as const;

export const USER_ROLES = [
  { value: "admin", label: "Администратор" },
  { value: "manager", label: "Менеджер" },
  { value: "logistics", label: "Логист" },
  { value: "accounting", label: "Бухгалтерия" },
  { value: "readonly", label: "Просмотр" },
] as const;

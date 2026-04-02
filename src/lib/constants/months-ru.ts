export const MONTHS_RU = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
] as const;

export const QUARTERS = ["I кв", "II кв", "III кв", "IV кв"] as const;

export function getQuarterFromMonth(month: string): string {
  const idx = MONTHS_RU.indexOf(month as (typeof MONTHS_RU)[number]);
  if (idx === -1) return "";
  return QUARTERS[Math.floor(idx / 3)];
}

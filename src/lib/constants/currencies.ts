// Shared currency definitions used across deals, shipments, payments.
// Keep options flat so `<select>` + value comparisons work everywhere.

export const CURRENCIES: { value: string; label: string; symbol: string }[] = [
  { value: "USD", label: "USD $", symbol: "$" },
  { value: "KZT", label: "KZT ₸", symbol: "₸" },
  { value: "KGS", label: "KGS сом", symbol: "сом" },
  { value: "RUB", label: "RUB ₽", symbol: "₽" },
];

export const CURRENCY_SYMBOLS: Record<string, string> = Object.fromEntries(
  CURRENCIES.map((c) => [c.value, c.symbol]),
);

export function currencySymbol(code: string | null | undefined, fallback = "$"): string {
  if (!code) return fallback;
  return CURRENCY_SYMBOLS[code] ?? code;
}

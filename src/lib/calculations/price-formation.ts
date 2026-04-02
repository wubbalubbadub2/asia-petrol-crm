/**
 * Price Formation Calculator
 *
 * Three pricing modes per the TZ:
 * 1. Average Month (Средний месяц) — monthly average quotation - discount = price
 * 2. Fixed Date (Фикс цена на дату) — quotation on specific date - discount = price
 * 3. Trigger (35-40 days from date) — average over N days from start date - discount = price
 *
 * Formula: quotation - discount = price per ton
 */

export type PriceMode = "average_month" | "fixed" | "trigger";

export type PriceFormationInput = {
  mode: PriceMode;
  discount: number;
  // For average_month
  monthlyAverage?: number | null;
  // For fixed
  fixedDatePrice?: number | null;
  // For trigger
  triggerPrices?: number[];
  triggerDays?: number; // 35-40
};

export type PriceFormationResult = {
  quotation: number | null;
  discount: number;
  price: number | null;
  label: string;
};

export function calculatePrice(input: PriceFormationInput): PriceFormationResult {
  const { mode, discount } = input;

  switch (mode) {
    case "average_month": {
      const quotation = input.monthlyAverage ?? null;
      return {
        quotation,
        discount,
        price: quotation != null ? quotation - discount : null,
        label: "Средний месяц",
      };
    }

    case "fixed": {
      const quotation = input.fixedDatePrice ?? null;
      return {
        quotation,
        discount,
        price: quotation != null ? quotation - discount : null,
        label: "Фикс цена на дату",
      };
    }

    case "trigger": {
      const prices = input.triggerPrices ?? [];
      const quotation =
        prices.length > 0
          ? prices.reduce((a, b) => a + b, 0) / prices.length
          : null;
      return {
        quotation,
        discount,
        price: quotation != null ? quotation - discount : null,
        label: `Триггер (${input.triggerDays ?? 35} дней)`,
      };
    }
  }
}

/**
 * Get quotation prices for a date range (for trigger mode)
 */
export function getDateRange(startDate: string, days: number): { start: string; end: string } {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return {
    start: startDate,
    end: end.toISOString().split("T")[0],
  };
}

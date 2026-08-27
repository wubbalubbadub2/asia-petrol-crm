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
 * Границы окна котировок для режима «Триггер».
 *
 * Окно ВКЛЮЧАЕТ сам startDate: «Триггер (35 дней)» — это стартовая дата
 * и ещё 34 дня, то есть 35 календарных дат, попадающих в выборку
 * `date >= start AND date <= end` (price-calculator.tsx). Среднее по ним
 * и становится котировкой, поэтому граница окна — это цена.
 *
 * Считаем строго в UTC. Раньше здесь было `new Date(startDate +
 * "T00:00:00")` (ЛОКАЛЬНАЯ полночь) плюс `setDate`, а результат
 * снимался через `toISOString()` (UTC) — и конец окна уезжал на сутки в
 * зависимости от таймзоны браузера:
 *   Asia/Almaty (+05) → 2026-02-18, UTC → 2026-02-19, New York → 2026-02-19.
 * Пользователи все в Казахстане, поэтому в проде окно всегда было
 * 35-дневным включительно; эта правка закрепляет ровно это поведение и
 * убирает зависимость от таймзоны. Числа у казахстанских пользователей
 * не меняются.
 */
export function getDateRange(startDate: string, days: number): { start: string; end: string } {
  const end = new Date(`${startDate}T00:00:00Z`);
  // Math.max: окно из 0 или 1 дня — это сам startDate, а не пустой
  // диапазон с концом раньше начала.
  end.setUTCDate(end.getUTCDate() + Math.max(0, days - 1));
  return {
    start: startDate,
    end: end.toISOString().split("T")[0],
  };
}

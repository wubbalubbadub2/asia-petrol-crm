/**
 * Индекс курсов валют для отчётов.
 *
 * Правило клиента 2026-07-22: «если мы показываем данные на сегодня,
 * берём курс вчерашнего дня — сегодня курс ещё не зафиксировался и в
 * течение дня может меняться. Для всех дат начиная со вчера и ранее
 * курс уже зафиксирован, берём курс того дня.»
 *
 * Реализовано одним фильтром на входе: строки с датой позднее «вчера»
 * в индекс просто не попадают. Дальше обычный поиск последнего курса
 * с date <= запрошенной — он же закрывает выходные и праздники,
 * когда нац. банки не публикуют курс.
 *
 * base_currency всегда USD — пивот. KZT→KGS считается как
 * KZT→USD→KGS двумя обращениями.
 */
export type FxRateRow = {
  date: string;            // YYYY-MM-DD
  base_currency: string;
  quote_currency: string;
  rate: number;
};

export function prevDayISO(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type Point = { date: string; rate: number };

export class FxRates {
  private byQuote = new Map<string, Point[]>();

  constructor(rows: FxRateRow[], today: string) {
    const cutoff = prevDayISO(today);
    for (const r of rows) {
      if (r.base_currency !== "USD") continue;
      if (r.date > cutoff) continue;
      const arr = this.byQuote.get(r.quote_currency) ?? [];
      arr.push({ date: r.date, rate: Number(r.rate) });
      this.byQuote.set(r.quote_currency, arr);
    }
    // ISO-даты сравниваются лексикографически — сортировка строк корректна.
    for (const arr of this.byQuote.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Курс USD → quote на дату (последний зафиксированный с date <= p_date). */
  rateOn(quote: string, date: string): number | null {
    if (quote === "USD") return 1;
    const arr = this.byQuote.get(quote);
    if (!arr || arr.length === 0) return null;
    let lo = 0, hi = arr.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].date <= date) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return found >= 0 ? arr[found].rate : null;
  }

  /** Среднемесячный курс — фолбэк для событий без даты (=СРЗНАЧ в ТЗ). */
  rateInMonth(quote: string, year: number, month: number): number | null {
    if (quote === "USD") return 1;
    const arr = this.byQuote.get(quote);
    if (!arr) return null;
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const xs = arr.filter((r) => r.date.startsWith(prefix));
    if (xs.length === 0) return null;
    return xs.reduce((s, r) => s + r.rate, 0) / xs.length;
  }

  /**
   * Конвертация суммы. date === null → среднемесячный курс по fallback.
   * Любой недостающий курс даёт null — молча занулять деньги нельзя.
   */
  convert(
    amount: number | null,
    from: string | null,
    to: string,
    date: string | null,
    fallback: { year: number; month: number } | null,
  ): number | null {
    if (amount == null || !from) return null;
    if (from === to) return amount;
    const rate = (cur: string): number | null =>
      date != null
        ? this.rateOn(cur, date)
        : fallback != null
          ? this.rateInMonth(cur, fallback.year, fallback.month)
          : null;
    const rFrom = rate(from);
    if (rFrom == null || rFrom === 0) return null;
    const rTo = rate(to);
    if (rTo == null || rTo === 0) return null;
    return (amount / rFrom) * rTo;
  }
}

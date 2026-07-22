# Отчёт «Сбор по валюте» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Таблица сделок на 25 колонок, где каждая денежная величина пересчитана в выбранную валюту по курсу даты своего события, с фильтрами и детальной Excel-выгрузкой как в паспорте.

**Architecture:** Конвертация целиком на клиенте. `FxRates` — индекс курсов с правилом «на сегодня берём вчерашний курс». `convertDeal()` — чистая функция: сделка + её события → строка отчёта. Хук грузит данные, страница рисует. Экспортёр «Паспорт Детальный» получает режим валюты и переиспользуется как есть.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase JS, vitest, exceljs, nuqs.

## Global Constraints

- **Спека:** `docs/superpowers/specs/2026-07-22-fx-collection-report-design.md` — источник истины по правилам.
- **Пагинация обязательна.** Любой запрос без `.range()` молча режется PostgREST'ом на 1000 строк. Только через `fetchAllPaginated` с детерминированным ORDER BY (обязательный tie-breaker `id`).
- **Объёмы, тоннаж и вагоны не конвертируются никогда.** Только деньги.
- **Правило курса:** эффективная дата = `min(дата события, вчера)`. Курс сегодняшнего дня не используется — он ещё не зафиксирован.
- **Отчёт read-only.** Ни одной операции записи в БД.
- **Формулы паспорта не переизобретаем:** `Баланс = Приход − Оплата + жд(если галочка) + грузоотправитель(если галочка)`, `Долг = Оплата покуп. − Отгружено сумма`. Условие «валюта сделки == валюта логистики» вычисляется по ИСХОДНЫМ валютам.
- **Тесты:** `npx vitest run` — весь набор зелёный, кроме заведомо сломанного до нас `bulk-wagons.test.ts`.
- **Проверка на проде.** Локального dev-сервера не поднимаем: пушим в `main`, Vercel деплоит, проверяем на `https://asia-petrol-crm.vercel.app`.
- **CHANGELOG обязателен.** После каждой задачи — запись НАВЕРХ `CHANGELOG-SINCE-EXTRACTION.md` (файл newest-first).

## Источники истины по данным (проверено на живой БД 2026-07-22)

| Величина в паспорте | Откуда берётся на самом деле |
|---|---|
| `supplier_shipped_amount` / `buyer_shipped_amount` | `Σ deal_shipment_prices.amount` по стороне. У каждой строки есть `shipment_date` — **это и есть дата курса** |
| `supplier_payment` / `buyer_payment` | `Σ deal_payments.amount` со знаком по `payment_type` |
| `invoice_amount` | `Σ shipment_registry.shipped_tonnage_amount` |
| `additional_expenses_amount` | `Σ shipment_registry.additional_expenses` |
| Объёмы | `deals.supplier_shipped_volume` / `buyer_shipped_volume` / `actual_shipped_volume` |

## Структура файлов

| Файл | Ответственность |
|---|---|
| `src/lib/fx/rates.ts` | НОВЫЙ. Индекс курсов + правило «вчерашний курс». Ноль знаний о сделках |
| `src/lib/fx/convert-deal.ts` | НОВЫЙ. Чистая функция: сделка + события → строка отчёта. Ноль знаний о сети и React |
| `src/lib/data/deal-events.ts` | НОВЫЙ. Загрузка событий сделок пачками с пагинацией. Ноль бизнес-логики |
| `src/lib/hooks/use-fx-collection.ts` | НОВЫЙ. Склейка: грузит → конвертирует → мемоизирует |
| `src/components/reports/passport-filters.tsx` | НОВЫЙ. Осознанная копия фильтров паспорта (решение №3 спеки) |
| `src/components/reports/collection-table.tsx` | НОВЫЙ. Таблица 25 колонок + итоги |
| `src/app/(dashboard)/reports/collection/page.tsx` | НОВАЯ страница |
| `src/lib/exports/passport-detail-excel.ts` | Правка: режим валюты |
| `src/lib/constants/nav-items.ts` | Правка: пункт меню |
| `supabase/migrations/00127_fx_rate_yesterday.sql` | НОВАЯ миграция: тот же кламп в SQL |

---

### Task 1: Индекс курсов `FxRates`

**Files:**
- Create: `src/lib/fx/rates.ts`
- Test: `src/__tests__/fx-rates.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `type FxRateRow = { date: string; base_currency: string; quote_currency: string; rate: number }`
  - `function prevDayISO(iso: string): string`
  - `class FxRates` с конструктором `(rows: FxRateRow[], today: string)` и методами `rateOn(quote: string, date: string): number | null`, `rateInMonth(quote: string, year: number, month: number): number | null`, `convert(amount: number | null, from: string | null, to: string, date: string | null, fallback: { year: number; month: number } | null): number | null`

- [ ] **Step 1: Написать падающий тест**

Создать `src/__tests__/fx-rates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FxRates, prevDayISO, type FxRateRow } from "@/lib/fx/rates";

// НБ РК публикует USD→KZT, НБ КР — USD→KGS. base всегда USD (пивот).
const ROWS: FxRateRow[] = [
  { date: "2026-07-16", base_currency: "USD", quote_currency: "KZT", rate: 468 },
  { date: "2026-07-17", base_currency: "USD", quote_currency: "KZT", rate: 470 },
  { date: "2026-07-20", base_currency: "USD", quote_currency: "KZT", rate: 475 },
  { date: "2026-07-17", base_currency: "USD", quote_currency: "KGS", rate: 87 },
];

describe("prevDayISO", () => {
  it("переходит через границу месяца", () => {
    expect(prevDayISO("2026-08-01")).toBe("2026-07-31");
    expect(prevDayISO("2026-07-21")).toBe("2026-07-20");
  });
});

describe("FxRates.rateOn", () => {
  it("берёт курс своего дня для прошлых дат", () => {
    const fx = new FxRates(ROWS, "2026-07-21");
    expect(fx.rateOn("KZT", "2026-07-17")).toBe(470);
  });

  it("на СЕГОДНЯ берёт вчерашний зафиксированный курс", () => {
    // сегодня 2026-07-21, курс за 21-е ещё не зафиксирован
    const withToday: FxRateRow[] = [
      ...ROWS,
      { date: "2026-07-21", base_currency: "USD", quote_currency: "KZT", rate: 999 },
    ];
    const fx = new FxRates(withToday, "2026-07-21");
    expect(fx.rateOn("KZT", "2026-07-21")).toBe(475);
  });

  it("на выходных подтягивает последний рабочий день", () => {
    const fx = new FxRates(ROWS, "2026-07-21");
    expect(fx.rateOn("KZT", "2026-07-19")).toBe(470);
  });

  it("USD к USD всегда 1", () => {
    const fx = new FxRates(ROWS, "2026-07-21");
    expect(fx.rateOn("USD", "2026-07-17")).toBe(1);
  });

  it("нет курса раньше первой записи — null", () => {
    const fx = new FxRates(ROWS, "2026-07-21");
    expect(fx.rateOn("KZT", "2026-01-01")).toBeNull();
    expect(fx.rateOn("RUB", "2026-07-17")).toBeNull();
  });
});

describe("FxRates.convert", () => {
  const fx = new FxRates(ROWS, "2026-07-21");

  it("USD → KZT умножает", () => {
    expect(fx.convert(100, "USD", "KZT", "2026-07-17", null)).toBe(47000);
  });

  it("KZT → USD делит", () => {
    expect(fx.convert(47000, "KZT", "USD", "2026-07-17", null)).toBe(100);
  });

  it("KGS → KZT идёт через USD", () => {
    // 87 сом = 1 USD = 470 тенге
    expect(fx.convert(87, "KGS", "KZT", "2026-07-17", null)).toBeCloseTo(470, 6);
  });

  it("одинаковые валюты возвращают сумму как есть", () => {
    expect(fx.convert(123.45, "KZT", "KZT", null, null)).toBe(123.45);
  });

  it("без даты берёт среднемесячный курс", () => {
    // июль: (468 + 470 + 475) / 3 = 471
    expect(fx.convert(1, "USD", "KZT", null, { year: 2026, month: 7 })).toBeCloseTo(471, 6);
  });

  it("нет курса — null, а не ноль", () => {
    expect(fx.convert(100, "USD", "KZT", "2026-01-01", null)).toBeNull();
    expect(fx.convert(100, "USD", "RUB", "2026-07-17", null)).toBeNull();
    expect(fx.convert(null, "USD", "KZT", "2026-07-17", null)).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/__tests__/fx-rates.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/fx/rates"`.

- [ ] **Step 3: Реализовать**

Создать `src/lib/fx/rates.ts`:

```ts
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
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run src/__tests__/fx-rates.test.ts`
Expected: PASS, 12 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/fx/rates.ts src/__tests__/fx-rates.test.ts
git commit -m "feat(fx): индекс курсов с правилом «на сегодня — вчерашний курс»"
```

---

### Task 2: Ядро конвертации `convertDeal`

**Files:**
- Create: `src/lib/fx/convert-deal.ts`
- Test: `src/__tests__/fx-convert-deal.test.ts`

**Interfaces:**
- Consumes: `FxRates` из Task 1.
- Produces:
  - `type PriceRow = { deal_id: string; side: "supplier" | "buyer"; amount: number | null; shipment_date: string | null }`
  - `type PaymentRow = { deal_id: string; side: "supplier" | "buyer"; amount: number | null; payment_date: string | null; currency: string | null }`
  - `type LogisticsRow = { deal_id: string; loading_date: string | null; date: string | null; shipped_tonnage_amount: number | null; additional_expenses: number | null; currency: string | null }`
  - `type DealEvents = { prices: PriceRow[]; payments: PaymentRow[]; logistics: LogisticsRow[] }`
  - `type FxDealRow` — см. код ниже
  - `function monthNumRu(month: string | null): number | null`
  - `function convertDeal(deal: Deal, events: DealEvents, fx: FxRates, target: string): FxDealRow`

- [ ] **Step 1: Написать падающий тест**

Создать `src/__tests__/fx-convert-deal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FxRates, type FxRateRow } from "@/lib/fx/rates";
import { convertDeal, monthNumRu, type DealEvents } from "@/lib/fx/convert-deal";
import type { Deal } from "@/lib/hooks/use-deals";

const RATES: FxRateRow[] = [
  { date: "2026-06-10", base_currency: "USD", quote_currency: "KZT", rate: 500 },
  { date: "2026-06-20", base_currency: "USD", quote_currency: "KZT", rate: 400 },
];
const fx = new FxRates(RATES, "2026-07-21");

// Минимальная сделка: только поля, которые читает convertDeal.
function makeDeal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    deal_code: "KG/26/001",
    year: 2026,
    month: "июнь",
    deal_type: "KG",
    supplier_currency: "USD",
    buyer_currency: "USD",
    logistics_currency: "USD",
    supplier_shipped_volume: 100,
    buyer_shipped_volume: 100,
    actual_shipped_volume: 100,
    railway_in_price: false,
    additional_expenses_in_price: false,
    ...over,
  } as unknown as Deal;
}

const EMPTY: DealEvents = { prices: [], payments: [], logistics: [] };

describe("monthNumRu", () => {
  it("переводит русский месяц в номер", () => {
    expect(monthNumRu("июнь")).toBe(6);
    expect(monthNumRu("Декабрь")).toBe(12);
    expect(monthNumRu("не месяц")).toBeNull();
    expect(monthNumRu(null)).toBeNull();
  });
});

describe("convertDeal — паритет с паспортом", () => {
  it("в родной валюте суммы совпадают с исходными", () => {
    const deal = makeDeal();
    const events: DealEvents = {
      prices: [
        { deal_id: "d1", side: "supplier", amount: 1000, shipment_date: "2026-06-10" },
        { deal_id: "d1", side: "supplier", amount: 500, shipment_date: "2026-06-20" },
        { deal_id: "d1", side: "buyer", amount: 2000, shipment_date: "2026-06-20" },
      ],
      payments: [
        { deal_id: "d1", side: "supplier", amount: 600, payment_date: "2026-06-10", currency: null },
        { deal_id: "d1", side: "buyer", amount: 2500, payment_date: "2026-06-20", currency: null },
      ],
      logistics: [],
    };
    const row = convertDeal(deal, events, fx, "USD");
    expect(row.supplierAmount).toBe(1500);
    expect(row.supplierPayment).toBe(600);
    expect(row.supplierBalance).toBe(900);   // 1500 − 600
    expect(row.buyerAmount).toBe(2000);
    expect(row.buyerPayment).toBe(2500);
    expect(row.buyerDebt).toBe(500);         // 2500 − 2000
    expect(row.incomplete).toBe(false);
  });
});

describe("convertDeal — конвертация по дате события", () => {
  it("каждая сумма берёт курс своей даты", () => {
    const deal = makeDeal();
    const events: DealEvents = {
      ...EMPTY,
      prices: [
        { deal_id: "d1", side: "supplier", amount: 1000, shipment_date: "2026-06-10" }, // ×500
        { deal_id: "d1", side: "supplier", amount: 1000, shipment_date: "2026-06-20" }, // ×400
      ],
    };
    const row = convertDeal(deal, events, fx, "KZT");
    expect(row.supplierAmount).toBe(900_000);
  });

  it("цена = сконвертированная сумма ÷ объём", () => {
    const deal = makeDeal({ supplier_shipped_volume: 200 } as Partial<Deal>);
    const events: DealEvents = {
      ...EMPTY,
      prices: [{ deal_id: "d1", side: "supplier", amount: 1000, shipment_date: "2026-06-20" }],
    };
    const row = convertDeal(deal, events, fx, "KZT");
    expect(row.supplierAmount).toBe(400_000);
    expect(row.supplierPrice).toBe(2000);
  });

  it("событие без даты берёт среднемесячный курс месяца сделки", () => {
    const deal = makeDeal();
    const events: DealEvents = {
      ...EMPTY,
      prices: [{ deal_id: "d1", side: "supplier", amount: 100, shipment_date: null }],
    };
    // июнь: (500 + 400) / 2 = 450
    const row = convertDeal(deal, events, fx, "KZT");
    expect(row.supplierAmount).toBe(45_000);
    expect(row.incomplete).toBe(false);
  });

  it("нет курса — сумма пустая, строка помечена неполной", () => {
    const deal = makeDeal({ month: null } as Partial<Deal>);
    const events: DealEvents = {
      ...EMPTY,
      prices: [{ deal_id: "d1", side: "supplier", amount: 100, shipment_date: null }],
    };
    const row = convertDeal(deal, events, fx, "KZT");
    expect(row.supplierAmount).toBeNull();
    expect(row.incomplete).toBe(true);
  });

  it("валюта строки реестра важнее валюты сделки", () => {
    const deal = makeDeal({ logistics_currency: "USD" } as Partial<Deal>);
    const events: DealEvents = {
      ...EMPTY,
      logistics: [
        { deal_id: "d1", loading_date: "2026-06-20", date: "2026-06-20", shipped_tonnage_amount: 40000, additional_expenses: null, currency: "KZT" },
      ],
    };
    const row = convertDeal(deal, events, fx, "USD");
    expect(row.railAmount).toBe(100); // 40000 KZT ÷ 400
  });
});

describe("convertDeal — галочки «в цене»", () => {
  const events: DealEvents = {
    prices: [{ deal_id: "d1", side: "supplier", amount: 1000, shipment_date: "2026-06-20" }],
    payments: [],
    logistics: [
      { deal_id: "d1", loading_date: "2026-06-20", date: "2026-06-20", shipped_tonnage_amount: 200, additional_expenses: 50, currency: null },
    ],
  };

  it("жд в цене плюсуется к балансу", () => {
    const row = convertDeal(makeDeal({ railway_in_price: true } as Partial<Deal>), events, fx, "USD");
    expect(row.supplierBalance).toBe(1200);
  });

  it("грузоотправитель в цене плюсуется к балансу", () => {
    const row = convertDeal(makeDeal({ additional_expenses_in_price: true } as Partial<Deal>), events, fx, "USD");
    expect(row.supplierBalance).toBe(1050);
  });

  it("галочка не срабатывает, когда исходные валюты сделки и логистики разные", () => {
    const deal = makeDeal({ railway_in_price: true, logistics_currency: "KZT" } as Partial<Deal>);
    const row = convertDeal(deal, events, fx, "USD");
    expect(row.supplierBalance).toBe(1000); // жд НЕ плюсуется — как в паспорте
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/__tests__/fx-convert-deal.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/fx/convert-deal"`.

- [ ] **Step 3: Реализовать**

Создать `src/lib/fx/convert-deal.ts`:

```ts
/**
 * Пересчёт сделки в выбранную валюту для отчёта «Сбор по валюте».
 *
 * Чистая функция: никакой сети, никакого React. Каждая денежная
 * величина пересобирается из СОБЫТИЙ, и каждое событие берёт курс
 * своей даты — хранимые итоги сделки сконвертировать нельзя, у них
 * нет даты.
 *
 * Источники (проверено на живой БД 2026-07-22):
 *   Приход / Отгружено сумма — deal_shipment_prices (у строки есть
 *     собственная shipment_date; сумма правится вручную в карточке
 *     Триггер/Фикс/Средний месяц, поэтому «цена × объём» пересчитывать
 *     НЕЛЬЗЯ — разойдётся с паспортом);
 *   Оплаты — deal_payments (знак уже применён на загрузке);
 *   Сумма жд и грузоотправителя — shipment_registry.
 *
 * Баланс и Долг повторяют формулу БД (compute_deal_derived_fields,
 * миграция 00112) слово в слово. Условие «валюта сделки == валюта
 * логистики» проверяется по ИСХОДНЫМ валютам: после конвертации оно
 * выполнялось бы всегда, и баланс разошёлся бы с паспортом по
 * составу, а не только по курсу.
 */
import type { Deal } from "@/lib/hooks/use-deals";
import type { FxRates } from "@/lib/fx/rates";

export type PriceRow = {
  deal_id: string;
  side: "supplier" | "buyer";
  amount: number | null;
  shipment_date: string | null;
};

export type PaymentRow = {
  deal_id: string;
  side: "supplier" | "buyer";
  amount: number | null;      // знак уже применён (возврат/перезачёт → минус)
  payment_date: string | null;
  currency: string | null;
};

export type LogisticsRow = {
  deal_id: string;
  loading_date: string | null;   // входящее СНТ — по нему считается логистика
  date: string | null;           // исходящее СНТ — фолбэк, если входящей нет
  shipped_tonnage_amount: number | null;
  additional_expenses: number | null;
  currency: string | null;
};

export type DealEvents = {
  prices: PriceRow[];
  payments: PaymentRow[];
  logistics: LogisticsRow[];
};

export type FxDealRow = {
  id: string;
  dealCode: string;
  month: string | null;
  factory: string;
  fuel: string;
  supplier: string;
  supplierContract: string;
  supplierPrice: number | null;
  supplierAmount: number | null;
  supplierVolume: number | null;
  supplierPayment: number | null;
  supplierBalance: number | null;
  chain: string;
  buyer: string;
  buyerContract: string;
  buyerPrice: number | null;
  buyerVolume: number | null;
  buyerAmount: number | null;
  buyerPayment: number | null;
  buyerDebt: number | null;
  forwarder: string;
  logisticsGroup: string;
  actualTariff: number | null;
  actualVolume: number | null;
  railAmount: number | null;
  shipperAmount: number | null;
  /** Хоть одна сумма не сконвертировалась — не хватило курса. */
  incomplete: boolean;
};

const MONTHS_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

export function monthNumRu(month: string | null): number | null {
  if (!month) return null;
  const i = MONTHS_RU.indexOf(month.trim().toLowerCase());
  return i === -1 ? null : i + 1;
}

// Сумма списка событий в целевой валюте. Если хоть одно событие не
// сконвертировалось — возвращаем null: показать заниженную сумму
// хуже, чем показать пустую ячейку.
function sumConverted<T>(
  items: T[],
  amountOf: (x: T) => number | null,
  dateOf: (x: T) => string | null,
  currencyOf: (x: T) => string,
  fx: FxRates,
  target: string,
  fallback: { year: number; month: number } | null,
): number | null {
  let total = 0;
  for (const it of items) {
    const raw = amountOf(it);
    if (raw == null) continue;
    const v = fx.convert(raw, currencyOf(it), target, dateOf(it), fallback);
    if (v == null) return null;
    total += v;
  }
  return total;
}

function divide(amount: number | null, volume: number | null): number | null {
  if (amount == null || volume == null || volume === 0) return null;
  return amount / volume;
}

export function convertDeal(
  deal: Deal,
  events: DealEvents,
  fx: FxRates,
  target: string,
): FxDealRow {
  const m = monthNumRu(deal.month);
  const fallback = deal.year != null && m != null ? { year: deal.year, month: m } : null;

  const supplierPrices = events.prices.filter((p) => p.side === "supplier");
  const buyerPrices = events.prices.filter((p) => p.side === "buyer");
  const supplierPays = events.payments.filter((p) => p.side === "supplier");
  const buyerPays = events.payments.filter((p) => p.side === "buyer");

  const supplierAmount = sumConverted(
    supplierPrices, (p) => p.amount, (p) => p.shipment_date,
    () => deal.supplier_currency, fx, target, fallback,
  );
  const buyerAmount = sumConverted(
    buyerPrices, (p) => p.amount, (p) => p.shipment_date,
    () => deal.buyer_currency, fx, target, fallback,
  );
  const supplierPayment = sumConverted(
    supplierPays, (p) => p.amount, (p) => p.payment_date,
    (p) => p.currency ?? deal.supplier_currency, fx, target, fallback,
  );
  const buyerPayment = sumConverted(
    buyerPays, (p) => p.amount, (p) => p.payment_date,
    (p) => p.currency ?? deal.buyer_currency, fx, target, fallback,
  );

  // Логистика — по дате ВХОДЯЩЕГО СНТ (ТЗ: «оплата экспедитору так же
  // берётся по дате входящего СНТ»); если её нет — по исходящему.
  const logisticsDate = (r: LogisticsRow) => r.loading_date ?? r.date;
  const logisticsCur = (r: LogisticsRow) => r.currency ?? deal.logistics_currency;
  const railAmount = sumConverted(
    events.logistics, (r) => r.shipped_tonnage_amount, logisticsDate,
    logisticsCur, fx, target, fallback,
  );
  const shipperAmount = sumConverted(
    events.logistics, (r) => r.additional_expenses, logisticsDate,
    logisticsCur, fx, target, fallback,
  );

  // Формула паспорта (00112). Галочки смотрят на ИСХОДНЫЕ валюты.
  const railInPrice = deal.railway_in_price === true && deal.supplier_currency === deal.logistics_currency;
  const shipperInPrice = deal.additional_expenses_in_price === true && deal.supplier_currency === deal.logistics_currency;
  const balanceParts: (number | null)[] = [supplierAmount, supplierPayment];
  if (railInPrice) balanceParts.push(railAmount);
  if (shipperInPrice) balanceParts.push(shipperAmount);
  const supplierBalance = balanceParts.some((x) => x == null)
    ? null
    : (supplierAmount as number) - (supplierPayment as number)
      + (railInPrice ? (railAmount as number) : 0)
      + (shipperInPrice ? (shipperAmount as number) : 0);

  const buyerDebt = buyerPayment == null || buyerAmount == null
    ? null
    : buyerPayment - buyerAmount;

  const supplierVolume = deal.supplier_shipped_volume;
  const buyerVolume = deal.buyer_shipped_volume;
  const actualVolume = deal.actual_shipped_volume;

  const chain = (deal.deal_company_groups ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((g) => g.company_group?.name)
    .filter((n): n is string => !!n)
    .join(" → ");

  const money = [supplierAmount, buyerAmount, supplierPayment, buyerPayment, railAmount, shipperAmount];
  const incomplete = money.some((x) => x == null) || supplierBalance == null || buyerDebt == null;

  return {
    id: deal.id,
    dealCode: deal.deal_code,
    month: deal.month,
    factory: deal.factory?.name ?? "",
    fuel: deal.fuel_type?.name ?? "",
    supplier: deal.supplier?.short_name ?? deal.supplier?.full_name ?? "",
    supplierContract: deal.supplier_contract ?? "",
    supplierPrice: divide(supplierAmount, supplierVolume),
    supplierAmount,
    supplierVolume,
    supplierPayment,
    supplierBalance,
    chain,
    buyer: deal.buyer?.short_name ?? deal.buyer?.full_name ?? "",
    buyerContract: deal.buyer_contract ?? "",
    buyerPrice: divide(buyerAmount, buyerVolume),
    buyerVolume,
    buyerAmount,
    buyerPayment,
    buyerDebt,
    forwarder: deal.forwarder?.name ?? "",
    logisticsGroup: deal.logistics_company_group?.name ?? "",
    actualTariff: divide(railAmount, actualVolume),
    actualVolume,
    railAmount,
    shipperAmount,
    incomplete,
  };
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run src/__tests__/fx-convert-deal.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Проверить типы и закоммитить**

```bash
npx tsc --noEmit
git add src/lib/fx/convert-deal.ts src/__tests__/fx-convert-deal.test.ts
git commit -m "feat(fx): ядро пересчёта сделки в выбранную валюту"
```

---

### Task 3: Загрузка событий сделок

**Files:**
- Create: `src/lib/data/deal-events.ts`
- Modify: `src/lib/exports/passport-detail-excel.ts` (перевести три фетчера на общий хелпер)

**Interfaces:**
- Consumes: типы `PriceRow`, `PaymentRow`, `LogisticsRow`, `DealEvents` из Task 2.
- Produces:
  - `function fetchByDealIds<T>(opts: { table: string; select: string; dealIds: string[]; orderBy: string[] }): Promise<T[]>`
  - `function fetchDealEvents(dealIds: string[]): Promise<Map<string, DealEvents>>`
  - `function fetchFxRatesRange(fromDate: string, toDate: string): Promise<FxRateRow[]>`

- [ ] **Step 1: Создать модуль**

Создать `src/lib/data/deal-events.ts`:

```ts
/**
 * Загрузка событий сделок для отчёта «Сбор по валюте».
 *
 * ВСЁ идёт через fetchAllPaginated с tie-breaker'ом по id. Запрос без
 * .range() молча режется PostgREST'ом на 1000 строк — этот баг уже
 * стоил нам пропавших под-строк в выгрузке паспорта (KG/26/346,
 * 2026-07-20) и обрезанного отчёта по ценам.
 */
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";
import type { FxRateRow } from "@/lib/fx/rates";
import type { DealEvents, PriceRow, PaymentRow, LogisticsRow } from "@/lib/fx/convert-deal";

type PostgrestPage<T> = PromiseLike<{ data: T[] | null; error: PostgrestError | null }>;

const CHUNK = 150;   // PostgREST ограничивает длину URL — IN-лист чанкуем

/**
 * Батчевая выборка по deal_id: чанки по 150 id параллельно, каждый
 * чанк постранично. orderBy обязан заканчиваться на "id" — без
 * детерминированного порядка строки на границе страниц теряются.
 */
export async function fetchByDealIds<T>(opts: {
  table: string;
  select: string;
  dealIds: string[];
  orderBy: string[];
}): Promise<T[]> {
  if (opts.dealIds.length === 0) return [];
  if (opts.orderBy[opts.orderBy.length - 1] !== "id") {
    throw new Error(`fetchByDealIds(${opts.table}): последний ключ сортировки обязан быть "id"`);
  }
  const sb = createClient();
  const chunks: string[][] = [];
  for (let i = 0; i < opts.dealIds.length; i += CHUNK) chunks.push(opts.dealIds.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map((ids) =>
    fetchAllPaginated<T>((from, to) => {
      let q = sb.from(opts.table).select(opts.select).in("deal_id", ids);
      for (const col of opts.orderBy) q = q.order(col, { ascending: true });
      return q.range(from, to) as unknown as PostgrestPage<T>;
    }),
  ));
  const out: T[] = [];
  for (const res of results) {
    if (res.error) throw new Error(`${opts.table}: ${res.error.message}`);
    out.push(...res.data);
  }
  return out;
}

type RawPayment = PaymentRow & { payment_type: string | null };

/** Все события выбранных сделок, сгруппированные по deal_id. */
export async function fetchDealEvents(dealIds: string[]): Promise<Map<string, DealEvents>> {
  const [prices, payments, logistics] = await Promise.all([
    fetchByDealIds<PriceRow>({
      table: "deal_shipment_prices",
      select: "deal_id, side, amount, shipment_date, id",
      dealIds,
      orderBy: ["deal_id", "id"],
    }),
    fetchByDealIds<RawPayment>({
      table: "deal_payments",
      select: "deal_id, side, amount, payment_date, currency, payment_type, id",
      dealIds,
      orderBy: ["deal_id", "id"],
    }),
    fetchByDealIds<LogisticsRow>({
      table: "shipment_registry",
      select: "deal_id, loading_date, date, shipped_tonnage_amount, additional_expenses, currency, id",
      dealIds,
      orderBy: ["deal_id", "id"],
    }),
  ]);

  const out = new Map<string, DealEvents>();
  const bucket = (id: string): DealEvents => {
    let b = out.get(id);
    if (!b) { b = { prices: [], payments: [], logistics: [] }; out.set(id, b); }
    return b;
  };
  for (const p of prices) bucket(p.deal_id).prices.push(p);
  for (const p of payments) {
    // Знак задаётся типом платежа — та же конвенция, что в rollup 00062
    // и в выгрузке паспорта.
    const sign = p.payment_type === "refund" || p.payment_type === "offset" ? -1 : 1;
    bucket(p.deal_id).payments.push({
      deal_id: p.deal_id, side: p.side,
      amount: p.amount != null ? p.amount * sign : null,
      payment_date: p.payment_date, currency: p.currency,
    });
  }
  for (const r of logistics) bucket(r.deal_id).logistics.push(r);
  return out;
}

/** Курсы за период. Таблица маленькая (≈2 строки в день), грузим целиком. */
export async function fetchFxRatesRange(fromDate: string, toDate: string): Promise<FxRateRow[]> {
  const sb = createClient();
  const { data, error } = await fetchAllPaginated<FxRateRow>((from, to) =>
    sb
      .from("fx_rates")
      .select("date, base_currency, quote_currency, rate")
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date", { ascending: true })
      .order("quote_currency", { ascending: true })
      .range(from, to) as unknown as PostgrestPage<FxRateRow>,
  );
  if (error) throw new Error(`Курсы валют: ${error.message}`);
  return data;
}
```

- [ ] **Step 2: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add src/lib/data/deal-events.ts
git commit -m "feat(fx): загрузчик событий сделок с обязательной пагинацией"
```

---

### Task 4: Хук отчёта

**Files:**
- Create: `src/lib/hooks/use-fx-collection.ts`

**Interfaces:**
- Consumes: `fetchDealEvents`, `fetchFxRatesRange` (Task 3), `FxRates` (Task 1), `convertDeal` (Task 2).
- Produces: `function useFxCollection(deals: Deal[], target: string): { rows: FxDealRow[]; loading: boolean; error: string | null }`

- [ ] **Step 1: Реализовать хук**

Создать `src/lib/hooks/use-fx-collection.ts`:

```ts
"use client";
/**
 * Склейка отчёта «Сбор по валюте»: события сделок + курсы → строки.
 *
 * Сделки приходят снаружи (страница фильтрует их ровно так же, как
 * паспорт). События грузятся один раз на набор id и переиспользуются
 * при переключении валюты — конвертация чистая и дешёвая, сеть при
 * смене ₸/$ не трогается вообще.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Deal } from "@/lib/hooks/use-deals";
import { FxRates, type FxRateRow } from "@/lib/fx/rates";
import { convertDeal, type DealEvents, type FxDealRow } from "@/lib/fx/convert-deal";
import { fetchDealEvents, fetchFxRatesRange } from "@/lib/data/deal-events";

const EMPTY_EVENTS: DealEvents = { prices: [], payments: [], logistics: [] };

export function useFxCollection(deals: Deal[], target: string) {
  const [events, setEvents] = useState<Map<string, DealEvents>>(new Map());
  const [rates, setRates] = useState<FxRateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ключ загрузки — набор id. Смена валюты его не меняет.
  const idsKey = useMemo(() => deals.map((d) => d.id).sort().join(","), [deals]);
  const lastKey = useRef<string>("");

  useEffect(() => {
    if (!idsKey) { setEvents(new Map()); return; }
    if (lastKey.current === idsKey) return;
    lastKey.current = idsKey;
    const ids = idsKey.split(",");
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchDealEvents(ids),
      // Курсы грузим с запасом: события сделки могут выходить за
      // пределы её года (оплата в январе следующего).
      fetchFxRatesRange("2025-01-01", new Date().toISOString().slice(0, 10)),
    ])
      .then(([ev, rt]) => { if (alive) { setEvents(ev); setRates(rt); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [idsKey]);

  const rows = useMemo(() => {
    if (rates.length === 0) return [];
    const fx = new FxRates(rates, new Date().toISOString().slice(0, 10));
    return deals.map((d) => convertDeal(d, events.get(d.id) ?? EMPTY_EVENTS, fx, target));
  }, [deals, events, rates, target]);

  return { rows, loading, error };
}
```

- [ ] **Step 2: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add src/lib/hooks/use-fx-collection.ts
git commit -m "feat(fx): хук отчёта — события + курсы в строки таблицы"
```

---

### Task 5: Фильтры (копия паспорта)

**Files:**
- Create: `src/components/reports/passport-filters.tsx`
- Reference: `src/app/(dashboard)/deals/page.tsx:82-560` — источник копии

**Interfaces:**
- Consumes: `Deal`, `globalRefs`.
- Produces: `function usePassportFilters(deals: Deal[], dealType: "KG" | "KZ" | null): { filtered: Deal[]; activeFilterCount: number; clearAll: () => void; bar: React.ReactNode }`

**Решение №3 спеки:** это ОСОЗНАННАЯ копия. `/deals` не трогаем.

- [ ] **Step 1: Скопировать механику фильтров**

Скопировать из `src/app/(dashboard)/deals/page.tsx` в новый файл, обернув в один хук:
- 10 осей `useQueryState` (строки 102-131), но с **другими именами параметров URL** — префикс `r`: `rSupplierFilter`, `rBuyerFilter`, `rFactoryFilter`, `rFuelTypeFilter`, `rMonthFilter`, `rForwarderFilter`, `rCompanyGroupFilter`, `rCompanyGroupPos1`, `rCompanyGroupPos2`, `rApplicationFilter`, `rSearch`. Иначе открытые в соседних вкладках паспорт и отчёт будут перетирать фильтры друг друга;
- `useDeferredValue` на каждую ось (строки 141-151);
- `labelMaps` (строки 262-275);
- `predicates` (строки 285-340);
- блок сужения опций `narrowed` (строки 380-500);
- `filterOptions` (строки 501-526);
- `activeFilterCount` и `clearAllFilters` (строки 538-558);
- JSX самой панели фильтров (`SearchableSelect` × 10 + поиск + кнопка сброса).

Возвращать `{ filtered, activeFilterCount, clearAll, bar }`, где `bar` — готовый JSX панели.

- [ ] **Step 2: Проверить сборку**

Run: `npx tsc --noEmit && npm run build`
Expected: без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add src/components/reports/passport-filters.tsx
git commit -m "feat(reports): фильтры отчёта — копия фильтров паспорта"
```

---

### Task 6: Таблица 25 колонок

**Files:**
- Create: `src/components/reports/collection-table.tsx`

**Interfaces:**
- Consumes: `FxDealRow` (Task 2).
- Produces: `function CollectionTable({ rows, currency }: { rows: FxDealRow[]; currency: string }): React.ReactElement`

- [ ] **Step 1: Реализовать таблицу**

Создать `src/components/reports/collection-table.tsx`:

```tsx
"use client";
/**
 * Таблица отчёта «Сбор по валюте» — 25 колонок из ТЗ клиента
 * (files/Обработка сбор по валюте (1).docx), строка = сделка.
 * Бэнды и цвета — как в паспорте, чтобы взгляд не переучивался.
 */
import Link from "next/link";
import type { FxDealRow } from "@/lib/fx/convert-deal";
import { currencySymbol } from "@/lib/constants/currencies";

const money = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vol = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

type Band = "deal" | "supplier" | "groups" | "buyer" | "logistics";

const BAND_BG: Record<Band, string> = {
  deal: "bg-stone-100",
  supplier: "bg-amber-50",
  groups: "bg-stone-50",
  buyer: "bg-sky-50",
  logistics: "bg-emerald-50",
};

type Col = {
  key: string;
  header: string;
  band: Band;
  align?: "right";
  cell: (r: FxDealRow) => React.ReactNode;
  total?: (rows: FxDealRow[]) => React.ReactNode;
};

const sum = (rows: FxDealRow[], pick: (r: FxDealRow) => number | null) => {
  let t = 0;
  for (const r of rows) t += pick(r) ?? 0;
  return t;
};

const COLS: Col[] = [
  { key: "code", header: "№ сделки", band: "deal",
    cell: (r) => (
      <Link href={`/deals/${r.id}`} className="font-mono text-[11px] font-bold text-amber-700 underline decoration-amber-300 hover:text-amber-900">
        {r.dealCode}
      </Link>
    ) },
  { key: "month", header: "Месяц", band: "deal", cell: (r) => r.month ?? "—" },
  { key: "factory", header: "Завод", band: "deal", cell: (r) => r.factory || "—" },
  { key: "fuel", header: "ГСМ", band: "deal", cell: (r) => r.fuel || "—" },

  { key: "supplier", header: "Поставщик", band: "supplier", cell: (r) => r.supplier || "—" },
  { key: "sup_contract", header: "Договор", band: "supplier", cell: (r) => r.supplierContract || "—" },
  { key: "sup_price", header: "Цена", band: "supplier", align: "right", cell: (r) => money(r.supplierPrice) },
  { key: "sup_amount", header: "Приход сумма", band: "supplier", align: "right",
    cell: (r) => money(r.supplierAmount), total: (rows) => money(sum(rows, (r) => r.supplierAmount)) },
  { key: "sup_volume", header: "Приход объем", band: "supplier", align: "right",
    cell: (r) => vol(r.supplierVolume), total: (rows) => vol(sum(rows, (r) => r.supplierVolume)) },
  { key: "sup_payment", header: "Оплата", band: "supplier", align: "right",
    cell: (r) => money(r.supplierPayment), total: (rows) => money(sum(rows, (r) => r.supplierPayment)) },
  { key: "sup_balance", header: "Баланс", band: "supplier", align: "right",
    cell: (r) => money(r.supplierBalance), total: (rows) => money(sum(rows, (r) => r.supplierBalance)) },

  { key: "chain", header: "Группа компании", band: "groups", cell: (r) => r.chain || "—" },

  { key: "buyer", header: "Покупатель", band: "buyer", cell: (r) => r.buyer || "—" },
  { key: "buy_contract", header: "Договор", band: "buyer", cell: (r) => r.buyerContract || "—" },
  { key: "buy_price", header: "Цена", band: "buyer", align: "right", cell: (r) => money(r.buyerPrice) },
  { key: "buy_volume", header: "Отгружено тонн", band: "buyer", align: "right",
    cell: (r) => vol(r.buyerVolume), total: (rows) => vol(sum(rows, (r) => r.buyerVolume)) },
  { key: "buy_amount", header: "Отгружено сумма", band: "buyer", align: "right",
    cell: (r) => money(r.buyerAmount), total: (rows) => money(sum(rows, (r) => r.buyerAmount)) },
  { key: "buy_payment", header: "Оплата", band: "buyer", align: "right",
    cell: (r) => money(r.buyerPayment), total: (rows) => money(sum(rows, (r) => r.buyerPayment)) },
  { key: "buy_debt", header: "Долг", band: "buyer", align: "right",
    cell: (r) => money(r.buyerDebt), total: (rows) => money(sum(rows, (r) => r.buyerDebt)) },

  { key: "forwarder", header: "Экспедитор", band: "logistics", cell: (r) => r.forwarder || "—" },
  { key: "log_group", header: "Группа компании", band: "logistics", cell: (r) => r.logisticsGroup || "—" },
  { key: "tariff", header: "Тариф факт", band: "logistics", align: "right", cell: (r) => money(r.actualTariff) },
  { key: "act_volume", header: "Факт объем", band: "logistics", align: "right",
    cell: (r) => vol(r.actualVolume), total: (rows) => vol(sum(rows, (r) => r.actualVolume)) },
  { key: "rail_amount", header: "Сумма", band: "logistics", align: "right",
    cell: (r) => money(r.railAmount), total: (rows) => money(sum(rows, (r) => r.railAmount)) },
  { key: "shipper_amount", header: "Сумма грузоотправления", band: "logistics", align: "right",
    cell: (r) => money(r.shipperAmount), total: (rows) => money(sum(rows, (r) => r.shipperAmount)) },
];

export function CollectionTable({ rows, currency }: { rows: FxDealRow[]; currency: string }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
        <p className="text-sm text-stone-500">Нет сделок под текущими фильтрами</p>
      </div>
    );
  }
  return (
    <div className="overflow-auto rounded-md border border-stone-200 bg-white max-h-[calc(100vh-260px)]">
      <table className="w-max border-collapse text-[11px]">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.key}
                  className={`sticky top-0 z-10 border-r border-b border-stone-200 px-2 py-1.5 font-medium text-stone-700 whitespace-nowrap ${BAND_BG[c.band]} ${c.align === "right" ? "text-right" : "text-left"}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`hover:bg-amber-50/40 ${r.incomplete ? "bg-red-50/40" : ""}`}
                title={r.incomplete ? "Не хватило курса на дату одного из событий — часть сумм пустая" : undefined}>
              {COLS.map((c) => (
                <td key={c.key}
                    className={`border-r border-b border-stone-100 px-2 py-1 whitespace-nowrap ${c.align === "right" ? "text-right font-mono tabular-nums" : ""}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-stone-100 border-t-2 border-stone-300">
            {COLS.map((c, i) => (
              <td key={c.key}
                  className={`sticky bottom-0 border-r border-stone-200 px-2 py-1.5 font-semibold whitespace-nowrap bg-stone-100 ${c.align === "right" ? "text-right font-mono tabular-nums" : ""}`}>
                {i === 0 ? `Итого (${rows.length}) ${currencySymbol(currency)}` : c.total?.(rows) ?? ""}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Проверить сборку**

Run: `npx tsc --noEmit && npm run build`
Expected: без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add src/components/reports/collection-table.tsx
git commit -m "feat(reports): таблица «Сбор по валюте» — 25 колонок"
```

---

### Task 7: Страница отчёта и навигация

**Files:**
- Create: `src/app/(dashboard)/reports/collection/page.tsx`
- Modify: `src/lib/constants/nav-items.ts`
- Modify: `src/app/(dashboard)/reports/page.tsx:50` (заголовок)

**Interfaces:**
- Consumes: `usePassportFilters` (Task 5), `useFxCollection` (Task 4), `CollectionTable` (Task 6).
- Produces: маршрут `/reports/collection`.

- [ ] **Step 1: Страница**

Создать `src/app/(dashboard)/reports/collection/page.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import { useQueryState, parseAsInteger, parseAsStringEnum } from "nuqs";
import { useDeals, type Deal } from "@/lib/hooks/use-deals";
import { usePassportFilters } from "@/components/reports/passport-filters";
import { useFxCollection } from "@/lib/hooks/use-fx-collection";
import { CollectionTable } from "@/components/reports/collection-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CURRENT_YEAR = new Date().getFullYear();

export default function CollectionReportPage() {
  const [tab, setTab] = useQueryState("tab",
    parseAsStringEnum(["kg", "kz", "all"]).withDefault("kg"));
  const [currency, setCurrency] = useQueryState("cur",
    parseAsStringEnum(["KZT", "USD"]).withDefault("KZT"));
  const [year, setYear] = useQueryState("year",
    parseAsInteger.withDefault(CURRENT_YEAR));

  const { data: deals, loading: dealsLoading } = useDeals({ year, isArchived: false });
  const dealType = tab === "kg" ? "KG" : tab === "kz" ? "KZ" : null;
  const { filtered, activeFilterCount, clearAll, bar } = usePassportFilters(deals, dealType);
  const { rows, loading: fxLoading, error } = useFxCollection(filtered, currency);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Сбор по валюте</h1>
        {/* Кнопка Excel добавляется в Task 8 */}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded border border-stone-200 bg-white overflow-hidden">
          {(["kg", "kz", "all"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${tab === t ? "bg-amber-500 text-white" : "text-stone-600 hover:bg-stone-50"}`}>
              {t === "kg" ? "KG (Экспорт)" : t === "kz" ? "KZ (Внутренний)" : "Все"}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded border border-stone-200 bg-white overflow-hidden">
          {(["KZT", "USD"] as const).map((c) => (
            <button key={c} onClick={() => setCurrency(c)}
              className={`px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${currency === c ? "bg-amber-500 text-white" : "text-stone-600 hover:bg-stone-50"}`}>
              {c === "KZT" ? "₸ тенге" : "$ доллар"}
            </button>
          ))}
        </div>

        <div className="grid gap-1">
          <Label className="text-[11px] text-stone-500">Год</Label>
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
                 className="w-24 h-8 text-[12px]" />
        </div>

        <span className="ml-auto text-[11px] text-stone-400">
          {rows.length} сделок{activeFilterCount > 0 ? ` · фильтров: ${activeFilterCount}` : ""}
        </span>
      </div>

      {bar}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600">
          Ошибка: {error}
        </div>
      )}
      {dealsLoading || fxLoading
        ? <p className="text-sm text-stone-500">Загрузка…</p>
        : <CollectionTable rows={rows} currency={currency} />}
    </div>
  );
}
```

- [ ] **Step 2: Навигация**

В `src/lib/constants/nav-items.ts` в секции «Отчёты» заменить единственный пункт на два:

```ts
  // ── Отчёты ── (по пункту на каждый отчёт)
  {
    label: "Сбор по валюте",
    href: "/reports/collection",
    icon: Table2,
    section: "reports",
  },
  {
    label: "Анализ по валюте",
    href: "/reports",
    icon: BarChart3,
    section: "reports",
  },
```

Добавить `Table2` в импорт из `lucide-react` (строки 1-16).

**Важно:** в `src/components/layout/sidebar.tsx` подсветка активного пункта считает `pathname.startsWith(item.href)` — `/reports/collection` подсветит и «Анализ по валюте». Исправить в `NavLink` (строки 81-83):

```tsx
  const isActive =
    pathname === item.href ||
    (item.href !== "/" && pathname.startsWith(item.href + "/"));
```

- [ ] **Step 3: Переименовать первый отчёт**

В `src/app/(dashboard)/reports/page.tsx:50` заменить заголовок:

```tsx
      <h1 className="text-xl font-bold text-stone-900">Анализ по валюте</h1>
```

- [ ] **Step 4: Сборка и деплой**

```bash
npx tsc --noEmit && npm run build
git add -A && git commit -m "feat(reports): страница «Сбор по валюте» + два пункта в меню"
git push origin main
```

- [ ] **Step 5: Проверить на проде**

Открыть `https://asia-petrol-crm.vercel.app/reports/collection`, залогиниться, убедиться:
- в сайдбаре два пункта, активный подсвечен ровно один;
- таблица рисуется, 25 колонок, итоговая строка на месте;
- переключение ₸/$ меняет суммы и НЕ вызывает сетевых запросов (вкладка Network).

---

### Task 8: Excel в выбранной валюте

**Files:**
- Modify: `src/lib/exports/passport-detail-excel.ts`
- Modify: `src/app/(dashboard)/reports/collection/page.tsx` (кнопка)

**Interfaces:**
- Consumes: `FxRates` (Task 1), `convertDeal` (Task 2), `fetchFxRatesRange` (Task 3).
- Produces: `exportPassportDetailToExcel(deals, ctx, opts?: { variant?: "detail" | "debt"; fx?: { target: string; rates: FxRateRow[] } })`

Выгрузка остаётся «Паспорт Детальный» один в один — меняются только денежные значения.

- [ ] **Step 1: Расширить типы строк**

В `src/lib/exports/passport-detail-excel.ts` в тип `DetailShipment` (строки 46-60) добавить поля, заполняемые только в режиме валюты:

```ts
  additional_expenses?: number | null;
  currency?: string | null;
  // Заполняются только в fx-режиме: цена, пересчитанная по курсу даты
  // ЭТОЙ строки. Пусто в обычной выгрузке.
  fx_supplier_price?: number | null;
  fx_buyer_price?: number | null;
```

В `select` внутри `fetchShipmentsByDeals` (строка 343) добавить `additional_expenses, currency`.

- [ ] **Step 2: Научить колонки читать fx-цену**

Заменить четыре ридера (строки 172, 179, 199, 207):

```ts
  { key: "supplier_price", header: "Цена финальная", width: 12, band: "supplier", numFmt: NUM_FMT_PRICE,
    read: (d) => d.supplier_price,
    readShip: (d, s) => s.ship?.fx_supplier_price ?? d.supplier_price },
```

```ts
  { key: "supplier_shipped_amount", header: "Приход, сумма", width: 14, band: "supplier", numFmt: NUM_FMT_AMOUNT,
    read: (d) => d.supplier_shipped_amount,
    readShip: (d, s) => {
      const price = s.ship?.fx_supplier_price ?? d.supplier_price;
      return price != null && s.ship?.loading_volume != null ? price * s.ship.loading_volume : null;
    } },
```

```ts
  { key: "buyer_price", header: "Цена финальная", width: 12, band: "buyer", numFmt: NUM_FMT_PRICE,
    read: (d) => d.buyer_price,
    readShip: (d, s) => s.ship?.fx_buyer_price ?? d.buyer_price },
```

```ts
  { key: "buyer_shipped_amount", header: "Отгр. сумма", width: 14, band: "buyer", numFmt: NUM_FMT_AMOUNT,
    read: (d) => d.buyer_shipped_amount,
    readShip: (d, s) => {
      const price = s.ship?.fx_buyer_price ?? d.buyer_price;
      return price != null && s.ship?.shipment_volume != null ? price * s.ship.shipment_volume : null;
    } },
```

- [ ] **Step 3: Добавить fx-режим в экспортёр**

Расширить сигнатуру (строка 409-415):

```ts
export async function exportPassportDetailToExcel(
  deals: Deal[],
  ctx: ExportContext,
  opts?: { variant?: "detail" | "debt"; fx?: { target: string; rates: FxRateRow[] } },
): Promise<void> {
  const isDebt = opts?.variant === "debt";
```

После того как собраны `deals`, `shipmentsByDeal` и `paymentsByDeal` (сразу за блоком `deals = deals.map(...)`, строка ~500), вставить конвертацию:

```ts
  // ── Режим валюты (отчёт «Сбор по валюте») ────────────────────
  // Выгрузка та же самая, меняются только деньги: каждое значение
  // берёт курс даты СВОЕЙ строки. Объёмы не трогаем.
  if (opts?.fx) {
    const { FxRates } = await import("@/lib/fx/rates");
    const { convertDeal, monthNumRu } = await import("@/lib/fx/convert-deal");
    const { fetchDealEvents } = await import("@/lib/data/deal-events");
    const target = opts.fx.target;
    const fx = new FxRates(opts.fx.rates, new Date().toISOString().slice(0, 10));
    const eventsByDeal = await fetchDealEvents(dealIds);

    deals = deals.map((d) => {
      const m = monthNumRu(d.month);
      const fb = d.year != null && m != null ? { year: d.year, month: m } : null;
      const agg = convertDeal(d, eventsByDeal.get(d.id) ?? { prices: [], payments: [], logistics: [] }, fx, target);

      // Под-строки: цены и суммы по датам своих строк.
      const ships = shipmentsByDeal.get(d.id) ?? [];
      shipmentsByDeal.set(d.id, ships.map((s) => ({
        ...s,
        fx_supplier_price: fx.convert(d.supplier_price, d.supplier_currency, target, s.loading_date, fb),
        fx_buyer_price: fx.convert(d.buyer_price, d.buyer_currency, target, s.date, fb),
        shipped_tonnage_amount: fx.convert(
          s.shipped_tonnage_amount, s.currency ?? d.logistics_currency, target, s.loading_date ?? s.date, fb),
        railway_tariff: fx.convert(
          s.railway_tariff, s.currency ?? d.logistics_currency, target, s.loading_date ?? s.date, fb),
      })));

      const pays = paymentsByDeal.get(d.id);
      if (pays) {
        paymentsByDeal.set(d.id, {
          supplier: pays.supplier.map((p) => ({
            ...p, amount: fx.convert(p.amount, d.supplier_currency, target, p.payment_date, fb),
          })),
          buyer: pays.buyer.map((p) => ({
            ...p, amount: fx.convert(p.amount, d.buyer_currency, target, p.payment_date, fb),
          })),
        });
      }

      // Итоги сделки — из того же ядра, что и таблица на экране.
      return {
        ...d,
        supplier_price: agg.supplierPrice,
        supplier_shipped_amount: agg.supplierAmount,
        supplier_payment: agg.supplierPayment,
        supplier_balance: agg.supplierBalance,
        buyer_price: agg.buyerPrice,
        buyer_shipped_amount: agg.buyerAmount,
        buyer_payment: agg.buyerPayment,
        buyer_debt: agg.buyerDebt,
        invoice_amount: agg.railAmount,
        actual_tariff: agg.actualTariff,
        supplier_contracted_amount: fx.convert(d.supplier_contracted_amount, d.supplier_currency, target, null, fb),
        buyer_contracted_amount: fx.convert(d.buyer_contracted_amount, d.buyer_currency, target, null, fb),
        preliminary_amount: fx.convert(d.preliminary_amount, d.logistics_currency, target, null, fb),
        planned_tariff: fx.convert(d.planned_tariff, d.logistics_currency, target, null, fb),
      };
    });
  }
```

Импортировать тип наверху файла:

```ts
import type { FxRateRow } from "@/lib/fx/rates";
```

В имени листа (строка ~512) для fx-режима добавить валюту:

```ts
  const sheetName = opts?.fx
    ? `Сбор по валюте ${opts.fx.target}`
    : isDebt
      ? (ctx.dealType === "KG" ? "Паспорт (долги) KG" : ctx.dealType === "KZ" ? "Паспорт (долги) KZ" : "Паспорт (долги)")
      : (ctx.dealType === "KG" ? "Паспорт (дет.) KG" :
         ctx.dealType === "KZ" ? "Паспорт (дет.) KZ" :
         "Сделки (детально)");
```

- [ ] **Step 4: Кнопка на странице отчёта**

В `src/app/(dashboard)/reports/collection/page.tsx` добавить состояние и обработчик:

```tsx
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const [{ exportPassportDetailToExcel }, { fetchFxRatesRange }] = await Promise.all([
        import("@/lib/exports/passport-detail-excel"),
        import("@/lib/data/deal-events"),
      ]);
      const rates = await fetchFxRatesRange("2025-01-01", new Date().toISOString().slice(0, 10));
      // ExportContext = { dealType: "KG" | "KZ" | "ALL"; year: number }
      // (см. src/lib/exports/passport-excel.ts:180) — вкладка «Все»
      // маппится в "ALL".
      await exportPassportDetailToExcel(
        filtered,
        { dealType: dealType ?? "ALL", year },
        { variant: "detail", fx: { target: currency, rates } },
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }
```

И кнопку в шапку рядом с заголовком:

```tsx
        <Button size="sm" variant="outline" disabled={exporting || filtered.length === 0}
                onClick={handleExport} className="h-8 text-xs">
          {exporting ? "Выгрузка…" : "Excel"}
        </Button>
```

Импорты: `Button` из `@/components/ui/button`. Сверить поля `ExportContext` в `src/lib/exports/passport-excel.ts` и передать те, что он требует.

- [ ] **Step 5: Сборка, тесты, деплой**

```bash
npx tsc --noEmit && npx vitest run && npm run build
git add -A && git commit -m "feat(reports): выгрузка «Сбор по валюте» в формате Паспорт Детальный"
git push origin main
```

- [ ] **Step 6: Проверить выгрузку**

Скачать файл с прода и распарсить:

```bash
node -e "
const ExcelJS=require('exceljs');
(async()=>{const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(process.argv[1]);
const ws=wb.worksheets[0];console.log('лист:',ws.name,'колонок:',ws.columnCount,'строк:',ws.rowCount);})()
" ~/Downloads/<файл>.xlsx
```

Ожидается: 63 колонки, есть под-строки, суммы совпадают с экраном отчёта.

---

### Task 9: Кламп курса в SQL + сверка с паспортом на проде

**Files:**
- Create: `supabase/migrations/00127_fx_rate_yesterday.sql`

**Interfaces:**
- Consumes: `fx_rate` из 00123.
- Produces: та же сигнатура, изменённое поведение.

- [ ] **Step 1: Написать миграцию**

Создать `supabase/migrations/00127_fx_rate_yesterday.sql`:

```sql
-- 00127_fx_rate_yesterday.sql
--
-- Уточнение клиента 2026-07-22: «если мы показываем данные на сегодня,
-- то берём курс вчерашнего дня, так как сегодня курс ещё не
-- зафиксировался и в течение дня может меняться. Для всех дат начиная
-- со вчера и ранее курс уже зафиксирован — берём курс того дня.»
--
-- Клиентский отчёт «Сбор по валюте» реализует это же правило в TS
-- (src/lib/fx/rates.ts). Здесь повторяем в SQL, чтобы помесячный
-- «Анализ по валюте» считал так же — иначе два отчёта разойдутся на
-- сегодняшних событиях.
--
-- Загрузку курсов не трогаем: сегодняшний курс продолжаем сохранять,
-- кламп происходит только на чтении.

CREATE OR REPLACE FUNCTION fx_rate(p_base TEXT, p_quote TEXT, p_date DATE)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT rate FROM fx_rates
   WHERE base_currency = p_base
     AND quote_currency = p_quote
     AND date <= LEAST(p_date, CURRENT_DATE - 1)
   ORDER BY date DESC LIMIT 1;
$$;

-- Среднемесячный курс тоже не должен видеть незафиксированный
-- сегодняшний курс — иначе среднее за текущий месяц «дрожит» в
-- течение дня.
CREATE OR REPLACE FUNCTION fx_rate_month(p_base TEXT, p_quote TEXT, p_year INT, p_month INT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT AVG(rate) FROM fx_rates
   WHERE base_currency = p_base
     AND quote_currency = p_quote
     AND date <= CURRENT_DATE - 1
     AND EXTRACT(YEAR FROM date) = p_year
     AND EXTRACT(MONTH FROM date) = p_month;
$$;
```

- [ ] **Step 2: Отдать миграцию пользователю**

Миграции применяет пользователь в Supabase SQL Editor — проект локально не слинкован. В ответе указать имя файла и что он делает.

- [ ] **Step 3: Сверка отчёта с паспортом на проде**

Это главная приёмка. Скриптом сравнить хранимые значения с тем, что показывает отчёт в РОДНОЙ валюте сделки:

```bash
node -e '
const fs=require("fs");
const env=fs.readFileSync(".env.local","utf8");
const get=k=>(env.match(new RegExp("^"+k+"=(.*)$","m"))||[])[1].trim();
const url=get("NEXT_PUBLIC_SUPABASE_URL"), key=get("SUPABASE_SERVICE_ROLE_KEY");
const h={apikey:key,Authorization:"Bearer "+key};
(async()=>{
 const deals=await (await fetch(`${url}/rest/v1/deals?select=id,deal_code,supplier_currency,supplier_shipped_amount,buyer_shipped_amount&year=eq.2026&is_archived=eq.false&limit=200`,{headers:h})).json();
 let bad=0;
 for(const d of deals){
   const p=await (await fetch(`${url}/rest/v1/deal_shipment_prices?select=side,amount&deal_id=eq.${d.id}`,{headers:h})).json();
   const s=p.filter(x=>x.side==="supplier").reduce((a,x)=>a+Number(x.amount||0),0);
   if(Math.abs(s-Number(d.supplier_shipped_amount||0))>0.01){bad++;console.log("РАСХОЖДЕНИЕ",d.deal_code,s.toFixed(2),"vs",d.supplier_shipped_amount);}
 }
 console.log(bad?`${bad} расхождений`:"паритет по всем сделкам");
})();
'
```

Ожидается: `паритет по всем сделкам`. Если есть расхождения — это сделки, где `deal_shipment_prices` не покрывает весь приход; разобрать до правки кода.

- [ ] **Step 4: Живая проверка отчёта**

Playwright на `https://asia-petrol-crm.vercel.app/reports/collection`:
1. Выбрать валюту, совпадающую с валютой конкретной сделки (KG-сделки обычно USD) — сверить `Приход сумма`, `Оплата`, `Баланс`, `Долг` с той же сделкой в паспорте. Должно совпасть до копейки.
2. Переключить валюту — суммы меняются, объёмы нет.
3. Сравнить число строк отчёта и паспорта при одинаковых фильтрах.

- [ ] **Step 5: CHANGELOG и коммит**

Добавить запись НАВЕРХ `CHANGELOG-SINCE-EXTRACTION.md` по шаблону файла: тип `[FORMULA]` + `[UI-FIELD]`, с правилом курса и списком источников сумм.

```bash
git add -A && git commit -m "feat(fx): кламп курса до вчерашнего дня в SQL + changelog"
git push origin main
```

---

## Само-ревью плана

**Покрытие спеки:**

| Требование спеки | Задача |
|---|---|
| Два отчёта, переименование | 7 |
| Конвертация на клиенте | 1, 2, 4 |
| Фильтры копией | 5 |
| Вкладки KG/KZ/Все + тумблер валюты | 7 |
| Правило «на сегодня — вчерашний курс» | 1 (TS), 9 (SQL) |
| Исходная валюта каждой суммы | 2 |
| 25 колонок | 6 |
| Баланс и Долг по формуле паспорта | 2 |
| Цена и тариф как производные | 2 |
| Среднемесячный фолбэк | 1, 2 |
| Провал в сделку | 6 |
| Excel = Паспорт Детальный в валюте | 8 |
| Группы: ячейка на экране, колонки в Excel | 2 (`chain`), 8 (колонки экспортёра не трогаем) |
| Самопроверка паритета | 2 (юнит), 9 (прод) |
| Пагинация везде | 3 |

Пробелов нет.

**Отличие от спеки:** спека предполагала вынести фетчеры паспорта в общий модуль. В плане общим сделан только механизм «чанк + пагинация» (`fetchByDealIds`), а списки полей у отчёта и экспортёра свои — их формы не совпадают, а склеивать их значило бы переписывать работающий экспортёр ради формы. Дублирования опасной части (пагинация) при этом нет.

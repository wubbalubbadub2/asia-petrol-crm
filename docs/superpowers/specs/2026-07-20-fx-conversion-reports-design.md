# FX-конвертация + вкладка «Отчёты»

**Дата:** 2026-07-20
**Статус:** дизайн утверждён, готов к плану имплементации
**Источник требований:** `files/Обработка сбор по валюте.docx` (ТЗ клиента) + `FX-INVENTORY.md` (инвентаризация money-колонок).

## Цель

Дать возможность видеть суммы и цены отчётов в **двух валютах — USD и KZT** — конвертируя каждую сумму по официальному курсу нацбанка на **дату соответствующего события** (отгрузки / оплаты). Суммы в БД остаются в native-валюте; конвертация — on-demand (Архитектура A, ранее согласована).

Deliverable — новая вкладка **«Отчёты»** (`/reports`) с 5 отчётами, каждый в USD и KZT:
1. Приход (входящее СНТ)
2. Исход (исходящее СНТ)
3. Оплаты поставщикам
4. Оплаты покупателям
5. Цена (по каждому СНТ)

## Правила конвертации (из ТЗ клиента)

- Курс USD/KZT — с сайта **НБ РК** (`nationalbank.kz`).
- Курс USD/KGS — с сайта **НБ КР** (`nbkr.kg`).
- **Пивот через USD**: сумма в KGS → USD (÷ курс НБ КР) → при отчёте в тенге → KZT (× курс НБ РК). Сумма в KZT → USD (÷ курс НБ РК). Всё остальное — только НБ РК.
- Курс берётся **на дату события**; на выходные/праздники — последний доступный курс `date <= событие`.
- Эффективная дата курса — «на предыдущий день» (T-1 по закрытию банковских операций). Храним курс под датой, на которую он действует.
- **Если у события нет даты** — берётся **среднемесячный курс** (`=СРЗНАЧ` по всем дням месяца) соответствующего месяца.
- **Цена — производное**: не переводим цену напрямую, а конвертируем сумму и делим на объём.
  Пример: USD-цена 340$; в тенге = `(219 745,4 × 472,03) ÷ 646,310 = 160 490 ₸`.

## Native-валюта событий

Три валюты в системе: `USD`, `KZT`, `KGS` (`src/lib/constants/currencies.ts`). Дефолты по типу сделки: KG→USD, KZ→KZT, OIL→USD (`deal-types.ts`). Native-валюту определяет валюта, которую вносят менеджер/логист на сделке (`supplier_currency`, `buyer_currency`, `logistics_currency`; строка реестра — `shipment_registry.currency ?? deals.logistics_currency`; платёж — `deal_payments.currency ?? сторона сделки`).

---

## Компонент 1 — таблица курсов `fx_rates`

```sql
CREATE TABLE fx_rates (
  date           DATE   NOT NULL,   -- эффективная дата курса
  base_currency  TEXT   NOT NULL,   -- 'USD'
  quote_currency TEXT   NOT NULL,   -- 'KZT' | 'KGS'
  rate           NUMERIC(18,6) NOT NULL,  -- 1 base = rate quote
  source         TEXT   NOT NULL,   -- 'nbrk' | 'nbkr' | 'manual'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (date, base_currency, quote_currency)
);
```

Строки: `(date, 'USD', 'KZT', …, 'nbrk')` и `(date, 'USD', 'KGS', …, 'nbkr')`.
RLS: read — все аутентифицированные; write — только service-role (загрузчик) и админ (ручная правка).

## Компонент 2 — загрузка курсов (портируемое ядро)

Ограничение проекта: скоро уход с Vercel/Supabase → платформо-зависимое держим тонкой обёрткой.

- **Ядро** `src/lib/fx/ingest.ts` — чистый модуль без привязки к платформе:
  - `fetchNbrkRate(date): {kzt}` — НБ РК `GET https://nationalbank.kz/rss/get_rates.cfm?fdate=DD.MM.YYYY`; XML: `<item><title>USD</title><description>468.88</description></item>`. `rate` = KZT за 1 USD.
  - `fetchNbkrRate(): {kgs}` — НБ КР `GET https://www.nbkr.kg/XML/daily.xml`; XML: `<Currency ISOCode="USD"><Nominal>1</Nominal><Value>87,4500</Value></Currency>` (запятая как десятичный разделитель → нормализовать). `rate` = KGS за 1 USD. Даёт только текущий день.
  - `ingestDailyRates(dates?)` — тянет оба банка, нормализует, `upsert` в `fx_rates` (service-role).
- **Обёртка (сейчас)** — `src/app/api/cron/fx-rates/route.ts`, защищён `CRON_SECRET`, дёргает `ingestDailyRates()`; `vercel.json` cron раз в день. При переезде меняется только обёртка/расписание.
- **Backfill истории** — одноразовый скрипт `scripts/fx-backfill.mjs`:
  - USD/KZT: НБ РК по `fdate` для каждого рабочего дня от самой ранней даты события в БД (min по `shipment_registry.date/loading_date`, `deal_payments.payment_date`) до сегодня.
  - USD/KGS: у НБ КР нет чистого date-параметра (история только через архив/Excel). Backfill точечно — только для дат, где реально есть KGS-суммы. Отсутствующие даты решаются fallback `date <= X` и ручным вводом (`source='manual'`).

## Компонент 3 — функции конвертации (обычный Postgres, переезжают с БД)

```
fx_rate(base, quote, on_date)          -> последний rate где date <= on_date (STABLE)
fx_rate_month(base, quote, year, mon)  -> AVG(rate) за месяц (среднемесячный, STABLE)
fx_convert(amount, from, to, on_date)      -> пивот через USD, точечный курс
fx_convert_month(amount, from, to, y, mon) -> пивот через USD, среднемесячный курс
```

Алгоритм `fx_convert`:
1. `from == to` → вернуть `amount`; `amount IS NULL` → `NULL`.
2. Нормализовать в USD: `USD`→как есть; `KZT`→`amount / fx_rate('USD','KZT',d)`; `KGS`→`amount / fx_rate('USD','KGS',d)`.
3. Из USD в target: `USD`→как есть; `KZT`→`× fx_rate('USD','KZT',d)`; `KGS`→`× fx_rate('USD','KGS',d)`.
4. Курс не найден → `NULL` (отчёт покажет прочерк, не ноль).

`fx_convert_month` — то же, но `fx_rate_month`. Используется, когда у события нет даты.

## Компонент 4 — RPC под отчёты

### `fx_report_flows(p_from DATE, p_to DATE)` — 4 потоковых отчёта
Возвращает `(metric TEXT, deal_type TEXT, year INT, month INT, usd NUMERIC, kzt NUMERIC)`.
Каждая сумма конвертится по своей дате события (нет даты → среднемесячный по месяцу), затем группируется по `(metric, deal_type, year, month)`.

| metric | Σ суммы | Native | Дата курса | Fallback-месяц |
|---|---|---|---|---|
| `supply_in` (Приход) | `supplier_price × loading_volume` по строкам реестра | `deals.supplier_currency` | `shipment_registry.loading_date` | месяц отгрузки (`shipment_month` ?? `deals.month/year`) |
| `ship_out` (Исход) | `buyer_price × shipment_volume` | `deals.buyer_currency` | `shipment_registry.date` | месяц отгрузки |
| `pay_supplier` (Оплаты поставщикам) | `deal_payments.amount` (side=supplier, знак по `payment_type`) | `deal_payments.currency ?? supplier_currency` | `payment_date` | месяц сделки (`deals.month/year`) |
| `pay_buyer` (Оплаты покупателям) | `deal_payments.amount` (side=buyer, знак) | `deal_payments.currency ?? buyer_currency` | `payment_date` | месяц сделки |

- `supplier_price`/`buyer_price` — уровня сделки (headline-цена), не по группам/линиям.
- Знак: `payment_type IN ('refund','offset')` → сумма минусом (как rollup 00062).
- Период `p_from..p_to` фильтрует по дате события метрики.

### `fx_report_price(p_from DATE, p_to DATE)` — отчёт «Цена» построчно (уровень СНТ)
Одна строка на строку `shipment_registry`. Возвращает:
`(deal_code, deal_type, snt_date, loading_date, supplier_price_usd, supplier_price_kzt, buyer_price_usd, buyer_price_kzt, …)`.
- Приход-цена = `fx_convert(supplier_price × loading_volume, supplier_currency, R, loading_date) / loading_volume` для каждой отчётной валюты R ∈ {USD, KZT}.
- Исход-цена = `fx_convert(buyer_price × shipment_volume, buyer_currency, R, date) / shipment_volume`.
- Нет даты СНТ → среднемесячный курс месяца отгрузки. Нулевой объём → цена `NULL`.
- Фильтр периода — по дате СНТ (`date` ?? `loading_date`).

Производительность: `fx_rate` реализуется через join/lateral к `fx_rates` (не вызов функции на строку). Объём данных — сотни/тысячи строк, индексов `fx_rates(pk)` достаточно.

## Компонент 5 — UI, вкладка «Отчёты» (`/reports`)

- Новый пункт сайдбара после «Реестр отгрузки» (`src/lib/constants/nav-items.ts`), иконка `BarChart3`.
- Роут `src/app/(dashboard)/reports/page.tsx`.
- Внутри: переключатель между 5 отчётами + фильтр периода (`p_from`/`p_to`).
- Потоковые отчёты (Приход/Исход/Оплаты×2): таблица — строки по месяцам, под-разбивка по типу сделки (KG/KZ/OIL), строка «Итого». Колонки суммы **в USD и KZT рядом**.
- Отчёт «Цена»: таблица построчно по СНТ — `deal_code`, дата СНТ, цена прихода (USD, KZT), цена исхода (USD, KZT).
- Данные — из RPC (`fx_report_flows` / `fx_report_price`), клиент только рендерит. Стиль — по `DESIGN.md`.
- Экспорт в Excel — не в первой версии (быстрый follow-up при необходимости).

## Обязательные проектные правила

- После каждого изменения в репо — запись в `CHANGELOG-SINCE-EXTRACTION.md` (FORMULA-изменения с Before → After).
- Миграции применяет пользователь в Supabase SQL Editor (локально проект не залинкован).
- Тестируем на production Vercel (push в main).

## Открытые вопросы / зависящее от данных

- Глубина backfill USD/KZT = от самой ранней даты события в БД (вычисляется в момент backfill).
- KGS-история — покрываем только по факту наличия KGS-сумм; иначе fallback + ручной ввод.
- Ключ `CRON_SECRET` и `SUPABASE_SERVICE_ROLE_KEY` в env Vercel — нужны для роута загрузки (настройка пользователем).

## Проверка (после имплементации)

1. `npx tsc --noEmit`, production build.
2. Применить миграции, прогнать backfill, проверить наличие `fx_rates` за диапазон.
3. Юнит-проверка `fx_convert`: `fx_convert(1100000,'USD','KZT','2026-06-24')` ≈ `1100000 × 486.19` (± по факт. курсу НБ РК на дату).
4. E2E на проде: `/reports` → каждый из 5 отчётов рендерится, суммы в USD и KZT согласованы (KZT ≈ USD × курс периода), «Цена» — построчно по СНТ.

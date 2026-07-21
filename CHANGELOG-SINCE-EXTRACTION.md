# CHANGELOG-SINCE-EXTRACTION.md

Running log of every change made to this repo after the DELTA snapshot.

**Baseline:** `DELTA-SINCE-EXTRACTION.md` covers everything from the AS-BUILT
extraction (2026-06-22, migrations ≤ 00093) through 2026-07-11 (`main` at
`c8774f3`, migrations ≤ 00115). Entries below start AFTER that point.

**Rule:** after EVERY change — before finishing the task — append one entry.
No commit without its changelog entry. FORMULA changes must always include
Before → After.

Entry template:

```
### YYYY-MM-DD — <short title>
- **What changed:** file(s), migration number(s), column(s), function(s)
- **Type:** [FORMULA] | [SCHEMA] | [EXPORT] | [UI-FIELD] | [BEHAVIOR] | [PRESENTATION]
- **Before → After:** for FORMULA/SCHEMA show the old and new logic exactly
- **Client reason:** one sentence, if known
- **Rebuild impact:** DATA-MODEL / PRICING / ACCEPTANCE-SCENARIOS /
  FIELD-OWNERSHIP — name the doc(s), or "presentation only"
```

---

<!-- Entries below, newest first -->

### 2026-07-21 — 00125: поля отсрочки платежа на deals для отчёта «Паспорт (долги)»
- **What changed:** migration `00125_payment_deferral.sql` (8 колонок на `deals`: `supplier_deferral_days INT`, `supplier_deferral_mode TEXT`, `supplier_deferral_note TEXT`, `supplier_planned_pay_date DATE`, и аналогичные `buyer_*` + 2 CHECK constraints для `supplier_deferral_mode` и `buyer_deferral_mode` со значениями 'shipment'/'other')
- **Type:** [SCHEMA]
- **Before → After:** нет данных об отсрочке платежей на сделках → каждая сделка содержит условия оплаты по стороне (поставщик/покупатель): дни отсрочки, режим расчёта (с даты отгрузки или прочее), плановая дата оплаты и заметка
- **Client reason:** основы для отчёта «Паспорт (долги)» (Task 1 из features паспорта должников)
- **Rebuild impact:** DATA-MODEL (новые колонки на `deals` для хранения условий платежа; базис для debt-отчётов)

### 2026-07-20 — Fix: ещё два batched-запроса в detail-экспорте без пагинации (1000-row cap, follow-up)
- **What changed:** `src/lib/hooks/use-deals.ts` — `fetchDealLinesForExport` (~строки 239-291): единый unchunked `.in("deal_id", dealIds)` по `deal_supplier_lines`/`deal_buyer_lines` заменён на чанки по 150 id + постраничный `fetchAllPaginated` на каждый чанк, tie-breaker `.order("deal_id").order("id")`; возвращаемая форма (`{ supplier: Map, buyer: Map }`) не изменилась — оба вызывающих места (`passport-excel.ts`, `passport-detail-excel.ts`) не тронуты. `src/lib/exports/passport-detail-excel.ts` — фетч `deal_company_groups` (~строки 382-409): уже был чанкирован по 150, но не пагинирован через `.range()`; переведён на `fetchAllPaginated` с тем же tie-breaker (`deal_id`+`id`), как остальные фетчеры файла.
- **Type:** [EXPORT] + [BEHAVIOR]
- **Before → After:** (1) `fetchDealLinesForExport` бил один `.in(...)` без `.range()` по ВСЕМУ списку сделок годового экспорта (не чанкировано вообще) → при большом количестве строк по сделкам (несколько supplier/buyer lines на сделку × сотни сделок) PostgREST мог молча обрезать ответ на 1000 строк, теряя «Биржа»/quotation/price данные для сделок, отсортированных после отсечки → теперь чанки по 150 id, каждый чанк пагинируется до короткой страницы. (2) `deal_company_groups`-фетч был чанкирован (≤~450 строк/чанк — сейчас безопасно), но не пагинирован — тот же паттерн-риск как обе функции, исправленные в предыдущем коммите → добавлен `.range()`-пейджинг для консистентности и запаса на рост числа company-groups на сделку.
- **Client reason:** ревью нашло два дополнительных места того же класса бага после исправления `fetchPaymentsByDeals`/`fetchShipmentsByDeals` в предыдущем коммите (abb49dc).
- **Rebuild impact:** EXPORT-LAYOUTS / DATA-MODEL — закрывает то же правило: любой batched `.in(...)`-запрос к таблице с потенциально большим числом строк на группу id обязан пагинироваться через `fetchAllPaginated`, а не полагаться на единичный `.select()`/чанкирование без `.range()`.

### 2026-07-20 — Fix: detail-выгрузка теряла под-строки на полном экспорте (1000-row cap)
- **What changed:** `src/lib/exports/passport-detail-excel.ts` — `fetchPaymentsByDeals` и `fetchShipmentsByDeals`: батч-запросы `.in("deal_id", chunk)` (150 id/чанк) переведены на постраничный `fetchAllPaginated` (`src/lib/supabase/fetch-all.ts`, уже используется в tariffs/archive/dt-kt/use-applications) с детерминированным tie-breaker в `.order()` (payment_date+id / date+deal_id+id).
- **Type:** [EXPORT] + [BEHAVIOR]
- **Before → After:** каждый чанк из 150 сделок запрашивался одним `.in(...).order(...)` без `.range()` → PostgREST молча обрезал ответ на дефолтном лимите 1000 строк (Max-Rows); сделки, чьи строки реестра/оплат сортировались после отсечки, теряли ВСЕ под-строки на главной строке, оставаясь «1 строка без деталей». Подтверждено на реальных данных: чанк из 150 id (куда попадает KG/26/346) даёт 1613 строк `shipment_registry` — дефолтный (без range) запрос возвращает ровно 1000 и 0 из них принадлежат KG/26/346; постраничный запрос (0-999 + 1000-1999) даёт все 1613 без дублей/пропусков, и 6 строк KG/26/346 появляются. → теперь оба батч-фетчера пейджинятся до короткой страницы, поэтому строк-в-чанке-более-1000 больше не обрезает данные независимо от того, сколько сделок в экспорте.
- **Client reason:** баг-репорт со скриншотом: «Паспорт (детальный)» с фильтром на KG/26/346 → 7 строк (верно); без фильтра (полный список) → та же сделка 1 строка без под-строк.
- **Rebuild impact:** EXPORT-LAYOUTS / DATA-MODEL — общее правило проекта: любой batched `.in(...)`-запрос к таблице, где строк на группу id может быть много (`shipment_registry`, `deal_payments`, и по аналогии любые будущие детальные выгрузки), обязан пагинироваться через `fetchAllPaginated`, а не полагаться на единичный `.select()`.
### 2026-07-20 — FX финальный ревью ветки: fail-closed cron, согласованные USD/KZT суммы, индекс fx_rates
- **What changed:** `src/app/api/cron/fx-rates/route.ts` (auth-check), `supabase/migrations/00124_fx_reports.sql` (`fx_report_flows`, `fx_report_price` — не применены, правка миграций до deploy безопасна), `supabase/migrations/00122_fx_rates.sql` (индекс, не применена).
- **Type:** [FORMULA] (fx_report_flows) + [BEHAVIOR] (cron auth) + [SCHEMA] (индекс)
- **Before → After:**
  - Cron-роут: `if (secret && auth !== ...) 401` (fail-OPEN — при незаданном `CRON_SECRET` эндпойнт публично триггерился без авторизации) → `if (!secret || auth !== ...) 401` (fail-CLOSED — отсутствие секрета теперь тоже 401, а не «пропустить проверку»).
  - `fx_report_flows`: финальный `SELECT` считал `SUM(... 'USD' ...)` и `SUM(... 'KZT' ...)` как две независимые агрегации по `events` — `SUM` отбрасывает NULL по-колоночно, поэтому строка с NULL в USD-конвертации (нет курса), но не-NULL в KZT (identity для KZT-native), попадала в KZT-сумму, но не в USD-сумму → USD и KZT описывали разные популяции строк. Добавлена промежуточная CTE `converted` (те же ветки dated/fallback-month, тот же period filter без изменений), считающая `u`/`k` один раз на строку; финальный `SUM(CASE WHEN u IS NOT NULL AND k IS NOT NULL THEN u/k END)` теперь включает строку в ОБЕ суммы только когда обе конвертации не-NULL — USD и KZT снова про одну и ту же популяцию строк. `events`-CTE (UNION ALL 4 метрик) не менялся.
  - `fx_rates`: добавлен `CREATE INDEX IF NOT EXISTS fx_rates_pair_date_idx ON fx_rates (base_currency, quote_currency, date DESC)` — PK ведёт с `date`, per-row lookup в `fx_rate()` ищет по (пара, date DESC), для чего PK не покрывающий.
  - `fx_report_price`: без функциональных изменений — добавлен только комментарий, поясняющий расхождение с `fx_report_flows` (построчный отчёт исключает строки без обеих дат СНТ, а не кладёт их в fallback-месяц).
- **Client reason:** финальный ревью всей FX-ветки (`feat/fx-reports`) перед деплоем — 2 Important + 1 рекомендация + 1 уточняющий комментарий.
- **Rebuild impact:** PRICING (формула агрегации `fx_report_flows` — правило для rebuild: USD/KZT суммы по одному отчёту-агрегату должны считаться по одной и той же отфильтрованной популяции строк, не двумя независимыми `SUM(CASE...)`); DATA-MODEL (индекс на `fx_rates` — lookup-паттерн `fx_rate()` требует (pair, date DESC), не покрыт PK).

### 2026-07-20 — Task 12: вкладка «Отчёты» приведена к DESIGN.md + строгий тип report
- **What changed:** `src/app/(dashboard)/reports/page.tsx` — сырые `<select>`/`<input type="date">` заменены на проектные примитивы (`Select`/`SelectTrigger`/`SelectItem`, `Input`, `Label` из `@/components/ui`); убран лишний `p-4` (страница уже получает отступ от `main` в `(dashboard)/layout.tsx`); `report` типизирован как `ReportKey = (typeof REPORTS)[number]["key"]` вместо bare `string` (опечатка в ключе теперь ошибка компиляции); метрик-фильтр `flows.filter(r => r.metric === report)` не тронут. `src/components/reports/flow-report.tsx` и `src/components/reports/price-report.tsx` — стиль таблиц приведён к паттерну `registry/page.tsx`/`passport-table.tsx`: заголовок `bg-stone-100 text-stone-500`, границы `border-stone-200`/`border-stone-100`, компактные ячейки `px-2 py-1(.5)`, числа `font-mono tabular-nums text-right`, hover-only подсветка строк (без зебры, по DESIGN.md «alternating row shading on hover only»); добавлена подпись-заголовок над каждой таблицей (`<h2>` с названием отчёта + «· USD / KZT»), включая пустое состояние — устраняет замечание ревью «tables lacked a caption».
- **Type:** [PRESENTATION]
- **Client reason:** Task 12 (причёсывание по DESIGN.md) — код-часть; деплой/E2E/финальная запись фичи выполняются контроллером отдельно после применения миграций 00122–00124.
- **Rebuild impact:** presentation only — DESIGN.md токены (цвета stone/amber, JetBrains Mono для чисел, 28px-плотность) применены к существующим RPC/данным Task 7/8, формулы и схема не менялись.

### 2026-07-20 — Вкладка «Отчёты» (/reports) — оболочка + переключатель отчёта и период
- **What changed:** `src/lib/constants/nav-items.ts` — импорт `BarChart3` из `lucide-react`, пункт меню «Отчёты» (`/reports`) добавлен после «Реестр отгрузки». NEW `src/app/(dashboard)/reports/page.tsx` — клиентская страница-оболочка: селектор отчёта (`FLOW_METRICS` + «Цена (по СНТ)»), поля периода `from`/`to`, загрузка через `fetchFlows`/`fetchPrice` (Task 8), рендер `FlowReport`/`PriceReport` (Task 10/11); строки потоков предварительно фильтруются по выбранной метрике (`flows.filter(r => r.metric === report)`) перед передачей в `FlowReport`, т.к. сам компонент не фильтрует.
- **Type:** [UI]
- **Client reason:** Task 9 — интеграция вкладки «Отчёты» в навигацию и роутинг.
- **Rebuild impact:** presentation only — новых DB-объектов и формул нет, только UI-обвязка вокруг существующих RPC/компонентов.

### 2026-07-20 — Компонент отчёта Цена PriceReport
- **What changed:** NEW `src/components/reports/price-report.tsx` — компонент таблицы цен (Price Report), отображает цены поставщика и покупателя (приход/исход) в USD и KZT с форматированием чисел
- **Type:** [PRESENTATION]
- **Client reason:** Task 11 — компонент таблицы цен для вкладки «Отчёты»
- **Rebuild impact:** presentation only

### 2026-07-20 — Компонент потокового отчёта FlowReport
- **What changed:** NEW `src/components/reports/flow-report.tsx` — компонент таблицы потоков (Flow Report), отображает ежемесячные суммы по типам сделок в USD и KZT
- **Type:** [PRESENTATION]
- **Client reason:** Task 10 — компонент потокового отчёта для вкладки «Отчёты»
- **Rebuild impact:** presentation only

### 2026-07-20 — Фикс CI: детерминированный placeholder-env вместо loadEnv в vitest.config.ts
- **What changed:** `vitest.config.ts` — убран импорт `loadEnv` из `vite` и вызов `Object.assign(process.env, loadEnv(...))`, конфиг возвращён к обычному объекту (без `({ mode }) => …`); `setupFiles: []` → `setupFiles: ["./vitest.setup.ts"]`. NEW `vitest.setup.ts` (repo root) — с двумя строками `process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321"` / `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key"`.
- **Type:** [BEHAVIOR]
- **Before → After:**
  - Env для `src/lib/supabase/client.ts` (бросает при импорте, если `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` не заданы): `loadEnv(mode, cwd, "")` читал `.env.local` целиком (пустой prefix → включая `SUPABASE_SERVICE_ROLE_KEY`, RLS-bypass секрет) → детерминированные placeholder-значения через `??=` в `vitest.setup.ts`, не зависящие от `.env.local` вообще; реальный локальный `.env.local`, если экспортирован в shell, по-прежнему имеет приоритет благодаря `??=`.
- **Client reason:** Ревью Task 8 нашло: у CI unit-test джобы нет `.env.local` (в `.gitignore`, никогда не создаётся в CI) → `loadEnv` ничего не находит → `process.env` пуст → падает весь `npm test` на каждый push/PR; локально проходило только благодаря реальному dev-файлу `.env.local`. Плюс `loadEnv(mode, cwd, "")` без префикса лишний раз тянул service-role секрет в Node test-процесс.
- **Rebuild impact:** presentation/infra only — тестовая инфраструктура, схема и формулы БД не менялись. Проверено: `env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY npx vitest run src/__tests__/fx-report-shape.test.ts` (симуляция CI) — PASS; `npx vitest run` — только исходный неродственный `bulk-wagons.test.ts` failure остаётся; `npx tsc --noEmit` — чисто.

### 2026-07-20 — Слой данных отчётов FX: use-fx-reports.ts + groupFlows
- **What changed:** NEW `src/lib/hooks/use-fx-reports.ts` — `fetchFlows()`/`fetchPrice()` (клиентские обёртки над RPC `fx_report_flows`/`fx_report_price` из миграции 00124), типы `FlowRow`/`PriceRow`, константа `FLOW_METRICS` (порядок/лейблы метрик для вкладки «Отчёты»), чистая функция `groupFlows()`. NEW `src/__tests__/fx-report-shape.test.ts` (TDD: RED → GREEN на `groupFlows`). Также `vitest.config.ts` — добавлен `loadEnv()` (из `vite`) в `defineConfig`, мержится в `process.env`.
- **Type:** [BEHAVIOR]
- **Before → After:**
  - Клиентского доступа к RPC 00124 не было → `fetchFlows(from, to)`/`fetchPrice(from, to)` вызывают RPC через узкий структурный каст `(createClient() as unknown as { rpc: Rpc }).rpc` (`database.ts` ещё не знает новых RPC — тот же stale-types приём, что в `use-user-pref.ts`; без `any` и без lint-disable).
  - `groupFlows(rows: FlowRow[])` — чистая агрегация: группирует строки `fx_report_flows` по `metric` (`byMetric`) и суммирует `usd`/`kzt` по метрике (`totals`), с `?? 0` на случай null-сумм.
  - Побочный фикс инфраструктуры: `vitest.config.ts` не подтягивал `.env.local` в `process.env` (Vitest, в отличие от Next.js, не делает этого сам) — импорт `use-fx-reports.ts` тянет `@/lib/supabase/client`, который бросает `Error("Missing Supabase env vars…")` при импорте модуля, если переменные не заданы. Это первый тест, который импортирует что-либо из `src/lib/hooks`, поэтому проблема не проявлялась раньше. Исправлено через `loadEnv(mode, process.cwd(), "")` (пакет `vite`) в `defineConfig(({ mode }) => …)`.
- **Client reason:** Task 8 контракта FX-отчётов (слой данных для будущего UI вкладки «Отчёты»).
- **Rebuild impact:** presentation/data-layer only — новых DB-объектов нет (использует RPC 00124), формулы БД не менялись. `vitest.config.ts` фикс — инфраструктурный, влияет на все будущие тесты, импортирующие hooks с `createClient()`.

### 2026-07-20 — [MIGRATION 00124] fx_report_flows / fx_report_price — RPC отчётов
- **What changed:** migration `00124_fx_reports.sql` — 2 SQL-функции (RPC): `fx_report_flows(p_from date, p_to date)` и `fx_report_price(p_from date, p_to date)`.
- **Type:** [FORMULA]
- **Before → After:**
  - Отчёты по потокам денег и ценам: две RPC-функции для вкладки «Отчёты» реализуют расчёты с конвертацией по дате события. `fx_report_flows()` строит таблицу 4 метрик (supply_in, ship_out, pay_supplier, pay_buyer) с group by (metric, deal_type, year, month), конвертирует каждую сумму по дате события (loading_date/date/payment_date); при отсутствии даты использует среднемесячный курс месяца из d.month. Результат: (metric, deal_type, year, month, usd, kzt) с SUM по конвертированным суммам. Бездатные события включаются в результат только если их fallback-месяц попадает в запрошенный период (WHERE: `ev_date IS NOT NULL AND … BETWEEN` OR `ev_date IS NULL AND fb_year|fb_month NOT NULL AND make_date(fb_year, fb_month, 1) BETWEEN start-of-month(p_from) AND p_to`). `fx_report_price()` выводит per-row цены поставщика и покупателя (converted в USD/KZT), с делением на объём (loading_volume/shipment_volume) для получения per-unit цены, также с fallback на fx_convert_month() если нет даты события.
  - Обе функции в режиме STABLE; вызывают fx_convert() и fx_convert_month() из миграции 00123, через которые зависят от fx_rate/fx_rate_month и таблицы fx_rates.
- **Client reason:** вкладка «Отчёты» на UI требует RPC для вытягивания данных с конвертацией в базовые валюты (USD/KZT).
- **Rebuild impact:** DATA-MODEL/PRICING (новые RPC для отчётной части; завершает реализацию модуля FX-конвертации для FX-отчётов).

### 2026-07-20 — [MIGRATION 00123] fx_convert / fx_rate / month_num — функции конвертации
- **What changed:** migration `00123_fx_functions.sql` — 5 SQL-функций: `month_num(text)`, `fx_rate(base, quote, date)`, `fx_rate_month(base, quote, year, month)`, `fx_convert(amount, from, to, date)`, `fx_convert_month(amount, from, to, year, month)`.
- **Type:** [FORMULA]
- **Before → After:**
  - Конвертация валют: нет системного способа конвертировать суммы между USD/KZT/KGS → функции реализуют пивот через USD (промежуточный): `KZT→USD ÷ fx_rate(USD, KZT)`, затем `USD→target × fx_rate(USD, target)`. Обратное (target→USD) меняет ÷/× местами. Логика `fx_rate()` берёт курс на дату (дата ≤ p_date); логика `fx_rate_month()` — среднее значение за месяц. При отсутствии курса возвращается NULL (защита от ошибочных расчётов). Если `p_from = p_to`, сумма не меняется. Если `p_amount IS NULL`, результат NULL.
  - `month_num(text)` — служебная функция: преобразует русский месяц ('январь'…'декабрь') в число (1…12), используется в UI фильтров месяцев, не входит в основной расчёт.
  - Четыре функции (`fx_rate`, `fx_rate_month`, `fx_convert`, `fx_convert_month`) в режиме STABLE; `month_num` — IMMUTABLE. Верификация — ручной SQL-probe после применения миграции (`fx_convert(1100000, 'USD', 'KZT', DATE '2026-06-24')` должен вернуть корректный результат).
- **Client reason:** функции конвертации для отчётов с валютами (Task 6 из плана FX-отчётов), базис для калькуляции итогов по USD.
- **Rebuild impact:** DATA-MODEL/PRICING (новые функции для расчёта итогов в отчётах; формула пивота USD используется везде, где требуется конвертация между KZT/KGS).

### 2026-07-20 — fix(fx-backfill): вежливая задержка на каждой итерации + surfacing ошибок earliest()
- **What changed:** `scripts/fx-backfill.mjs` (lines 24–51) — изменена структура дня-цикла и функция `earliest()`.
- **Type:** [SCRIPT]
- **Before → After:**
  - День-цикл: вежливая задержка 120мс была в конце итерации; `continue` при выходных/no-rate перепрыгивал её → дозвоны к НБ РК в выходные подряд без паузы. Теперь: обёртка `try { ...per-iteration... } finally { await delay(120) }` гарантирует delay на КАЖДОЙ итерации (continue не пропускает finally); внутренний try/catch для fetch+upsert сохранён.
  - `earliest()`: запросы q1/q2 не проверяли `.error` — ошибка БД молча падала на fallback 2026-01-01. Добавлена обработка: если `q1.error || q2.error`, то `console.warn()` с сообщением, затем graceful fallback (не throw).
- **Client reason:** review finding при подготовке Phase 5 (FX-отчёты).
- **Rebuild impact:** presentation only — скрипт utility, не меняет схему; graceful error-surfacing.

### 2026-07-20 — [SCRIPT] fx-backfill.mjs — backfill истории USD/KZT
- **What changed:** NEW `scripts/fx-backfill.mjs` — самостоятельный Node-скрипт (без импорта Next-алиасов `@/`), использует `@supabase/supabase-js` напрямую с service-role ключом (`SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` из env). Флаг `--dry` для прогона без записи.
- **Type:** [SCRIPT]
- **Before → After:** курсов до самой ранней даты события в `fx_rates` не было (таблица 00122 и cron 00121/Task 4 наполняют её только начиная с момента внедрения) → скрипт вычисляет самую раннюю дату (`min(shipment_registry.date, deal_payments.payment_date)`, фоллбек `2026-01-01`), проходит по будним дням от неё до сегодня, тянет курс USD с НБ РК (`get_rates.cfm?fdate=dd.mm.yyyy`) и делает upsert в `fx_rates` (`onConflict: date,base_currency,quote_currency`, `source: 'nbrk'`) с паузой 120мс между запросами; выходные пропускаются (покрываются fallback `date <= X` в `fx_rate` из Task 3). KGS-историю не тянет (у НБ КР нет чистого date-параметра) — при необходимости бэкфиллится вручную (`source='manual'`).
- **Client reason:** заполнение исторических курсов USD/KZT для конвертации отчётов по уже существующим сделкам/платежам (Task 5 из плана FX-отчётов).
- **Rebuild impact:** presentation/data-fill only — одноразовый скрипт, схему `fx_rates` (00122) не меняет; запуск — human checkpoint (нужны реальные `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` и сеть).

### 2026-07-20 — [API] /api/cron/fx-rates — ежедневная загрузка курсов (Vercel Cron)
- **What changed:** NEW `src/app/api/cron/fx-rates/route.ts` (`GET`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`); `vercel.json` (+`crons` — daily `0 6 * * *`, оставлен `regions: ["fra1"]`); `.env.example` (+`CRON_SECRET=` после `SUPABASE_SERVICE_ROLE_KEY`).
- **Type:** [BEHAVIOR]
- **Before → After:** `ingestDailyRates` (Task 3) существовал изолированно, без вызывающего слоя → тонкий cron-роут дёргает его раз в день (06:00 UTC — после закрытия банковских операций накануне; на Hobby-тарифе Vercel это единственная доступная частота). Auth — сравнение `Authorization: Bearer <CRON_SECRET>` с `process.env.CRON_SECRET`; при переезде с Vercel меняется только этот файл + расписание, ядро (`ingest.ts`) не трогается.
- **Client reason:** автоматическая ежедневная загрузка курсов НБ РК/НБ КР для FX-конвертации отчётов (Task 4 из плана).
- **Rebuild impact:** presentation only (внутренний cron-эндпоинт, не виден клиенту напрямую); FIELD-OWNERSHIP/DATA-MODEL не затронуты — новый env-ключ `CRON_SECRET` требует ручной настройки в Vercel (человеческий чекпоинт, см. task-4-brief.md Step 6).

### 2026-07-20 — Ядро загрузки курсов НБ РК/НБ КР (`ingest.ts`, TDD)
- **What changed:** NEW `src/lib/fx/ingest.ts` (`nbrkUrl`, `NBKR_URL`, `fetchNbrkRate`, `fetchNbkrRate`, `ingestDailyRates`); NEW `src/__tests__/fx-ingest.test.ts` (4 теста, TDD RED→GREEN, покрывают только чистые части — URL-билдеры и fetch-функции с фейковым `fetch`).
- **Type:** [BEHAVIOR]
- **Before → After:** парсеры фидов (Task 2) существовали изолированно, без слоя загрузки → `ingest.ts` строит URL обоих банков, тянет и парсит их (`fetchNbrkRate`/`fetchNbkrRate` принимают опциональный `fetchFn` для тестируемости), и `ingestDailyRates` через `createAdminClient()` делает upsert обеих строк (`USD/KZT` из НБ РК, `USD/KGS` из НБ КР) в `fx_rates` по конфликту `(date, base_currency, quote_currency)`. Upsert использует узкий структурный `as unknown as {...}` каст (тот же приём, что в `use-user-pref.ts`) — `database.ts` ещё не знает `fx_rates` до перегенерации типов (Task 8). `ingestDailyRates` не покрыт unit-тестом (сеть + БД) — верифицируется интеграционно через cron-роут (Task 4).
- **Client reason:** ядро rate-loading для FX-конвертации отчётов (Task 3 из плана).
- **Rebuild impact:** presentation only (внутренний загрузочный сервис, не виден клиенту напрямую).

### 2026-07-20 — Закалена NBKR-парсер + добавлены тесты для отсутствия USD и лишних тегов
- **What changed:** `src/lib/fx/parse.ts` (`parseNbkrUsdKgs`), `src/__tests__/fx-parse.test.ts` (+2 теста).
- **Type:** [BEHAVIOR]
- **Before → After:** regex для НБ КР требовал только пробелы между `<Currency ISOCode="USD">` и `<Nominal>` — лишний тег (напр. `<NumCode>840</NumCode>`) ломал матч → на `[\s\S]*?` (любые символы, ленивое); добавлены тесты: выброс при отсутствии USD и парсинг при наличии лишних тегов. Номинал, коммы, правило деления не менялись.
- **Client reason:** review finding Task 2 (FX-отчёты).
- **Rebuild impact:** presentation only (парсер используется rate-loader'ом).

### 2026-07-20 — Парсеры XML-фидов НБ РК/НБ КР + formatKzDate (TDD)
- **What changed:** NEW `src/lib/fx/parse.ts` (3 экспорта: `parseNbrkUsdKzt`, `parseNbkrUsdKgs`, `formatKzDate`); NEW `src/__tests__/fx-parse.test.ts` (5 тестов, TDD RED→GREEN).
- **Type:** [BEHAVIOR]
- **Before → After:** нет парсеров XML-фидов → 3 чистые функции для извлечения курсов USD из фидов НБ РК (фиксированный номинал, точка) и НБ КР (переменный номинал, запятая), утилита форматирования даты в DD.MM.YYYY (UTC).
- **Client reason:** основы для rate-loading-сервиса (Task 2 из FX-отчётов).
- **Rebuild impact:** presentation only (парсеры используются rate-loader'ом, не видны клиенту).

### 2026-07-20 — 00122: fx_rates — таблица курсов НБ РК/НБ КР для FX-отчётов
- **What changed:** migration `00122_fx_rates.sql` (таблица `fx_rates(date, base_currency, quote_currency, rate, source, created_at)` с PK `(date, base_currency, quote_currency)` и RLS на SELECT (authenticated) / ALL (is_admin()); поддерживаемые пары валют: USD/KZT (source 'nbrk' — НБ РК), USD/KGS (source 'nbkr' — НБ КР), 'manual' для ручной правки).
- **Type:** [SCHEMA]
- **Before → After:** нет курсов валют в системе → таблица `fx_rates` хранит курсы с привязкой к дате, базовой/целевой валюте и источнику для конвертации отчётов в USD
- **Client reason:** «Обработка сбор по валюте» — нужна таблица курсов ЦБ РК и КР для конвертации сумм в отчётах
- **Rebuild impact:** DATA-MODEL (новая таблица для курсов валют, базис для FX-отчётов)

### 2026-07-17 — 00121: per-user скрытие и закрепление столбцов паспорта
- **What changed:** migration `00121_user_prefs.sql` (таблица `user_prefs(user_id, key, value JSONB)` + RLS owner-only + updated_at триггер); NEW `src/lib/hooks/use-user-pref.ts` (кэш + debounce-upsert 600мс, оптимистично); `passport-table.tsx` — реестр колонок `PT_UNITS` (39 скрываемых единиц; «Группы компании» — одна единица, в теле она colSpan=2), панель `ColumnManager` («Столбцы»: чекбоксы по бэндам + «Закрепить до» + «Сбросить»), генерация CSS (display:none по nth-child для скрытых; sticky-left с измеренными офсетами для закреплённого префикса), динамические colSpan бэндовой шапки и первой ячейки «Итого».
- **Type:** [SCHEMA] + [UI-FIELD] + [PRESENTATION]
- **Before → After:** у всех пользователей одинаковые 41 колонка → каждый пользователь скрывает ненужные столбцы и закрепляет префикс «до выбранного столбца» (Excel-семантика); настройки хранятся в БД по user_id (едут за аккаунтом, на других не влияют). «№» закреплена всегда и не скрывается; колонка удаления не скрывается. Скрытие столбца, до которого закреплено, сдвигает закрепление на ближайший видимый слева. Итоги/бэнды/выделение ячеек продолжают работать при любом наборе видимых колонок.
- **Client reason:** «Можно в сделке ненужные столбцы скрывать по желанию… оставались изменения по их ID… и самостоятельно делать закрепление столбцов» (2026-07-17). Scope подтверждён: только паспорт, хранение в базе по ID.
- **Rebuild impact:** DATA-MODEL (новая таблица user_prefs — механизм личных настроек интерфейса, расширяемый на другие экраны); остальное presentation.

### 2026-07-17 — Возврат/перезачёт минусом в detail-выгрузке и попапе оплат
- **What changed:** `passport-detail-excel.ts` (`fetchPaymentsByDeals` тянет `payment_type`, сумма подписывается), `passport-table.tsx` (helper `signedAmount`, оптимистичный итог попапа со знаком, красный лейбл «возврат»/«перезачёт» в строке попапа).
- **Type:** [EXPORT] + [PRESENTATION]
- **Before → After:** сумма оплаты бралась сырой из `deal_payments.amount` (в БД возвраты хранятся плюсом, знак задаёт `payment_type` — конвенция rollup 00062) → в detail-выгрузке под-строка возврата/перезачёта показывается минусом (красный формат Excel), оптимистичный итог попапа считает `SUM(amount × знак)`, в строке попапа лейбл «возврат»/«перезачёт». Сам ввод суммы в попапе остаётся плюсом (как в БД).
- **Client reason:** «когда тип оплаты возврат или перезачет, в системе сумма минусом, но в выгрузке плюсом» (2026-07-17, пример: возврат 87 790 у сделки с итогом 2 144 450).
- **Rebuild impact:** presentation/EXPORT-LAYOUTS; правило для rebuild: знак суммы оплаты всегда выводится из payment_type, в БД — модуль.

### 2026-07-17 — Переименование колонок поставщика: «Отгр.» → «Приход»
- **What changed:** `passport-table.tsx` (заголовки supplier-бэнда + NUMERIC_COLS), `passport-excel.ts`, `passport-detail-excel.ts` (supplier-колонки), `deals/[id]/page.tsx` («Сумма отгрузки» → «Приход, сумма»).
- **Type:** [PRESENTATION]
- **Before → After:** у поставщика «Отгр. тонн» → «Приход, тонн» (паспорт) / «Отгр., т» → «Приход, т» (оба Excel); «Отгр. сумма» → «Приход, сумма» (везде); в сделке «Сумма отгрузки» → «Приход, сумма». Колонки покупателя не тронуты (остаются «Отгр.»). DB-колонки те же (`supplier_shipped_volume`/`supplier_shipped_amount`).
- **Client reason:** «у поставщика в сделке и во всех эксельках поменять колонки: Отгр. тонн → Приход, тонн; Отгр. сумма → Приход, сумма» (2026-07-17).
- **Rebuild impact:** presentation only (словарь терминов: сторона поставщика = «приход»).

### 2026-07-17 — Detail-экспорт: каждая оплата на своей под-строке
- **What changed:** `passport-detail-excel.ts` — тип `SubRow` (`{ship, supPay, buyPay}`), `fetchPaymentsByDeals` (сырые платежи вместо склеенных дат), zip-цикл под-строк, колонки «Оплата»/«Дата оплаты» обеих сторон получили readShip.
- **Type:** [EXPORT]
- **Before → After:**
  - Под-строка = отгрузка; оплаты — только на главной строке (сумма rollup + даты через запятую) → под-строка = i-я отгрузка + i-я оплата поставщика + i-я оплата покупателя, три параллельных списка без связи между собой; кол-во под-строк = max длин; отсутствующая часть строки пустая (пример клиента: 5 отгрузок + 7 оплат → 7 под-строк, в последних 2 только оплаты).
  - «Оплата» на главной строке — по-прежнему rollup-итог; «Дата оплаты» на главной строке теперь пустая (даты живут на под-строках, склеенный список удалён).
- **Client reason:** «нужно каждую оплату на новую строку… после сделки могут быть строки отгрузок или оплат, но они между собой не связаны» (2026-07-17, с примером 5/7).
- **Rebuild impact:** EXPORT-LAYOUTS (структура detail-выгрузки: под-строки — zip трёх списков).

### 2026-07-16 — Попап оплат: мгновенный Баланс + «Изменить итог» закрывает попап
- **What changed:** `passport-table.tsx` — `PaymentBreakdownCell` получил проп `balance`; оптимистика переведена на `applyDealPatch` (кэш сделок патчится синхронно: оплата + баланс/долг одним патчем); локальный pending-механизм удалён; `startEdit` закрывает попап.
- **Type:** [PRESENTATION]
- **Before → After:**
  - Баланс/Долг обновлялись через 1–2 с (ждали серверный rollup и refetch) → патчатся в кэш мгновенно вместе с оплатой: `Δбаланса = −Δоплаты` (supplier: баланс = отгружено − оплата + …), `Δдолга = +Δоплаты` (buyer: долг = оплата − отгружено). Серверная правда затем тихо замещает (значения совпадают).
  - «Изменить итог» держал попап открытым во время ввода → попап закрывается сразу, ячейка уходит в inline-edit; сам «итог» тоже стал оптимистичным (оплата + баланс сразу, revert на ошибке).
- **Client reason:** «when we click on изменить итог the modal should close… the sum field is updated immediately, but balance after 1-2 seconds» (2026-07-16).
- **Rebuild impact:** presentation only; формулы Δ повторяют триггер `compute_deal_derived_fields` — при изменении формулы баланса в БД пересмотреть локальные дельты.

### 2026-07-16 — Попап оплат: оптимистичные правки (Excel-режим)
- **What changed:** `passport-table.tsx` — `PaymentBreakdownCell`: `applyOptimistic`/`revertOptimistic`, client-side UUID для новых оплат, `pendingBase` ref для снятия оптимистичного итога при приходе серверного.
- **Type:** [PRESENTATION]
- **Before → After:** правка/удаление/добавление оплаты ждали ответа бэка и refetch, потом обновляли список и итог → список и итог ячейки меняются мгновенно (до ответа), запрос в фоне, кэши синхронизируются без видимой перерисовки; ошибка бэка → откат + toast. Новая оплата получает UUID на клиенте — строка сразу редактируема без ожидания серверного id.
- **Client reason:** «не сразу меняется, а ждёт ответа от бэкенда… на фронте мы должны всегда менять сразу — как в эксель; ответ бэка не должен перезагружать страницу; ошибка — только тогда показываем» (2026-07-16). Правило зафиксировано как общий стандарт проекта.
- **Rebuild impact:** presentation only; для rebuild-доков: стандарт UI — optimistic-first, revert-on-error.

### 2026-07-15 — Итоги в реестре: строка «Итого» в конце каждой сделки + полные суммы в Excel
- **What changed:** `registry/page.tsx` (новый компонент `GroupTotalsRow` — последняя строка каждой группы-сделки), `registry-excel.ts` (TOTAL_KEYS).
- **Type:** [PRESENTATION]
- **Before → After:**
  - Экран: итогов внутри групп не было (только счётчики в шапке группы) → в конце таблицы каждой сделки строка «Итого · N отгр.»: Входящее СНТ, Исходящее СНТ, Округл (та же логика, что ячейка: override → CEIL при round_volume → raw, база по типу реестра), Сумма и Сумма грузоотправителя; деньги по валюте (при смешанной — перечисляются). Первая версия делала общий sticky-итог по всей выборке — клиент уточнил: «по каждой сделке внизу последней строкой, не общий итог всех» — переделано.
  - Excel «Итого»: суммировались только исходящее СНТ/округл/сумма → добавлены Входящее СНТ (`loading_volume`) и Сумма грузоотправителя (`additional_expenses`). Тарифы не суммируются (ставки).
- **Client reason:** «итоги не появились внизу в реестре… нужно в реестре по каждой сделке внизу последней строкой добавлять итог» (2026-07-15).
- **Rebuild impact:** presentation only.

### 2026-07-15 — 00120: два фактических тарифа (авто из реестра) + автоподстановка «Объем план»
- **What changed:** migration `00120_actual_tariffs.sql` (колонки `deals.actual_tariff_override`, `deals.shipper_actual_tariff`, `deals.shipper_actual_tariff_override`; `compute_deal_derived_fields` расширена; backfill-пересчёт всех сделок); `use-deals.ts` (тип + LIST_SELECT); `passport-table.tsx` (2 новые колонки, EditableNumCell с override, totals); `deals/[id]/page.tsx` (Field с extraPatch, «Тариф факт» с override + новое поле «Тариф факт (грузоотпр.)»); `deals/new/page.tsx` («Объем план» преинициализируется объемом поставщика).
- **Type:** [FORMULA] + [SCHEMA] + [UI-FIELD]
- **Before → After:**
  - `deals.actual_tariff`: ручное поле → авто-расчёт в `compute_deal_derived_fields`: `invoice_amount ÷ базовый объем СНТ` (KZ → `supplier_shipped_volume` = SUM входящего, KG/прочие → `actual_shipped_volume` = SUM исходящего); NULL если суммы/объема нет. Ручная правка ставит `actual_tariff_override = TRUE` — авто-расчёт поле не трогает. ⚠ Прошлые ручные значения перетёрты backfill'ом (у них override=FALSE; правило клиента «факт всегда с реестра»).
  - Новое `deals.shipper_actual_tariff` («Тариф факт грузоотпр.»): `additional_expenses_amount ÷ supplier_shipped_volume` (входящее СНТ), тот же override-паттерн.
  - Паспорт: колонка «Тариф факт» между «Предв. сумма» и «Факт объем»; колонка «Тариф факт (грузоотпр.)» между «Сумма» и «Сумма грузоотпр.». Обе editable-with-override (курсив+amber при ручном вводе), в Итого — пусто (ставки не суммируются).
  - Сделка (Логистика): «Тариф факт» теперь авто с override; новое поле «Тариф факт (грузоотпр.)».
  - Форма создания: «Объем план» подставляется из «Объем, т» поставщика, пока логист не ввёл своё (вариант «б», подтверждён).
  - Detail-экспорт «жд тариф факт» автоматически стал расчётным (читал `actual_tariff`).
- **Client reason:** «Тариф фактический берётся с реестра: итоговая сумма делённая на объем входящего/исходящего СНТ… считается автоматом и может меняться вручную… в сделке в разделе логистика нужно добавить второй тариф факт… Объем план исходит от объема поставщика по договору» (2026-07-15).
- **Rebuild impact:** PRICING (новая формула фактических тарифов), DATA-MODEL (3 новые колонки), FIELD-OWNERSHIP (actual_tariff: авто до override; preliminary_tonnage: prefill от supplier volume).

### 2026-07-15 — 00119: раздельные даты входящего и исходящего СНТ в реестре
- **What changed:** migration `00119_loading_date.sql` — колонка `shipment_registry.loading_date DATE` + backfill; `use-registry.ts` (тип, REG_SELECT, RegistryInsert/Update); `registry/page.tsx` (новая колонка «дата вход. СНТ» после «Входящее СНТ», «дата отгр.» переименована в «дата исход. СНТ», оба диалога добавления пишут loading_date при записи налива); `bulk-add-dialog.tsx` (то же); `registry-excel.ts` (FULL: +«Дата вход. СНТ», «Дата отгр.» → «Дата исход. СНТ»; PTS не тронут — фикс. формат экспедитора); `passport-detail-excel.ts` («Дата вход. СНТ» теперь из loading_date).
- **Type:** [SCHEMA] + [UI-FIELD] + [EXPORT]
- **Before → After:**
  - Была одна дата на строку (`date`, «дата отгр.») → теперь `date` = дата исходящего СНТ (semantics не менялась — на ней resolve_shipment_year_month, autoprice, сортировка), `loading_date` = дата входящего СНТ.
  - Backfill: `loading_date = date` там, где заполнен налив (`loading_volume IS NOT NULL`) — ровно то, что detail-экспорт уже показывал как «Дата вход. СНТ». Audit/activity триггеры заглушены на время backfill.
  - Вставка строк (одиночная + оба «Массово»): `loading_date` наследует дату строки, когда пишется налив (`volumeTarget=load` или «Продублировать отгрузку»).
- **Client reason:** «давай в реестре разделим даты входящего и исходящего СНТ. У каждого будет своя колонка с датой» (2026-07-15).
- **Rebuild impact:** DATA-MODEL (новая колонка + правило: date=исходящее, loading_date=входящее); EXPORT-LAYOUTS.

### 2026-07-19 — Паспорт: редактирование оплат прямо в попапе колонки «Оплата»
- **What changed:** `src/components/deals/passport-table.tsx` — `PaymentBreakdownCell`: статичный текстовый список оплат заменён на редактируемые строки (новый компонент `PaymentEditRow`), добавлены `patchPayment` / `deletePayment` / `addPayment`.
- **Type:** [UI-FIELD]
- **Before → After:** попап показывал оплаты read-only, менять можно было только «итог» (перезапись rollup-колонки deals) или идти в сделку → теперь в попапе каждая оплата редактируется inline (дата + сумма), удаляется («×», с подтверждением), добавляется («+ Оплата», сегодняшняя дата, сумма 0, тип «Оплата»). Записи идут напрямую в `deal_payments`; rollup `deals.supplier_payment`/`buyer_payment` пересчитывает существующий DB-триггер; кэши (`invalidateDealPayments` + `invalidateDeal`) будят список без F5. Кнопка «Изменить итог» сохранена. Пустая сумма = 0 (`amount NOT NULL` в БД).
- **Client reason:** «когда нажимаем на колонку оплата… можем ли сделать так, чтобы оплаты и даты можно сразу в модалке менять, не проваливаясь в сделку» (2026-07-19).
- **Rebuild impact:** presentation only — схема и формулы не менялись; для rebuild-доков: оплаты редактируются из двух мест (страница сделки + попап паспорта), оба пишут в `deal_payments`.

### 2026-07-18 — 00118: станции сделки дозаполняют реестр + fallback в «Массово»
- **What changed:** migration `00118_station_propagation.sql` (функция `propagate_deal_stations_to_registry`, триггер `trg_propagate_deal_stations` на deals, catch-up станций + повтор tariff catch-up); `use-registry.ts` (deal-embed + станции сделки), `registry/page.tsx` (fallback станций в bulk-контексте).
- **Type:** [BEHAVIOR]
- **Before → After:**
  - Раньше: станция копировалась в строку реестра только в момент вставки; если у сделки в тот момент станции не было — строки оставались с NULL навсегда (KG/26/275: 24 строки без станции, batch 12:53 до заполнения станции на сделке, batch 12:55 — после).
  - Теперь: появление/смена `supplier_departure_station_id` / `buyer_destination_station_id` на сделке дозаполняет строки реестра этой сделки, где станция NULL. Явно выбранные станции не перетираются.
  - Catch-up: разово дозаполнены NULL-станции по всей базе из сделок; затем повторён tariff catch-up 00117 — строки без станций раньше не могли сматчиться со справочником тарифов.
  - «Массово» с /registry: станции контекста теперь fallback'ятся на поля сделки, когда первая строка группы без станций.
- **Client reason:** «в некоторых отгрузках KG/26/275 отсутствует ст. отправления» (2026-07-18).
- **Rebuild impact:** FIELD-OWNERSHIP (станция строки реестра: сделка дозаполняет NULL, ручной выбор неприкосновенен); DATA-MODEL — новое propagation-правило.

### 2026-07-18 — Сумма грузоотправителя: ручной ввод без тарифа менеджера
- **What changed:** `registry/page.tsx` — ячейка «Сумма грузоотправителя» (`additional_expenses`) теперь коммитит `additional_expenses_override = true` при ручной правке (EN получил параметры titleManual/titleAuto).
- **Type:** [UI-FIELD]
- **Before → After:** ячейка писала только `additional_expenses`; BEFORE-триггер 00113 при `additional_expenses_override = FALSE` и `manager_tariff IS NULL` немедленно затирал введённое значение в NULL («ей всегда нужен тариф») → теперь ручной ввод (включая очистку) ставит override, триггер значение не трогает — семантика идентична ручной сумме `shipped_tonnage_amount` и тарифу 00117. Отображение: курсив + amber + tooltip. Формулы БД не менялись — колонка override существовала с 00113, UI её не использовал.
- **Client reason:** «В реестре KZ в столбце сумма грузоотправления не можем вставить вручную сумму… Ей всегда нужен тариф, без тарифа сумма не вносится, а нужно чтобы вносилась» (2026-07-14).
- **Rebuild impact:** FIELD-OWNERSHIP (additional_expenses: авто до ручного override); presentation в остальном.

### 2026-07-18 — 00117: тариф из справочника автоматически обновляет реестр
- **What changed:** migration `00117_tariff_propagation.sql` — колонка `shipment_registry.railway_tariff_override BOOLEAN NOT NULL DEFAULT FALSE`, функция `propagate_tariff_to_registry()`, триггеры `trg_propagate_tariff_ins/upd` на `tariffs`, catch-up по всем тарифам; frontend `registry/page.tsx` (EN-ячейка «Тариф (логисты)» ставит override при ручной правке, курсив при override), `use-registry.ts` (тип + REG_SELECT + RegistryUpdate).
- **Type:** [SCHEMA] + [BEHAVIOR] + [UI-FIELD]
- **Before → After:**
  - Раньше: lookup тарифа только при вставке строки реестра (UI) и разовыми backfill'ами (00047); изменение ставки в справочнике Тарифы реестр не трогало.
  - Теперь: INSERT тарифа или изменение `planned_tariff` → UPDATE всех строк реестра c совпадением по ключу 00047 (departure + destination + fuel + forwarder + month с fallback'ом на поля сделки + год сделки), КРОМЕ строк с `railway_tariff_override = TRUE`. Обнуление ставки в справочнике реестр не трогает (защита от массового стирания).
  - Ручная правка ячейки «Тариф (логисты)» в реестре (включая очистку) ставит `railway_tariff_override = TRUE` — строка выходит из-под propagation (семантика как у `shipped_tonnage_amount_override`: «ручной ввод всегда приоритетнее»). Отображение: курсив + amber, tooltip.
  - Пересчёт сумм — существующей цепочкой (compute_registry_amount + guarded rollups 00116).
  - Catch-up в миграции выравнивает уже разъехавшиеся строки (пример клиента: KG/26/270 держал 78.71 при 76.00 в справочнике).
- **Client reason:** «when users change the тариф, in the registry тариф (логисты) does not change, but it should always get the updated тариф, unless it wasn't updated manually in registry» (2026-07-18).
- **Rebuild impact:** DATA-MODEL (новая колонка + правило propagation), PRICING (тариф → суммы строк пересчитываются), FIELD-OWNERSHIP (тариф строки: справочник владеет до ручного override). ⚠ У строк с ручным тарифом, введённым ДО миграции, флага нет — catch-up выровнял их по справочнику (отличить задним числом невозможно, правило клиента — справочник главный).

### 2026-07-16 — 00116: WHEN-guards на rollup-триггеры реестра (statement timeout)
- **What changed:** migration `00116_registry_rollup_when_guards.sql` — функции `refresh_deal_shipment_totals`, `update_deal_additional_expenses`; триггеры `trg_shipment_refresh_deal` и `trg_update_deal_additional_expenses` разбиты на `*_ins_del` (безусловные) + `*_upd` (с WHEN).
- **Type:** [FORMULA] (тела rollup-функций) + [BEHAVIOR] (условия срабатывания триггеров)
- **Before → After:**
  - `trg_shipment_refresh_deal`: AFTER INSERT OR UPDATE OR DELETE безусловно → UPDATE-ветка срабатывает только `WHEN (OLD.loading_volume|shipment_volume|shipped_tonnage_amount|deal_id IS DISTINCT FROM NEW.*)`; INSERT/DELETE без изменений.
  - `trg_update_deal_additional_expenses`: AFTER INSERT OR UPDATE OR DELETE безусловно (00115) → UPDATE-ветка только `WHEN (OLD.additional_expenses|deal_id IS DISTINCT FROM NEW.*)`. WHEN сравнивает значения, а не SET-list — auto-compute из BEFORE-триггера 00113 ловится, баг 00112 не возвращается.
  - `refresh_deal_shipment_totals()`: `UPDATE deals ... FROM (SELECT SUM ...)` + ветка `IF NOT FOUND → нули` → SUM в переменные + один UPDATE с guard'ом `AND (<поле> IS DISTINCT FROM <значение>)`; пустой реестр даёт нули через COALESCE (семантика сохранена). Сами формулы сумм НЕ менялись: `supplier_shipped_volume=SUM(loading)`, `buyer_shipped_volume=actual_shipped_volume=SUM(shipment)`, `invoice_amount=SUM(shipped_tonnage_amount)`.
  - `update_deal_additional_expenses()`: `UPDATE deals SET additional_expenses_amount = v_sum` безусловно → `... AND additional_expenses_amount IS DISTINCT FROM v_sum`. Формула `SUM(additional_expenses)` не менялась.
- **Client reason:** «canceling statement due to statement timeout» при быстром вводе № СФ (12:57 Алматы, 15–18 правок/мин по audit_log) — каждая правка любой ячейки реестра дважды безусловно переписывала строку deals; параллельные правки одной сделки сериализовались на её блокировке, хвост очереди превышал 8-секундный лимит Supabase и правка терялась.
- **Rebuild impact:** DATA-MODEL/PRICING — правило для rebuild: rollup-триггеры реестра должны быть guarded (fire-on-change), иначе конкурентный ввод упирается в блокировку строки deals.

### 2026-07-16 — Detail-экспорт: дата СНТ только при своём тоннаже
- **What changed:** `src/lib/exports/passport-detail-excel.ts` — колонки «Дата вход. СНТ» / «Дата исход. СНТ» на под-строках.
- **Type:** [EXPORT]
- **Before → After:** обе даты = `registry.date` безусловно → «Дата вход. СНТ» только если заполнено `loading_volume` (Входящее СНТ), «Дата исход. СНТ» только если заполнено `shipment_volume` (Исходящее СНТ). Пустой тоннаж = пустая дата.
- **Client reason:** KG/26/487 — «дата отгрузки» в реестре одна на строку и относится к той стороне, чей тоннаж внесён; в экспорте она разводится на две колонки, и дата без тоннажа читалась как «нулевая отгрузка с датой» (2026-07-16).
- **Rebuild impact:** presentation only (EXPORT-LAYOUTS).

### 2026-07-16 — Валюта логистики: fallback в реестре + дефолт формы создания
- **What changed:** `src/lib/hooks/use-registry.ts` (REG_SELECT deal-embed + тип), `src/app/(dashboard)/registry/page.tsx` (4 места fallback), `src/lib/exports/registry-excel.ts` (колонка «Валюта» в обоих вариантах), `src/app/(dashboard)/deals/new/page.tsx` (дефолт валюты).
- **Type:** [BEHAVIOR] + [PRESENTATION]
- **Before → After:**
  - Валюта строки реестра: `row.currency ?? deals.currency (legacy) ?? дефолт таба` → `row.currency ?? deals.logistics_currency ?? deals.currency ?? дефолт таба`. Смена валюты в разделе Логистика сделки теперь сразу видна в реестре (для строк без явной валюты — их 95%).
  - Форма создания сделки: валюта по умолчанию `USD` всегда → `DEAL_TYPE_CURRENCY[тип]` (KZ → KZT, KG → USD), автоследование за сменой типа, пока валюта не выбрана вручную.
- **Client reason:** «Когда мы заводим сделку… в разделе логистика почему-то не дублирует валюту. Стоит по умолчанию другая» + «При изменении валюты в разделе логистика автоматом менялось в реестре» (2026-07-16).
- **Rebuild impact:** FIELD-OWNERSHIP/DATA-MODEL: fallback-цепочка валюты реестра — правило для rebuild-доков; схема БД не менялась.

### 2026-07-16 — Detail-экспорт: «Дата оплаты» из deal_payments
- **What changed:** `src/lib/exports/passport-detail-excel.ts` — новый батч-фетч `fetchPaymentDatesByDeals()`; колонки «Дата оплаты» (пост./покуп.) на главной строке сделки.
- **Type:** [EXPORT]
- **Before → After:** читали `deals.supplier_payment_date` / `buyer_payment_date` (ручной TEXT, заполнен у 7 и 1 сделки из 792) → список реальных дат из `deal_payments.payment_date` по стороне (`side`), формат dd.mm.yyyy через запятую, по возрастанию; TEXT-поле осталось как fallback при отсутствии платежей.
- **Client reason:** «даты оплат не прогрузились в detail excel» (2026-07-16).
- **Rebuild impact:** presentation only (EXPORT-LAYOUTS); схема и формулы БД не менялись.

### 2026-07-14 — Экспорт паспорта: 3 варианта + новый «Паспорт (детальный)»
- **What changed:**
  - NEW `src/lib/exports/passport-detail-excel.ts` — `exportPassportDetailToExcel()`: 63-колоночный формат по клиентскому файлу `passport-detail-2026-07-09.xlsx`; под каждой сделкой — под-строка на каждую строку `shipment_registry` (outlineLevel=1, сворачиваемые).
  - `src/app/(dashboard)/deals/page.tsx` — кнопка Excel заменена на DropdownMenu: «Паспорт» (прежний формат, без изменений), «Паспорт (детальный)», «Паспорт (долги)» (disabled, «Скоро»).
  - `src/lib/hooks/use-deals.ts` — `fetchDealLinesForExport` теперь тянет `quotation_type:quotation_product_types(basis)`; `DealLineSnapshot` расширен полем `quotation_type`.
  - `src/lib/exports/registry-excel.ts` — `roundedTonnage()` экспортирована (структурный параметр) для реюза в detail-экспорте.
- **Type:** [EXPORT]
- **Before → After:**
  - Кнопка Excel: одиночная (только «Паспорт») → выпадающее меню с 3 вариантами.
  - «Остаток, т» в detail-варианте: `shipped − ordered` (как в обычном паспорте) → `ordered − shipped` (положительный; клиентская аннотация «остаток сделать плюсовой»). Обычный «Паспорт» НЕ изменён.
  - Detail-layout vs обычный: +«Биржа» (пост./покуп., из `quotation_product_types.basis` через линии), +«Дата вход./исход. СНТ» (на под-строках), +«Дата оплаты» (обе стороны, из `deals.*_payment_date`), группы получили блок «Биржа (пусто)|Котировка|Скидка|Цена предв.|Цена финальная» (из `deal_company_groups`), −«Цена гр. (avg)», −«Сумма грузоотпр.», логистика: «жд тариф план/Плановая сумма жд/Объем по счету-фактуре/жд тариф факт/Сумма жд по счету-фактуре» + «Менеджер по покупке»/«Менеджер по продаже» (buyer_manager ранее в экспорт не выводился).
  - Под-строки несут только значения вагона: тоннажи (`loading_volume`/`shipment_volume`), даты, `Отгр. сумма = цена сделки × тоннаж вагона` (клиентская формула `O$4*P5`), приложения (`supplier_appendix`/`buyer_appendix` с fallback на договор сделки), жд-данные (`railway_tariff`, `shipped_tonnage_amount`, rounded tonnage). Агрегаты сделки (Оплата/Баланс/Заявлено/Остаток/Долг/группы-числа) — только на главной строке (иначе SUM задваивается).
- **Client reason:** клиент прислал размеченный шаблон (`files/Паспорт/`) — нужна детальная выгрузка с расшифровкой по отгрузкам; формат «долги» ждёт утверждения.
- **Rebuild impact:** EXPORT-LAYOUTS (новый вариант выгрузки); FIELD-OWNERSHIP не затронут (новых DB-полей нет); PRICING не затронут (формулы в БД не менялись — расчёт `цена × тоннаж` только в файле экспорта).

### 2026-07-20 — Fix: /reports падал — .rpc вызывался без this-binding
- **What changed:** `src/lib/hooks/use-fx-reports.ts` — `callRpc` теперь зовёт `sb.rpc(name, args)` КАК МЕТОД клиента, а не извлекает `.rpc` в переменную и вызывает отдельно.
- **Type:** [BEHAVIOR]
- **Before → After:** было `const rpc = (createClient() as ...).rpc; await rpc()(name,args)` → метод `.rpc` терял `this`-привязку к SupabaseClient, supabase-js падал в рантайме, вкладка «Отчёты» показывала «Ошибка:». Стало `sb.rpc(name,args)` — this сохранён, RPC отрабатывают. Поймано E2E-пробой на проде (tsc такое не ловит).
- **Client reason:** после применения миграций /reports показывала ошибку вместо отчётов.
- **Rebuild impact:** none (правка вызова).

### 2026-07-21 — Fix: backfill стартовал с «античных» дат (опечатки в данных)
- **What changed:** `scripts/fx-backfill.mjs` — `earliest()` теперь фильтрует даты `>= 2025-01-01` (FLOOR) при поиске стартовой даты.
- **Type:** [SCRIPT]
- **Before → After:** брал min(`shipment_registry.date`, `deal_payments.payment_date`) без нижнего предела → в данных есть опечатки (строка реестра сделки KG/26/101 с `date=0226-02-28`, ещё `2006-06-01`), поэтому backfill стартовал с ~226/2006 года и молотил тысячи лет неудачных fetch'ей к НБ РК. → теперь стартует с реальной ранней даты (2025-11), диапазон 2025-11…сегодня.
- **Client reason:** backfill курсов завис/не заполнял; выявлены строки с битыми датами.
- **Rebuild impact:** none (one-off скрипт).

### 2026-07-21 — Fix: proxy редиректил /api/cron на /login (cron курсов не работал)
- **What changed:** `src/proxy.ts` — исключение из auth-гейта расширено с `/api/keepalive` на `/api/cron` тоже.
- **Type:** [BEHAVIOR]
- **Before → After:** proxy (Next 16 middleware) пропускал мимо auth только `/api/keepalive`; `/api/cron/fx-rates` уходил в `updateSession` → 307-редирект на /login, обработчик не выполнялся, Vercel Cron не мог загрузить курсы. → теперь `/api/cron/*` пропускается к своему обработчику (у него собственная проверка CRON_SECRET). Поймано E2E: `curl` cron-роута отдавал 307.
- **Client reason:** после установки CRON_SECRET ежедневная загрузка курсов всё равно не срабатывала.
- **Rebuild impact:** none.

### 2026-07-21 — UI/Fix: вкладка «Отчёты» — лейблы в дропдауне, селектор года, пагинация «Цены»
- **What changed:** `src/app/(dashboard)/reports/page.tsx` — дропдаун отчёта показывает человекочитаемый лейбл (а не ключ `ship_out`); day-picker'ы «С»/«По» заменены на селектор **Год** (отчёты помесячные); панель фильтров в `Card`, ровные размеры на shared `Select`. `src/lib/hooks/use-fx-reports.ts` — `fetchPrice`/`fetchFlows` тянут результат RPC постранично (`callRpcAll`), т.к. `fx_report_price` построчный по СНТ и упирался в лимит PostgREST 1000 строк → отчёт «Цена» молча обрезался.
- **Type:** [UI] + [BEHAVIOR]
- **Before → After:** (1) дропдаун показывал сырые ключи метрик → показывает лейблы. (2) day-picker для помесячного отчёта → выбор года (период = весь год). (3) «Цена» отдавала ≤1000 строк → все строки за год.
- **Client reason:** фидбэк со скриншотом: ключи в дропдауне, лишний date-picker, неровный layout/не shared-компоненты.
- **Rebuild impact:** none.

# Этап 1. Дислокация и сверхнормативный простой — план (запись исполнения)

> План записан по ходу исполнения (владелец просил «быстро»; одобрение спеки
> принято как одобрение плана). Код — в коммитах ветки `feat/dislocation-demurrage`,
> здесь не дублируется: у каждой задачи — файлы, интерфейсы и команда проверки.

**Goal:** логист загружает дислокацию, заводит протокол цены — CRM считает простой погрузки/выгрузки по вагонам.
**Architecture:** снимки → рейсы (таблица-кэш, пересчёт по экспедитору) → стоянки → простой (вью) → реестр PTC (вью). Деньги только в Postgres. UI — клиентские страницы Next 16 + нетипизированный клиент Supabase (типы не перегенерированы).
**Spec:** `docs/superpowers/specs/2026-09-27-dislocation-demurrage-design.md`

## Global Constraints
- Таблицы только с префиксом `rail_` (общая схема `public`).
- Миграция идемпотентна: применяется вручную в SQL-редакторе Supabase, может встать частично.
- Даты — `date`/`timestamp` без часового пояса.
- Node 22.18 из nvm; `.env.local` не копировать — сборку проверять по «Compiled successfully».

## Review Focus
1. Последний рейс вагона: сравнения с `next_*` дают NULL — стоянка не должна пропадать (баг найден и закрыт тестом).
2. Вагон пропал из рассылки Шагыр — стоянка не должна тихо считаться до последнего снимка без пометки.
3. Порожний → порожний (переадресовка через Арыс 1) — не стоянка.
4. Два протокола на одну дату и маршрут — суммы нет, статус «несколько протоколов».
5. Повторная загрузка того же файла — отказ, без задвоения.

## Tasks

### Task 1: Схема, загрузка, расчёт (миграция 00174) — готово, `1f1876d`, `35ee07b`
- Files: `supabase/migrations/00174_rail_dislocation_demurrage.sql`, `supabase/tests/31_rail_demurrage.test.sql`
- Produces: `rail_upload_dislocation(uuid, timestamp, text, text, jsonb) → uuid`; вью `rail_demurrage`, `rail_demurrage_registry` (колонки — `src/lib/dislocation/types.ts`).
- Verify: одноразовый Postgres 15 + стаб из `.github/workflows/test.yml` + все миграции + `supabase/tests/run.sh` → «All DB tests passed.»; повторное применение 00174 без ошибок; прогон 17 файлов Шагыр.

### Task 2: Подготовка файла к загрузке — готово, `1f1876d`
- Files: `src/lib/dislocation/upload.ts`, `src/__tests__/dislocation-upload.test.ts`
- Produces: `parseSnapshotAtFromFileName`, `normalizeStationName` (= `rail_norm_station`), `collectStationNames`, `toUploadRows`, `sha256Hex`.
- Verify: `npx vitest run src/__tests__/dislocation-upload.test.ts`

### Task 3: Реестр в Excel — готово, `35ee07b`
- Files: `src/lib/dislocation/registry-export.ts`, `src/lib/exports/demurrage-registry-excel.ts`, `src/__tests__/demurrage-registry-export.test.ts`
- Verify: `npx vitest run src/__tests__/demurrage-registry-export.test.ts`

### Task 4: Хуки и экраны — готово, `35ee07b`
- Files: `src/lib/hooks/use-dislocation.ts`, `src/lib/dislocation/{db,types}.ts`, `src/app/(dashboard)/dislocation/{page,upload/page,wagon/[number]/page,protocols/page}.tsx`, `src/lib/constants/nav-items.ts`, `src/__tests__/paginated-order.test.ts` (исключения для вью).
- Verify: `npx tsc --noEmit`; `npm run lint` — новых проблем нет (база 270); `npx vitest run` 693/693; `npm run build` → «Compiled successfully»; запросы страниц повторены через PostgREST v12 на данных Шагыр — 200.

### Task 5: Документы — `CHANGELOG-SINCE-EXTRACTION.md`, `AS-BUILT-DATA.md`.

### Task 6: Выкатка
1. Владелец применяет `00174` в Supabase; проверка объектов по `pg_class`/`pg_proc`/`pg_trigger`.
2. Ветка сводится с `origin/main`, пуш в `main` выкатывает фронтенд (Vercel).

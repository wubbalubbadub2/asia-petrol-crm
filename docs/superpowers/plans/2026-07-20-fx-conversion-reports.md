# FX-конвертация + вкладка «Отчёты» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать 5 отчётов (Приход, Исход, Оплаты поставщикам, Оплаты покупателям, Цена) в USD и KZT, конвертируя каждую сумму по курсу нацбанка на дату события; курсы грузятся автоматически и хранятся в БД.

**Architecture:** Суммы в БД остаются в native-валюте. Курсы НБ РК (USD/KZT) и НБ КР (USD/KGS) складываются в таблицу `fx_rates`. Конвертация — Postgres-функции с пивотом через USD и среднемесячным fallback. Отчёты собираются RPC-функциями и рендерятся в новой вкладке `/reports`. Загрузчик курсов — портируемое ядро + тонкая обёртка Vercel Cron.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase/Postgres, vitest (unit), Tailwind. XML-фиды парсим регулярками (без новых зависимостей).

## Global Constraints

- Миграции применяет ПОЛЬЗОВАТЕЛЬ в Supabase SQL Editor — проект локально не залинкован. Задачи с миграциями завершаются чекпоинтом «пользователь применил + probe».
- Тестируем на production Vercel (push в `main` → auto-deploy). НЕ `npm run dev`.
- После КАЖДОГО изменения в репо — запись в `CHANGELOG-SINCE-EXTRACTION.md` (FORMULA-изменения с Before → After).
- Оптимистичный UI: фронт меняется сразу, без перезагрузки на ответ бэка; ошибка → откат + toast. (Для отчётов это read-only, правило применяется к фильтрам/переключателям — мгновенный отклик.)
- Новый инфра-код держать портируемым: платформа (Vercel Cron) — тонкая обёртка над ядром.
- Валюты в системе: `USD`, `KZT`, `KGS`. Пивот-валюта конвертации — **USD**. НБ РК → USD/KZT; НБ КР → USD/KGS.
- `deals.month` — русское название месяца в нижнем регистре (`январь`…`декабрь`); `deals.year` — INT; `deals.deal_type` ∈ `KG|KZ|OIL`.
- Номера миграций идут после 00121 → следующая свободная 00122.
- Знак платежа: `deal_payments.payment_type IN ('refund','offset')` → сумма минусом.

---

### Task 1: Миграция 00122 — таблица `fx_rates`

**Files:**
- Create: `supabase/migrations/00122_fx_rates.sql`
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Produces: таблица `fx_rates(date, base_currency, quote_currency, rate, source, created_at)`, PK `(date, base_currency, quote_currency)`. Строки пар `USD/KZT` (source `nbrk`) и `USD/KGS` (source `nbkr`).

- [ ] **Step 1: Написать миграцию**

```sql
-- 00122_fx_rates.sql
-- Курсы нацбанков для конвертации отчётов в USD/KZT (клиент, ТЗ
-- «Обработка сбор по валюте»). rate = «1 base = rate quote».
-- USD/KZT — НБ РК; USD/KGS — НБ КР. Конвертация пивотит через USD.

CREATE TABLE IF NOT EXISTS fx_rates (
  date           DATE NOT NULL,
  base_currency  TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate           NUMERIC(18,6) NOT NULL,
  source         TEXT NOT NULL,           -- 'nbrk' | 'nbkr' | 'manual'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (date, base_currency, quote_currency)
);

ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;

-- Чтение — любой аутентифицированный (отчёты). Запись — только
-- админ (ручная правка) через канонический хелпер is_admin() проекта
-- (00010_rls_policies). service-role загрузчик RLS обходит в любом случае.
DROP POLICY IF EXISTS fx_rates_read ON fx_rates;
CREATE POLICY fx_rates_read ON fx_rates
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fx_rates_admin_write ON fx_rates;
CREATE POLICY fx_rates_admin_write ON fx_rates
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
```

- [ ] **Step 2: Добавить запись в changelog**

В `CHANGELOG-SINCE-EXTRACTION.md` дописать блок `[MIGRATION 00122] fx_rates — таблица курсов НБ РК/НБ КР для FX-отчётов`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00122_fx_rates.sql CHANGELOG-SINCE-EXTRACTION.md
git commit -m "feat(fx): миграция 00122 — таблица курсов fx_rates"
```

- [ ] **Step 4: ЧЕКПОИНТ — пользователь применяет 00122**

Попросить пользователя прогнать `00122_fx_rates.sql` в Supabase SQL Editor.
Probe после применения: `SELECT count(*) FROM fx_rates;` → 0 строк, ошибок нет.

---

### Task 2: Парсеры XML-фидов (pure, TDD)

**Files:**
- Create: `src/lib/fx/parse.ts`
- Test: `src/__tests__/fx-parse.test.ts`

**Interfaces:**
- Produces:
  - `parseNbrkUsdKzt(xml: string): number` — KZT за 1 USD из фида НБ РК.
  - `parseNbkrUsdKgs(xml: string): number` — KGS за 1 USD из фида НБ КР (с учётом `Nominal`, запятая-разделитель).
  - `formatKzDate(d: Date): string` — `DD.MM.YYYY` для параметра `fdate` НБ РК.

- [ ] **Step 1: Написать падающий тест**

```ts
// src/__tests__/fx-parse.test.ts
import { describe, it, expect } from "vitest";
import { parseNbrkUsdKzt, parseNbkrUsdKgs, formatKzDate } from "@/lib/fx/parse";

const NBRK = `<rates>
  <item><fullname>ЕВРО</fullname><title>EUR</title><description>520.10</description><quant>1</quant></item>
  <item><fullname>ДОЛЛАР США</fullname><title>USD</title><description>468.88</description><quant>1</quant></item>
</rates>`;

const NBKR = `<CurrencyRates Date="20.07.2026">
  <Currency ISOCode="EUR"><Nominal>1</Nominal><Value>96,5000</Value></Currency>
  <Currency ISOCode="USD"><Nominal>1</Nominal><Value>87,4500</Value></Currency>
</CurrencyRates>`;

describe("fx parse", () => {
  it("вытаскивает USD/KZT из НБ РК", () => {
    expect(parseNbrkUsdKzt(NBRK)).toBeCloseTo(468.88, 2);
  });
  it("вытаскивает USD/KGS из НБ КР (запятая, номинал)", () => {
    expect(parseNbkrUsdKgs(NBKR)).toBeCloseTo(87.45, 2);
  });
  it("делит на номинал, если он > 1", () => {
    const xml = `<CurrencyRates><Currency ISOCode="USD"><Nominal>10</Nominal><Value>874,50</Value></Currency></CurrencyRates>`;
    expect(parseNbkrUsdKgs(xml)).toBeCloseTo(87.45, 2);
  });
  it("форматирует дату для fdate", () => {
    expect(formatKzDate(new Date(Date.UTC(2026, 6, 5)))).toBe("05.07.2026");
  });
  it("кидает ошибку, если USD не найден", () => {
    expect(() => parseNbrkUsdKzt("<rates></rates>")).toThrow();
  });
});
```

- [ ] **Step 2: Прогнать — тест падает**

Run: `npx vitest run src/__tests__/fx-parse.test.ts`
Expected: FAIL — `parseNbrkUsdKzt is not a function` / module not found.

- [ ] **Step 3: Реализовать парсеры**

```ts
// src/lib/fx/parse.ts
// Парсинг фидов нацбанков регулярками — фиды простые и стабильные,
// отдельная XML-зависимость не нужна.

/** KZT за 1 USD из фида НБ РК (get_rates.cfm). */
export function parseNbrkUsdKzt(xml: string): number {
  const m = xml.match(
    /<item>[\s\S]*?<title>\s*USD\s*<\/title>[\s\S]*?<description>\s*([\d.,]+)\s*<\/description>/i,
  );
  if (!m) throw new Error("НБ РК: курс USD не найден в фиде");
  const val = Number(m[1].replace(",", "."));
  if (!Number.isFinite(val) || val <= 0) throw new Error(`НБ РК: некорректный курс "${m[1]}"`);
  return val;
}

/** KGS за 1 USD из фида НБ КР (daily.xml), с учётом номинала. */
export function parseNbkrUsdKgs(xml: string): number {
  const m = xml.match(
    /<Currency\s+ISOCode="USD">\s*<Nominal>\s*(\d+)\s*<\/Nominal>\s*<Value>\s*([\d.,]+)\s*<\/Value>/i,
  );
  if (!m) throw new Error("НБ КР: курс USD не найден в фиде");
  const nominal = Number(m[1]) || 1;
  const value = Number(m[2].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`НБ КР: некорректный курс "${m[2]}"`);
  return value / nominal;
}

/** DD.MM.YYYY (UTC) для параметра fdate НБ РК. */
export function formatKzDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}
```

- [ ] **Step 4: Прогнать — тест зелёный**

Run: `npx vitest run src/__tests__/fx-parse.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fx/parse.ts src/__tests__/fx-parse.test.ts
git commit -m "feat(fx): парсеры фидов НБ РК/НБ КР + formatKzDate (TDD)"
```

---

### Task 3: Ядро загрузки курсов `ingest.ts`

**Files:**
- Create: `src/lib/fx/ingest.ts`
- Test: `src/__tests__/fx-ingest.test.ts`

**Interfaces:**
- Consumes: `parseNbrkUsdKzt`, `parseNbkrUsdKgs`, `formatKzDate` (Task 2); `createAdminClient` из `@/lib/supabase/admin`.
- Produces:
  - `nbrkUrl(d: Date): string`, `NBKR_URL: string` — построители URL (чистые, тестируемые).
  - `fetchNbrkRate(d: Date, fetchFn?): Promise<number>` — KZT/USD на дату.
  - `fetchNbkrRate(fetchFn?): Promise<number>` — KGS/USD текущий.
  - `ingestDailyRates(opts?: { date?: Date }): Promise<{ nbrk: number; nbkr: number; date: string }>` — тянет оба банка, upsert в `fx_rates`.

- [ ] **Step 1: Написать падающий тест (чистые части)**

```ts
// src/__tests__/fx-ingest.test.ts
import { describe, it, expect } from "vitest";
import { nbrkUrl, NBKR_URL, fetchNbrkRate, fetchNbkrRate } from "@/lib/fx/ingest";

const NBRK = `<rates><item><title>USD</title><description>468.88</description></item></rates>`;
const NBKR = `<CurrencyRates><Currency ISOCode="USD"><Nominal>1</Nominal><Value>87,4500</Value></Currency></CurrencyRates>`;
const fakeFetch = (body: string) =>
  (async () => ({ ok: true, text: async () => body })) as unknown as typeof fetch;

describe("fx ingest (pure)", () => {
  it("строит URL НБ РК с fdate", () => {
    expect(nbrkUrl(new Date(Date.UTC(2026, 6, 5)))).toContain("fdate=05.07.2026");
  });
  it("URL НБ КР — daily.xml", () => {
    expect(NBKR_URL).toContain("nbkr.kg");
  });
  it("fetchNbrkRate парсит ответ", async () => {
    expect(await fetchNbrkRate(new Date(Date.UTC(2026, 6, 5)), fakeFetch(NBRK))).toBeCloseTo(468.88, 2);
  });
  it("fetchNbkrRate парсит ответ", async () => {
    expect(await fetchNbkrRate(fakeFetch(NBKR))).toBeCloseTo(87.45, 2);
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx vitest run src/__tests__/fx-ingest.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Реализовать ядро**

```ts
// src/lib/fx/ingest.ts
// Портируемое ядро загрузки курсов. НИКАКОЙ привязки к Vercel —
// вызывается из cron-роута (сейчас) и из любого другого шедулера
// потом. Запись через service-role (обходит RLS fx_rates).

import { createAdminClient } from "@/lib/supabase/admin";
import { parseNbrkUsdKzt, parseNbkrUsdKgs, formatKzDate } from "@/lib/fx/parse";

export const NBKR_URL = "https://www.nbkr.kg/XML/daily.xml";
export function nbrkUrl(d: Date): string {
  return `https://nationalbank.kz/rss/get_rates.cfm?fdate=${formatKzDate(d)}`;
}

async function getText(url: string, fetchFn: typeof fetch): Promise<string> {
  const res = await fetchFn(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FX fetch ${url} → HTTP ${res.status}`);
  return res.text();
}

/** KZT за 1 USD (НБ РК) на дату. */
export async function fetchNbrkRate(d: Date, fetchFn: typeof fetch = fetch): Promise<number> {
  return parseNbrkUsdKzt(await getText(nbrkUrl(d), fetchFn));
}

/** KGS за 1 USD (НБ КР) — только текущий день. */
export async function fetchNbkrRate(fetchFn: typeof fetch = fetch): Promise<number> {
  return parseNbkrUsdKgs(await getText(NBKR_URL, fetchFn));
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Тянет оба банка на дату (по умолчанию сегодня) и делает upsert в
 * fx_rates: (date, USD, KZT, nbrk) и (date, USD, KGS, nbkr).
 * НБ КР отдаёт только текущий курс — историю сюда не передаём.
 */
export async function ingestDailyRates(opts?: { date?: Date }): Promise<{ nbrk: number; nbkr: number; date: string }> {
  const d = opts?.date ?? new Date();
  const date = isoDate(d);
  const [nbrk, nbkr] = await Promise.all([fetchNbrkRate(d), fetchNbkrRate()]);
  const sb = createAdminClient();
  const rows = [
    { date, base_currency: "USD", quote_currency: "KZT", rate: nbrk, source: "nbrk" },
    { date, base_currency: "USD", quote_currency: "KGS", rate: nbkr, source: "nbkr" },
  ];
  const { error } = await (sb as unknown as {
    from: (t: string) => { upsert: (r: unknown, o: { onConflict: string }) => Promise<{ error: { message: string } | null }> };
  }).from("fx_rates").upsert(rows, { onConflict: "date,base_currency,quote_currency" });
  if (error) throw new Error(`fx_rates upsert: ${error.message}`);
  return { nbrk, nbkr, date };
}
```

> `as unknown as {...}` — `database.ts` ещё не знает `fx_rates` (тот же приём, что в `use-user-pref.ts`/`use-registry.ts`). После Task 8, при желании, можно перегенерить типы (`npm run types:db`) и убрать каст.

- [ ] **Step 4: Прогнать — зелёный**

Run: `npx vitest run src/__tests__/fx-ingest.test.ts`
Expected: PASS (4 теста). `ingestDailyRates` тестируется интеграционно через роут (Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fx/ingest.ts src/__tests__/fx-ingest.test.ts
git commit -m "feat(fx): ядро загрузки курсов (fetch НБ РК/НБ КР + upsert)"
```

---

### Task 4: Cron-роут + vercel.json + env

**Files:**
- Create: `src/app/api/cron/fx-rates/route.ts`
- Modify: `vercel.json`
- Modify: `.env.example`
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Consumes: `ingestDailyRates` (Task 3).
- Produces: `GET /api/cron/fx-rates` — защищён `CRON_SECRET`, дёргает загрузку; Vercel Cron daily.

- [ ] **Step 1: Написать роут**

```ts
// src/app/api/cron/fx-rates/route.ts
// Тонкая обёртка Vercel Cron над портируемым ядром ingestDailyRates.
// При переезде с Vercel меняется ТОЛЬКО этот файл + расписание.
import { type NextRequest } from "next/server";
import { ingestDailyRates } from "@/lib/fx/ingest";

export const runtime = "nodejs";      // ядру нужен service-role клиент
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  // Vercel Cron шлёт `Authorization: Bearer <CRON_SECRET>`.
  if (secret && auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await ingestDailyRates();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Добавить cron в vercel.json**

```json
{
  "regions": ["fra1"],
  "crons": [
    { "path": "/api/cron/fx-rates", "schedule": "0 6 * * *" }
  ]
}
```

> `0 6 * * *` — 06:00 UTC ежедневно (после закрытия банковских операций накануне). На Hobby-тарифе cron всё равно только раз в день — это ровно то, что нужно.

- [ ] **Step 3: Дописать ключ в .env.example**

Добавить строку `CRON_SECRET=` в `.env.example` (после `SUPABASE_SERVICE_ROLE_KEY=`).

- [ ] **Step 4: Changelog + commit**

Запись `[API] /api/cron/fx-rates — ежедневная загрузка курсов (Vercel Cron)`.
```bash
git add src/app/api/cron/fx-rates/route.ts vercel.json .env.example CHANGELOG-SINCE-EXTRACTION.md
git commit -m "feat(fx): cron-роут загрузки курсов + расписание Vercel"
```

- [ ] **Step 5: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: без ошибок.

- [ ] **Step 6: ЧЕКПОИНТ — env-ключи и деплой**

Пользователю: добавить в Vercel Project → Settings → Environment Variables ключ `CRON_SECRET` (любая длинная строка). `SUPABASE_SERVICE_ROLE_KEY` уже есть. После push в `main` дёрнуть роут вручную и проверить ответ:
`curl -H "Authorization: Bearer <CRON_SECRET>" https://asia-petrol-crm.vercel.app/api/cron/fx-rates`
Expected: `{ "ok": true, "nbrk": ~4xx, "nbkr": ~8x, "date": "…" }`; в `fx_rates` появились 2 строки на сегодня.

---

### Task 5: Backfill истории курсов (одноразовый скрипт)

**Files:**
- Create: `scripts/fx-backfill.mjs`
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Consumes: те же URL/парсинг, что ядро, но автономно (Node-скрипт, не импортирует Next-алиасы). Пишет напрямую через `@supabase/supabase-js` service-role.
- Produces: заполненная `fx_rates` по USD/KZT (НБ РК) от самой ранней даты события в БД до сегодня.

- [ ] **Step 1: Написать скрипт**

```js
// scripts/fx-backfill.mjs
// Одноразовый backfill USD/KZT из НБ РК по историческим датам.
// Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/fx-backfill.mjs [--dry]
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY = process.argv.includes("--dry");
if (!URL || !KEY) { console.error("Need SUPABASE URL + SERVICE_ROLE_KEY"); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const fmt = (d) => `${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}.${d.getUTCFullYear()}`;
const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;

async function nbrk(d) {
  const res = await fetch(`https://nationalbank.kz/rss/get_rates.cfm?fdate=${fmt(d)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const m = xml.match(/<item>[\s\S]*?<title>\s*USD\s*<\/title>[\s\S]*?<description>\s*([\d.,]+)\s*<\/description>/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

// Самая ранняя дата события: min по отгрузкам и оплатам.
async function earliest() {
  const q1 = await sb.from("shipment_registry").select("date").not("date","is",null).order("date",{ascending:true}).limit(1);
  const q2 = await sb.from("deal_payments").select("payment_date").not("payment_date","is",null).order("payment_date",{ascending:true}).limit(1);
  const dates = [q1.data?.[0]?.date, q2.data?.[0]?.payment_date].filter(Boolean).sort();
  return dates[0] ? new Date(dates[0] + "T00:00:00Z") : new Date(Date.UTC(2026,0,1));
}

const start = await earliest();
const end = new Date();
console.log(`Backfill USD/KZT ${iso(start)} → ${iso(end)}${DRY ? " (dry)" : ""}`);
let ok = 0, skip = 0;
for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) { skip++; continue; }          // выходные — пропуск, покрываются fallback date<=X
  try {
    const rate = await nbrk(new Date(d));
    if (!rate) { skip++; continue; }
    if (!DRY) {
      const { error } = await sb.from("fx_rates").upsert(
        { date: iso(d), base_currency: "USD", quote_currency: "KZT", rate, source: "nbrk" },
        { onConflict: "date,base_currency,quote_currency" });
      if (error) throw new Error(error.message);
    }
    ok++;
    if (ok % 20 === 0) console.log(`  …${iso(d)} = ${rate}`);
  } catch (e) { console.warn(`  ${iso(d)}: ${e.message}`); skip++; }
  await new Promise((r) => setTimeout(r, 120));               // вежливо к серверу НБ РК
}
console.log(`Готово: ${ok} курсов записано, ${skip} пропущено.`);
```

> KGS-историю скрипт не тянет (у НБ КР нет чистого date-параметра). Если по факту в БД есть KGS-суммы за прошлые даты — забэкфиллить их отдельно/вручную (`source='manual'`); отсутствующие даты покрывает fallback `date <= X` в `fx_rate`.

- [ ] **Step 2: Dry-run локально**

Run: `NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/fx-backfill.mjs --dry`
Expected: печатает диапазон дат и «Готово: N курсов…», без записи. (Требует реальные env — если недоступны локально, этот шаг делает пользователь на чекпоинте.)

- [ ] **Step 3: Changelog + commit**

Запись `[SCRIPT] fx-backfill.mjs — backfill истории USD/KZT`.
```bash
git add scripts/fx-backfill.mjs CHANGELOG-SINCE-EXTRACTION.md
git commit -m "feat(fx): скрипт backfill истории курсов USD/KZT"
```

- [ ] **Step 4: ЧЕКПОИНТ — пользователь запускает backfill**

После Task 1 применён: пользователь (или я, если есть env) запускает `node scripts/fx-backfill.mjs`.
Probe: `SELECT min(date), max(date), count(*) FROM fx_rates WHERE quote_currency='KZT';` → диапазон от ранней даты до сегодня.

---

### Task 6: Миграция 00123 — функции конвертации

**Files:**
- Create: `supabase/migrations/00123_fx_functions.sql`
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Consumes: таблица `fx_rates` (Task 1).
- Produces (SQL):
  - `month_num(text) -> int`
  - `fx_rate(base text, quote text, on_date date) -> numeric`
  - `fx_rate_month(base text, quote text, year int, month int) -> numeric`
  - `fx_convert(amount numeric, from text, to text, on_date date) -> numeric`
  - `fx_convert_month(amount numeric, from text, to text, year int, month int) -> numeric`

- [ ] **Step 1: Написать миграцию**

```sql
-- 00123_fx_functions.sql
-- Конвертация валют для отчётов. Пивот через USD:
--   KZT→USD ÷ курс НБ РК; KGS→USD ÷ курс НБ КР; далее USD→target ×.
-- Нет даты у события → среднемесячный курс (=СРЗНАЧ за месяц).

CREATE OR REPLACE FUNCTION month_num(p TEXT) RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(trim(p))
    WHEN 'январь' THEN 1 WHEN 'февраль' THEN 2 WHEN 'март' THEN 3
    WHEN 'апрель' THEN 4 WHEN 'май' THEN 5 WHEN 'июнь' THEN 6
    WHEN 'июль' THEN 7 WHEN 'август' THEN 8 WHEN 'сентябрь' THEN 9
    WHEN 'октябрь' THEN 10 WHEN 'ноябрь' THEN 11 WHEN 'декабрь' THEN 12
    ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION fx_rate(p_base TEXT, p_quote TEXT, p_date DATE)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT rate FROM fx_rates
   WHERE base_currency = p_base AND quote_currency = p_quote AND date <= p_date
   ORDER BY date DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fx_rate_month(p_base TEXT, p_quote TEXT, p_year INT, p_month INT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT AVG(rate) FROM fx_rates
   WHERE base_currency = p_base AND quote_currency = p_quote
     AND EXTRACT(YEAR FROM date) = p_year AND EXTRACT(MONTH FROM date) = p_month;
$$;

CREATE OR REPLACE FUNCTION fx_convert(p_amount NUMERIC, p_from TEXT, p_to TEXT, p_date DATE)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE v_usd NUMERIC; v_r NUMERIC;
BEGIN
  IF p_amount IS NULL THEN RETURN NULL; END IF;
  IF p_from = p_to THEN RETURN p_amount; END IF;
  IF p_from = 'USD' THEN v_usd := p_amount;
  ELSE
    v_r := fx_rate('USD', p_from, p_date);
    IF v_r IS NULL OR v_r = 0 THEN RETURN NULL; END IF;
    v_usd := p_amount / v_r;
  END IF;
  IF p_to = 'USD' THEN RETURN v_usd; END IF;
  v_r := fx_rate('USD', p_to, p_date);
  IF v_r IS NULL THEN RETURN NULL; END IF;
  RETURN v_usd * v_r;
END $$;

CREATE OR REPLACE FUNCTION fx_convert_month(p_amount NUMERIC, p_from TEXT, p_to TEXT, p_year INT, p_month INT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE v_usd NUMERIC; v_r NUMERIC;
BEGIN
  IF p_amount IS NULL THEN RETURN NULL; END IF;
  IF p_from = p_to THEN RETURN p_amount; END IF;
  IF p_from = 'USD' THEN v_usd := p_amount;
  ELSE
    v_r := fx_rate_month('USD', p_from, p_year, p_month);
    IF v_r IS NULL OR v_r = 0 THEN RETURN NULL; END IF;
    v_usd := p_amount / v_r;
  END IF;
  IF p_to = 'USD' THEN RETURN v_usd; END IF;
  v_r := fx_rate_month('USD', p_to, p_year, p_month);
  IF v_r IS NULL THEN RETURN NULL; END IF;
  RETURN v_usd * v_r;
END $$;
```

- [ ] **Step 2: Changelog + commit**

Запись `[MIGRATION 00123] fx_convert / fx_rate / month_num — функции конвертации (пивот USD, среднемесячный fallback)`.
```bash
git add supabase/migrations/00123_fx_functions.sql CHANGELOG-SINCE-EXTRACTION.md
git commit -m "feat(fx): миграция 00123 — функции конвертации fx_convert"
```

- [ ] **Step 3: ЧЕКПОИНТ — применить + probe**

Пользователь применяет 00123 (после Task 1, Task 5). Probe на известном примере из ТЗ:
```sql
-- если в fx_rates есть USD/KZT на 2026-06-24 ≈ 486.19:
SELECT fx_convert(1100000, 'USD', 'KZT', DATE '2026-06-24');  -- ≈ 534 809 000
SELECT fx_convert(534809000, 'KZT', 'USD', DATE '2026-06-24'); -- ≈ 1 100 000
SELECT fx_convert(1000, 'KGS', 'KZT', CURRENT_DATE);          -- через USD, не NULL если есть оба курса
```

---

### Task 7: Миграция 00124 — RPC отчётов

**Files:**
- Create: `supabase/migrations/00124_fx_reports.sql`
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Consumes: `fx_convert`, `fx_convert_month`, `month_num` (Task 6); таблицы `deals`, `shipment_registry`, `deal_payments`.
- Produces (SQL):
  - `fx_report_flows(p_from date, p_to date) -> TABLE(metric text, deal_type text, year int, month int, usd numeric, kzt numeric)`
  - `fx_report_price(p_from date, p_to date) -> TABLE(deal_code text, deal_type text, snt_date date, loading_date date, supplier_price_usd numeric, supplier_price_kzt numeric, buyer_price_usd numeric, buyer_price_kzt numeric)`

- [ ] **Step 1: Написать миграцию**

```sql
-- 00124_fx_reports.sql
-- RPC под вкладку «Отчёты». Каждая сумма конвертится по своей дате
-- события; нет даты → среднемесячный курс месяца сделки/отгрузки.

CREATE OR REPLACE FUNCTION fx_report_flows(p_from DATE, p_to DATE)
RETURNS TABLE(metric TEXT, deal_type TEXT, year INT, month INT, usd NUMERIC, kzt NUMERIC)
LANGUAGE sql STABLE AS $$
WITH events AS (
  -- Приход: цена поставщика × входящий объём, дата входящего СНТ
  SELECT 'supply_in'::text AS metric, d.deal_type::text AS deal_type,
         (d.supplier_price * r.loading_volume) AS amount,
         d.supplier_currency AS cur, r.loading_date AS ev_date,
         COALESCE(EXTRACT(YEAR FROM r.loading_date)::int, d.year) AS fb_year,
         COALESCE(EXTRACT(MONTH FROM r.loading_date)::int, month_num(d.month)) AS fb_month
    FROM shipment_registry r JOIN deals d ON d.id = r.deal_id
   WHERE r.loading_volume IS NOT NULL AND d.supplier_price IS NOT NULL
  UNION ALL
  -- Исход: цена покупателя × исходящий объём, дата исходящего СНТ
  SELECT 'ship_out', d.deal_type::text,
         (d.buyer_price * r.shipment_volume), d.buyer_currency, r.date,
         COALESCE(EXTRACT(YEAR FROM r.date)::int, d.year),
         COALESCE(EXTRACT(MONTH FROM r.date)::int, month_num(d.month))
    FROM shipment_registry r JOIN deals d ON d.id = r.deal_id
   WHERE r.shipment_volume IS NOT NULL AND d.buyer_price IS NOT NULL
  UNION ALL
  -- Оплаты поставщикам (знак по типу платежа)
  SELECT 'pay_supplier', d.deal_type::text,
         (CASE WHEN p.payment_type IN ('refund','offset') THEN -1 ELSE 1 END) * p.amount,
         COALESCE(p.currency, d.supplier_currency), p.payment_date,
         COALESCE(EXTRACT(YEAR FROM p.payment_date)::int, d.year),
         COALESCE(EXTRACT(MONTH FROM p.payment_date)::int, month_num(d.month))
    FROM deal_payments p JOIN deals d ON d.id = p.deal_id
   WHERE p.side = 'supplier'
  UNION ALL
  -- Оплаты покупателям (поступления от покупателей)
  SELECT 'pay_buyer', d.deal_type::text,
         (CASE WHEN p.payment_type IN ('refund','offset') THEN -1 ELSE 1 END) * p.amount,
         COALESCE(p.currency, d.buyer_currency), p.payment_date,
         COALESCE(EXTRACT(YEAR FROM p.payment_date)::int, d.year),
         COALESCE(EXTRACT(MONTH FROM p.payment_date)::int, month_num(d.month))
    FROM deal_payments p JOIN deals d ON d.id = p.deal_id
   WHERE p.side = 'buyer'
)
SELECT metric, deal_type, fb_year AS year, fb_month AS month,
       SUM(CASE WHEN ev_date IS NOT NULL
                THEN fx_convert(amount, cur, 'USD', ev_date)
                ELSE fx_convert_month(amount, cur, 'USD', fb_year, fb_month) END) AS usd,
       SUM(CASE WHEN ev_date IS NOT NULL
                THEN fx_convert(amount, cur, 'KZT', ev_date)
                ELSE fx_convert_month(amount, cur, 'KZT', fb_year, fb_month) END) AS kzt
  FROM events
 WHERE ev_date IS NULL OR ev_date BETWEEN p_from AND p_to
 GROUP BY metric, deal_type, fb_year, fb_month
 ORDER BY fb_year, fb_month, metric, deal_type;
$$;

CREATE OR REPLACE FUNCTION fx_report_price(p_from DATE, p_to DATE)
RETURNS TABLE(
  deal_code TEXT, deal_type TEXT, snt_date DATE, loading_date DATE,
  supplier_price_usd NUMERIC, supplier_price_kzt NUMERIC,
  buyer_price_usd NUMERIC, buyer_price_kzt NUMERIC
) LANGUAGE sql STABLE AS $$
  SELECT
    d.deal_code, d.deal_type::text, r.date AS snt_date, r.loading_date,
    CASE WHEN COALESCE(r.loading_volume,0) > 0 THEN
      (CASE WHEN r.loading_date IS NOT NULL
            THEN fx_convert(d.supplier_price * r.loading_volume, d.supplier_currency, 'USD', r.loading_date)
            ELSE fx_convert_month(d.supplier_price * r.loading_volume, d.supplier_currency, 'USD', d.year, month_num(d.month)) END
      ) / r.loading_volume END,
    CASE WHEN COALESCE(r.loading_volume,0) > 0 THEN
      (CASE WHEN r.loading_date IS NOT NULL
            THEN fx_convert(d.supplier_price * r.loading_volume, d.supplier_currency, 'KZT', r.loading_date)
            ELSE fx_convert_month(d.supplier_price * r.loading_volume, d.supplier_currency, 'KZT', d.year, month_num(d.month)) END
      ) / r.loading_volume END,
    CASE WHEN COALESCE(r.shipment_volume,0) > 0 THEN
      (CASE WHEN r.date IS NOT NULL
            THEN fx_convert(d.buyer_price * r.shipment_volume, d.buyer_currency, 'USD', r.date)
            ELSE fx_convert_month(d.buyer_price * r.shipment_volume, d.buyer_currency, 'USD', d.year, month_num(d.month)) END
      ) / r.shipment_volume END,
    CASE WHEN COALESCE(r.shipment_volume,0) > 0 THEN
      (CASE WHEN r.date IS NOT NULL
            THEN fx_convert(d.buyer_price * r.shipment_volume, d.buyer_currency, 'KZT', r.date)
            ELSE fx_convert_month(d.buyer_price * r.shipment_volume, d.buyer_currency, 'KZT', d.year, month_num(d.month)) END
      ) / r.shipment_volume END
  FROM shipment_registry r JOIN deals d ON d.id = r.deal_id
  WHERE COALESCE(r.date, r.loading_date) BETWEEN p_from AND p_to
  ORDER BY COALESCE(r.date, r.loading_date), d.deal_code;
$$;

GRANT EXECUTE ON FUNCTION fx_report_flows(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION fx_report_price(DATE, DATE) TO authenticated;
```

- [ ] **Step 2: Changelog + commit**

Запись `[MIGRATION 00124] fx_report_flows / fx_report_price — RPC отчётов (конвертация по дате события, среднемесячный fallback)`.
```bash
git add supabase/migrations/00124_fx_reports.sql CHANGELOG-SINCE-EXTRACTION.md
git commit -m "feat(fx): миграция 00124 — RPC отчётов fx_report_flows/price"
```

- [ ] **Step 3: ЧЕКПОИНТ — применить + probe**

Пользователь применяет 00124. Probe:
```sql
SELECT * FROM fx_report_flows(DATE '2026-01-01', DATE '2026-12-31') LIMIT 20;
SELECT * FROM fx_report_price(DATE '2026-06-01', DATE '2026-07-31') LIMIT 20;
```
Expected: строки с ненулевыми `usd`/`kzt` (для дат, где есть курсы), `kzt ≈ usd × курс`.

---

### Task 8: Слой данных отчётов (TS-хук)

**Files:**
- Create: `src/lib/hooks/use-fx-reports.ts`
- Test: `src/__tests__/fx-report-shape.test.ts`

**Interfaces:**
- Consumes: RPC `fx_report_flows`, `fx_report_price` (Task 7); `createClient` из `@/lib/supabase/client`.
- Produces:
  - типы `FlowRow`, `PriceRow`, `FLOW_METRICS` (порядок/лейблы метрик);
  - `fetchFlows(from: string, to: string): Promise<FlowRow[]>`;
  - `fetchPrice(from: string, to: string): Promise<PriceRow[]>`;
  - `groupFlows(rows: FlowRow[]): { byMetric: Record<string, FlowRow[]>; totals: Record<string, {usd:number;kzt:number}> }` — чистая, тестируемая.

- [ ] **Step 1: Тест на чистую агрегацию (падает)**

```ts
// src/__tests__/fx-report-shape.test.ts
import { describe, it, expect } from "vitest";
import { groupFlows, type FlowRow } from "@/lib/hooks/use-fx-reports";

const rows: FlowRow[] = [
  { metric: "supply_in", deal_type: "KG", year: 2026, month: 6, usd: 100, kzt: 48000 },
  { metric: "supply_in", deal_type: "KZ", year: 2026, month: 6, usd: 50, kzt: 24000 },
  { metric: "pay_buyer", deal_type: "KG", year: 2026, month: 7, usd: 10, kzt: 4800 },
];

describe("groupFlows", () => {
  it("группирует по метрике и считает итоги", () => {
    const g = groupFlows(rows);
    expect(g.byMetric.supply_in).toHaveLength(2);
    expect(g.totals.supply_in).toEqual({ usd: 150, kzt: 72000 });
    expect(g.totals.pay_buyer).toEqual({ usd: 10, kzt: 4800 });
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx vitest run src/__tests__/fx-report-shape.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Реализовать хук**

```ts
// src/lib/hooks/use-fx-reports.ts
"use client";
import { createClient } from "@/lib/supabase/client";

export type FlowRow = { metric: string; deal_type: string; year: number; month: number; usd: number | null; kzt: number | null };
export type PriceRow = {
  deal_code: string; deal_type: string; snt_date: string | null; loading_date: string | null;
  supplier_price_usd: number | null; supplier_price_kzt: number | null;
  buyer_price_usd: number | null; buyer_price_kzt: number | null;
};

export const FLOW_METRICS = [
  { key: "supply_in", label: "Приход (входящее СНТ)" },
  { key: "ship_out", label: "Исход (исходящее СНТ)" },
  { key: "pay_supplier", label: "Оплаты поставщикам" },
  { key: "pay_buyer", label: "Оплаты покупателям" },
] as const;

// database.ts не знает новых RPC (stale types) — узкий структурный каст,
// тот же приём, что в use-user-pref.ts.
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
function rpc(): Rpc {
  return (createClient() as unknown as { rpc: Rpc }).rpc;
}

export async function fetchFlows(from: string, to: string): Promise<FlowRow[]> {
  const { data, error } = await rpc()("fx_report_flows", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? []) as FlowRow[];
}

export async function fetchPrice(from: string, to: string): Promise<PriceRow[]> {
  const { data, error } = await rpc()("fx_report_price", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? []) as PriceRow[];
}

export function groupFlows(rows: FlowRow[]): {
  byMetric: Record<string, FlowRow[]>;
  totals: Record<string, { usd: number; kzt: number }>;
} {
  const byMetric: Record<string, FlowRow[]> = {};
  const totals: Record<string, { usd: number; kzt: number }> = {};
  for (const r of rows) {
    (byMetric[r.metric] ??= []).push(r);
    const t = (totals[r.metric] ??= { usd: 0, kzt: 0 });
    t.usd += r.usd ?? 0;
    t.kzt += r.kzt ?? 0;
  }
  return { byMetric, totals };
}
```

- [ ] **Step 4: Прогнать — зелёный**

Run: `npx vitest run src/__tests__/fx-report-shape.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hooks/use-fx-reports.ts src/__tests__/fx-report-shape.test.ts
git commit -m "feat(fx): слой данных отчётов + groupFlows (TDD)"
```

---

### Task 9: Пункт навигации + страница «Отчёты»

**Files:**
- Modify: `src/lib/constants/nav-items.ts`
- Create: `src/app/(dashboard)/reports/page.tsx`
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Consumes: `fetchFlows`, `fetchPrice`, `FLOW_METRICS` (Task 8). Компоненты таблиц из Task 10/11 — до их готовности страница рендерит заглушку «загрузка…».
- Produces: роут `/reports` с переключателем отчёта и фильтром периода; состояние `report` (`supply_in|ship_out|pay_supplier|pay_buyer|price`), `from`, `to`.

- [ ] **Step 1: Добавить пункт меню**

В `src/lib/constants/nav-items.ts` в импорт `lucide-react` добавить `BarChart3`, и вставить пункт после «Реестр отгрузки»:
```ts
  {
    label: "Отчёты",
    href: "/reports",
    icon: BarChart3,
  },
```

- [ ] **Step 2: Написать страницу-оболочку**

```tsx
// src/app/(dashboard)/reports/page.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { FLOW_METRICS, fetchFlows, fetchPrice, type FlowRow, type PriceRow } from "@/lib/hooks/use-fx-reports";
import { FlowReport } from "@/components/reports/flow-report";
import { PriceReport } from "@/components/reports/price-report";

const REPORTS = [...FLOW_METRICS, { key: "price", label: "Цена (по СНТ)" }] as const;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReportsPage() {
  const [report, setReport] = useState<string>("supply_in");
  const [from, setFrom] = useState(() => ymd(new Date(new Date().getFullYear(), 0, 1)));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [prices, setPrices] = useState<PriceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isPrice = report === "price";

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const load = isPrice
      ? fetchPrice(from, to).then((d) => { if (alive) setPrices(d); })
      : fetchFlows(from, to).then((d) => { if (alive) setFlows(d); });
    load.catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [report, from, to, isPrice]);

  const flowRows = useMemo(() => (flows ?? []).filter((r) => r.metric === report), [flows, report]);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">Отчёты</h1>
      <div className="flex flex-wrap items-center gap-2">
        <select value={report} onChange={(e) => setReport(e.target.value)} className="border rounded px-2 py-1 text-sm">
          {REPORTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <label className="text-sm">с <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1" /></label>
        <label className="text-sm">по <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1" /></label>
      </div>
      {error && <div className="text-sm text-red-600">Ошибка: {error}</div>}
      {loading && <div className="text-sm text-neutral-500">Загрузка…</div>}
      {!loading && !error && (isPrice
        ? <PriceReport rows={prices ?? []} />
        : <FlowReport metric={report} rows={flowRows} />)}
    </div>
  );
}
```

> Стиль здесь минимальный — на шаге интеграции причесать по `DESIGN.md` (цвета/типографика/спейсинг из проекта).

- [ ] **Step 3: Changelog + commit**

Запись `[UI] Вкладка «Отчёты» (/reports) — оболочка + переключатель отчёта и период`.
```bash
git add src/lib/constants/nav-items.ts "src/app/(dashboard)/reports/page.tsx" CHANGELOG-SINCE-EXTRACTION.md
git commit -m "feat(fx): вкладка Отчёты — навигация + оболочка страницы"
```

---

### Task 10: Компонент потокового отчёта `FlowReport`

**Files:**
- Create: `src/components/reports/flow-report.tsx`

**Interfaces:**
- Consumes: `FlowRow`, `groupFlows` (Task 8); `MONTHS_RU` из `@/lib/constants/months-ru`.
- Produces: `<FlowReport metric={string} rows={FlowRow[]} />` — таблица помесячно + сплит KG/KZ/OIL + строка «Итого», суммы в USD и KZT.

- [ ] **Step 1: Написать компонент**

```tsx
// src/components/reports/flow-report.tsx
import { MONTHS_RU } from "@/lib/constants/months-ru";
import type { FlowRow } from "@/lib/hooks/use-fx-reports";

const fmt = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 0 });

const monthLabel = (m: number) => MONTHS_RU[m - 1] ?? String(m);

export function FlowReport({ metric, rows }: { metric: string; rows: FlowRow[] }) {
  void metric;
  if (rows.length === 0) return <div className="text-sm text-neutral-500">Нет данных за период.</div>;

  // Сортировка по (год, месяц, тип сделки).
  const sorted = [...rows].sort(
    (a, b) => a.year - b.year || a.month - b.month || a.deal_type.localeCompare(b.deal_type),
  );
  const totalUsd = rows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const totalKzt = rows.reduce((s, r) => s + (r.kzt ?? 0), 0);

  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="px-3 py-1.5">Период</th>
            <th className="px-3 py-1.5">Тип</th>
            <th className="px-3 py-1.5 text-right">USD</th>
            <th className="px-3 py-1.5 text-right">KZT</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={`${r.year}-${r.month}-${r.deal_type}-${i}`} className="border-b">
              <td className="px-3 py-1.5">{monthLabel(r.month)} {r.year}</td>
              <td className="px-3 py-1.5">{r.deal_type}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.usd)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.kzt)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <td className="px-3 py-1.5" colSpan={2}>Итого</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totalUsd)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totalKzt)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add src/components/reports/flow-report.tsx
git commit -m "feat(fx): компонент потокового отчёта FlowReport"
```

---

### Task 11: Компонент отчёта «Цена» `PriceReport`

**Files:**
- Create: `src/components/reports/price-report.tsx`

**Interfaces:**
- Consumes: `PriceRow` (Task 8).
- Produces: `<PriceReport rows={PriceRow[]} />` — таблица построчно по СНТ: сделка, дата, цена прихода (USD/KZT), цена исхода (USD/KZT).

- [ ] **Step 1: Написать компонент**

```tsx
// src/components/reports/price-report.tsx
import type { PriceRow } from "@/lib/hooks/use-fx-reports";

const fmt = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export function PriceReport({ rows }: { rows: PriceRow[] }) {
  if (rows.length === 0) return <div className="text-sm text-neutral-500">Нет отгрузок за период.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="px-3 py-1.5">Сделка</th>
            <th className="px-3 py-1.5">Тип</th>
            <th className="px-3 py-1.5">Дата исх. СНТ</th>
            <th className="px-3 py-1.5">Дата вх. СНТ</th>
            <th className="px-3 py-1.5 text-right">Цена прих. USD</th>
            <th className="px-3 py-1.5 text-right">Цена прих. KZT</th>
            <th className="px-3 py-1.5 text-right">Цена исх. USD</th>
            <th className="px-3 py-1.5 text-right">Цена исх. KZT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.deal_code}-${i}`} className="border-b">
              <td className="px-3 py-1.5">{r.deal_code}</td>
              <td className="px-3 py-1.5">{r.deal_type}</td>
              <td className="px-3 py-1.5">{r.snt_date ?? "—"}</td>
              <td className="px-3 py-1.5">{r.loading_date ?? "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.supplier_price_usd)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.supplier_price_kzt)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.buyer_price_usd)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.buyer_price_kzt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: tsc + build + commit**

Run: `npx tsc --noEmit && npm run build`
```bash
git add src/components/reports/price-report.tsx
git commit -m "feat(fx): компонент отчёта Цена PriceReport"
```

---

### Task 12: Причёсывание по DESIGN.md, деплой, E2E-проверка

**Files:**
- Modify: `src/app/(dashboard)/reports/page.tsx`, `src/components/reports/*.tsx` (стили под `DESIGN.md`)
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

- [ ] **Step 1: Привести стиль к проекту**

Прочитать `DESIGN.md`; заменить нейтральные классы (`border`, `text-neutral-500`, отступы) на проектные токены/паттерны существующих таблиц (сверить с `registry/page.tsx` и `passport-table.tsx` — цвета шапки, зебра, sticky-заголовок при желании).

- [ ] **Step 2: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: без ошибок.

- [ ] **Step 3: Полный прогон vitest**

Run: `npx vitest run`
Expected: все тесты зелёные (включая fx-parse, fx-ingest, fx-report-shape).

- [ ] **Step 4: Push + деплой**

```bash
git add -A && git commit -m "style(fx): отчёты по DESIGN.md" && git push origin main
```

- [ ] **Step 5: E2E на проде (playwright-проба)**

После деплоя (и применённых миграций 00122–00124 + backfill): залогиниться, открыть `/reports`, переключить все 5 отчётов, проверить:
- потоковые отчёты рендерят строки помесячно + «Итого», суммы в USD и KZT непустые для месяцев с курсами;
- `kzt ≈ usd × курс` за период (сверить с курсом НБ РК на дату);
- «Цена» — построчно по СНТ, приход и исход в обеих валютах;
- возврат/перезачёт уменьшает сумму оплат (проверить сделку с refund).

- [ ] **Step 6: Финальная запись в changelog**

`[FEATURE] Вкладка «Отчёты»: 5 отчётов (Приход/Исход/Оплаты×2/Цена) в USD и KZT на курсах НБ РК/НБ КР.`

---

## Self-Review (выполнено при написании плана)

**Покрытие спеки:**
- Компонент 1 (fx_rates) → Task 1. ✓
- Компонент 2 (портируемая загрузка: ядро/обёртка/backfill) → Tasks 2,3,4,5. ✓
- Компонент 3 (fx_rate/fx_rate_month/fx_convert/fx_convert_month) → Task 6. ✓
- Компонент 4 (fx_report_flows/fx_report_price) → Task 7. ✓
- Компонент 5 (вкладка /reports, 5 отчётов, USD+KZT, помесячно/по типу) → Tasks 8,9,10,11,12. ✓
- Правило changelog → в каждой задаче. ✓
- Пивот через USD, среднемесячный fallback, знак платежа → Task 6/7. ✓

**Типы согласованы:** `FlowRow`/`PriceRow`/`FLOW_METRICS` определены в Task 8, используются в Tasks 9–11 с теми же именами полей; RPC-имена и сигнатуры (`p_from`/`p_to`) совпадают между Task 7 и Task 8; `fx_convert`/`fx_convert_month`/`month_num` из Task 6 вызываются в Task 7 с теми же сигнатурами.

**Плейсхолдеров нет:** весь код приведён целиком; «причёсывание по DESIGN.md» (Task 12) — намеренный шаг интеграции, не заглушка логики.
```

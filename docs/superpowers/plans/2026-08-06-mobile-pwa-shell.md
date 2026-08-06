# Мобильное приложение: оболочка PWA и мобильные представления — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить существующий десктопный CRM в устанавливаемое на домашний экран приложение с мобильными представлениями паспорта, реестра и ДТ-КТ и с чтением данных без сети.

**Architecture:** Приложение остаётся обычным развёрнутым Next.js — статический экспорт не нужен. Добавляются четыре независимых слоя: манифест с иконками, собственный сервис-воркер для офлайн-старта, сохранение существующих кэшей в IndexedDB и мобильный каркас с нижними вкладками. Мобильные экраны — это компоненты-близнецы, которым отдают тот же готовый массив данных, что и десктопным таблицам; логика фильтрации и загрузки не дублируется.

**Tech Stack:** Next.js 16.2.2 (App Router), React, TypeScript, Supabase JS (RLS), Tailwind, `@tanstack/react-virtual`, `nuqs`, vitest, Playwright, `sharp` (уже есть транзитивно через Next).

**Спека:** `docs/superpowers/specs/2026-08-06-mobile-pwa-shell-design.md`

## Global Constraints

- Доставка — **PWA**, не Capacitor. Статический экспорт (`output: "export"`) не вводится, `/deals/[id]` не трогаем.
- Офлайн — **только чтение**. Любая правка требует сети; в офлайн-режиме элементы ввода заблокированы.
- Порог мобильного режима — **768 пикселей** (`< md`). Шире 768 поведение не меняется вообще, включая планшеты.
- Цвет темы — `#f59e0b`, фон — `#fafaf9` (существующие цвета интерфейса).
- Вкладок в этой версии **четыре**: Главная · Сделки · Реестр · Ещё. Вкладка «Чаты» появится следующей спекой — пустое место под неё сейчас не рисуем.
- Язык интерфейса русский. Плотность десктопных таблиц не ухудшать (`.claude/rules/ui.md`).
- **Выход из системы обязан стирать все данные пользователя с устройства** — IndexedDB, кэши навигации в сервис-воркере и сохранённые рабочие вкладки.
- Серверная авторизация живёт в `src/proxy.ts` (в Next 16 middleware называется proxy). Его матчер не исключает `.js` и `.webmanifest` — файлы PWA нужно вывести из-под него явно.
- **Состояние lint на старте: 189 ошибок** двух отложенных категорий (`react-hooks/refs` — 154, `react-hooks/set-state-in-effect` — 35). Это унаследованный долг, зафиксированный решением владельца. Из-за него `npm run verify` падает на шаге lint. **Критерий приёмки каждой задачи — не «lint зелёный», а «новых ошибок не добавилось»**: сравнивать число до и после. По этой же причине новые компоненты не должны использовать `useRef`, читаемый во время рендера, и `setState` в эффекте — иначе счётчик вырастет.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `scripts/generate-pwa-icons.mjs` | Разовая генерация PNG-иконок из SVG-знака |
| `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | Иконки приложения |
| `src/app/manifest.ts` | Манифест как маршрут Next |
| `public/sw.js` | Сервис-воркер: кэш статики и оболочки |
| `src/components/pwa/service-worker-registrar.tsx` | Регистрация воркера и плашка обновления |
| `src/lib/offline/persist-policy.ts` | **Чистая** политика: что сохранять, ключи, срок годности |
| `src/lib/offline/idb-store.ts` | Тонкая обёртка над IndexedDB |
| `src/lib/offline/cache-bridge.ts` | Связка существующих кэшей с хранилищем + отметка времени |
| `src/lib/offline/offline-mode.ts` | **Чистое** решение «пускать в офлайн или на форму входа» |
| `src/lib/offline/wipe.ts` | Полная очистка данных устройства при выходе |
| `src/lib/hooks/use-is-mobile.ts` | Порог 768 через `useSyncExternalStore` |
| `src/components/mobile/bottom-tabs.tsx` | Нижняя панель вкладок |
| `src/components/mobile/offline-banner.tsx` | Плашка «нет сети, данные от …» |
| `src/components/mobile/deal-card-list.tsx` | Список карточек сделок (виртуализованный) |
| `src/components/mobile/deal-filters-sheet.tsx` | Фильтры в выдвижной панели |
| `src/components/mobile/registry-card-list.tsx` | Реестр карточками |
| `src/components/mobile/dtkt-card-list.tsx` | ДТ-КТ карточками |
| `src/app/(dashboard)/mobile-home/page.tsx` | Экран «Главная» |

Правятся: `src/app/layout.tsx` (viewport, регистратор), `src/app/(dashboard)/layout.tsx` (каркас), `src/proxy.ts` (исключения), `src/components/layout/top-bar.tsx` (очистка при выходе), `src/components/layout/auth-guard.tsx` (офлайн), `src/app/(dashboard)/deals/page.tsx`, `registry/page.tsx`, `dt-kt/page.tsx` (подстановка мобильных видов).

---

### Task 1: Иконки и манифест

**Files:**
- Create: `scripts/generate-pwa-icons.mjs`, `public/pwa-icon.svg`, `src/app/manifest.ts`
- Modify: `src/app/layout.tsx` (экспорт `viewport`), `src/proxy.ts:47-52` (матчер)
- Test: `src/__tests__/pwa-manifest.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: маршрут `/manifest.webmanifest`; файлы `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png`, `/apple-touch-icon.png`; экспорт `viewport` из корневого макета.

- [ ] **Step 1: Написать падающий тест**

Создать `src/__tests__/pwa-manifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";

/**
 * Манифест — единственное, что делает приложение устанавливаемым.
 * Проверяем поля, без которых браузер не предложит установку:
 * name, start_url, display: standalone и иконки 192 + 512.
 */
describe("PWA-манифест", () => {
  const m = manifest();

  it("имя и режим отображения заданы", () => {
    expect(m.name).toBe("Singularity Trading CRM");
    expect(m.short_name).toBe("Singularity");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.lang).toBe("ru");
  });

  it("цвета совпадают с интерфейсом", () => {
    expect(m.theme_color).toBe("#f59e0b");
    expect(m.background_color).toBe("#fafaf9");
  });

  it("есть иконки 192 и 512, включая маскируемую", () => {
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const maskable = (m.icons ?? []).filter((i) => i.purpose === "maskable");
    expect(maskable.length).toBeGreaterThan(0);
  });

  it("ориентация не зафиксирована — планшет должен уметь альбомную", () => {
    expect(m.orientation).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

```bash
npm test -- src/__tests__/pwa-manifest.test.ts
```

Ожидание: FAIL — `Failed to resolve import "@/app/manifest"`.

- [ ] **Step 3: Нарисовать знак**

Создать `public/pwa-icon.svg` — тот же знак, что в боковом меню: контуры `Fuel` из `lucide-react` на янтарном градиенте, скруглённый квадрат.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fbbf24"/>
      <stop offset="1" stop-color="#d97706"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <g transform="translate(256 256) scale(13.5) translate(-12 -12)"
     fill="none" stroke="#ffffff" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5"/>
    <path d="M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16"/>
    <path d="M2 21h13"/>
    <path d="M3 9h11"/>
  </g>
</svg>
```

- [ ] **Step 4: Написать генератор PNG**

Создать `scripts/generate-pwa-icons.mjs`. `sharp` уже установлен транзитивно через Next — отдельная зависимость не нужна.

```js
// Генерация иконок PWA из public/pwa-icon.svg.
// Запуск: node scripts/generate-pwa-icons.mjs
//
// Маскируемая иконка рисуется с полями: Android обрезает её в круг,
// и знак без отступов потеряет края. Безопасная зона — центральные
// 80% холста, поэтому знак ужимается до 320 из 512.
import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/pwa-icon.svg");

await sharp(svg).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(svg).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(svg).resize(180, 180).png().toFile("public/apple-touch-icon.png");

await sharp({
  create: { width: 512, height: 512, channels: 4, background: "#d97706" },
})
  .composite([{ input: await sharp(svg).resize(320, 320).png().toBuffer(), gravity: "centre" }])
  .png()
  .toFile("public/icon-maskable-512.png");

console.log("Иконки PWA сгенерированы в public/");
```

Выполнить:

```bash
node scripts/generate-pwa-icons.mjs
ls -la public/icon-192.png public/icon-512.png public/icon-maskable-512.png public/apple-touch-icon.png
```

- [ ] **Step 5: Написать манифест**

Создать `src/app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

/**
 * Манифест отдаётся Next как маршрут /manifest.webmanifest — отдельный
 * файл в public/ не нужен.
 *
 * orientation НЕ задаём намеренно: мобильный режим включается только
 * уже 768px, а на планшете альбомная ориентация — основной сценарий.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Singularity Trading CRM",
    short_name: "Singularity",
    description: "CRM и управление сделками Singularity Trading",
    lang: "ru",
    display: "standalone",
    start_url: "/",
    theme_color: "#f59e0b",
    background_color: "#fafaf9",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

- [ ] **Step 6: Добавить метатеги окна**

В `src/app/layout.tsx` рядом с существующим `export const metadata` добавить:

```ts
import type { Metadata, Viewport } from "next";

// viewport-fit=cover обязателен: без него на телефонах с вырезом
// интерфейс уезжает под чёлку, а нижняя панель вкладок — под полосу
// жестов. Отступы берём через env(safe-area-inset-*).
export const viewport: Viewport = {
  themeColor: "#f59e0b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
```

Строку импорта `import type { Metadata } from "next";` заменить на строку с `Viewport`.

- [ ] **Step 7: Вывести файлы PWA из-под серверной авторизации**

В `src/proxy.ts` матчер сейчас пропускает через авторизацию всё, кроме статики и картинок. Манифест и воркер туда не попадают и будут редиректиться на `/login`.

Заменить `matcher` (строки 47–52) на:

```ts
export const config = {
  matcher: [
    // Skip static assets, image optimisation, and RSC data paths.
    // sw.js / manifest.webmanifest / иконки PWA обязаны отдаваться без
    // редиректа на /login — иначе браузер не зарегистрирует воркер и
    // не предложит установку.
    "/((?!_next/static|_next/image|_next/data|favicon.ico|sw\\.js|manifest\\.webmanifest|icon-|apple-touch-icon|pwa-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 8: Запустить тест и проверить отдачу**

```bash
npm test -- src/__tests__/pwa-manifest.test.ts
npm run typecheck
```

Ожидание: PASS, 4 теста; типы чистые.

Затем поднять `npm run dev` и проверить:

```bash
curl -s -o /dev/null -w "manifest: %{http_code}\n" http://localhost:3000/manifest.webmanifest
curl -s -o /dev/null -w "icon: %{http_code}\n" http://localhost:3000/icon-192.png
```

Ожидание: оба `200`, а не `307` (редирект на `/login`).

- [ ] **Step 9: Коммит**

```bash
git add scripts/generate-pwa-icons.mjs public/pwa-icon.svg public/icon-*.png public/apple-touch-icon.png src/app/manifest.ts src/app/layout.tsx src/proxy.ts src/__tests__/pwa-manifest.test.ts
git commit -m "feat(pwa): манифест, иконки и метатеги окна"
```

---

### Task 2: Сервис-воркер и офлайн-старт

**Files:**
- Create: `public/sw.js`, `src/components/pwa/service-worker-registrar.tsx`
- Modify: `src/app/layout.tsx` (монтаж регистратора)

**Interfaces:**
- Consumes: исключения матчера из Task 1.
- Produces: кэши `sw-static-v1` (статика) и `sw-pages-v1` (навигация) — их имена читает `wipe.ts` в Task 4; компонент `<ServiceWorkerRegistrar />`.

- [ ] **Step 1: Написать воркер**

Создать `public/sw.js`:

```js
// Сервис-воркер приложения. Пишем руками, без библиотек: задача узкая —
// три правила, и обёртки вроде next-pwa тянули бы зависимость и
// build-шаг ради этого.
//
// Имена кэшей читает src/lib/offline/wipe.ts при выходе из системы —
// менять их только вместе с ним.
const STATIC_CACHE = "sw-static-v1";
const PAGES_CACHE = "sw-pages-v1";
const KEEP = [STATIC_CACHE, PAGES_CACHE];

self.addEventListener("install", (event) => {
  // Не ждём закрытия старых вкладок: обновление воркера пользователь
  // подтверждает сам плашкой (см. service-worker-registrar.tsx).
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase и прочее не трогаем

  // Статика Next содержит хеш в имени и неизменна — сначала кэш.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        return res;
      })),
    );
    return;
  }

  // Навигация — сначала сеть, при отказе кэш. Свежесть важнее, но
  // приложение обязано открыться без связи.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGES_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? caches.match("/"))),
    );
  }
});
```

- [ ] **Step 2: Написать регистратор**

Создать `src/components/pwa/service-worker-registrar.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Регистрирует сервис-воркер и предлагает обновление.
 *
 * Принудительно перезагружать страницу нельзя: оператор может стоять
 * в середине правки оплаты. Показываем плашку, решение за человеком.
 */
export function ServiceWorkerRegistrar() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;

    navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (cancelled) return;
      if (reg.waiting) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener("statechange", () => {
          if (next.state === "installed" && navigator.serviceWorker.controller) {
            setWaiting(next);
          }
        });
      });
    }).catch(() => { /* регистрация недоступна — приложение работает как обычно */ });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!waiting) return;
    toast("Доступно обновление", {
      duration: Infinity,
      action: {
        label: "Перезагрузить",
        onClick: () => {
          waiting.postMessage("SKIP_WAITING");
          window.location.reload();
        },
      },
    });
  }, [waiting]);

  return null;
}
```

- [ ] **Step 3: Смонтировать регистратор**

В `src/app/layout.tsx` внутри `<NuqsAdapter>`, рядом с `<Toaster …/>`, добавить:

```tsx
<ServiceWorkerRegistrar />
```

и импорт:

```tsx
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
```

- [ ] **Step 4: Проверить в браузере**

```bash
npm run build && npm run start
```

Сервис-воркер регистрируется и в dev, но кэш статики в dev-режиме бессмысленен (файлы без хешей и постоянно меняются) — проверять надо на собранном приложении.

В браузере: открыть приложение, войти, зайти на `/deals`. Затем в инструментах разработчика вкладка Application → Service Workers — воркер `activated`. Дальше Application → Cache Storage — появились `sw-static-v1` и `sw-pages-v1`.

Затем включить Network → Offline и перезагрузить страницу. Ожидание: **страница открывается** (данных пока нет — они появятся после Task 3), вместо ошибки браузера «нет соединения».

- [ ] **Step 5: Проверить, что lint не вырос**

```bash
npx eslint . 2>&1 | tail -2
```

Ожидание: 189 ошибок, как было. Если больше — исправить новый код (скорее всего `set-state-in-effect` в регистраторе; тогда перенести показ плашки в колбэк `statechange`, не заводя состояние).

- [ ] **Step 6: Коммит**

```bash
git add public/sw.js src/components/pwa/service-worker-registrar.tsx src/app/layout.tsx
git commit -m "feat(pwa): сервис-воркер и офлайн-старт оболочки"
```

---

### Task 3: Сохранение кэшей между запусками

**Files:**
- Create: `src/lib/offline/persist-policy.ts`, `src/lib/offline/idb-store.ts`, `src/lib/offline/cache-bridge.ts`
- Test: `src/__tests__/persist-policy.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `PERSIST_TTL_MS: number`
  - `type PersistKind = "deals" | "deal" | "refs" | "registry"`
  - `persistKey(kind: PersistKind, id?: string): string`
  - `isPersistable(kind: string): kind is PersistKind`
  - `type PersistedEnvelope<T> = { data: T; ts: number; userId: string }`
  - `isEnvelopeUsable(env: PersistedEnvelope<unknown> | null, userId: string, now: number): boolean`
  - `idbGet<T>(key: string): Promise<PersistedEnvelope<T> | null>`, `idbPut(key, env)`, `idbClear(): Promise<void>`
  - `setPersistUser(userId: string | null): void`
  - `persistCache<T>(kind: PersistKind, id: string | undefined, data: T): void`
  - `hydrateCache<T>(kind: PersistKind, id: string | undefined): Promise<T | null>`
  - `lastSyncAt(): number | null`

- [ ] **Step 1: Написать падающий тест политики**

Создать `src/__tests__/persist-policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PERSIST_TTL_MS, persistKey, isPersistable, isEnvelopeUsable,
} from "@/lib/offline/persist-policy";

/**
 * Политика сохранения — чистый модуль без обращений к браузеру,
 * поэтому проверяется обычными тестами. Ввод-вывод в IndexedDB
 * проверяется в браузере (см. Task 3, шаг 6).
 */
describe("persistKey", () => {
  it("списочные виды не требуют идентификатора", () => {
    expect(persistKey("deals")).toBe("deals");
    expect(persistKey("refs")).toBe("refs");
  });

  it("поштучные виды включают идентификатор", () => {
    expect(persistKey("deal", "abc-123")).toBe("deal:abc-123");
  });
});

describe("isPersistable", () => {
  it("пропускает разрешённые виды", () => {
    expect(isPersistable("deals")).toBe(true);
    expect(isPersistable("registry")).toBe(true);
  });

  it("отчёты и выгрузки не сохраняются — им нужны свежие курсы", () => {
    expect(isPersistable("reports")).toBe(false);
    expect(isPersistable("fx")).toBe(false);
  });
});

describe("isEnvelopeUsable", () => {
  const now = 1_800_000_000_000;

  it("свежие данные того же пользователя годны", () => {
    expect(isEnvelopeUsable({ data: [], ts: now - 1000, userId: "u1" }, "u1", now)).toBe(true);
  });

  it("данные ЧУЖОГО пользователя не годны никогда", () => {
    expect(isEnvelopeUsable({ data: [], ts: now, userId: "u2" }, "u1", now)).toBe(false);
  });

  it("просроченные данные не годны", () => {
    expect(isEnvelopeUsable({ data: [], ts: now - PERSIST_TTL_MS - 1, userId: "u1" }, "u1", now)).toBe(false);
  });

  it("пустое хранилище не годно", () => {
    expect(isEnvelopeUsable(null, "u1", now)).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
npm test -- src/__tests__/persist-policy.test.ts
```

Ожидание: FAIL — `Failed to resolve import "@/lib/offline/persist-policy"`.

- [ ] **Step 3: Написать политику**

Создать `src/lib/offline/persist-policy.ts`:

```ts
/**
 * Политика сохранения кэшей на устройство.
 *
 * Чистый модуль: никаких обращений к браузеру, только правила. Что
 * сохранять, под каким ключом и когда сохранённое считать пригодным.
 *
 * Отчёты и валютные пересчёты сюда НЕ входят намеренно: они требуют
 * свежих курсов, и показать их из вчерашнего кэша опаснее, чем не
 * показать вовсе.
 */
export const PERSIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // неделя

const KINDS = ["deals", "deal", "refs", "registry"] as const;
export type PersistKind = (typeof KINDS)[number];

export function isPersistable(kind: string): kind is PersistKind {
  return (KINDS as readonly string[]).includes(kind);
}

export function persistKey(kind: PersistKind, id?: string): string {
  return id ? `${kind}:${id}` : kind;
}

export type PersistedEnvelope<T> = {
  data: T;
  /** Когда данные получены с сервера. Показывается как «данные от 14:32». */
  ts: number;
  /** Чьи это данные. RLS фильтрует на сервере — на устройстве проверяем сами. */
  userId: string;
};

export function isEnvelopeUsable(
  env: PersistedEnvelope<unknown> | null,
  userId: string,
  now: number,
): boolean {
  if (!env) return false;
  if (env.userId !== userId) return false;          // чужие данные — никогда
  return now - env.ts <= PERSIST_TTL_MS;
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
npm test -- src/__tests__/persist-policy.test.ts
```

Ожидание: PASS, 8 тестов.

- [ ] **Step 5: Написать хранилище и мост**

Создать `src/lib/offline/idb-store.ts`:

```ts
/**
 * Тонкая обёртка над IndexedDB. Ровно четыре операции, без библиотек.
 * Все ошибки гасятся: приватный режим и переполнение квоты не должны
 * ронять приложение — офлайн-чтение это удобство, а не обязанность.
 */
import type { PersistedEnvelope } from "@/lib/offline/persist-policy";

const DB_NAME = "asia-petrol-offline";
const STORE = "cache";
const DB_VERSION = 1;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function idbGet<T>(key: string): Promise<PersistedEnvelope<T> | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as PersistedEnvelope<T>) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function idbPut<T>(key: string, env: PersistedEnvelope<T>): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(env, key);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

export async function idbClear(): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}
```

Создать `src/lib/offline/cache-bridge.ts`:

```ts
/**
 * Мост между существующими кэшами в памяти и хранилищем устройства.
 *
 * Существующая логика кэширования (use-deals, use-deal-lines, refs)
 * НЕ переписывается: мост только зеркалит записи и поднимает их при
 * старте. Запись асинхронная и «отпущенная» — она не должна
 * задерживать отрисовку.
 */
import {
  isEnvelopeUsable, persistKey, type PersistKind, type PersistedEnvelope,
} from "@/lib/offline/persist-policy";
import { idbGet, idbPut } from "@/lib/offline/idb-store";

let lastSync: number | null = null;

// Идентификатор пользователя держим здесь, а не тащим параметром через
// всю цепочку загрузки: fetchDealsList — модульная функция без доступа
// к профилю, и протаскивание userId через неё зацепило бы prefetchDeals
// и все вызовы. Значение ставит <PersistUserBinder/> при монтировании.
let currentUserId: string | null = null;

export function setPersistUser(userId: string | null): void {
  currentUserId = userId;
}

/** Время самых свежих поднятых или сохранённых данных. Для плашки «данные от 14:32». */
export function lastSyncAt(): number | null {
  return lastSync;
}

export function persistCache<T>(kind: PersistKind, id: string | undefined, data: T): void {
  if (!currentUserId) return;          // до входа сохранять нечего и некому
  const ts = Date.now();
  lastSync = ts;
  void idbPut(persistKey(kind, id), { data, ts, userId: currentUserId });
}

export async function hydrateCache<T>(kind: PersistKind, id?: string): Promise<T | null> {
  if (!currentUserId) return null;
  const env = await idbGet<T>(persistKey(kind, id));
  if (!isEnvelopeUsable(env as PersistedEnvelope<unknown> | null, currentUserId, Date.now())) {
    return null;
  }
  const hit = env as PersistedEnvelope<T>;
  if (lastSync === null || hit.ts > lastSync) lastSync = hit.ts;
  return hit.data;
}
```

- [ ] **Step 6: Сообщить мосту, кто вошёл**

Создать `src/components/pwa/persist-user-binder.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRole } from "@/lib/hooks/use-role";
import { setPersistUser } from "@/lib/offline/cache-bridge";

/**
 * Отдаёт мосту идентификатор вошедшего пользователя. Отдельный
 * компонент, а не вызов внутри хука загрузки: сохранение кэша не
 * должно зависеть от того, какая страница открыта.
 */
export function PersistUserBinder() {
  const { profile } = useRole();
  useEffect(() => {
    setPersistUser(profile?.id ?? null);
  }, [profile?.id]);
  return null;
}
```

Смонтировать в `src/app/(dashboard)/layout.tsx` внутри `<RoleProvider>`, рядом с `<AuthGuard>`.

- [ ] **Step 7: Подключить мост к кэшу сделок**

В `src/lib/hooks/use-deals.ts` найти строку записи кэша в `fetchDealsList` (около строки 633):

```ts
  dealsCache.set(cacheKey, { promise: null, data: rows, total, ts: Date.now() });
```

Добавить сразу после неё:

```ts
  // Зеркалим на устройство: список года — то, что нужно увидеть
  // первым делом при запуске без сети. Запись «отпущенная», отрисовку
  // не задерживает.
  persistCache("deals", cacheKey, rows);
```

и импорт в шапке файла:

```ts
import { persistCache, hydrateCache } from "@/lib/offline/cache-bridge";
```

Подъём при старте — в `useDeals`, рядом с существующим эффектом загрузки:

```ts
  // Без сети сетевой запрос не состоится, и список останется пустым.
  // Поднимаем сохранённый снимок, чтобы приложение открылось с данными.
  useEffect(() => {
    if (navigator.onLine) return;
    let cancelled = false;
    hydrateCache<Deal[]>("deals", cacheKey).then((rows) => {
      if (!cancelled && rows) setData(rows);
    });
    return () => { cancelled = true; };
  }, [cacheKey]);
```

- [ ] **Step 8: Проверить в браузере**

На собранном приложении открыть `/deals`, дождаться загрузки. В инструментах разработчика Application → IndexedDB → `asia-petrol-offline` → `cache` должна появиться запись с ключом `deals:<cacheKey>` и полями `data`, `ts`, `userId`.

Затем Network → Offline и перезагрузка: список сделок отрисовывается из хранилища.

- [ ] **Step 9: Проверить и закоммитить**

```bash
npm test -- src/__tests__/persist-policy.test.ts && npm run typecheck && npx eslint . 2>&1 | tail -2
```

Ожидание: тесты проходят, типы чистые, lint по-прежнему 189.

```bash
git add src/lib/offline/ src/components/pwa/persist-user-binder.tsx src/lib/hooks/use-deals.ts "src/app/(dashboard)/layout.tsx" src/__tests__/persist-policy.test.ts
git commit -m "feat(offline): сохранение кэшей на устройство и подъём при старте"
```

---

### Task 4: Очистка устройства при выходе

**Files:**
- Create: `src/lib/offline/wipe.ts`
- Modify: `src/components/layout/top-bar.tsx:47-52` (выход)
- Test: `src/__tests__/wipe-targets.test.ts`

**Interfaces:**
- Consumes: `idbClear` (Task 3), имена кэшей `sw-static-v1` / `sw-pages-v1` (Task 2).
- Produces: `DATA_CACHE_NAMES: string[]`, `LOCAL_KEYS_WITH_DATA: string[]`, `wipeDeviceData(): Promise<void>`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/__tests__/wipe-targets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DATA_CACHE_NAMES, LOCAL_KEYS_WITH_DATA } from "@/lib/offline/wipe";

/**
 * Телефон может быть передан другому сотруднику. Всё, что содержит
 * данные пользователя, обязано стираться при выходе — а кэш статики,
 * наоборот, обязан оставаться: он одинаков для всех и его повторная
 * загрузка стоит трафика.
 */
describe("Что стирается при выходе", () => {
  it("кэш навигации стирается — там HTML авторизованного приложения", () => {
    expect(DATA_CACHE_NAMES).toContain("sw-pages-v1");
  });

  it("кэш статики НЕ стирается — данных не содержит", () => {
    expect(DATA_CACHE_NAMES).not.toContain("sw-static-v1");
  });

  it("рабочие вкладки стираются — в них коды и id сделок", () => {
    expect(LOCAL_KEYS_WITH_DATA).toContain("asia-petrol-tabs-v1");
  });

  it("настройка свёрнутости меню остаётся — это не данные", () => {
    expect(LOCAL_KEYS_WITH_DATA).not.toContain("asia-petrol-sidebar-collapsed-v1");
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
npm test -- src/__tests__/wipe-targets.test.ts
```

Ожидание: FAIL — модуль не найден.

- [ ] **Step 3: Написать очистку**

Создать `src/lib/offline/wipe.ts`:

```ts
/**
 * Полная очистка данных пользователя с устройства.
 *
 * Вызывается при выходе из системы и при входе другого пользователя.
 * Требование безопасности из спеки: телефон могут передать коллеге, а
 * в хранилище лежат балансы, оплаты и коды сделок.
 *
 * Кэш статики (sw-static-v1) сознательно НЕ трогаем — он одинаков для
 * всех пользователей и не содержит данных.
 */
import { idbClear } from "@/lib/offline/idb-store";

export const DATA_CACHE_NAMES = ["sw-pages-v1"];

export const LOCAL_KEYS_WITH_DATA = [
  "asia-petrol-tabs-v1",   // открытые рабочие вкладки: коды и id сделок
];

export async function wipeDeviceData(): Promise<void> {
  await idbClear();

  if (typeof caches !== "undefined") {
    await Promise.all(DATA_CACHE_NAMES.map((n) => caches.delete(n).catch(() => false)));
  }

  for (const key of LOCAL_KEYS_WITH_DATA) {
    try { window.localStorage.removeItem(key); } catch { /* приватный режим */ }
  }
}
```

- [ ] **Step 4: Подключить к выходу**

В `src/components/layout/top-bar.tsx` заменить `handleLogout` на:

```tsx
  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Стираем данные ДО перехода: телефон могут передать коллеге, а в
    // хранилище лежат балансы, оплаты и коды сделок.
    await wipeDeviceData();
    router.push("/login");
  }
```

и добавить импорт:

```tsx
import { wipeDeviceData } from "@/lib/offline/wipe";
```

- [ ] **Step 5: Очистить при входе другого пользователя**

Выход не единственный путь: сеанс может оборваться, и на том же телефоне войдёт коллега. Чтение уже защищено (`hydrateCache` отказывает по `userId`), но спека требует именно **стирать**, а не просто не показывать.

В `src/components/pwa/persist-user-binder.tsx` (создан в Task 3) заменить эффект на:

```tsx
  const { profile } = useRole();
  useEffect(() => {
    const id = profile?.id ?? null;
    if (!id) { setPersistUser(null); return; }

    const prev = window.localStorage.getItem(LAST_USER_KEY);
    if (prev && prev !== id) {
      // На устройстве данные другого сотрудника — стираем до загрузки.
      void wipeDeviceData();
    }
    try { window.localStorage.setItem(LAST_USER_KEY, id); } catch { /* приватный режим */ }
    setPersistUser(id);
  }, [profile?.id]);
```

с константой в шапке файла:

```tsx
const LAST_USER_KEY = "asia-petrol-last-user-v1";
```

и импортом `wipeDeviceData` из `@/lib/offline/wipe`.

Ключ `asia-petrol-last-user-v1` содержит только идентификатор и в `LOCAL_KEYS_WITH_DATA` не входит намеренно: он и должен пережить выход, иначе сравнивать будет не с чем.

- [ ] **Step 6: Проверить в браузере**

На собранном приложении: войти, открыть `/deals`, убедиться что в IndexedDB есть запись. Нажать «Выйти». Открыть Application → IndexedDB — база `asia-petrol-offline` пуста; Cache Storage — `sw-pages-v1` отсутствует, `sw-static-v1` на месте; localStorage — ключа `asia-petrol-tabs-v1` нет, `asia-petrol-sidebar-collapsed-v1` остался, `asia-petrol-last-user-v1` остался.

Затем войти под другим пользователем и убедиться, что в IndexedDB нет записей от первого.

- [ ] **Step 7: Коммит**

```bash
npm test -- src/__tests__/wipe-targets.test.ts && npm run typecheck
git add src/lib/offline/wipe.ts src/components/layout/top-bar.tsx src/components/pwa/persist-user-binder.tsx src/__tests__/wipe-targets.test.ts
git commit -m "feat(offline): очистка данных устройства при выходе и смене пользователя"
```

---

### Task 5: Режим чтения без сети

**Files:**
- Create: `src/lib/offline/offline-mode.ts`, `src/components/mobile/offline-banner.tsx`
- Modify: `src/components/layout/auth-guard.tsx`
- Test: `src/__tests__/offline-mode.test.ts`

**Interfaces:**
- Consumes: `lastSyncAt()` (Task 3).
- Produces: `shouldStayOffline(input: { online: boolean; hasLocalSession: boolean; sessionExpiresAt: number | null; now: number }): boolean`; компонент `<OfflineBanner />`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/__tests__/offline-mode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldStayOffline } from "@/lib/offline/offline-mode";

/**
 * Без сети Supabase не может обновить токен и присылает SIGNED_OUT.
 * Если поддаться и увести на /login, офлайн-режим не заработает вовсе.
 * Но показывать финансы по ПРОСРОЧЕННОМУ сеансу тоже нельзя.
 */
const now = 1_800_000_000_000;

describe("shouldStayOffline", () => {
  it("нет сети и сеанс ещё жив — остаёмся в приложении", () => {
    expect(shouldStayOffline({
      online: false, hasLocalSession: true, sessionExpiresAt: now + 60_000, now,
    })).toBe(true);
  });

  it("нет сети, но сеанс истёк — на форму входа", () => {
    expect(shouldStayOffline({
      online: false, hasLocalSession: true, sessionExpiresAt: now - 1, now,
    })).toBe(false);
  });

  it("нет сети и сеанса нет — на форму входа", () => {
    expect(shouldStayOffline({
      online: false, hasLocalSession: false, sessionExpiresAt: null, now,
    })).toBe(false);
  });

  it("сеть есть — офлайн-режим не при чём, решает обычная авторизация", () => {
    expect(shouldStayOffline({
      online: true, hasLocalSession: true, sessionExpiresAt: now + 60_000, now,
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
npm test -- src/__tests__/offline-mode.test.ts
```

Ожидание: FAIL — модуль не найден.

- [ ] **Step 3: Написать решение**

Создать `src/lib/offline/offline-mode.ts`:

```ts
/**
 * Единственное правило офлайн-режима, вынесенное в чистую функцию,
 * чтобы его можно было проверить тестами, а не догадками.
 */
export function shouldStayOffline(input: {
  online: boolean;
  hasLocalSession: boolean;
  sessionExpiresAt: number | null;
  now: number;
}): boolean {
  if (input.online) return false;                     // сеть есть — решает обычная авторизация
  if (!input.hasLocalSession) return false;
  if (input.sessionExpiresAt === null) return false;
  return input.sessionExpiresAt > input.now;          // сеанс ещё не истёк
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
npm test -- src/__tests__/offline-mode.test.ts
```

Ожидание: PASS, 4 теста.

- [ ] **Step 5: Научить AuthGuard не выбрасывать офлайн**

В `src/components/layout/auth-guard.tsx` заменить тело подписки:

```tsx
    const { data: { subscription } } = supabaseRef.current.auth.onAuthStateChange(
      async (event, session) => {
        if (event !== "SIGNED_OUT" && session) return;

        // Без сети Supabase не может обновить токен и присылает
        // SIGNED_OUT. Уводить на /login в этот момент нельзя — иначе
        // офлайн-режим не работает вовсе. Показываем кэш, пока сеанс
        // формально не истёк.
        const { data } = await supabaseRef.current.auth.getSession();
        const expiresAt = data.session?.expires_at ? data.session.expires_at * 1000 : null;
        const stay = shouldStayOffline({
          online: navigator.onLine,
          hasLocalSession: !!data.session,
          sessionExpiresAt: expiresAt,
          now: Date.now(),
        });
        if (!stay) router.replace("/login");
      },
    );
```

и импорт `import { shouldStayOffline } from "@/lib/offline/offline-mode";`.

- [ ] **Step 6: Написать плашку**

Создать `src/components/mobile/offline-banner.tsx`:

```tsx
"use client";

import { useSyncExternalStore } from "react";
import { lastSyncAt } from "@/lib/offline/cache-bridge";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

// useSyncExternalStore, а не useState+useEffect: не даёт расхождения
// разметки при гидратации и не добавляет ошибок react-hooks.
const getSnapshot = () => navigator.onLine;
const getServerSnapshot = () => true;

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (online) return null;

  const ts = lastSyncAt();
  const at = ts
    ? new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="bg-amber-100 border-b border-amber-300 px-3 py-1.5 text-[12px] text-amber-900">
      Нет сети{at ? `. Данные от ${at}` : ""}. Изменения недоступны.
    </div>
  );
}
```

- [ ] **Step 7: Показать плашку и заблокировать ввод**

В `src/app/(dashboard)/layout.tsx` смонтировать `<OfflineBanner />` сразу под `<TopBar …/>`.

Блокировка ввода: обернуть область содержимого в контейнер, получающий `pointer-events-none opacity-60` при отсутствии сети (то же значение `useSyncExternalStore`), кроме самой плашки и панели вкладок. Это грубый, но надёжный способ выполнить требование «правки требуют сети» без правки каждого поля.

- [ ] **Step 8: Проверить в браузере**

На собранном приложении: войти, открыть `/deals`, включить Network → Offline. Ожидание: приложение **остаётся открытым**, сверху появилась плашка «Нет сети. Данные от 14:32. Изменения недоступны», список сделок виден, поля не реагируют на нажатия. Вернуть сеть — плашка исчезает, ввод возвращается.

- [ ] **Step 9: Коммит**

```bash
npm test && npm run typecheck && npx eslint . 2>&1 | tail -2
git add src/lib/offline/offline-mode.ts src/components/mobile/offline-banner.tsx src/components/layout/auth-guard.tsx "src/app/(dashboard)/layout.tsx" src/__tests__/offline-mode.test.ts
git commit -m "feat(offline): режим чтения без сети вместо выброса на форму входа"
```

---

### Task 6: Мобильный каркас и нижние вкладки

**Files:**
- Create: `src/lib/hooks/use-is-mobile.ts`, `src/components/mobile/bottom-tabs.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: ничего.
- Produces: `useIsMobile(): boolean` (истина при ширине < 768); компонент `<BottomTabs />`.

- [ ] **Step 1: Написать хук порога**

Создать `src/lib/hooks/use-is-mobile.ts`:

```ts
"use client";

import { useSyncExternalStore } from "react";

/**
 * Порог мобильного режима — 768px, совпадает с брейкпоинтом `md`
 * в Tailwind. Шире этого поведение приложения не меняется вообще,
 * включая планшеты: существующая таблица паспорта с горизонтальной
 * прокруткой в альбомной ориентации читается нормально.
 *
 * useSyncExternalStore, а не useState+useEffect: серверный снимок
 * (false = десктоп) не расходится с разметкой при гидратации, и
 * правило react-hooks/set-state-in-effect не нарушается.
 */
const QUERY = "(max-width: 767px)";

function subscribe(cb: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;
const getServerSnapshot = () => false;

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

- [ ] **Step 2: Написать панель вкладок**

Создать `src/components/mobile/bottom-tabs.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, ClipboardList, MoreHorizontal } from "lucide-react";

/**
 * Нижняя навигация мобильного режима. Вкладок четыре; пятая «Чаты»
 * появится следующей спекой — пустое место под неё сейчас не рисуем.
 *
 * paddingBottom через env(safe-area-inset-bottom): без него панель
 * уезжает под полосу жестов на телефонах без кнопки «Домой».
 */
const TABS = [
  { href: "/mobile-home", label: "Главная", Icon: LayoutDashboard },
  { href: "/deals", label: "Сделки", Icon: FileText },
  { href: "/registry", label: "Реестр", Icon: ClipboardList },
  { href: "/more", label: "Ещё", Icon: MoreHorizontal },
] as const;

export function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-stone-200 bg-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[9px] ${
              active ? "font-semibold text-amber-700" : "text-stone-400"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: Встроить в каркас**

В `src/app/(dashboard)/layout.tsx` добавить `const isMobile = useIsMobile();` рядом с существующими состояниями и перестроить разметку так:

```tsx
{/* Боковое меню и выдвижная панель — только не на телефоне: там их
    роль берут нижние вкладки. */}
{!isMobile && (
  <>
    <div className="hidden lg:block">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((c) => !c)} />
    </div>
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent side="left" className="w-[260px] p-0 bg-slate-900 border-r-0">
        <Sidebar onNavigate={() => setMobileOpen(false)} />
      </SheetContent>
    </Sheet>
  </>
)}

<div className="flex flex-1 flex-col overflow-hidden">
  <TopBar onMenuClick={() => setMobileOpen(true)} />
  <OfflineBanner />
  {/* Строка рабочих вкладок на телефоне не нужна — навигация внизу. */}
  {!isMobile && <TabBar />}
  {/* pb-14 — чтобы нижняя панель не перекрыла последнюю строку списка. */}
  <div className={`flex-1 overflow-auto ${isMobile ? "pb-14" : ""}`}>
    {children}
  </div>
</div>

{isMobile && <BottomTabs />}
```

Импорты: `useIsMobile`, `BottomTabs`, `OfflineBanner`. Существующие обработчики `mobileOpen` и `sidebarCollapsed` не удалять — они продолжают работать на планшете.

- [ ] **Step 4: Создать заглушку раздела «Ещё»**

Создать `src/app/(dashboard)/more/page.tsx` — список ссылок: ДТ-КТ, Тарифы, Справочник, Настройки, Выйти. Обычный вертикальный список строк с разделителями, тот же стиль, что у карточек.

- [ ] **Step 5: Проверить в браузере**

Открыть приложение в окне 390×844 (в инструментах разработчика режим устройства). Ожидание: бокового меню нет, снизу четыре вкладки, переходы работают, последняя строка списка не спрятана под панелью. Затем растянуть окно шире 768 — вкладки исчезают, возвращается боковое меню, десктоп выглядит как прежде.

- [ ] **Step 6: Коммит**

```bash
npm run typecheck && npx eslint . 2>&1 | tail -2
git add src/lib/hooks/use-is-mobile.ts src/components/mobile/bottom-tabs.tsx "src/app/(dashboard)/layout.tsx" "src/app/(dashboard)/more/page.tsx"
git commit -m "feat(mobile): нижние вкладки и мобильный каркас"
```

---

### Task 7: Экран «Главная»

**Files:**
- Create: `src/app/(dashboard)/mobile-home/page.tsx`
- Test: `src/__tests__/mobile-home-totals.test.ts`
- Create: `src/lib/mobile/home-totals.ts`

**Interfaces:**
- Consumes: тип `Deal` из `@/lib/hooks/use-deals`.
- Produces: `homeTotals(deals: Deal[]): { supplierBalance: number; buyerDebt: number; count: number }`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/__tests__/mobile-home-totals.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { homeTotals } from "@/lib/mobile/home-totals";
import type { Deal } from "@/lib/hooks/use-deals";

const d = (over: Partial<Deal>) => over as Deal;

describe("homeTotals", () => {
  it("складывает балансы и долги, считает сделки", () => {
    expect(homeTotals([
      d({ supplier_balance: 100, buyer_debt: -30 }),
      d({ supplier_balance: -250, buyer_debt: 10 }),
    ])).toEqual({ supplierBalance: -150, buyerDebt: -20, count: 2 });
  });

  it("пустые значения считаются нулём, а не ломают сумму", () => {
    expect(homeTotals([
      d({ supplier_balance: null, buyer_debt: null }),
      d({ supplier_balance: 40, buyer_debt: null }),
    ])).toEqual({ supplierBalance: 40, buyerDebt: 0, count: 2 });
  });

  it("пустой список — нули", () => {
    expect(homeTotals([])).toEqual({ supplierBalance: 0, buyerDebt: 0, count: 0 });
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
npm test -- src/__tests__/mobile-home-totals.test.ts
```

Ожидание: FAIL — модуль не найден.

- [ ] **Step 3: Написать расчёт**

Создать `src/lib/mobile/home-totals.ts`:

```ts
import type { Deal } from "@/lib/hooks/use-deals";

/**
 * Сводка главного экрана. Считается из уже загруженного списка сделок
 * года — дополнительных запросов нет.
 */
export function homeTotals(deals: Deal[]): {
  supplierBalance: number;
  buyerDebt: number;
  count: number;
} {
  let supplierBalance = 0;
  let buyerDebt = 0;
  for (const d of deals) {
    supplierBalance += d.supplier_balance ?? 0;
    buyerDebt += d.buyer_debt ?? 0;
  }
  return { supplierBalance, buyerDebt, count: deals.length };
}
```

- [ ] **Step 4: Написать экран**

Создать `src/app/(dashboard)/mobile-home/page.tsx`: клиентский компонент, берёт сделки текущего года через существующий `useDeals`, считает `homeTotals`, рисует три плитки в сетке два столбца (баланс поставщикам, долг покупателей, сделок за год) и ниже список открытых рабочих вкладок из `useTabs()` как «Продолжить работу» — ссылки на сделки.

Числа — моноширинные, выровнены вправо, отрицательные красным: та же подача, что в таблицах (`.claude/rules/ui.md`).

- [ ] **Step 5: Проверить и закоммитить**

```bash
npm test -- src/__tests__/mobile-home-totals.test.ts && npm run typecheck
```

В браузере в окне 390×844 открыть `/mobile-home`: три плитки с числами, ниже открытые сделки, переход по ним работает.

```bash
git add src/lib/mobile/home-totals.ts "src/app/(dashboard)/mobile-home/page.tsx" src/__tests__/mobile-home-totals.test.ts
git commit -m "feat(mobile): экран «Главная» со сводкой"
```

---

### Task 8: Сделки карточками

**Files:**
- Create: `src/components/mobile/deal-card-list.tsx`
- Modify: `src/app/(dashboard)/deals/page.tsx:838` (подстановка вида)

**Interfaces:**
- Consumes: `useIsMobile()` (Task 6); массив `filtered: Deal[]`, уже вычисленный на странице.
- Produces: `<DealCardList deals={Deal[]} loading={boolean} />`.

- [ ] **Step 1: Написать список карточек**

Создать `src/components/mobile/deal-card-list.tsx`:

```tsx
"use client";

import { useRef } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Deal } from "@/lib/hooks/use-deals";

/**
 * Мобильный вид паспорта: карточка на сделку вместо строки из 43
 * колонок. Данные приходят готовыми — тот же массив `filtered`, что
 * получает PassportTable, поэтому фильтрация и поиск не дублируются.
 *
 * Виртуализация обязательна: сделок за год около 530, и без неё
 * прокрутка на телефоне встанет.
 */
const money = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function DealCard({ deal }: { deal: Deal }) {
  const balance = deal.supplier_balance ?? 0;
  return (
    <Link
      href={`/deals/${deal.id}`}
      className="block rounded-lg border border-stone-200 bg-white px-3 py-2.5 active:bg-stone-50"
    >
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[13px] font-bold text-amber-700">{deal.deal_code}</span>
        <span className="rounded border border-blue-200 bg-blue-50 px-1.5 text-[10px] font-medium text-blue-700">
          {deal.deal_type}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-stone-500">
        {[deal.month, deal.fuel_type?.name, deal.factory?.name].filter(Boolean).join(" · ")}
      </div>
      <div className="mt-2 space-y-0.5 text-[11px]">
        <Row label="Поставщик" value={deal.supplier?.short_name ?? deal.supplier?.full_name ?? "—"} />
        <Row label="Покупатель" value={deal.buyer?.short_name ?? deal.buyer?.full_name ?? "—"} />
      </div>
      <div className="mt-2 space-y-0.5 border-t border-stone-100 pt-1.5 text-[11px]">
        <Num label="Оплата" value={deal.supplier_payment_gross} />
        <Num label="Возврат/Перезачет" value={deal.supplier_refund_total} />
        <Num label="Баланс" value={deal.supplier_balance} negative={balance < 0} />
      </div>
    </Link>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-stone-400">{label}</span>
      <span className="truncate text-stone-700">{value}</span>
    </div>
  );
}

function Num({ label, value, negative }: { label: string; value: number | null | undefined; negative?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-stone-400">{label}</span>
      <span className={`font-mono tabular-nums ${negative ? "font-semibold text-red-700" : "text-stone-800"}`}>
        {money(value)}
      </span>
    </div>
  );
}

export function DealCardList({ deals, loading }: { deals: Deal[]; loading: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: deals.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 168,
    overscan: 6,
  });

  if (loading && deals.length === 0) {
    return <p className="px-3 py-6 text-center text-[12px] text-stone-400">Загрузка…</p>;
  }
  if (deals.length === 0) {
    return <p className="px-3 py-6 text-center text-[12px] text-stone-400">Сделок не найдено</p>;
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto px-3 py-2">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={deals[item.index].id}
            style={{
              position: "absolute", top: 0, left: 0, width: "100%",
              transform: `translateY(${item.start}px)`, paddingBottom: 8,
            }}
          >
            <DealCard deal={deals[item.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

`useRef` здесь используется только как якорь прокрутки для виртуализатора и **не читается во время рендера** — ровно тот же приём, что в `passport-table.tsx:1558`. Счётчик lint от этого не растёт.

- [ ] **Step 2: Подставить вид на странице сделок**

В `src/app/(dashboard)/deals/page.tsx` там, где сейчас рендерится `<PassportTable … deals={filtered} …/>`, разветвить:

```tsx
{isMobile
  ? <DealCardList deals={filtered} loading={loading || isTabSwitching} />
  : <PassportTable … />}
```

`filtered` — уже готовый массив, вся логика фильтрации и поиска переиспользуется как есть.

- [ ] **Step 3: Проверить в браузере**

Окно 390×844, открыть `/deals`. Ожидание: карточки вместо таблицы, прокрутка плавная на всех 530 сделках, тап открывает карточку сделки. Растянуть шире 768 — вернулась таблица, десктоп не изменился.

Проверить на сделке с возвратом (`KG/26/373`): Оплата 143 000,00, Возврат/Перезачет 9 020,00, Баланс 0,00.

- [ ] **Step 4: Коммит**

```bash
npm run typecheck && npx eslint . 2>&1 | tail -2
git add src/components/mobile/deal-card-list.tsx "src/app/(dashboard)/deals/page.tsx"
git commit -m "feat(mobile): список сделок карточками"
```

---

### Task 9: Фильтры в выдвижной панели

**Files:**
- Create: `src/components/mobile/deal-filters-sheet.tsx`
- Modify: `src/app/(dashboard)/deals/page.tsx` (шапка мобильного вида)

**Interfaces:**
- Consumes: существующие состояния фильтров на странице (`useQueryState` из `nuqs`, строки 104–135) — передаются пропсами, новых источников истины не заводится.
- Produces: `<DealFiltersSheet activeCount={number} … />`.

- [ ] **Step 1: Написать панель**

Создать `src/components/mobile/deal-filters-sheet.tsx` на существующем `Sheet` (`@/components/ui/sheet`, side `bottom`). Внутри — те же наборы фильтров, что в десктопной шапке: год, поставщик, покупатель, завод, ГСМ, месяц, экспедитор, группы компаний. Значения и обработчики приходят пропсами со страницы — состояние остаётся в `nuqs`, чтобы выбор сохранялся в адресе и переживал переходы.

- [ ] **Step 2: Собрать мобильную шапку**

В `src/app/(dashboard)/deals/page.tsx` при `isMobile` вместо десктопной панели фильтров рисовать строку: поле поиска на всю ширину (оно важнее фильтров при 530 сделках) и рядом кнопка «Фильтры» со счётчиком активных, открывающая панель.

- [ ] **Step 3: Проверить в браузере**

Окно 390×844: поиск сужает список по мере ввода; кнопка «Фильтры» открывает панель снизу; выбор фильтра сужает список и отражается в адресной строке; счётчик на кнопке показывает число активных.

- [ ] **Step 4: Коммит**

```bash
npm run typecheck && npx eslint . 2>&1 | tail -2
git add src/components/mobile/deal-filters-sheet.tsx "src/app/(dashboard)/deals/page.tsx"
git commit -m "feat(mobile): поиск в шапке и фильтры в выдвижной панели"
```

---

### Task 10: Реестр карточками

**Files:**
- Create: `src/components/mobile/registry-card-list.tsx`
- Modify: `src/app/(dashboard)/registry/page.tsx`

**Interfaces:**
- Consumes: `useIsMobile()`; сгруппированные по сделкам данные, которые страница уже готовит.
- Produces: `<RegistryCardList groups={…} />`.

- [ ] **Step 1: Написать список**

Создать `src/components/mobile/registry-card-list.tsx`: карточка на сделку (код, месяц, ГСМ, поставщик → покупатель), внутри строки вагонов — номер, объём, дата. Массовое добавление и импорт на мобильном не показываются: это работа за компьютером.

- [ ] **Step 2: Подставить вид**

В `src/app/(dashboard)/registry/page.tsx` при `isMobile` рендерить `<RegistryCardList …/>` вместо десктопной разметки; кнопки «Добавить» и «Импорт» скрыть при `isMobile`.

- [ ] **Step 3: Проверить в браузере**

Окно 390×844, `/registry`: карточки сделок с вагонами внутри, прокрутка плавная (в базе 7118 записей по 432 сделкам), кнопок массового ввода нет.

- [ ] **Step 4: Коммит**

```bash
npm run typecheck && npx eslint . 2>&1 | tail -2
git add src/components/mobile/registry-card-list.tsx "src/app/(dashboard)/registry/page.tsx"
git commit -m "feat(mobile): реестр отгрузки карточками"
```

---

### Task 11: ДТ-КТ карточками

**Files:**
- Create: `src/components/mobile/dtkt-card-list.tsx`
- Modify: `src/app/(dashboard)/dt-kt/page.tsx`

**Interfaces:**
- Consumes: `useIsMobile()`; массив `filtered`, уже вычисленный на странице (`dt-kt/page.tsx:385`).
- Produces: `<DtKtCardList rows={…} />`.

- [ ] **Step 1: Написать список**

Создать `src/components/mobile/dtkt-card-list.tsx`: карточка на строку — экспедитор и группа компаний в заголовке, ниже год, входящее сальдо, оплата, реестр, исходящее сальдо. Только чтение: правка расчётов с телефона в эту версию не входит, поля отображаются как текст.

- [ ] **Step 2: Подставить вид**

В `src/app/(dashboard)/dt-kt/page.tsx` при `isMobile` рендерить `<DtKtCardList rows={filtered} />` вместо таблицы.

- [ ] **Step 3: Проверить в браузере**

Окно 390×844, `/dt-kt` (открывается через вкладку «Ещё»): 17 карточек, имена экспедиторов и групп на месте, числа совпадают с десктопной таблицей.

- [ ] **Step 4: Коммит**

```bash
npm run typecheck && npx eslint . 2>&1 | tail -2
git add src/components/mobile/dtkt-card-list.tsx "src/app/(dashboard)/dt-kt/page.tsx"
git commit -m "feat(mobile): ДТ-КТ карточками"
```

---

### Task 12: Ревизия карточки сделки на узком экране

**Files:**
- Modify: `src/app/(dashboard)/deals/[id]/page.tsx` и вложенные блоки по результатам осмотра

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: ничего для последующих задач.

Это самая непредсказуемая по трудозатратам часть плана. Оценивать её по коду нельзя — только по живому экрану.

- [ ] **Step 1: Осмотреть каждую секцию**

В окне 390×844 открыть сделку с возвратом (`KG/26/373`) и по очереди раскрыть: Поставщик, Покупатель, Группа компаний, Условия оплаты, Логистика, Массово, Ответственные, Активность.

Для каждой записать: не вылезает ли содержимое за ширину экрана, попадает ли палец в элементы управления (минимум 32 пикселя), читаются ли числа.

- [ ] **Step 2: Починить найденное**

Типовые правки: сетки полей `sm:grid-cols-2 md:grid-cols-4` получают явный одностолбцовый вариант на узком экране; таблицы внутри секций (строки вариантов, оплаты, цены по отгрузкам) — горизонтальную прокрутку в собственном контейнере, чтобы страница не ехала целиком; кнопки — минимальную высоту.

Десктопную плотность не менять: правки применяются только ниже `md`.

- [ ] **Step 3: Проверить, что десктоп не пострадал**

Растянуть окно шире 768 и сверить карточку сделки с тем, как она выглядела до правок: расположение полей и плотность прежние.

- [ ] **Step 4: Коммит**

```bash
npm run typecheck && npx eslint . 2>&1 | tail -2
git add "src/app/(dashboard)/deals/[id]/page.tsx"
git commit -m "fix(mobile): карточка сделки на узком экране"
```

---

### Task 13: Мобильный smoke-тест, установка и журнал

**Files:**
- Create: `e2e/mobile.spec.ts`
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: ничего.

- [ ] **Step 1: Написать мобильный smoke-тест**

Создать `e2e/mobile.spec.ts` по образцу `e2e/smoke.spec.ts` (тот же способ входа через `E2E_EMAIL` / `E2E_PASSWORD`, тот же пропуск при отсутствии секретов), с окном 390×844:

```ts
test.use({ viewport: { width: 390, height: 844 } });
```

Проверки: после входа видна нижняя панель с четырьмя вкладками; на `/deals` отрисованы карточки, а таблицы паспорта нет; тап по первой карточке открывает `/deals/<uuid>`; вкладка «Реестр» открывает реестр.

- [ ] **Step 2: Прогнать тест**

```bash
E2E_EMAIL=… E2E_PASSWORD=… npm run test:e2e -- e2e/mobile.spec.ts
```

Ожидание: PASS. Без секретов тест пропускается — это нормально и совпадает с поведением существующего smoke.

- [ ] **Step 3: Проверить установку на живых устройствах**

Собранное приложение открыть на **Android** (Chrome): браузер предлагает установку, приложение ставится на домашний экран, запускается без адресной строки.

На **iPhone** (Safari): «Поделиться» → «На экран "Домой"», приложение запускается, иконка и название верные. Поведение платформ различается — проверять надо обе, обещать одинаковое нельзя.

- [ ] **Step 4: Проверить офлайн-старт на телефоне**

На телефоне с установленным приложением включить режим полёта и запустить с домашнего экрана. Ожидание: приложение открывается, видна плашка «Нет сети. Данные от …», список сделок отрисован, поля не реагируют.

- [ ] **Step 5: Проверить очистку при выходе**

Выйти из системы на телефоне, снова открыть приложение офлайн. Ожидание: данных нет, показана форма входа.

- [ ] **Step 6: Полная проверка**

```bash
npm test
npm run typecheck
npm run build
npx eslint . 2>&1 | tail -2
```

Ожидание: тесты и типы чистые, сборка проходит, lint — **189 ошибок, как на старте**. Рост означает, что новый код нарушает одно из двух отложенных правил; исправить в новом коде, а не подавлять.

- [ ] **Step 7: Запись в журнал**

Добавить запись в `CHANGELOG-SINCE-EXTRACTION.md` в формате файла (посмотреть верхнюю запись и повторить структуру) с содержанием: приложение стало устанавливаемым PWA; добавлены манифест, иконки, сервис-воркер; кэши сохраняются на устройстве и поднимаются при старте, показывается время последней синхронизации; выход стирает данные с устройства; без сети приложение открывается в режиме чтения вместо выброса на форму входа; ниже 768 пикселей появились нижние вкладки и карточные представления паспорта, реестра и ДТ-КТ; десктопное поведение не изменено; Capacitor рассмотрен и отклонён — причина в спеке.

- [ ] **Step 8: Коммит**

```bash
git add e2e/mobile.spec.ts CHANGELOG-SINCE-EXTRACTION.md
git commit -m "test(mobile): smoke в мобильном окне + журнал изменений"
```

---

## Порядок и зависимости

```
Task 1 (манифест, иконки, исключения proxy)
   └─→ Task 2 (сервис-воркер) ─→ Task 4 (очистка при выходе)
Task 3 (сохранение кэшей) ─→ Task 4, Task 5
Task 5 (офлайн-режим)
Task 6 (каркас, вкладки) ─→ Task 7, 8, 10, 11
Task 8 (карточки сделок) ─→ Task 9 (фильтры)
Task 12 (карточка сделки) — после 6
Task 13 — последняя
```

Задачи 1–5 (оболочка и офлайн) и 6–12 (мобильные виды) независимы друг от друга и могут идти параллельно, если работают двое.

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

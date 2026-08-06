"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Регистрирует сервис-воркер и предлагает обновление.
 *
 * Принудительно перезагружать страницу нельзя: оператор может стоять
 * в середине правки оплаты. Показываем плашку, решение за человеком.
 *
 * Состояния компонент НЕ заводит намеренно — плашка показывается прямо
 * из колбэка. useState здесь дал бы setState внутри эффекта, то есть
 * новую ошибку react-hooks/set-state-in-effect (см. Global Constraints
 * плана: счётчик lint не должен расти).
 */
function offerUpdate(worker: ServiceWorker) {
  toast("Доступно обновление", {
    duration: Infinity,
    action: {
      label: "Перезагрузить",
      onClick: () => {
        worker.postMessage("SKIP_WAITING");
        window.location.reload();
      },
    },
  });
}

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (cancelled) return;
        if (reg.waiting) offerUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener("statechange", () => {
            // controller !== null означает, что это ОБНОВЛЕНИЕ, а не
            // первая установка: при первой плашка была бы бессмысленной.
            if (next.state === "installed" && navigator.serviceWorker.controller && !cancelled) {
              offerUpdate(next);
            }
          });
        });
      })
      .catch(() => {
        /* регистрация недоступна (приватный режим, http) — приложение работает как обычно */
      });

    return () => { cancelled = true; };
  }, []);

  return null;
}

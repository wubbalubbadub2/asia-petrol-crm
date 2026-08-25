import { toast } from "sonner";

/**
 * Вкладка, открытая до деплоя, просит чанк, которого на сервере больше нет.
 *
 * Выгрузки в Excel подключаются динамическим `import()` — exceljs слишком
 * большой, чтобы лежать в основном бандле. После выката Vercel имена
 * чанков меняются (`/_next/static/chunks/06fzrtmu_rcv~.js`), и у
 * пользователя, который не перезагружал страницу, этот import падает.
 * Раньше это выглядело как поломка экспорта: «Не удалось экспортировать:
 * Failed to load chunk … from module 26030» — сообщение, из которого
 * невозможно понять, что делать.
 *
 * Принудительно перезагружать страницу нельзя (тот же довод, что у
 * `ServiceWorkerRegistrar`): оператор может стоять в середине правки.
 * Показываем плашку с кнопкой, решение за человеком.
 */
export function isStaleChunkError(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  if (!err) return false;
  if (err.name === "ChunkLoadError") return true;
  const msg = err.message ?? "";
  return (
    /failed to load chunk/i.test(msg) ||
    /loading chunk \S+ failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg) ||
    /failed to fetch dynamically imported module/i.test(msg)
  );
}

/** Плашка «приложение обновилось» с кнопкой перезагрузки. */
export function offerReloadAfterDeploy(): void {
  toast("Приложение обновилось", {
    description: "Страница открыта до обновления, поэтому файл не собрался. Перезагрузите и повторите выгрузку.",
    duration: Infinity,
    action: { label: "Перезагрузить", onClick: () => window.location.reload() },
  });
}

/**
 * Общий разбор ошибки выгрузки: устаревший чанк — плашка с кнопкой,
 * всё остальное — обычный текст ошибки. `prefix` сохраняет формулировку,
 * к которой пользователь привык на конкретной странице.
 */
export function reportExportError(e: unknown, prefix = "Не удалось экспортировать"): void {
  if (isStaleChunkError(e)) {
    offerReloadAfterDeploy();
    return;
  }
  toast.error(`${prefix}: ${e instanceof Error ? e.message : String(e)}`);
}

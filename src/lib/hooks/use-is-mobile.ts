"use client";

import { useSyncExternalStore } from "react";

/**
 * Порог мобильного режима — 768px, совпадает с брейкпоинтом `md`
 * в Tailwind. Шире этого поведение приложения не меняется вообще,
 * включая планшеты: существующая таблица паспорта с горизонтальной
 * прокруткой в альбомной ориентации читается нормально, а третья
 * раскладка — лишняя работа и лишняя поверхность для ошибок.
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

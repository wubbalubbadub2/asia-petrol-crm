"use client";

/**
 * useDelayed — flip to `true` only if the source stays `true` for at
 * least `delayMs`. Lets components mount a loader ONLY when the
 * underlying fetch actually drags past the threshold; a sub-1s fetch
 * never shows the spinner at all, so the layout doesn't jump.
 *
 *   const showLoader = useDelayed(loading);
 *   if (showLoader && !data) return <p>Загрузка…</p>;
 *
 * Default 1000ms per client feedback 2026-06-17 («if the load is more
 * than 1 second, we should show loader»). Sub-1s loads paint nothing,
 * over-1s loads get the spinner.
 */

import { useEffect, useState } from "react";

export function useDelayed(active: boolean, delayMs = 1000): boolean {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!active) {
      setDelayed(false);
      return;
    }
    const t = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return delayed;
}

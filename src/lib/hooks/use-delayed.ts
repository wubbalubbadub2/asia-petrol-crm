"use client";

/**
 * useDelayed — flip to `true` only if the source stays `true` for at
 * least `delayMs`. Lets components mount a loader ONLY when the
 * underlying fetch actually drags past the threshold; a sub-1s fetch
 * never shows the spinner at all, so the layout doesn't jump.
 *
 *   const showLoader = useDelayed(loading, 800);
 *   if (showLoader && !data) return <p>Загрузка…</p>;
 *
 * 800ms is the default — generally below the user's perceptual «is
 * this stuck?» threshold while still avoiding the flash on quick
 * fetches.
 */

import { useEffect, useState } from "react";

export function useDelayed(active: boolean, delayMs = 800): boolean {
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

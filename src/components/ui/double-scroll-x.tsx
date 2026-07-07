"use client";

import {
  ReactNode,
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Двойной горизонтальный скроллбар: рендерит верхнюю и нижнюю полосы
 * прокрутки над и под содержимым, синхронизированные между собой.
 * Пользователю не нужно мотать вниз до таблицы за скроллбаром.
 *
 * Обе полосы появляются только если контент действительно шире
 * контейнера (scrollWidth > clientWidth).
 */
export function DoubleScrollX({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [innerWidth, setInnerWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const bottom = bottomRef.current;
    if (!bottom) return;

    const measure = () => {
      const w = bottom.scrollWidth;
      setInnerWidth(w);
      setOverflowing(w > bottom.clientWidth + 1);
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(bottom);
    const child = bottom.firstElementChild;
    if (child) ro.observe(child);

    const mo = new MutationObserver(measure);
    mo.observe(bottom, { childList: true, subtree: true, attributes: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [children]);

  useEffect(() => {
    const top = topRef.current;
    const bottom = bottomRef.current;
    if (!top || !bottom) return;
    return wireScrollSync(top, bottom);
  }, []);

  return (
    <div className={className}>
      <ProxyBar barRef={topRef} innerWidth={innerWidth} visible={overflowing} />
      <div ref={bottomRef} style={{ overflowX: "auto" }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Верхняя синхронизированная полоса прокрутки для существующего
 * scroll-контейнера (когда нельзя обернуть в свой overflow-x-auto —
 * например, virtualizer уже держит внешний ref на этот div).
 *
 * Использование:
 *   const ref = useRef<HTMLDivElement>(null);
 *   <SyncedTopScrollbar targetRef={ref} />
 *   <div ref={ref} className="overflow-auto ...">...</div>
 */
export function SyncedTopScrollbar({
  targetRef,
  className,
}: {
  targetRef: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const topRef = useRef<HTMLDivElement>(null);
  const [innerWidth, setInnerWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const measure = () => {
      const w = target.scrollWidth;
      setInnerWidth(w);
      setOverflowing(w > target.clientWidth + 1);
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(target);
    const child = target.firstElementChild;
    if (child) ro.observe(child);

    const mo = new MutationObserver(measure);
    mo.observe(target, { childList: true, subtree: true, attributes: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [targetRef]);

  useEffect(() => {
    const top = topRef.current;
    const target = targetRef.current;
    if (!top || !target) return;
    return wireScrollSync(top, target);
  }, [targetRef]);

  return (
    <ProxyBar
      barRef={topRef}
      innerWidth={innerWidth}
      visible={overflowing}
      className={className}
    />
  );
}

function ProxyBar({
  barRef,
  innerWidth,
  visible,
  className,
}: {
  barRef: RefObject<HTMLDivElement | null>;
  innerWidth: number;
  visible: boolean;
  className?: string;
}) {
  return (
    <div
      ref={barRef}
      aria-hidden
      className={className}
      style={{
        overflowX: "auto",
        overflowY: "hidden",
        height: visible ? 14 : 0,
        transition: "height 0.12s",
      }}
    >
      <div style={{ width: innerWidth, height: 1 }} />
    </div>
  );
}

function wireScrollSync(a: HTMLElement, b: HTMLElement) {
  let syncing = false;
  const clearSyncing = () => {
    syncing = false;
  };
  const onA = () => {
    if (syncing) return;
    syncing = true;
    b.scrollLeft = a.scrollLeft;
    requestAnimationFrame(clearSyncing);
  };
  const onB = () => {
    if (syncing) return;
    syncing = true;
    a.scrollLeft = b.scrollLeft;
    requestAnimationFrame(clearSyncing);
  };
  a.addEventListener("scroll", onA, { passive: true });
  b.addEventListener("scroll", onB, { passive: true });
  return () => {
    a.removeEventListener("scroll", onA);
    b.removeEventListener("scroll", onB);
  };
}

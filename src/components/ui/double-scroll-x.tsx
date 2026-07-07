"use client";

import {
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * DoubleScrollX — верхняя и нижняя КАСТОМНЫЕ полосы прокрутки над
 * широким содержимым (например, широкая таблица).
 *
 * Почему кастомные, а не native ::-webkit-scrollbar:
 *   macOS Chromium/Chrome для overlay-скроллбаров игнорирует
 *   ::-webkit-scrollbar styling — bar рисуется поверх контента,
 *   fade-out через ~1 секунду и НЕ резервирует место в layout.
 *   Проверено playwright'ом: offsetHeight === clientHeight даже
 *   при overflow-x: scroll + -webkit-appearance: none. Единственный
 *   надёжный путь для мышиных пользователей — рисовать полосу
 *   собственным DOM-элементом.
 *
 * Обе полосы всегда видны, когда контент overflow-х-ится, и
 * скрываются иначе (height → 0).
 */
export function DoubleScrollX({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const dim = useScrollDim(contentRef);
  const setScrollLeft = useCallback((left: number) => {
    if (contentRef.current) contentRef.current.scrollLeft = left;
  }, []);

  return (
    <div className={className}>
      <CustomScrollbar dim={dim} onScrollLeft={setScrollLeft} />
      <div
        ref={contentRef}
        className="dsx-hide-native-all"
        style={{ overflowX: "auto" }}
      >
        {children}
      </div>
      <CustomScrollbar dim={dim} onScrollLeft={setScrollLeft} />
    </div>
  );
}

/**
 * Пара кастомных горизонтальных полос (сверху и снизу),
 * синхронизированных с внешним scroll-контейнером, ref на который
 * уже используется чем-то ещё (виртуализатором в passport-таблице).
 *
 * ВАЖНО: dim меряется ОДИН раз внутри этого компонента и
 * пробрасывается в оба CustomScrollbar. Иначе две независимые
 * useScrollDim могут получить разные scrollWidth (первое измерение
 * до полной раскладки таблицы) — верхняя полоса тогда не отрисуется.
 *
 * children — DOM, где стоит `<div ref={targetRef}>` c нужным
 * overflow-x. Wrapper сам ставит верхнюю полосу перед children и
 * нижнюю после.
 */
export function PairedSyncedScrollbars({
  targetRef,
  topClassName,
  bottomClassName,
  children,
}: {
  targetRef: RefObject<HTMLElement | null>;
  topClassName?: string;
  bottomClassName?: string;
  children: ReactNode;
}) {
  const dim = useScrollDim(targetRef);
  const setScrollLeft = useCallback(
    (left: number) => {
      if (targetRef.current) targetRef.current.scrollLeft = left;
    },
    [targetRef],
  );

  // Прячем ТОЛЬКО горизонтальный native scrollbar внешнего
  // контейнера — вертикальный оставляем.
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    el.classList.add("dsx-hide-native-h");
    return () => el.classList.remove("dsx-hide-native-h");
  }, [targetRef]);

  return (
    <>
      <div className={topClassName}>
        <CustomScrollbar dim={dim} onScrollLeft={setScrollLeft} />
      </div>
      {children}
      <div className={bottomClassName}>
        <CustomScrollbar dim={dim} onScrollLeft={setScrollLeft} />
      </div>
    </>
  );
}

/**
 * Оставлены как back-compat алиасы. НЕ используй их вместе на одном
 * target'е — dim меряется независимо в каждом, ловится race condition.
 * Для sandwich'а используй PairedSyncedScrollbars.
 */
export function SyncedTopScrollbar({
  targetRef,
  className,
}: {
  targetRef: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const dim = useScrollDim(targetRef);
  const setScrollLeft = useCallback(
    (left: number) => {
      if (targetRef.current) targetRef.current.scrollLeft = left;
    },
    [targetRef],
  );
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    el.classList.add("dsx-hide-native-h");
    return () => el.classList.remove("dsx-hide-native-h");
  }, [targetRef]);

  return (
    <div className={className}>
      <CustomScrollbar dim={dim} onScrollLeft={setScrollLeft} />
    </div>
  );
}

type Dim = {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
};

function useScrollDim(ref: RefObject<HTMLElement | null>): Dim {
  const [dim, setDim] = useState<Dim>({
    scrollWidth: 0,
    clientWidth: 0,
    scrollLeft: 0,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setDim({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollLeft: el.scrollLeft,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true, attributes: true });
    const onScroll = () => {
      setDim((d) => ({ ...d, scrollLeft: el.scrollLeft }));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [ref]);

  return dim;
}

function CustomScrollbar({
  dim,
  onScrollLeft,
}: {
  dim: Dim;
  onScrollLeft: (left: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; startScrollLeft: number } | null>(null);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const overflowing = dim.scrollWidth > dim.clientWidth + 1;
  const ratio = dim.scrollWidth > 0 ? dim.clientWidth / dim.scrollWidth : 1;
  const thumbWidth = Math.max(30, Math.floor(trackWidth * ratio));
  const maxThumbLeft = Math.max(0, trackWidth - thumbWidth);
  const maxScrollLeft = Math.max(1, dim.scrollWidth - dim.clientWidth);
  const thumbLeft = maxScrollLeft > 0
    ? (dim.scrollLeft / maxScrollLeft) * maxThumbLeft
    : 0;

  const onThumbDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragStartRef.current = { clientX: e.clientX, startScrollLeft: dim.scrollLeft };
    setDragging(true);
  };
  const onThumbMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.clientX;
    const scale = maxThumbLeft > 0 ? maxScrollLeft / maxThumbLeft : 0;
    const next = dragStartRef.current.startScrollLeft + dx * scale;
    onScrollLeft(Math.max(0, Math.min(maxScrollLeft, next)));
  };
  const onThumbUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    setDragging(false);
    dragStartRef.current = null;
  };
  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const targetThumbLeft = Math.max(0, Math.min(maxThumbLeft, clickX - thumbWidth / 2));
    const next = maxThumbLeft > 0
      ? (targetThumbLeft / maxThumbLeft) * maxScrollLeft
      : 0;
    onScrollLeft(next);
  };

  return (
    <div
      ref={trackRef}
      onClick={onTrackClick}
      aria-hidden
      style={{
        height: overflowing ? 12 : 0,
        overflow: "hidden",
        position: "relative",
        background: overflowing ? "#f5f5f4" : "transparent",
        cursor: overflowing ? "pointer" : "default",
        userSelect: "none",
        transition: "height 0.12s",
      }}
    >
      {overflowing && (
        <div
          onPointerDown={onThumbDown}
          onPointerMove={onThumbMove}
          onPointerUp={onThumbUp}
          onPointerCancel={onThumbUp}
          onClick={(e) => e.stopPropagation()}
          className="dsx-thumb"
          style={{
            position: "absolute",
            top: 2,
            bottom: 2,
            left: 0,
            width: thumbWidth,
            transform: `translateX(${thumbLeft}px)`,
            background: dragging ? "#57534e" : "#a8a29e",
            borderRadius: 4,
            cursor: dragging ? "grabbing" : "grab",
            transition: dragging ? "none" : "background 0.12s",
            touchAction: "none",
          }}
        />
      )}
    </div>
  );
}

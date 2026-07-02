"use client";

// Sec­tion card whose body can be folded away. Wraps <Card> so every
// existing section on the deal passport / new-deal form keeps its
// visual language — same border, padding, header font size. The
// header row grows a chevron toggle on the left; `headerRight` slot
// keeps the currency picker / "Массово" button anchored on the right.
//
// Client 2026-07-01: default state = collapsed everywhere. Operators
// scan the deal top-down and pop only what they need — the field
// density otherwise makes long deals hard to read at a glance.

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Client brand palette (2026-07-01). Same hex values the passport
// table column-group bands use; re-exported here so the deal detail
// page and the new-deal form pick from a single source of truth.
export const SECTION_COLORS = {
  deal:      "#b4c6e7", // Сделка / Ответственные / Основные данные
  supplier:  "#fce3d6", // Поставщик / Оплата заранее
  buyer:     "#fff2cc", // Покупатель
  chain:     "#bcd7ee", // Группы компании
  logistics: "#d9d9d9", // Логистика
} as const;

export function CollapsibleSection({
  title,
  defaultOpen = false,
  headerRight,
  children,
  contentClassName,
  headerBg,
  storageKey,
}: {
  title: string;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  // Hex applied to the whole card (colored end-to-end when closed) +
  // to the 2px accent border. Body stays white when the card is open
  // so form inputs remain readable. Client 2026-07-01 round 5:
  //   • «в collapsed пусть всё будет закрашено» → Card bg = headerBg
  //   • «в открытом не оставляй сверху белую дырку» → Card padding /
  //     gap zeroed out so the coloured header sits flush against the
  //     top edge, and the white body attaches directly below it.
  headerBg?: string;
  // Persist open/closed state across mounts. Passport pages remount
  // whenever the operator switches workspace tabs (e.g. Сделка → Реестр
  // → back to Сделка) — without persistence every section snaps back
  // to `defaultOpen`. Client 2026-07-02: «если раскрыл секцию и перешёл
  // на другой таб, при возврате должна оставаться раскрытой». Pass a
  // key like `deal:<id>:section:<title>` and we mirror the open state
  // into localStorage.
  storageKey?: string;
}) {
  // Initial state respects defaultOpen; a client-side effect below
  // hydrates from localStorage on mount. We deliberately DON'T read
  // storage in the useState initializer — Next.js SSR would render one
  // value and the client another, causing a hydration mismatch flash.
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "true") setOpen(true);
      else if (stored === "false") setOpen(false);
    } catch {
      /* storage disabled — silently fall back to defaultOpen */
    }
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, open ? "true" : "false");
    } catch {
      /* quota — ignore */
    }
  }, [open, storageKey]);
  const cardStyle: React.CSSProperties | undefined = headerBg
    ? { backgroundColor: headerBg, borderWidth: 2, borderColor: headerBg }
    : undefined;
  return (
    <Card
      style={cardStyle}
      // Kill Card's default py-4 + gap-4 when tinted so the header sits
      // flush at the top edge and the white body starts immediately
      // below it (no white or coloured gap in between).
      className={headerBg ? "py-0 gap-0" : undefined}
    >
      {/* Whole header is the click target (client 2026-07-01 round 6:
          «раскрывались при нажатии на любую часть карточки»). The
          headerRight slot renders its controls inside a click-swallower
          so buttons like the currency picker / «Массово» don't also
          fold the section when clicked. */}
      <CardHeader
        onClick={() => setOpen((o) => !o)}
        className={`flex flex-row items-center justify-between space-y-0 cursor-pointer select-none hover:opacity-90 transition-opacity ${headerBg ? "pt-3 pb-2" : "pb-2"}`}
      >
        <div className="flex items-center gap-1.5 text-left">
          {open
            ? <ChevronDown className="h-4 w-4 text-stone-700" />
            : <ChevronRight className="h-4 w-4 text-stone-700" />}
          <CardTitle className="text-[14px] text-stone-800">{title}</CardTitle>
        </div>
        {headerRight && (
          <div onClick={(e) => e.stopPropagation()}>
            {headerRight}
          </div>
        )}
      </CardHeader>
      {open && (
        <CardContent
          className={`${headerBg ? "bg-white py-4 " : ""}${contentClassName ?? "space-y-4"}`}
        >
          {children}
        </CardContent>
      )}
    </Card>
  );
}

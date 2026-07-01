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

import { useState, type ReactNode } from "react";
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
}: {
  title: string;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  // Hex background applied to the header bar. Should match the
  // matching column-group band on /deals (Сделка #b4c6e7, Поставщик
  // #fce3d6, Группа компаний #bcd7ee, Покупатель #fff2cc, Логистика
  // #d9d9d9) so the deal passport reads as the same layout, folded.
  headerBg?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader
        className={`pb-2 flex flex-row items-center justify-between space-y-0 ${headerBg ? "rounded-t-xl" : ""}`}
        style={headerBg ? { backgroundColor: headerBg } : undefined}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-left cursor-pointer hover:opacity-70 transition-opacity"
        >
          {open
            ? <ChevronDown className="h-4 w-4 text-stone-700" />
            : <ChevronRight className="h-4 w-4 text-stone-700" />}
          <CardTitle className="text-[14px] text-stone-800">{title}</CardTitle>
        </button>
        {headerRight}
      </CardHeader>
      {open && (
        <CardContent className={contentClassName ?? "space-y-4"}>
          {children}
        </CardContent>
      )}
    </Card>
  );
}

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

export function CollapsibleSection({
  title,
  defaultOpen = false,
  headerRight,
  children,
  contentClassName,
}: {
  title: string;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-left cursor-pointer hover:text-amber-700 transition-colors"
        >
          {open
            ? <ChevronDown className="h-4 w-4 text-stone-400" />
            : <ChevronRight className="h-4 w-4 text-stone-400" />}
          <CardTitle className="text-[14px]">{title}</CardTitle>
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

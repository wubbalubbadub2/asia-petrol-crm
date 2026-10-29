"use client";
// Паспорт, чип группы в цепочке: у группы KG-сделки с несколькими
// вариантами цены (00183) после цены группы — цены остальных вариантов,
// наведение раскрывает объём и сумму каждого — тот же вид, что у «Цены»
// покупателя (passport-price-cell.tsx). Цена «Основного» правится в чипе
// как раньше (EditableCGPrice), остальные — в карточке сделки.

import { createContext, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  companyGroupLineName, fetchCompanyGroupLineVolumes,
  type CompanyGroupLine, type CompanyGroupLineVolume,
} from "@/lib/hooks/use-company-group-lines";

export const PassportCgLinesContext = createContext<Map<string, CompanyGroupLine[]>>(new Map());

const price3 = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const tons3 = price3;
const money2 = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PassportCgLines({ cgId }: { cgId: string }) {
  const lines = useContext(PassportCgLinesContext).get(cgId);
  const [open, setOpen] = useState(false);
  // Объёмы — к этому списку вариантов: перечитали варианты — объёмы заново.
  const [cache, setCache] = useState<{ of: CompanyGroupLine[] | undefined; v: Map<string, CompanyGroupLineVolume> } | null>(null);
  const volumes = cache && cache.of === lines ? cache.v : null;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  if (!lines || lines.length < 2) return null;
  const others = lines.filter((l) => !l.is_default);

  async function show() {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: Math.max(8, rect.left) });
    setOpen(true);
    if (volumes !== null) return;
    try {
      setCache({ of: lines, v: await fetchCompanyGroupLineVolumes([cgId]) });
    } catch {
      setCache({ of: lines, v: new Map() });
    }
  }

  return (
    <>
      <span ref={ref} onMouseEnter={() => void show()} onMouseLeave={() => setOpen(false)}
        className="font-mono text-purple-500 cursor-help whitespace-nowrap">
        {others.map((l) => ` / ${price3(l.price)}`).join("")}
      </span>
      {open && pos && typeof window !== "undefined" && createPortal(
        <div style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 min-w-[260px] max-w-[420px] rounded-md bg-stone-800 px-3 py-2 text-[11px] text-stone-100 shadow-xl font-mono tabular-nums">
          {volumes === null
            ? "Загрузка…"
            : lines.map((l) => {
                const v = volumes.get(l.id);
                return (
                  <div key={l.id} className="whitespace-nowrap">
                    {companyGroupLineName(l, lines)}: {price3(l.price)}
                    {v?.volume != null
                      ? ` — ${v.is_linked ? "отгружено" : "объём"} ${tons3(v.volume)} т на ${money2(v.amount ?? 0)}`
                      : " — объём не задан"}
                  </div>
                );
              })}
        </div>,
        document.body,
      )}
    </>
  );
}

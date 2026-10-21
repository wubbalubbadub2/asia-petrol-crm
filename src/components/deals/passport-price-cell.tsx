"use client";
// «Цена» в паспорте (клиент 2026-10-21): у стороны с несколькими
// вариантами видны все цены — основная первой, «619,750 / 640,000»; клик
// (или наведение) раскрывает, сколько отгружено по каждой цене (строки реестра,
// закреплённые за вариантом — то же, что «Отгружено по этому варианту»
// в карточке). С одним вариантом — как было: цена основного варианта.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchDealLineRollups, type LineRollups } from "@/lib/hooks/use-deal-lines";
import { linePricesKey, type LinePrice } from "@/lib/hooks/use-line-prices-summary";

export const PassportLinePricesContext = createContext<Map<string, LinePrice[]>>(new Map());

const price3 = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const money2 = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** «★ Основной» / «Вариант N» — N по порядку вариантов, как в карточке сделки. */
function lineName(l: LinePrice, all: LinePrice[]): string {
  if (l.is_default) return "★ Основной";
  const byPos = [...all].sort((a, b) => a.position - b.position);
  return `Вариант ${byPos.indexOf(l) + 1}`;
}

export function PassportPriceCell({ dealId, side, price, className, dataCol }: {
  dealId: string;
  side: "supplier" | "buyer";
  price: number | null | undefined;
  className: string;
  dataCol: string;
}) {
  const lines = useContext(PassportLinePricesContext).get(linePricesKey(dealId, side));
  const many = !!lines && lines.length > 1;
  const [open, setOpen] = useState(false);
  // Наведение показывает сразу (клиент 2026-10-21: «навел мышь на цену и
  // ничего не выходит»); клик закрепляет попап, второй клик или клик мимо — закрывает.
  const [pinned, setPinned] = useState(false);
  const [rollups, setRollups] = useState<LineRollups | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (cellRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
      setPinned(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  async function show() {
    if (!many || open) return;
    const rect = cellRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
    if (rollups !== null) return;
    try {
      setRollups(await fetchDealLineRollups(dealId));
    } catch {
      setRollups({ supplier: {}, buyer: {} });
    }
  }

  function toggle() {
    if (!many) return;
    if (pinned) { setPinned(false); setOpen(false); return; }
    setPinned(true);
    void show();
  }

  const text = many ? lines!.map((l) => price3(l.price)).join(" / ") : price == null ? "" : price3(price);
  return (
    <>
      <td
        ref={cellRef}
        onClick={toggle}
        onMouseEnter={() => void show()}
        onMouseLeave={() => { if (!pinned) setOpen(false); }}
        className={`${className}${many ? " cursor-pointer whitespace-nowrap" : ""}${open ? " ring-2 ring-amber-300/70" : ""}`}
        title={many ? undefined : "цена за тонну (из условий)"}
        data-col={dataCol}
        data-deal-id={dealId}
        data-value={price ?? undefined}
      >
        {text}
      </td>
      {open && pos && typeof window !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 min-w-[260px] max-w-[380px] rounded-md bg-stone-800 px-3 py-2 text-[11px] text-stone-100 shadow-xl font-mono tabular-nums"
        >
          {rollups === null
            ? "Загрузка…"
            : lines!.map((l) => {
                const r = rollups[side][l.id];
                return (
                  <div key={l.id} className="whitespace-nowrap">
                    {lineName(l, lines!)}: {price3(l.price)} — отгружено {(r?.volume ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} т на {money2(r?.amount ?? 0)}
                  </div>
                );
              })}
        </div>,
        document.body,
      )}
    </>
  );
}

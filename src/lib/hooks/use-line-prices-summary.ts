"use client";
// Цены всех вариантов для колонки «Цена» в паспорте.
//
// Клиент 2026-10-21: «Тут две цены на два объема, как можно увидеть что
// две цены? Нужно как то добавить или разделить что объем один по такой
// цене второй по другой». Паспорт показывал только цену основного
// варианта (deals.*_price) и чип «+N лин.».
//
// Грузим только сделки, где у стороны больше одного варианта
// (deals.*_lines_count, 00092), одним запросом на сторону — как
// use-payment-dates-summary. Объёмы по вариантам — по клику на ячейку
// (fetchDealLineRollups), их считать на весь год незачем.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";

export type LinePrice = { id: string; position: number; is_default: boolean; price: number | null };

export const linePricesKey = (dealId: string, side: "supplier" | "buyer") => `${dealId}|${side}`;

type Row = LinePrice & { deal_id: string };

/** Основной вариант первым, остальные — по порядку, как карточки в сделке. */
export function orderLines(lines: LinePrice[]): LinePrice[] {
  return [...lines].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.position - b.position);
}

/** `version` — цены основных вариантов этих сделок: правка цены перечитывает список. */
export function useLinePricesSummary(supplierIds: string[], buyerIds: string[], version: string) {
  const [map, setMap] = useState<Map<string, LinePrice[]>>(new Map());
  const supabaseRef = useRef(createClient());
  const sKey = supplierIds.join(",");
  const bKey = buyerIds.join(",");

  const load = useCallback(async () => {
    const fetchSide = async (table: "deal_supplier_lines" | "deal_buyer_lines", key: string) => {
      const ids = key ? key.split(",") : [];
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
      const results = await Promise.all(chunks.map((chunk) =>
        fetchAllPaginated<Row>((from, to) =>
          supabaseRef.current
            .from(table)
            .select("id, deal_id, position, is_default, price")
            .in("deal_id", chunk)
            .order("deal_id", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: null }>,
        ),
      ));
      return results.flatMap((r) => r.data);
    };
    const [supplier, buyer] = await Promise.all([fetchSide("deal_supplier_lines", sKey), fetchSide("deal_buyer_lines", bKey)]);
    const next = new Map<string, LinePrice[]>();
    const put = (side: "supplier" | "buyer", rows: Row[]) => {
      for (const r of rows) {
        const k = linePricesKey(r.deal_id, side);
        const list = next.get(k) ?? [];
        list.push({ id: r.id, position: r.position, is_default: r.is_default, price: r.price == null ? null : Number(r.price) });
        next.set(k, list);
      }
    };
    put("supplier", supplier);
    put("buyer", buyer);
    for (const [k, list] of next) next.set(k, orderLines(list));
    setMap(next);
    // version — только триггер перечитывания.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sKey, bKey, version]);

  useEffect(() => { void load(); }, [load]);

  return { map, reload: load };
}

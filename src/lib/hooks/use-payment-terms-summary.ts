"use client";
// Сводка условий оплаты для паспорта (представление
// deal_payment_terms_summary, миграции 00141/00142).
//
// Паспорт показывает строку на сделку, а срок живёт на приложении.
// Сводка отвечает сразу на всё, что нужно колонке: какие сроки
// действуют, сколько приложений на стороне (одно → можно править по
// месту), есть ли ручная дата, и какая худшая просрочка.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";

export type PaymentTermsSummary = {
  deal_id: string;
  side: "supplier" | "buyer";
  line_count: number;
  /** Значим только при line_count = 1 — тогда известно, куда писать правку. */
  single_line_id: string | null;
  deferral_days_list: number[] | null;
  has_manual_date: boolean;
  worst_days_to_pay: number | null;
  overdue_count: number;
  deal_saldo: number | null;
};

export const summaryKey = (dealId: string, side: "supplier" | "buyer") => `${dealId}|${side}`;

/**
 * Грузит сводку по видимым сделкам. Отдельный запрос, а не расширение
 * основной выборки паспорта: та и так тяжёлая, а сводка меняется от
 * правки условий, а не от правки сделки.
 */
export function usePaymentTermsSummary(dealIds: string[]) {
  const [map, setMap] = useState<Map<string, PaymentTermsSummary>>(new Map());
  const supabaseRef = useRef(createClient());
  // Ключ сравнения, чтобы не перезапрашивать на каждый рендер.
  const idsKey = dealIds.join(",");

  const load = useCallback(async () => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) { setMap(new Map()); return; }

    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));

    const results = await Promise.all(chunks.map((chunk) =>
      fetchAllPaginated<PaymentTermsSummary>((from, to) =>
        supabaseRef.current
          .from("deal_payment_terms_summary")
          .select("deal_id, side, line_count, single_line_id, deferral_days_list, has_manual_date, worst_days_to_pay, overdue_count, deal_saldo")
          .in("deal_id", chunk)
          .order("deal_id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: PaymentTermsSummary[] | null; error: null }>,
      ),
    ));

    const next = new Map<string, PaymentTermsSummary>();
    for (const res of results) {
      for (const row of res.data) next.set(summaryKey(row.deal_id, row.side), row);
    }
    setMap(next);
  }, [idsKey]);

  useEffect(() => { void load(); }, [load]);

  return { map, reload: load };
}

/**
 * Текст для колонки «Условия оплаты». Пусто у приложения означает
 * «взять со сделки», поэтому прочерк здесь — это «нигде не задано».
 */
export function termsText(s: PaymentTermsSummary | undefined): string {
  if (!s) return "—";
  const days = s.deferral_days_list ?? [];
  const parts: string[] = [];
  if (days.length) parts.push(days.slice().sort((a, b) => a - b).map((d) => `${d} дн.`).join(" / "));
  if (s.has_manual_date) parts.push("вручную");
  return parts.length ? parts.join(" · ") : "—";
}

/** Красный — только настоящая просрочка и только пока долг не закрыт. */
export function summaryOverdue(s: PaymentTermsSummary | undefined): boolean {
  if (!s || s.worst_days_to_pay == null || s.worst_days_to_pay >= 0) return false;
  return (s.deal_saldo ?? 0) > 0;
}

"use client";
// Даты фактических оплат для колонки «Дата оплаты» в паспорте
// (представление deal_payment_dates_summary, миграция 00159).
//
// Клиент 2026-09-14: «при вводе оплаты мы вводим дату тоже, их нужно
// показывать. Со стороны поставщика и покупателя». Раньше колонка
// читала ручное поле deals.*_payment_date, которое никто не заполняет,
// и стояла пустой рядом с непустой «Оплатой».
//
// Отдельный запрос, а не расширение основной выборки паспорта — ровно
// по тем же причинам, что и у use-payment-terms-summary: та выборка и
// так тяжёлая, а даты меняются от правки оплат, а не от правки сделки.
// Грузим одним махом по видимым сделкам, чтобы не открывать попап ради
// каждой даты (вторая половина жалобы: попап «еле-еле открывается»).

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";

export type PaymentDatesSummary = {
  deal_id: string;
  side: "supplier" | "buyer";
  payment_count: number;
  first_date: string | null;
  last_date: string | null;
  /** Все даты по возрастанию. Отбор совпадает с колонкой «Оплата». */
  dates: string[] | null;
};

export const paymentDatesKey = (dealId: string, side: "supplier" | "buyer") => `${dealId}|${side}`;

export function usePaymentDatesSummary(dealIds: string[]) {
  const [map, setMap] = useState<Map<string, PaymentDatesSummary>>(new Map());
  const supabaseRef = useRef(createClient());
  const idsKey = dealIds.join(",");

  const load = useCallback(async () => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) { setMap(new Map()); return; }

    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));

    const results = await Promise.all(chunks.map((chunk) =>
      fetchAllPaginated<PaymentDatesSummary>((from, to) =>
        supabaseRef.current
          .from("deal_payment_dates_summary")
          .select("deal_id, side, payment_count, first_date, last_date, dates")
          .in("deal_id", chunk)
          .order("deal_id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: PaymentDatesSummary[] | null; error: null }>,
      ),
    ));

    const next = new Map<string, PaymentDatesSummary>();
    for (const res of results) {
      for (const row of res.data) next.set(paymentDatesKey(row.deal_id, row.side), row);
    }
    setMap(next);
  }, [idsKey]);

  useEffect(() => { void load(); }, [load]);

  return { map, reload: load };
}

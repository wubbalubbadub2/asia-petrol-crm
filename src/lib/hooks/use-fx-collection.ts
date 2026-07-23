"use client";
/**
 * Склейка отчёта «Сбор по валюте»: события сделок + курсы → строки.
 *
 * Сделки приходят снаружи (страница фильтрует их ровно так же, как
 * паспорт). События грузятся один раз на набор id и переиспользуются
 * при переключении валюты — конвертация чистая и дешёвая, сеть при
 * смене ₸/$ не трогается вообще.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Deal } from "@/lib/hooks/use-deals";
import { FxRates, type FxRateRow } from "@/lib/fx/rates";
import { convertDeal, type DealEvents } from "@/lib/fx/convert-deal";
import { fetchDealEvents, fetchFxRatesRange } from "@/lib/data/deal-events";

const EMPTY_EVENTS: DealEvents = { prices: [], payments: [], logistics: [] };

export function useFxCollection(deals: Deal[], target: string) {
  const [events, setEvents] = useState<Map<string, DealEvents>>(new Map());
  const [rates, setRates] = useState<FxRateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ключ загрузки — набор id. Смена валюты его не меняет.
  const idsKey = useMemo(() => deals.map((d) => d.id).sort().join(","), [deals]);
  const lastKey = useRef<string>("");

  useEffect(() => {
    if (!idsKey) {
      lastKey.current = "";
      setEvents(new Map());
      setLoading(false);
      setError(null);
      return;
    }
    if (lastKey.current === idsKey) return;
    lastKey.current = idsKey;
    const ids = idsKey.split(",");
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchDealEvents(ids),
      // Курсы грузим с запасом: события сделки могут выходить за
      // пределы её года (оплата в январе следующего).
      fetchFxRatesRange("2025-01-01", new Date().toISOString().slice(0, 10)),
    ])
      .then(([ev, rt]) => { if (alive) { setEvents(ev); setRates(rt); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [idsKey]);

  const rows = useMemo(() => {
    if (rates.length === 0) return [];
    const fx = new FxRates(rates, new Date().toISOString().slice(0, 10));
    return deals.map((d) => convertDeal(d, events.get(d.id) ?? EMPTY_EVENTS, fx, target));
  }, [deals, events, rates, target]);

  return { rows, loading, error };
}

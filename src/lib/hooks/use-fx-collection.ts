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
import { useGlobalRefs } from "@/lib/refs";

const EMPTY_EVENTS: DealEvents = { prices: [], payments: [], logistics: [] };

export function useFxCollection(deals: Deal[], target: string) {
  const [events, setEvents] = useState<Map<string, DealEvents>>(new Map());
  const [rates, setRates] = useState<FxRateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // LIST_SELECT (use-deals.ts) намеренно не встраивает join-объекты
  // имён (factory/fuel_type/supplier/buyer/forwarder/logistics_company_group,
  // а deal_company_groups — без company_group.name): страница сделок
  // резолвит имена из глобального refs-кэша сама. convertDeal же читает
  // эти вложенные поля напрямую (deal.factory?.name и т.п.), поэтому без
  // обогащения ниже колонки имён в отчёте были бы пустыми у всех строк.
  const { refs } = useGlobalRefs();
  const supplierById = useMemo(() => new Map(refs.suppliers.map((s) => [s.id, s])), [refs.suppliers]);
  const buyerById = useMemo(() => new Map(refs.buyers.map((b) => [b.id, b])), [refs.buyers]);
  const factoryById = useMemo(() => new Map(refs.factories.map((f) => [f.id, f])), [refs.factories]);
  const fuelTypeById = useMemo(() => new Map(refs.fuelTypes.map((ft) => [ft.id, ft])), [refs.fuelTypes]);
  const forwarderById = useMemo(() => new Map(refs.forwarders.map((fw) => [fw.id, fw])), [refs.forwarders]);
  const companyGroupById = useMemo(() => new Map(refs.companyGroups.map((cg) => [cg.id, cg])), [refs.companyGroups]);

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
    return deals.map((d) => {
      // Обогащение только именами (деньги/объёмы не трогаем) — тем же
      // способом, что уже делает passport-detail-excel.ts (см. блок
      // `deals = deals.map((d) => {...})`), чтобы convertDeal получил
      // те же поля, что и на экране паспорта/Excel.
      const sup = d.supplier_id ? supplierById.get(d.supplier_id) : null;
      const buy = d.buyer_id ? buyerById.get(d.buyer_id) : null;
      const fac = d.factory_id ? factoryById.get(d.factory_id) : null;
      const ft = d.fuel_type_id ? fuelTypeById.get(d.fuel_type_id) : null;
      const fw = d.forwarder_id ? forwarderById.get(d.forwarder_id) : null;
      const lcg = d.logistics_company_group_id ? companyGroupById.get(d.logistics_company_group_id) : null;
      const enriched: Deal = {
        ...d,
        supplier: sup ? { full_name: sup.full_name, short_name: sup.short_name } : d.supplier ?? null,
        buyer: buy ? { full_name: buy.full_name, short_name: buy.short_name } : d.buyer ?? null,
        factory: fac ? { name: fac.name } : d.factory ?? null,
        fuel_type: ft ? { name: ft.name, color: ft.color ?? "#6B7280" } : d.fuel_type ?? null,
        forwarder: fw ? { name: fw.name } : d.forwarder ?? null,
        logistics_company_group: lcg ? { name: lcg.name } : d.logistics_company_group ?? null,
        deal_company_groups: (d.deal_company_groups ?? []).map((g) => ({
          ...g,
          company_group: g.company_group ?? (
            companyGroupById.get(g.company_group_id)
              ? { name: companyGroupById.get(g.company_group_id)!.name }
              : null
          ),
        })),
      };
      return convertDeal(enriched, events.get(d.id) ?? EMPTY_EVENTS, fx, target);
    });
  }, [deals, events, rates, target, supplierById, buyerById, factoryById, fuelTypeById, forwarderById, companyGroupById]);

  return { rows, loading, error };
}

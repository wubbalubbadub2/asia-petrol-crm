"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

/**
 * Справочники для заявки на перевозку — одной загрузкой.
 *
 * Форма заявки выбирает из девяти списков сразу (ТЗ: «пользователь не
 * набирает каждый раз всю заявку вручную, а выбирает данные из
 * списков»). Тянуть их по одному — девять круговых поездок на открытие
 * формы, поэтому запрос один и результат живёт в модульном кэше:
 * переход «список → заявка → назад → другая заявка» больше в сеть не
 * ходит.
 *
 * Типы таблиц transport_* появятся в database.ts после перегенерации,
 * поэтому клиент здесь приводится к нетипизированному на границе
 * запроса — тот же приём, что в use-references.
 */

export type RefRow = { id: string; name: string };
export type StationRef = { id: string; name: string; code: string | null };
export type FuelRef = {
  id: string;
  name: string;
  full_name: string | null;
  etsng_code: string | null;
  gng_code: string | null;
};
export type ConsigneeRef = {
  id: string;
  name: string;
  bin_iin: string | null;
  code_4: string | null;
  okpo: string | null;
  address: string | null;
};
export type RouteRef = {
  id: string;
  name: string;
  transport_route_stations: {
    position: number;
    stations: { name: string; code: string | null } | null;
  }[];
};

export type TransportRefs = {
  companies: RefRow[];
  fuels: FuelRef[];
  stations: StationRef[];
  carriers: RefRow[];
  consignees: ConsigneeRef[];
  factories: RefRow[];
  forwarders: RefRow[];
  routes: RouteRef[];
  buyers: RefRow[];
};

const EMPTY: TransportRefs = {
  companies: [], fuels: [], stations: [], carriers: [],
  consignees: [], factories: [], forwarders: [], routes: [], buyers: [],
};

let cache: TransportRefs | null = null;

/** «Темир (660308) — Карабалта (715905)» — как печатается в заявке. */
export function printedRoute(route: RouteRef | undefined | null): string {
  if (!route) return "";
  return [...(route.transport_route_stations ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((l) => {
      const name = l.stations?.name ?? "—";
      return l.stations?.code ? `${name} (${l.stations.code})` : name;
    })
    .join(" — ");
}

export function useTransportRefs() {
  const [refs, setRefs] = useState<TransportRefs>(cache ?? EMPTY);
  const [loading, setLoading] = useState(!cache);
  const sbRef = useRef(createClient());

  useEffect(() => {
    if (cache) return;
    let cancelled = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = sbRef.current as any;
    const active = (t: string, cols: string, order = "name") =>
      sb.from(t).select(cols).eq("is_active", true).order(order);

    Promise.all([
      active("company_groups", "id, name"),
      active("fuel_types", "id, name, full_name, etsng_code, gng_code"),
      active("stations", "id, name, code"),
      active("transport_carriers", "id, name"),
      active("consignees", "id, name, bin_iin, code_4, okpo, address"),
      active("factories", "id, name"),
      active("forwarders", "id, name"),
      sb.from("transport_routes")
        .select("id, name, transport_route_stations(position, stations(name, code))")
        .eq("is_active", true)
        .order("name"),
      // Покупатели — обычные контрагенты, у них нет is_active в фильтре
      // по типу, поэтому запрос отдельный.
      sb.from("counterparties")
        .select("id, full_name, short_name")
        .eq("type", "buyer")
        .eq("is_active", true)
        .order("full_name"),
    ]).then((results) => {
      if (cancelled) return;
      const bad = results.find((r) => r.error);
      if (bad) {
        toast.error(`Не удалось загрузить справочники: ${bad.error.message}`);
        setLoading(false);
        return;
      }
      const [co, fu, st, ca, cn, fa, fw, ro, bu] = results.map((r) => r.data ?? []);
      const next: TransportRefs = {
        companies: co as RefRow[],
        fuels: fu as FuelRef[],
        stations: st as StationRef[],
        carriers: ca as RefRow[],
        consignees: cn as ConsigneeRef[],
        factories: fa as RefRow[],
        forwarders: fw as RefRow[],
        routes: ro as RouteRef[],
        buyers: (bu as { id: string; full_name: string; short_name: string | null }[])
          .map((b) => ({ id: b.id, name: b.short_name || b.full_name })),
      };
      cache = next;
      setRefs(next);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  return { refs, loading };
}

/** Сбросить кэш — после правки справочника из другой вкладки. */
export function invalidateTransportRefs() {
  cache = null;
}

"use client";

/**
 * Module-level cache for reference data shared across pages.
 *
 * Every page that lets the operator pick a supplier / buyer / fuel-type
 * etc. used to do its own Promise.all of 5–13 queries on mount — those
 * round-trips were the main reason /deals and /deals/[id] felt sluggish
 * on cold navigation. With this cache:
 *   • the first page that needs refs pays once for the parallel fan-out
 *   • every subsequent page reads the resolved data synchronously
 *   • a 5-minute TTL means edits in /spravochnik propagate without a
 *     reload (close enough — operators rarely add a supplier and then
 *     pick it within 5 minutes; if they do, a refresh fixes it)
 *
 * The dashboard layout warms the cache as soon as auth resolves so
 * dropdowns are ready by the time the user navigates.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type RefOpt = { id: string; name: string };
export type CounterpartyRef = { id: string; short_name: string | null; full_name: string };
export type ProfileRef = { id: string; full_name: string };
// Fuel types carry a colour swatch — passport-table renders it as the
// dot beside the fuel name. Loaded once so the dots stay in sync with
// the spravochnik even though deals queries don't embed the join.
export type FuelTypeRef = { id: string; name: string; color: string | null };

export type GlobalRefs = {
  suppliers: CounterpartyRef[];
  buyers: CounterpartyRef[];
  forwarders: RefOpt[];
  managers: ProfileRef[];
  stations: RefOpt[];
  companyGroups: RefOpt[];
  factories: RefOpt[];
  fuelTypes: FuelTypeRef[];
  quotationTypes: RefOpt[];
  consignees: RefOpt[];
};

const EMPTY: GlobalRefs = {
  suppliers: [], buyers: [], forwarders: [], managers: [],
  stations: [], companyGroups: [], factories: [], fuelTypes: [],
  quotationTypes: [], consignees: [],
};

const TTL_MS = 5 * 60_000;

type CacheState = { promise: Promise<GlobalRefs>; data: GlobalRefs | null; ts: number };
let cached: CacheState | null = null;

function fetchAll(): Promise<GlobalRefs> {
  const sb = createClient();
  // Warm path = only the refs every /deals + /registry page touches.
  // consignees + quotationTypes lazy-loaded by getLazyRefs() — they
  // aren't on the critical path of the first page render.
  // allSettled — one missing table shouldn't tank every other dropdown.
  const queries = [
    sb.from("counterparties").select("id, short_name, full_name").eq("type", "supplier").eq("is_active", true).order("full_name"),
    sb.from("counterparties").select("id, short_name, full_name").eq("type", "buyer").eq("is_active", true).order("full_name"),
    sb.from("forwarders").select("id, name").eq("is_active", true).order("name"),
    sb.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    sb.from("stations").select("id, name").eq("is_active", true).order("name"),
    sb.from("company_groups").select("id, name").eq("is_active", true).order("name"),
    sb.from("factories").select("id, name").eq("is_active", true).order("name"),
    sb.from("fuel_types").select("id, name, color").eq("is_active", true).order("sort_order"),
  ];
  return Promise.allSettled(queries).then((rs) => {
    type Row = Record<string, unknown>;
    const pull = (i: number): Row[] => {
      const r = rs[i];
      if (r.status !== "fulfilled") return [];
      const v = (r.value as unknown as { data: Row[] | null }).data;
      return v ?? [];
    };
    const refs: GlobalRefs = {
      suppliers: pull(0) as unknown as CounterpartyRef[],
      buyers: pull(1) as unknown as CounterpartyRef[],
      forwarders: pull(2) as unknown as RefOpt[],
      managers: pull(3) as unknown as ProfileRef[],
      stations: pull(4) as unknown as RefOpt[],
      companyGroups: pull(5) as unknown as RefOpt[],
      factories: pull(6) as unknown as RefOpt[],
      fuelTypes: pull(7) as unknown as FuelTypeRef[],
      quotationTypes: [],
      consignees: [],
    };
    // Lazy-fire the rarely-needed lookups in the background — they
    // populate the cache so the few pages that consume them (e.g.
    // /deals/[id] quotation variant picker, /spravochnik/consignees)
    // already have them by the time the operator navigates there.
    queueMicrotask(() => { void getLazyRefs(refs); });
    return refs;
  });
}

async function getLazyRefs(target: GlobalRefs): Promise<void> {
  const sb = createClient();
  const [qt, co] = await Promise.allSettled([
    sb.from("quotation_product_types").select("id, name").eq("is_active", true).order("sort_order"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sb.from as any)("consignees").select("id, name").eq("is_active", true).order("name"),
  ]);
  type Row = Record<string, unknown>;
  const pull = (r: PromiseSettledResult<unknown>): Row[] => {
    if (r.status !== "fulfilled") return [];
    const v = (r.value as unknown as { data: Row[] | null }).data;
    return v ?? [];
  };
  target.quotationTypes = pull(qt) as unknown as RefOpt[];
  target.consignees = pull(co) as unknown as RefOpt[];
}

export function getGlobalRefs(): Promise<GlobalRefs> {
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.promise;
  const promise = fetchAll();
  const state: CacheState = { promise, data: null, ts: Date.now() };
  cached = state;
  promise.then((d) => { state.data = d; }).catch(() => { cached = null; });
  return promise;
}

export function getCachedRefsSync(): GlobalRefs | null {
  if (!cached) return null;
  return cached.data;
}

export function invalidateGlobalRefs() {
  cached = null;
}

/**
 * Hook variant — returns the cached refs immediately if available
 * (`ready` is true on first render), or warms the cache and updates
 * once the promise resolves.
 *
 * Components that previously did
 *   const [refs, setRefs] = useState({...empty}); useEffect(() => fetch...)
 * can swap to this and skip both the boilerplate AND the per-mount
 * network round-trip.
 */
export function useGlobalRefs(): { refs: GlobalRefs; ready: boolean } {
  const initial = getCachedRefsSync();
  const [refs, setRefs] = useState<GlobalRefs>(initial ?? EMPTY);
  const [ready, setReady] = useState<boolean>(initial != null);
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    getGlobalRefs()
      .then((d) => { if (!cancelled) { setRefs(d); setReady(true); } })
      .catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { refs, ready };
}

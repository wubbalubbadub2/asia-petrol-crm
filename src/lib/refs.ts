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
  // full_name carries the legal-form prefix («ОсОО "АБ Линк"»,
  // «Singularity Trading GmbH»). Needed by the registry bulk-add
  // dialog to auto-tick «Продублировать отгрузку» on ОсОО↔ОсОО /
  // ОсОО↔Singularity chains (operator request 2026-06-24).
  companyGroups: (RefOpt & { full_name?: string | null })[];
  factories: RefOpt[];
  fuelTypes: FuelTypeRef[];
  quotationTypes: RefOpt[];
  consignees: RefOpt[];
  // Типы базиса поставки (00136): FCA / CPT / DAP / EXW + всё, что
  // менеджеры добавят сами. Ленивая загрузка — нужны только редактору
  // вариантов цены и справочнику.
  deliveryBases: RefOpt[];
};

const EMPTY: GlobalRefs = {
  suppliers: [], buyers: [], forwarders: [], managers: [],
  stations: [], companyGroups: [], factories: [], fuelTypes: [],
  quotationTypes: [], consignees: [], deliveryBases: [],
};

const TTL_MS = 5 * 60_000;

type CacheState = { promise: Promise<GlobalRefs>; data: GlobalRefs | null; ts: number };
let cached: CacheState | null = null;
// Подписчики на обновление кэша: без них принудительный перезапрос
// чинит только тот список, из которого его вызвали, а соседние
// остаются пустыми.
const listeners = new Set<(refs: GlobalRefs) => void>();

// usable=false — ответ, который НЕЛЬЗЯ класть в кэш: часть запросов
// упала, либо все справочники пришли пустыми (см. fetchAll).
type FetchResult = { refs: GlobalRefs; usable: boolean };

function fetchAll(): Promise<FetchResult> {
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
    sb.from("company_groups").select("id, name, full_name").eq("is_active", true).order("name"),
    sb.from("factories").select("id, name").eq("is_active", true).order("name"),
    sb.from("fuel_types").select("id, name, color").eq("is_active", true).order("sort_order"),
  ];
  return Promise.allSettled(queries).then((rs) => {
    type Row = Record<string, unknown>;
    let failed = false;
    const pull = (i: number): Row[] => {
      const r = rs[i];
      if (r.status !== "fulfilled") { failed = true; return []; }
      const v = r.value as unknown as { data: Row[] | null; error: unknown };
      // PostgREST отдаёт ошибку в поле error, а промис при этом
      // резолвится — без этой проверки сломанный запрос выглядел бы
      // как «справочник пуст».
      if (v.error) { failed = true; return []; }
      return v.data ?? [];
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
      deliveryBases: [],
    };
    // Пустой ответ по ВСЕМ справочникам — это не «пустая база», а
    // сломанный запрос: RLS у нас `auth.uid() IS NOT NULL`, поэтому
    // запрос, ушедший до восстановления сессии, получает 200 [] БЕЗ
    // ошибки. Раньше такой ответ оседал в кэше и обрубал каждый
    // выпадающий список до перезагрузки страницы (баг 2026-08-04:
    // «Нет групп. Создайте в справочнике.» при 19 активных группах).
    const anyRows =
      refs.suppliers.length > 0 || refs.buyers.length > 0 ||
      refs.forwarders.length > 0 || refs.managers.length > 0 ||
      refs.stations.length > 0 || refs.companyGroups.length > 0 ||
      refs.factories.length > 0 || refs.fuelTypes.length > 0;
    const usable = !failed && anyRows;
    // Lazy-fire the rarely-needed lookups in the background — they
    // populate the cache so the few pages that consume them (e.g.
    // /deals/[id] quotation variant picker, /spravochnik/consignees)
    // already have them by the time the operator navigates there.
    // Непригодный ответ догружать нечем — сессии всё равно нет.
    if (usable) queueMicrotask(() => { void getLazyRefs(refs); });
    return { refs, usable };
  });
}

async function getLazyRefs(target: GlobalRefs): Promise<void> {
  const sb = createClient();
  const [qt, co, db] = await Promise.allSettled([
    sb.from("quotation_product_types").select("id, name").eq("is_active", true).order("sort_order"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sb.from as any)("consignees").select("id, name").eq("is_active", true).order("name"),
    // Базис поставки сортируется по sort_order, а не по имени: в
    // справочнике порядок FCA / CPT / DAP / EXW задан осмысленно
    // (00136), алфавит его бы перемешал.
    sb.from("delivery_bases").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  type Row = Record<string, unknown>;
  const pull = (r: PromiseSettledResult<unknown>): Row[] => {
    if (r.status !== "fulfilled") return [];
    const v = (r.value as unknown as { data: Row[] | null }).data;
    return v ?? [];
  };
  target.quotationTypes = pull(qt) as unknown as RefOpt[];
  target.consignees = pull(co) as unknown as RefOpt[];
  target.deliveryBases = pull(db) as unknown as RefOpt[];
}

export function getGlobalRefs(): Promise<GlobalRefs> {
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.promise;
  const fetched = fetchAll();
  const state: CacheState = {
    promise: fetched.then((r) => r.refs),
    data: null,
    ts: Date.now(),
  };
  cached = state;
  fetched
    .then((r) => {
      // Непригодный ответ не сохраняем — следующий вызов сходит заново,
      // иначе одна неудачная попытка глушит справочники на всю сессию.
      // Сравнение cached === state нужно, чтобы не обнулить более
      // свежую запись, если за это время успел уйти новый запрос.
      if (!r.usable) { if (cached === state) cached = null; return; }
      state.data = r.refs;
      // Разбудить уже смонтированные useGlobalRefs: иначе принудительный
      // перезапрос (invalidateGlobalRefs + getGlobalRefs) чинит только
      // того, кто его вызвал, а соседние списки остаются пустыми.
      listeners.forEach((l) => l(r.refs));
    })
    .catch(() => { if (cached === state) cached = null; });
  return state.promise;
}

export function getCachedRefsSync(): GlobalRefs | null {
  if (!cached) return null;
  return cached.data;
}

function isCacheStale(): boolean {
  return !cached || Date.now() - cached.ts >= TTL_MS;
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
    let cancelled = false;
    const apply = (d: GlobalRefs) => { if (!cancelled) { setRefs(d); setReady(true); } };
    // Подписка на обновления кэша — чтобы принудительный перезапрос из
    // любого места сессии дотянулся до всех открытых списков.
    listeners.add(apply);
    // Кэш свежий — берём как есть. Просроченный отдаём мгновенно, но
    // тихо перезапрашиваем: приложение — SPA со своими вкладками, живёт
    // часами без reload, и без этого правки в справочнике не доезжают
    // до открытой сессии вообще.
    if (!initial || isCacheStale()) {
      getGlobalRefs().then(apply).catch(() => { if (!cancelled) setReady(true); });
    }
    return () => { cancelled = true; listeners.delete(apply); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { refs, ready };
}

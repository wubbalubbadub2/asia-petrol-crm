"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export type ShipmentRecord = {
  id: string;
  registry_type: "KG" | "KZ";
  row_number: number | null;
  quarter: string | null;
  month: string | null;
  date: string | null;
  waybill_number: string | null;
  wagon_number: string | null;
  shipment_volume: number | null;
  destination_station_id: string | null;
  departure_station_id: string | null;
  fuel_type_id: string | null;
  deal_id: string | null;
  factory_id: string | null;
  supplier_id: string | null;
  forwarder_id: string | null;
  shipment_month: string | null;
  railway_tariff: number | null;
  buyer_id: string | null;
  rounded_tonnage_from_forwarder: number | null;
  shipped_tonnage_amount: number | null;
  // Migration 00050 — optional until applied + types regenerated
  shipped_tonnage_amount_override?: boolean | null;
  // Migration 00061 — manual override for the rolled-up volume («округл»)
  rounded_volume_override?: number | null;
  // Migration 00086 — per-row CEIL toggle. TRUE = CEIL(base) (current
  // behavior), FALSE = base as-is. KZ uses loading_volume as base; KG
  // uses shipment_volume. Optional until generated types catch up.
  round_volume?: boolean | null;
  // Migration 00072 — appendix labels per side. Free-text;
  // auto-resolves supplier_line_id / buyer_line_id when the registry
  // form matches them against the deal's variants.
  supplier_appendix?: string | null;
  buyer_appendix?: string | null;
  invoice_number: string | null;
  comment: string | null;
  loading_volume: number | null;
  company_group_id: string | null;
  additional_month: string | null;
  currency: string | null;
  created_at: string;
  // Joined — only `deal` is still embedded; deal_code / currency / year /
  // month aren't in the global refs cache and the per-row cost is
  // negligible. The other eight joins (destination_station,
  // departure_station, fuel_type, factory, forwarder, company_group,
  // supplier, buyer) used to ride this query too — they were eight
  // single-row sub-selects per shipment, which on a 5000+-row registry
  // cost the operator the 5–6 s cold paint. They've been dropped from
  // REG_SELECT; the page resolves names from useGlobalRefs() instead.
  deal?: { deal_code: string; currency: string | null; year: number | null; month: string | null } | null;
};

// Explicit projection — was `*` pulling every shipment_registry
// column whether the page uses it or not. Eight of the nine joined
// resources have been dropped (see ShipmentRecord above) — the
// rendering layer resolves names from the warmed global-refs cache,
// saving ~8 sub-selects × N rows of wire payload + JSON parse per
// chunk.
const REG_SELECT = `
  id, registry_type, row_number, quarter, month, date,
  waybill_number, wagon_number, shipment_volume, loading_volume,
  destination_station_id, departure_station_id,
  fuel_type_id, deal_id, factory_id, supplier_id, forwarder_id,
  buyer_id, company_group_id,
  shipment_month, additional_month,
  railway_tariff, rounded_tonnage_from_forwarder,
  shipped_tonnage_amount, shipped_tonnage_amount_override,
  rounded_volume_override, round_volume,
  supplier_appendix, buyer_appendix,
  invoice_number, comment, currency, created_at,
  deal:deals(deal_code, currency, year, month)
`;

// Stale-while-revalidate cache keyed by tab (KG / KZ). Navigating back
// to /registry after editing a shipment paints the previous snapshot
// instantly while a silent background fetch refreshes it. 60s TTL.
const registryCache = new Map<string, { data: ShipmentRecord[]; ts: number }>();
const REGISTRY_TTL_MS = 60_000;

// Pub-sub so a write from one tab/page propagates everywhere. The
// inline-edit handlers on /registry already call `reload()` after each
// updateRegistryEntry, but cross-page effects (a registry write should
// also invalidate the deal-bundle rollups for the affected deal) need
// this central hook.
const registryListeners = new Set<() => void>();
function notifyRegistry() {
  for (const fn of registryListeners) fn();
}
function subscribeRegistry(fn: () => void): () => void {
  registryListeners.add(fn);
  return () => { registryListeners.delete(fn); };
}

// Invalidate every cached tab snapshot — both KG and KZ — and force
// mounted useRegistry instances to refetch. Cheap because the page
// already painted the cached snapshot; the refetch happens in
// background and replaces silently.
export function invalidateRegistry() {
  for (const [k, entry] of registryCache) {
    // Drop ts to 0 so the next mount refetches but the painted data
    // stays visible during background reload.
    registryCache.set(k, { ...entry, ts: 0 });
  }
  notifyRegistry();
}

export function useRegistry(type: "KG" | "KZ") {
  const cached = registryCache.get(type);
  const isFresh = !!cached && Date.now() - cached.ts < REGISTRY_TTL_MS;
  const [data, setData] = useState<ShipmentRecord[]>(cached?.data ?? []);
  const [loading, setLoading] = useState(!cached);

  // Operator 2026-06-25: switching KG↔KZ tabs briefly showed previous
  // tab's records while the new tab loaded. Cause — useState's initial
  // value (above) is captured on first mount only; subsequent type
  // changes leave `data` pointing at the stale tab. Sync to the new
  // tab's cache (or empty) every time `type` changes so the swap is
  // instant for warmed tabs and shows the loading state for cold ones.
  useEffect(() => {
    const c = registryCache.get(type);
    setData(c?.data ?? []);
    setLoading(!c);
  }, [type]);

  const supabase = createClient();
  // Tracks the "currently requested" tab type. The paginated load below
  // can span many seconds; if the user flips KG → KZ mid-load the old
  // load must NOT call setData with KG rows, or the KZ tab silently
  // renders KG deals. Comparing the captured requestedType against this
  // ref at every page boundary lets the stale load short-circuit.
  const currentTypeRef = useRef(type);
  useEffect(() => { currentTypeRef.current = type; }, [type]);

  // Coalesce concurrent loads — operator 2026-06-25: «AbortError:
  // Lock broken by another request with the 'steal' option». After
  // 4b9d517's pub-sub refactor, rapid mutations could trigger several
  // load() calls in quick succession; Supabase's auth-refresh Web Lock
  // gets stolen by the next call and the in-flight one rejects.
  // Solution: serialise loads via inFlight + pending refs. While one
  // load runs, additional invalidations just set the pending flag; on
  // completion the load reruns once to pick up everything.
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);

  // Recognise the lock-contention error patterns Supabase emits when
  // the auth-token refresh lock gets stolen. These are transient and
  // safe to retry — surfacing them as red toasts to the operator is
  // noise (the data is fine; the request just lost a race).
  const isTransientLockError = (msg: string | undefined | null): boolean => {
    if (!msg) return false;
    return /aborterror|lock broken|'steal' option/i.test(msg);
  };

  const loadOnce = useCallback(async (): Promise<{ retryTransient: boolean }> => {
    const requestedType = type;
    // Two-step load: (1) HEAD with count:exact to learn the size,
    // (2) fire every page in parallel.
    const pageSize = 1000;
    const head = await supabase
      .from("shipment_registry")
      .select("id", { count: "exact", head: true })
      .eq("registry_type", requestedType);
    if (currentTypeRef.current !== requestedType) return { retryTransient: false };
    if (head.error) {
      if (isTransientLockError(head.error.message)) return { retryTransient: true };
      toast.error(`Ошибка загрузки реестра: ${head.error.message}`);
      return { retryTransient: false };
    }
    const total = head.count ?? 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const requests = Array.from({ length: pages }, (_, i) =>
      supabase
        .from("shipment_registry")
        .select(REG_SELECT)
        .eq("registry_type", requestedType)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(i * pageSize, (i + 1) * pageSize - 1),
    );
    const settled = await Promise.all(requests);
    if (currentTypeRef.current !== requestedType) return { retryTransient: false };
    const all: ShipmentRecord[] = [];
    let sawTransient = false;
    for (const r of settled) {
      if (r.error) {
        if (isTransientLockError(r.error.message)) { sawTransient = true; continue; }
        toast.error(`Ошибка загрузки реестра: ${r.error.message}`);
        continue;
      }
      // database.ts is stale on round_volume / supplier_appendix /
      // buyer_appendix (added by migrations 00072/00086) — cast through
      // unknown until `npm run types:db` is rerun.
      all.push(...((r.data ?? []) as unknown as ShipmentRecord[]));
    }
    if (sawTransient && all.length === 0) return { retryTransient: true };
    setData(all);
    registryCache.set(requestedType, { data: all, ts: Date.now() });
    setLoading(false);
    return { retryTransient: false };
  }, [supabase, type]);

  // Public load: serialise concurrent calls + retry once on transient
  // Supabase Web-Locks errors.
  const load = useCallback(async () => {
    if (inFlightRef.current) { pendingRef.current = true; return; }
    inFlightRef.current = true;
    try {
      const result = await loadOnce();
      if (result.retryTransient) {
        await new Promise((r) => setTimeout(r, 250));
        await loadOnce();
      }
    } finally {
      inFlightRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        // Coalesced trailing call — picks up any invalidation that
        // arrived mid-load.
        void load();
      }
    }
  }, [loadOnce]);

  useEffect(() => { if (!isFresh) load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [load]);

  // External-mutation listener: any write below (or from another page
  // editing the same shipments) bumps the registry pub-sub and we
  // refetch in background. The cached snapshot stays painted until the
  // new rows land.
  useEffect(() => {
    return subscribeRegistry(() => { load(); });
  }, [load]);

  return { data, loading, reload: load };
}

import type { TablesInsert, TablesUpdate } from "@/lib/types/database";
import { invalidateDealBundle } from "./use-deal-bundle";
import { invalidateAllDealsLists, invalidateDeal } from "./use-deals";

// Migration 00072 added supplier_appendix / buyer_appendix on
// shipment_registry. Until the generated database.ts is regenerated,
// the optional override here keeps inserts/updates type-clean.
type RegistryInsert = TablesInsert<"shipment_registry"> & {
  supplier_appendix?: string | null;
  buyer_appendix?: string | null;
};
// Override field is post-migration-00050; types here may run ahead of the
// generated database.ts until `npm run types:db` is rerun.
export type RegistryUpdate = TablesUpdate<"shipment_registry"> & {
  shipped_tonnage_amount_override?: boolean | null;
  rounded_volume_override?: number | null;
  round_volume?: boolean | null;
  supplier_appendix?: string | null;
  buyer_appendix?: string | null;
};

export async function createRegistryEntry(values: RegistryInsert) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shipment_registry")
    .insert(values)
    .select()
    .single();

  if (error) {
    toast.error(`Ошибка: ${error.message}`);
    return null;
  }
  toast.success("Запись добавлена в реестр");
  // Refresh every consumer that reads from these caches. The insert
  // affects: registry list (both tabs — same shipment_registry table),
  // deal bundle rollups (trigger updates deals.* totals), deals list
  // (shipped totals get denormalized onto the deals row).
  invalidateRegistry();
  if (data?.deal_id) {
    invalidateDealBundle(data.deal_id);
    invalidateDeal(data.deal_id);
  }
  invalidateAllDealsLists();
  return data;
}

export async function updateRegistryEntry(id: string, values: RegistryUpdate) {
  const supabase = createClient();
  // Read deal_id from the row BEFORE the update so the cross-cache
  // invalidation knows which deal bundle / deal row to refresh. We do
  // the read once up front rather than after the update to avoid an
  // extra round-trip; deal_id changes are rare.
  const { data: existingRow } = await supabase
    .from("shipment_registry")
    .select("deal_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("shipment_registry")
    .update(values)
    .eq("id", id);
  if (error) {
    toast.error(`Ошибка: ${error.message}`);
    throw error;
  }
  invalidateRegistry();
  // Invalidate both old and new deal if deal_id moved.
  const oldDealId = existingRow?.deal_id ?? null;
  const newDealId = (values as Record<string, unknown>).deal_id as string | undefined;
  for (const dId of new Set([oldDealId, newDealId].filter(Boolean) as string[])) {
    invalidateDealBundle(dId);
    invalidateDeal(dId);
  }
  invalidateAllDealsLists();
  return true;
}

export async function bulkInsertRegistry(records: RegistryInsert[]) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shipment_registry")
    .insert(records)
    .select();

  if (error) {
    toast.error(`Ошибка импорта: ${error.message}`);
    return null;
  }
  toast.success(`Импортировано ${data?.length ?? 0} записей`);
  invalidateRegistry();
  const dealIds = new Set<string>();
  for (const r of (data ?? []) as { deal_id?: string | null }[]) {
    if (r.deal_id) dealIds.add(r.deal_id);
  }
  for (const dId of dealIds) {
    invalidateDealBundle(dId);
    invalidateDeal(dId);
  }
  invalidateAllDealsLists();
  return data;
}

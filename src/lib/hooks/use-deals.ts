"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TablesInsert } from "@/lib/types/database";
import { toast } from "sonner";

export type Deal = {
  id: string;
  deal_type: "KG" | "KZ" | "OIL";
  deal_number: number;
  year: number;
  deal_code: string;
  quarter: string | null;
  month: string;
  factory_id: string | null;
  fuel_type_id: string | null;
  // Opcional anchor date for «Средний месяц» quotation pickup. Migration 00085.
  avg_month_date: string | null;
  sulfur_percent: string | null;
  supplier_id: string | null;
  supplier_contract: string | null;
  supplier_contracted_volume: number | null;
  supplier_contracted_amount: number | null;
  supplier_delivery_basis: string | null;
  supplier_quotation_comment: string | null;
  supplier_quotation: number | null;
  supplier_discount: number | null;
  supplier_price: number | null;
  supplier_price_condition: string | null;
  supplier_shipped_amount: number | null;
  supplier_shipped_volume: number | null;
  supplier_payment: number | null;
  supplier_payment_date: string | null;
  supplier_balance: number | null;
  supplier_departure_station_id: string | null;
  buyer_id: string | null;
  buyer_contract: string | null;
  buyer_delivery_basis: string | null;
  buyer_destination_station_id: string | null;
  buyer_contracted_volume: number | null;
  buyer_contracted_amount: number | null;
  buyer_quotation_comment: string | null;
  buyer_quotation: number | null;
  buyer_discount: number | null;
  buyer_price: number | null;
  buyer_price_condition: string | null;
  buyer_ordered_volume: number | null;
  buyer_remaining: number | null;
  buyer_shipped_volume: number | null;
  buyer_ship_date: string | null;
  buyer_shipped_amount: number | null;
  buyer_payment: number | null;
  buyer_payment_date: string | null;
  buyer_debt: number | null;
  forwarder_id: string | null;
  logistics_company_group_id: string | null;
  // Migration 00069 — overrides deal.month for tariff lookups when set.
  logistics_shipment_month?: string | null;
  planned_tariff: number | null;
  preliminary_tonnage: number | null;
  preliminary_amount: number | null;
  actual_tariff: number | null;
  actual_shipped_volume: number | null;
  invoice_volume: number | null;
  invoice_amount: number | null;
  additional_expenses_amount: number | null;
  additional_expenses_in_price: boolean | null;
  logistics_notes: string | null;
  surcharge_amount: number | null;
  surcharge_reinvoiced_to: string | null;
  railway_in_price: boolean | null;
  buyer_multi_deal_payments: string | null;
  buyer_snt_written: string | null;
  supplier_manager_id: string | null;
  buyer_manager_id: string | null;
  trader_id: string | null;
  currency: string | null;
  supplier_currency: string;
  buyer_currency: string;
  logistics_currency: string;
  is_archived: boolean;
  created_at: string;
  // Variant counts — denormalized onto the `deals` row by migration
  // 00092 (trigger-maintained). Always present from list/detail
  // queries; annotateLineCounts also back-fills them from the legacy
  // `supplier_lines.length` / `buyer_lines.length` arrays so older
  // cached payloads keep working.
  supplier_lines_count: number;
  buyer_lines_count: number;
  // Joined fields
  factory?: { name: string } | null;
  fuel_type?: { name: string; color: string } | null;
  supplier?: { full_name: string; short_name: string | null } | null;
  buyer?: { full_name: string; short_name: string | null } | null;
  forwarder?: { name: string } | null;
  supplier_manager?: { full_name: string } | null;
  buyer_manager?: { full_name: string } | null;
  trader?: { full_name: string } | null;
  buyer_destination_station?: { name: string } | null;
  supplier_departure_station?: { name: string } | null;
  logistics_company_group?: { name: string } | null;
  // Trimmed to the columns the passport-table list view actually reads
  // (LIST_SELECT). useDeal/DETAIL_SELECT still embeds the full set —
  // see DEAL_SELECT below — so the detail page keeps every field.
  deal_company_groups?: { id: string; position: number; company_group_id: string; price: number | null; price_kind: "preliminary" | "final"; quotation?: number | null; quotation_comment?: string | null; discount?: number | null; contract_ref?: string | null; currency?: string | null; company_group?: { name: string } | null }[];
  // Loaded for Excel export — pulls preliminary_price snapshot per variant.
  // Always carries at least the default line; we annotate counts post-fetch
  // (see annotateLineCounts).
  supplier_lines?: DealLineSnapshot[];
  buyer_lines?: DealLineSnapshot[];
};

// Shipment shape used by the click-popover breakdown on the passport
// volume cells. Loaded lazily per-deal (see fetchDealShipments below);
// never embedded into DEAL_SELECT — that embed alone was multiplying
// the deals list payload by ~5× because every row pulled its full
// shipment_registry tail in one round-trip.
export type ShipmentSnap = {
  id: string;
  wagon_number: string | null;
  waybill_number: string | null;
  loading_volume: number | null;
  shipment_volume: number | null;
  date: string | null;
};

// Module-level cache so the same deal isn't refetched when the operator
// reopens the popover or hops between volume cells of the same row.
// In-flight promises are stored too, so two near-simultaneous clicks
// don't double-fire the query.
const shipmentsCache = new Map<string, Promise<ShipmentSnap[]>>();
export function fetchDealShipments(dealId: string): Promise<ShipmentSnap[]> {
  const cached = shipmentsCache.get(dealId);
  if (cached) return cached;
  const sb = createClient();
  // Wrap with Promise.resolve — the PostgREST builder returns a
  // PromiseLike, not a full Promise, and Map<string, Promise<…>> needs
  // the real .catch / .finally surface.
  const p = Promise.resolve(
    sb
      .from("shipment_registry")
      .select("id, wagon_number, waybill_number, loading_volume, shipment_volume, date")
      .eq("deal_id", dealId),
  ).then(({ data, error }) => {
    if (error) {
      // Drop the failed entry so the next click retries instead of
      // returning the same rejected promise forever.
      shipmentsCache.delete(dealId);
      throw error;
    }
    return (data ?? []) as ShipmentSnap[];
  });
  shipmentsCache.set(dealId, p);
  return p;
}
export function invalidateDealShipments(dealId: string) {
  shipmentsCache.delete(dealId);
}

// Payment shape used by the click-popover breakdown on the passport
// payment cells. Loaded lazily per (deal, side); same Promise-cached
// pattern as fetchDealShipments — keeps the list query lean and avoids
// double-fetches on rapid clicks.
export type PaymentSnap = {
  id: string;
  payment_date: string;
  amount: number | null;
  currency: string | null;
  description: string | null;
  payment_type: string | null;
};

// Keyed by `${dealId}:${side}` — supplier/buyer payments live in the
// same table with a `side` discriminator, so the cache key has to
// distinguish them. In-flight promises live here too so a double-click
// on the same cell doesn't fan out into two requests.
const paymentsCache = new Map<string, Promise<PaymentSnap[]>>();
export function fetchDealPayments(
  dealId: string,
  side: "supplier" | "buyer",
): Promise<PaymentSnap[]> {
  const key = `${dealId}:${side}`;
  const cached = paymentsCache.get(key);
  if (cached) return cached;
  const sb = createClient();
  const p = Promise.resolve(
    sb
      .from("deal_payments")
      .select("id, payment_date, amount, currency, description, payment_type")
      .eq("deal_id", dealId)
      .eq("side", side)
      .order("payment_date", { ascending: true }),
  ).then(({ data, error }) => {
    if (error) {
      // Same retry-friendly policy as shipments — drop on failure so
      // the next click hits the network instead of the dead promise.
      paymentsCache.delete(key);
      throw error;
    }
    return (data ?? []) as PaymentSnap[];
  });
  paymentsCache.set(key, p);
  return p;
}
export function invalidateDealPayments(dealId: string, side?: "supplier" | "buyer") {
  if (side) {
    paymentsCache.delete(`${dealId}:${side}`);
  } else {
    paymentsCache.delete(`${dealId}:supplier`);
    paymentsCache.delete(`${dealId}:buyer`);
  }
}

// Most fields are optional because DEAL_SELECT only fetches `id` for
// the list view's count badge. The Excel export enriches deals via
// fetchDealLinesForExport (below) before reading these fields.
export type DealLineSnapshot = {
  id: string;
  is_default?: boolean;
  price?: number | null;
  price_stage?: "preliminary" | "final";
  preliminary_price?: number | null;
  preliminary_quotation?: number | null;
};

// Bulk-fetch the line snapshots for a set of deals. Used by the Excel
// export so the heavy column data isn't paid for on every passport
// refresh. One round-trip per side, IN-list scoped to visible deals.
export async function fetchDealLinesForExport(
  dealIds: string[],
): Promise<{ supplier: Map<string, DealLineSnapshot[]>; buyer: Map<string, DealLineSnapshot[]> }> {
  if (dealIds.length === 0) return { supplier: new Map(), buyer: new Map() };
  const sb = createClient();
  const [supRes, buyRes] = await Promise.all([
    sb
      .from("deal_supplier_lines")
      .select("id, deal_id, is_default, price, price_stage, preliminary_price, preliminary_quotation")
      .in("deal_id", dealIds),
    sb
      .from("deal_buyer_lines")
      .select("id, deal_id, is_default, price, price_stage, preliminary_price, preliminary_quotation")
      .in("deal_id", dealIds),
  ]);
  function group(rows: { deal_id: string }[] | null) {
    const m = new Map<string, DealLineSnapshot[]>();
    for (const r of rows ?? []) {
      const arr = m.get(r.deal_id) ?? [];
      arr.push(r as unknown as DealLineSnapshot);
      m.set(r.deal_id, arr);
    }
    return m;
  }
  return { supplier: group(supRes.data), buyer: group(buyRes.data) };
}

// LIST_SELECT — minimal projection for the deals list. We dropped the
// 7 single-row FK joins (factory / fuel_type / supplier / buyer /
// forwarder / supplier_manager / logistics_company_group) because
// passport-table now resolves those names from the global refs cache
// (see lib/refs.ts). Every dropped join was a sub-select per row on
// PostgREST; removing them cuts the deals query latency
// significantly. deal_company_groups stays embedded — it carries
// per-deal data (price/price_kind) that isn't in any reference
// table — but the embed is trimmed to ONLY the columns the list view
// reads. quotation / quotation_comment / discount / contract_ref /
// currency are detail-only and read via DEAL_SELECT on the deal page.
//
// supplier_lines:deal_supplier_lines(id) and buyer_lines:deal_buyer_lines(id)
// embeds were dropped entirely (migration 00092). The passport list only
// uses these to render the "+N лин." count badge — that count now lives
// directly on the `deals` row as supplier_lines_count / buyer_lines_count,
// maintained by AFTER INSERT/UPDATE/DELETE triggers on the lines tables.
// Dropping the embeds cuts the wire payload from ~1.28 MB to ~250 KB
// for a typical 500-deal list (perf agent audit, 2026-06-18).
//
// company_group name on each deal_company_groups row also resolves
// from the refs cache — no nested join needed.
const LIST_SELECT = `
  id, deal_type, deal_number, year, deal_code, quarter, month,
  factory_id, fuel_type_id, sulfur_percent,
  supplier_id, supplier_contract, supplier_delivery_basis,
  supplier_contracted_volume, supplier_contracted_amount, supplier_price,
  supplier_quotation, supplier_discount,
  supplier_shipped_amount, supplier_shipped_volume,
  supplier_payment, supplier_payment_date, supplier_balance,
  supplier_currency, supplier_manager_id,
  buyer_id, buyer_contract, buyer_delivery_basis,
  buyer_contracted_volume, buyer_contracted_amount, buyer_price,
  buyer_quotation, buyer_discount,
  buyer_ordered_volume, buyer_shipped_volume, buyer_shipped_amount,
  buyer_payment, buyer_payment_date, buyer_debt,
  buyer_currency, buyer_manager_id, trader_id,
  buyer_destination_station_id, supplier_departure_station_id,
  forwarder_id, logistics_company_group_id, logistics_shipment_month,
  preliminary_tonnage, preliminary_amount, planned_tariff, actual_tariff,
  actual_shipped_volume, invoice_amount, invoice_volume,
  additional_expenses_amount, additional_expenses_in_price,
  logistics_currency, currency, is_archived, is_draft, created_at,
  supplier_lines_count, buyer_lines_count,
  deal_company_groups(id, position, company_group_id, price, price_kind)
`;
// quotation + discount were missing from this projection — operator
// 2026-06-23: «при выгрузке в Excel не выгружаются данные если есть
// скидка». The Excel exporter reads d.supplier_discount /
// d.buyer_discount and friends, but absent fields came back as
// `undefined`, surfacing as empty cells in the .xlsx. Now included so
// the export carries the same numbers the operator sees on the
// passport tile.

// DETAIL_SELECT — full join set, used by useDeal on the deal-detail
// page where every relation is rendered and resolving via refs cache
// would require threading the cache into many subcomponents.
const DEAL_SELECT = `
  *,
  factory:factories(name),
  fuel_type:fuel_types(name, color),
  supplier:counterparties!supplier_id(full_name, short_name),
  buyer:counterparties!buyer_id(full_name, short_name),
  forwarder:forwarders(name),
  supplier_manager:profiles!supplier_manager_id(full_name),
  buyer_manager:profiles!buyer_manager_id(full_name),
  trader:profiles!trader_id(full_name),
  buyer_destination_station:stations!buyer_destination_station_id(name),
  supplier_departure_station:stations!supplier_departure_station_id(name),
  logistics_company_group:company_groups!logistics_company_group_id(name),
  deal_company_groups(id, position, company_group_id, price, price_kind, quotation, quotation_comment, discount, contract_ref, currency, company_group:company_groups(name)),
  supplier_lines:deal_supplier_lines(id),
  buyer_lines:deal_buyer_lines(id)
`;
// NOTE: lines arrays carry only `id` here — they're used purely for the
// «+N лин.» count badge in passport-table (see annotateLineCounts). The
// Excel export enriches them on demand via fetchDealLinesForExport so
// the list payload stays small.

// Line counts now come straight from the deals row (supplier_lines_count /
// buyer_lines_count columns, maintained by triggers — see migration
// 00092_deal_lines_counts.sql). DETAIL_SELECT still pulls the id-only
// arrays so legacy code paths read `.supplier_lines?.length ?? 0` work.
// We keep this helper around for backwards compatibility so callers
// don't all need refactoring; it falls back to array length if the
// columns aren't present (e.g. a stale cache from before the migration).
type WithLines = {
  supplier_lines?: { id: string }[];
  buyer_lines?: { id: string }[];
  supplier_lines_count?: number;
  buyer_lines_count?: number;
};
function annotateLineCounts<T extends WithLines>(rows: T[]): (T & Deal)[] {
  return rows.map((r) => ({
    ...(r as unknown as Deal),
    supplier_lines_count: r.supplier_lines_count ?? r.supplier_lines?.length ?? 0,
    buyer_lines_count: r.buyer_lines_count ?? r.buyer_lines?.length ?? 0,
  })) as (T & Deal)[];
}

export type DealFilters = {
  // ── Server-axis filters (round-trip required) ─────────────────────
  // Only `year` and `isArchived` actually affect the network query
  // and the SWR cache key. Everything else in this type is CLIENT-ONLY
  // (see below) — kept here for backwards compat with existing callers,
  // but ignored by fetchDealsList / useDeals.
  year?: number;
  isArchived?: boolean;
  // ── Client-only filters (ignored by useDeals/fetchDealsList) ──────
  // These fields are NOT pushed to PostgREST and do NOT participate in
  // the cache key. The page (src/app/(dashboard)/deals/page.tsx) applies
  // them in-memory via a useMemo against the cached year's deal set.
  // For 500-ish deals an array .filter() runs in <5 ms — orders of
  // magnitude faster than a 1.5–2 s network refetch per filter change.
  // The fields stay on the type so existing call sites compile; they're
  // simply dead args at this layer.
  dealType?: "KG" | "KZ" | "OIL";
  month?: string;
  supplierId?: string;
  buyerId?: string;
  factoryId?: string;
  fuelTypeId?: string;
  forwarderId?: string;
  companyGroupId?: string;
  companyGroupPos1Id?: string | null;
  companyGroupPos2Id?: string | null;
  logisticsCompanyGroupId?: string;
  applicationContract?: string;
  searchCode?: string;
};

// Module-level stale-while-revalidate cache. Keyed by JSON-stringified
// filters so the same (year, page, supplier=…) combo seen twice in a
// session paints instantly from memory while a background fetch
// refreshes it. 60s TTL — quick enough that mutations made on the
// detail page are picked up after a short revisit, slow enough that
// navigating between sibling pages feels native.
//
// `promise` is the in-flight fetch (if any). When the layout-level
// prefetch is mid-air and the page-level useDeals mounts, both used to
// fire the same query and double the backend load. Now the second
// caller awaits the same promise — true single-flight dedup. The
// promise resolves to the settled result, which is the same data
// written into `data` + `total` + `ts` once the fetch finishes.
type DealsCacheEntry = {
  promise: Promise<{ data: Deal[]; total: number }> | null;
  data: Deal[] | null;
  total: number;
  ts: number;
};
const dealsCache = new Map<string, DealsCacheEntry>();
const DEALS_TTL_MS = 60_000;
// dealByIdCache is also used by useDeals to pre-seed each visible row
// so the detail page opens instantly when clicked from the list.
const dealByIdCache = new Map<string, { data: Deal; ts: number }>();
const DEAL_TTL_MS = 60_000;

// ── Pub-sub for cache updates ───────────────────────────────────────
// Mutations (updateDeal, line edits, registry edits…) need to push a
// re-render into every mounted useDeals / useDeal that currently reflects
// the affected row — otherwise the operator has to refresh the page
// before the new value paints. (Operator complaint 2026-06-24.)
//
// We use a single revision counter per logical cache slice. Subscribers
// bump local state when the revision moves; the actual patched data lives
// in the module-level Maps above, so the new render reads the freshest
// snapshot synchronously.
type Listener = () => void;
const dealsListeners = new Set<Listener>();
const dealByIdListeners = new Map<string, Set<Listener>>();

function notifyDeals() {
  for (const fn of dealsListeners) fn();
}
function notifyDeal(id: string) {
  const ls = dealByIdListeners.get(id);
  if (ls) for (const fn of ls) fn();
}
function subscribeDeals(fn: Listener): () => void {
  dealsListeners.add(fn);
  return () => { dealsListeners.delete(fn); };
}
function subscribeDeal(id: string, fn: Listener): () => void {
  let ls = dealByIdListeners.get(id);
  if (!ls) { ls = new Set(); dealByIdListeners.set(id, ls); }
  ls.add(fn);
  return () => {
    const set = dealByIdListeners.get(id);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) dealByIdListeners.delete(id);
  };
}

// Pluggable cross-cache invalidator. use-deal-bundle.ts registers itself
// here at module load so use-deals.ts doesn't need to import it (would
// create a cycle). When updateDeal lands, the bundle cache for that
// deal is dropped too so the next deal-detail visit refetches.
let bundleInvalidator: ((dealId: string) => void) | null = null;
export function registerBundleInvalidator(fn: (dealId: string) => void) {
  bundleInvalidator = fn;
}

// Optimistically patch the local Deal caches without a round-trip and
// notify every mounted subscriber. Called by updateDeal after a
// successful DB write; also safe to call externally if a mutation has
// already persisted by another path.
export function applyDealPatch(id: string, patch: Record<string, unknown>) {
  const now = Date.now();
  const existing = dealByIdCache.get(id);
  if (existing) {
    const merged = { ...existing.data, ...(patch as Partial<Deal>) } as Deal;
    dealByIdCache.set(id, { data: merged, ts: now });
  }
  // Patch every dealsCache entry that contains this row. The list
  // payload carries a subset of fields — Object.assign on the row
  // mutates the same object reference inside the cached array.
  for (const [, entry] of dealsCache) {
    if (!entry.data) continue;
    const idx = entry.data.findIndex((d) => d.id === id);
    if (idx === -1) continue;
    entry.data[idx] = { ...entry.data[idx], ...(patch as Partial<Deal>) };
  }
  // Bundle cache (deal-detail page) carries a richer snapshot. Drop it
  // so the next visit refetches with the trigger-recomputed derived
  // columns (supplier_balance, buyer_debt, etc).
  bundleInvalidator?.(id);
  notifyDeal(id);
  notifyDeals();
}

// Invalidate-only escape hatch. Forces the next read for this id to
// hit the network. Used after destructive ops or when the patch shape
// is unknown (e.g. trigger recomputed many columns server-side).
export function invalidateDeal(id: string) {
  dealByIdCache.delete(id);
  for (const [key, entry] of dealsCache) {
    // Stale-flag the entry — keep painted data, force background
    // revalidate on next mount.
    dealsCache.set(key, { ...entry, ts: 0 });
  }
  bundleInvalidator?.(id);
  notifyDeal(id);
  notifyDeals();
}

// Used by use-registry / use-deal-lines after a write so the deals
// list's denormalized counters (supplier_lines_count, shipped totals
// recomputed by triggers) get refreshed on next read.
export function invalidateAllDealsLists() {
  for (const [key, entry] of dealsCache) {
    dealsCache.set(key, { ...entry, ts: 0 });
  }
  notifyDeals();
}

// Run the actual paged fetch and write the result into dealsCache.
// Factored out so prefetchDeals and useDeals can share a single promise
// via the cache's `promise` slot (true single-flight dedup).
//
// Architecture (2026-06-18 perf overhaul): we only round-trip the
// year/archive axes. Every other filter — dealType (tab), supplier,
// buyer, factory, fuel, month, forwarder, company-group (any/pos1/pos2),
// application contract, search — runs CLIENT-SIDE in the page layer
// against the deals array. For ~500 deals this is <5 ms, vs. ~1.5–2 s
// per network refetch on every dropdown change. The cache is keyed
// only on (year, isArchived) so the operator can toggle filters
// freely without invalidating it.
async function fetchDealsList(
  cacheKey: string,
  filters?: DealFilters,
): Promise<{ data: Deal[]; total: number }> {
  const sb = createClient();
  const PAGE = 1000;
  const baseFilter = (qb: ReturnType<typeof sb.from>) => {
    let q = qb.select(LIST_SELECT) as ReturnType<typeof qb.select>;
    // is_draft is now backfilled NOT NULL DEFAULT false (migration
    // 00091) so this is a sargable single-predicate filter instead
    // of a NULLS OR.
    q = q.eq("is_draft", false);
    if (filters?.year) q = q.eq("year", filters.year);
    if (filters?.isArchived !== undefined) q = q.eq("is_archived", filters.isArchived);
    // Newest deals first — operator request 2026-06-26: «как создадим,
    // приходится листать вниз». Sort by year DESC (current year on
    // top), then deal_number DESC inside each year (latest created
    // number first since deal_sequences increments monotonically).
    return q.order("year", { ascending: false }).order("deal_number", { ascending: false });
  };

  const all: unknown[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await baseFilter(sb.from("deals")).range(from, from + PAGE - 1);
    if (error) {
      // Drop the in-flight promise on failure so a retry can fire.
      const entry = dealsCache.get(cacheKey);
      if (entry) dealsCache.set(cacheKey, { ...entry, promise: null });
      throw error;
    }
    const batch = (data ?? []) as unknown[];
    all.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  const rows = annotateLineCounts(all as WithLines[]) as unknown as Deal[];
  const total = rows.length;
  dealsCache.set(cacheKey, { promise: null, data: rows, total, ts: Date.now() });
  const now = Date.now();
  for (const d of rows) dealByIdCache.set(d.id, { data: d, ts: now });
  return { data: rows, total };
}

// Cache key is intentionally narrow: only the SERVER-axis filters
// participate. dealType / supplierId / buyerId / factory / fuel /
// month / forwarder / company-group(*) / applicationContract /
// searchCode are now client-side (see DealFilters comments) and must
// NOT invalidate the cache when they change — that was the cause of
// the ~2 s filter lag reported on 2026-06-18.
function buildCacheKey(filters?: DealFilters): string {
  return JSON.stringify({
    year: filters?.year ?? null,
    isArchived: filters?.isArchived ?? null,
  });
}

// Standalone fetcher — same logic as useDeals' internal load, but
// callable from non-React contexts (e.g. the dashboard layout's
// effect-less warm-up). Writes straight into dealsCache so the
// subsequent useDeals call paints synchronously. If a fetch is already
// in-flight for this key (from useDeals or another prefetch call), we
// reuse that promise instead of issuing a duplicate request.
export async function prefetchDeals(filters?: DealFilters): Promise<void> {
  const cacheKey = buildCacheKey(filters);
  const cached = dealsCache.get(cacheKey);
  if (cached) {
    if (cached.data && Date.now() - cached.ts < DEALS_TTL_MS) return;
    if (cached.promise) {
      // Someone else is already fetching this key — piggyback.
      try { await cached.promise; } catch { /* swallowed — caller's problem */ }
      return;
    }
  }
  const promise = fetchDealsList(cacheKey, filters);
  // Seed the cache with the in-flight promise BEFORE awaiting so
  // concurrent callers (useDeals, second prefetchDeals) can find it.
  dealsCache.set(cacheKey, {
    promise,
    data: cached?.data ?? null,
    total: cached?.total ?? 0,
    ts: cached?.ts ?? 0,
  });
  try { await promise; } catch { /* errors surfaced via toast inside useDeals; prefetch is best-effort */ }
}

export function useDeals(filters?: DealFilters) {
  const cacheKey = buildCacheKey(filters);
  const cached = dealsCache.get(cacheKey);
  const isFresh = !!cached?.data && Date.now() - cached.ts < DEALS_TTL_MS;

  const [data, setData] = useState<Deal[]>(cached?.data ?? []);
  const [totalCount, setTotalCount] = useState(cached?.total ?? 0);
  // Only show a top-level «loading» when we have nothing to render —
  // a cached snapshot, even slightly stale, beats a blocker.
  const [loading, setLoading] = useState(!cached?.data);

  // Client wanted the passport back as one scrollable list — no
  // pagination controls. We still paginate INTERNALLY against the
  // 1000-row PostgREST cap inside fetchDealsList, streaming every
  // page into a single array and only flipping loading=false once.
  // LIST_SELECT is now lean enough (no FK joins, no line-array embeds —
  // the line counts are denormalized columns maintained by triggers,
  // migration 00092) that even ~500 rows come back well under a second.
  const load = useCallback(async () => {
    // Single-flight dedup: if there's already an in-flight fetch for
    // this filter combo (e.g. dashboard layout fired prefetchDeals a
    // few ms ago), await IT instead of starting a duplicate.
    const existing = dealsCache.get(cacheKey);
    let promise = existing?.promise;
    if (!promise) {
      promise = fetchDealsList(cacheKey, filters);
      dealsCache.set(cacheKey, {
        promise,
        data: existing?.data ?? null,
        total: existing?.total ?? 0,
        ts: existing?.ts ?? 0,
      });
    }
    try {
      const { data: rows, total } = await promise;
      setData(rows);
      setTotalCount(total);
    } catch (err) {
      toast.error(`Ошибка загрузки сделок: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters?.year, filters?.isArchived]);

  // Skip the background revalidation when the cached snapshot is still
  // fresh and we already painted it — saves a round-trip on rapid
  // navigation between sibling pages.
  useEffect(() => { if (!isFresh) load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [load]);

  // Subscribe to global mutations. After applyDealPatch / invalidateDeal
  // bumps the cache, we either repaint optimistically from the patched
  // cache snapshot or kick a fresh load if the entry was staled.
  useEffect(() => {
    return subscribeDeals(() => {
      const entry = dealsCache.get(cacheKey);
      if (!entry) return;
      // Stale-flagged (ts=0) → trigger a refetch. Patched entries keep
      // their ts and just need a re-render with the mutated array
      // reference (Array.from forces React to see a new identity).
      if (entry.data && entry.ts === 0) {
        load();
      } else if (entry.data) {
        setData(Array.from(entry.data));
        setTotalCount(entry.total);
      }
    });
  }, [cacheKey, load]);

  return { data, totalCount, loading, reload: load };
}

// dealByIdCache + DEAL_TTL_MS are declared above (hoisted for useDeals'
// pre-seed loop). useDeal reads from the same Map so seeded entries
// surface instantly when a row is clicked.
export function useDeal(id: string | null) {
  const cached = id ? dealByIdCache.get(id) : null;
  const isFresh = !!cached && Date.now() - cached.ts < DEAL_TTL_MS;
  const [data, setData] = useState<Deal | null>(cached?.data ?? null);
  // Only block render when we have absolutely nothing to show.
  const [loading, setLoading] = useState(!cached);
  const supabaseRef2 = useRef(createClient());

  // Note on `loading`: we deliberately do NOT toggle it back to true
  // on subsequent loads. The deal-detail page has
  //   `if (loading) return <p>Загрузка сделки...</p>`
  // which would unmount the entire tree on every refetch — and the
  // page is refetched after every field edit (DealReloadContext).
  // Unmount/remount resets scroll, focus, and component-local state
  // (expanded panels, pendingVal refs, etc). Initial mount toggles
  // loading once via `useState(true)`; reloads silently swap `data`.
  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    const { data, error } = await supabaseRef2.current
      .from("deals")
      .select(DEAL_SELECT)
      .eq("id", id)
      .single();
    if (error) {
      toast.error(`Ошибка загрузки сделки: ${error.message}`);
    } else if (data) {
      const [annotated] = annotateLineCounts([data as unknown as WithLines]);
      const deal = annotated as unknown as Deal;
      setData(deal);
      dealByIdCache.set(id, { data: deal, ts: Date.now() });
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { if (!isFresh) load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [load]);

  // Subscribe to global patches/invalidations for this specific id.
  useEffect(() => {
    if (!id) return;
    return subscribeDeal(id, () => {
      const entry = dealByIdCache.get(id);
      if (entry) {
        // Optimistic — paint from the patched snapshot immediately.
        setData({ ...entry.data });
      } else {
        // Entry was wiped (delete or invalidate without a patch). Refetch
        // so derived columns coming back from the DB trigger are picked up.
        load();
      }
    });
  }, [id, load]);

  return { data, loading, reload: load };
}

export async function createDeal(values: Omit<TablesInsert<"deals">, "deal_number">) {
  const supabase = createClient();

  // Generate deal number
  const dealType = values.deal_type;
  const year = values.year;

  const { data: numData, error: numError } = await supabase
    .rpc("generate_deal_number", { p_type: dealType, p_year: year });

  if (numError) {
    toast.error(`Ошибка генерации номера: ${numError.message}`);
    return null;
  }

  const dealNumber = numData as number;

  const { data, error } = await supabase
    .from("deals")
    .insert({ ...values, deal_number: dealNumber })
    .select()
    .single();

  if (error) {
    toast.error(`Ошибка создания сделки: ${error.message}`);
    return null;
  }

  toast.success(
    `Сделка ${dealType}/${String(year % 100).padStart(2, "0")}/${String(dealNumber).padStart(3, "0")} создана`,
  );
  // The new row isn't in any list cache yet — invalidate so a navigation
  // to /deals immediately refetches and shows it.
  invalidateAllDealsLists();
  return data;
}

export async function updateDeal(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const { error } = await supabase.from("deals").update(values).eq("id", id);
  if (error) {
    toast.error(`Ошибка сохранения: ${error.message}`);
    throw error;
  }
  // Optimistic propagation: every mounted useDeals / useDeal subscriber
  // sees the patched value without a manual refresh. The bundle cache
  // for this deal is also dropped (registered invalidator) so the next
  // /deals/[id] visit re-fetches and picks up trigger-recomputed derived
  // columns (supplier_balance, buyer_debt, preliminary_amount, etc).
  applyDealPatch(id, values);
  return true;
}

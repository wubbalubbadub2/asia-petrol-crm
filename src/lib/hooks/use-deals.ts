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
  // Variant counts — populated post-fetch from the embedded line arrays.
  supplier_lines_count?: number;
  buyer_lines_count?: number;
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
  deal_company_groups?: { id: string; position: number; company_group_id: string; price: number | null; price_kind: "preliminary" | "final"; quotation: number | null; quotation_comment: string | null; discount: number | null; contract_ref: string | null; currency: string | null; company_group: { name: string } | null }[];
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
// per-deal data (price/discount/etc) that isn't in any reference
// table.
// company_group name on each deal_company_groups row also resolves
// from the refs cache — drop the nested join so the list query is
// purely from the `deals` table + 3 lightweight `id`-only embeds.
// Explicit column list — was `*` pulling all ~75 columns; passport-
// table reads ~35. Halves wire payload + JSON parse cost (perf agent
// audit, 2026-06-17).
const LIST_SELECT = `
  id, deal_type, deal_number, year, deal_code, quarter, month,
  factory_id, fuel_type_id, sulfur_percent,
  supplier_id, supplier_contract, supplier_delivery_basis,
  supplier_contracted_volume, supplier_contracted_amount, supplier_price,
  supplier_shipped_amount, supplier_shipped_volume,
  supplier_payment, supplier_payment_date, supplier_balance,
  supplier_currency, supplier_manager_id,
  buyer_id, buyer_contract, buyer_delivery_basis,
  buyer_contracted_volume, buyer_contracted_amount, buyer_price,
  buyer_ordered_volume, buyer_shipped_volume, buyer_shipped_amount,
  buyer_payment, buyer_payment_date, buyer_debt,
  buyer_currency, buyer_manager_id, trader_id,
  buyer_destination_station_id, supplier_departure_station_id,
  forwarder_id, logistics_company_group_id, logistics_shipment_month,
  preliminary_tonnage, preliminary_amount, planned_tariff, actual_tariff,
  actual_shipped_volume, invoice_amount, invoice_volume,
  logistics_currency, currency, is_archived, is_draft, created_at,
  deal_company_groups(id, position, company_group_id, price, price_kind, quotation, quotation_comment, discount, contract_ref, currency),
  supplier_lines:deal_supplier_lines(id),
  buyer_lines:deal_buyer_lines(id)
`;

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

// Annotate fetched deals with simple line counts so the passport table
// can render a "+N линий" badge without a second round trip.
type WithLines = { supplier_lines?: { id: string }[]; buyer_lines?: { id: string }[] };
function annotateLineCounts<T extends WithLines>(rows: T[]): (T & Deal)[] {
  return rows.map((r) => ({
    ...(r as unknown as Deal),
    supplier_lines_count: r.supplier_lines?.length ?? 0,
    buyer_lines_count: r.buyer_lines?.length ?? 0,
  })) as (T & Deal)[];
}

export type DealFilters = {
  dealType?: "KG" | "KZ" | "OIL";
  year?: number;
  month?: string;
  isArchived?: boolean;
  // Server-side filters — push down to the SELECT instead of fetching
  // every deal and filtering in JS.
  supplierId?: string;
  buyerId?: string;
  factoryId?: string;
  fuelTypeId?: string;
  forwarderId?: string;
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
const dealsCache = new Map<string, { data: Deal[]; total: number; ts: number }>();
const DEALS_TTL_MS = 60_000;
// dealByIdCache is also used by useDeals to pre-seed each visible row
// so the detail page opens instantly when clicked from the list.
const dealByIdCache = new Map<string, { data: Deal; ts: number }>();
const DEAL_TTL_MS = 60_000;

export function useDeals(filters?: DealFilters) {
  const cacheKey = JSON.stringify(filters ?? {});
  const cached = dealsCache.get(cacheKey);
  const isFresh = !!cached && Date.now() - cached.ts < DEALS_TTL_MS;

  const [data, setData] = useState<Deal[]>(cached?.data ?? []);
  const [totalCount, setTotalCount] = useState(cached?.total ?? 0);
  // Only show a top-level «loading» when we have nothing to render —
  // a cached snapshot, even slightly stale, beats a blocker.
  const [loading, setLoading] = useState(!cached);
  const supabaseRef = useRef(createClient());

  // Client wanted the passport back as one scrollable list — no
  // pagination controls. We still paginate INTERNALLY against the
  // 1000-row PostgREST cap, but stream every page into a single array
  // and only flip loading=false once. LIST_SELECT is now lean enough
  // (no FK joins, just three id-only embeds) that even ~500 rows
  // come back well under a second.
  const PAGE = 1000;
  const load = useCallback(async () => {
    const baseFilter = (qb: ReturnType<typeof supabaseRef.current.from>) => {
      // No count:"exact" — that forced a second full-predicate scan;
      // total comes from `all.length` after the stream finishes.
      let q = qb.select(LIST_SELECT) as ReturnType<typeof qb.select>;
      // is_draft is now backfilled NOT NULL DEFAULT false (migration
      // 00091) so this is a sargable single-predicate filter instead
      // of a NULLS OR.
      q = q.eq("is_draft", false);
      if (filters?.dealType) q = q.eq("deal_type", filters.dealType);
      if (filters?.year) q = q.eq("year", filters.year);
      if (filters?.month) q = q.eq("month", filters.month);
      if (filters?.isArchived !== undefined) q = q.eq("is_archived", filters.isArchived);
      if (filters?.supplierId) q = q.eq("supplier_id", filters.supplierId);
      if (filters?.buyerId) q = q.eq("buyer_id", filters.buyerId);
      if (filters?.factoryId) q = q.eq("factory_id", filters.factoryId);
      if (filters?.fuelTypeId) q = q.eq("fuel_type_id", filters.fuelTypeId);
      if (filters?.forwarderId) q = q.eq("forwarder_id", filters.forwarderId);
      if (filters?.logisticsCompanyGroupId) q = q.eq("logistics_company_group_id", filters.logisticsCompanyGroupId);
      if (filters?.applicationContract) {
        const c = filters.applicationContract.replace(/,/g, "\\,");
        q = q.or(`supplier_contract.eq.${c},buyer_contract.eq.${c}`);
      }
      if (filters?.searchCode && filters.searchCode.trim()) {
        q = q.ilike("deal_code", `%${filters.searchCode.trim()}%`);
      }
      return q.order("deal_number", { ascending: true });
    };

    const all: unknown[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await baseFilter(supabaseRef.current.from("deals"))
        .range(from, from + PAGE - 1);
      if (error) {
        toast.error(`Ошибка загрузки сделок: ${error.message}`);
        break;
      }
      const batch = (data ?? []) as unknown[];
      all.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    const rows = annotateLineCounts(all as WithLines[]) as unknown as Deal[];
    setData(rows);
    const total = rows.length;
    setTotalCount(total);
    dealsCache.set(cacheKey, { data: rows, total, ts: Date.now() });
    const now = Date.now();
    for (const d of rows) dealByIdCache.set(d.id, { data: d, ts: now });
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters?.dealType, filters?.year, filters?.month, filters?.isArchived,
    filters?.supplierId, filters?.buyerId, filters?.factoryId, filters?.fuelTypeId,
    filters?.forwarderId, filters?.logisticsCompanyGroupId,
    filters?.applicationContract, filters?.searchCode,
  ]);

  // Skip the background revalidation when the cached snapshot is still
  // fresh and we already painted it — saves a round-trip on rapid
  // navigation between sibling pages.
  useEffect(() => { if (!isFresh) load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [load]);

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
  return data;
}

export async function updateDeal(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const { error } = await supabase.from("deals").update(values).eq("id", id);
  if (error) {
    toast.error(`Ошибка сохранения: ${error.message}`);
    throw error;
  }
  return true;
}

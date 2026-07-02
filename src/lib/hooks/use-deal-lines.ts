"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { invalidateDealBundle } from "./use-deal-bundle";
import { invalidateDeal, invalidateAllDealsLists } from "./use-deals";

export type DealLineSide = "supplier" | "buyer";

type LineStageFields = {
  // Migration 00068 — preliminary/final stage workflow.
  price_stage?: "preliminary" | "final";
  preliminary_quotation?: number | null;
  preliminary_price?: number | null;
  preliminary_set_at?: string | null;
  // Custom month override for average_month mode (defaults to deal.month).
  selected_month?: string | null;
  // Migration 00071 — manual_formula pricing (quotation - discount) * fx_rate.
  // fx_rate is line-level so different variants can carry different rates.
  // preliminary_fx_rate is the snapshot taken on finalize, mirroring
  // preliminary_quotation / preliminary_price.
  fx_rate?: number | null;
  preliminary_fx_rate?: number | null;
};

export type DealSupplierLine = {
  id: string;
  deal_id: string;
  position: number;
  is_default: boolean;
  price_condition: "average_month" | "fixed" | "trigger" | "manual" | "manual_formula" | null;
  // Migration 00064 — per-line trigger config. Optional until the
  // generated database.ts is regenerated (they live as `?` here so the
  // SELECT * still types cleanly when the columns exist on the row).
  trigger_basis?: "shipment_date" | "border_crossing_date" | null;
  trigger_days?: number | null;
  quotation_type_id: string | null;
  quotation: number | null;
  quotation_comment: string | null;
  discount: number | null;
  price: number | null;
  delivery_basis: string | null;
  departure_station_id: string | null;
  // Migration 00072 — free-text appendix label. Used by the registry
  // add form to auto-resolve which variant a shipment ties to.
  appendix?: string | null;
  // Migration 00077 — «Подкотировка», the specific wide-column of the
  // quotations table that the formula reads (price_cif_nwe /
  // price_fob_med / price_fob_rotterdam / …). Nullable — pre-00077
  // lines fall back to the legacy first-non-null coalesce.
  price_source?: string | null;
  // joined
  quotation_type?: { name: string } | null;
  departure_station?: { name: string } | null;
} & LineStageFields;

export type DealBuyerLine = {
  id: string;
  deal_id: string;
  position: number;
  is_default: boolean;
  price_condition: "average_month" | "fixed" | "trigger" | "manual" | "manual_formula" | null;
  // Migration 00064 — per-line trigger config. Optional until the
  // generated database.ts is regenerated (they live as `?` here so the
  // SELECT * still types cleanly when the columns exist on the row).
  trigger_basis?: "shipment_date" | "border_crossing_date" | null;
  trigger_days?: number | null;
  quotation_type_id: string | null;
  quotation: number | null;
  quotation_comment: string | null;
  discount: number | null;
  price: number | null;
  delivery_basis: string | null;
  destination_station_id: string | null;
  // Migration 00072 — see DealSupplierLine.
  appendix?: string | null;
  // Migration 00077 — «Подкотировка», the specific wide-column of the
  // quotations table that the formula reads (price_cif_nwe /
  // price_fob_med / price_fob_rotterdam / …). Nullable — pre-00077
  // lines fall back to the legacy first-non-null coalesce.
  price_source?: string | null;
  // joined
  quotation_type?: { name: string } | null;
  destination_station?: { name: string } | null;
} & LineStageFields;

const SUPPLIER_SELECT = `
  *,
  quotation_type:quotation_product_types(name),
  departure_station:stations!departure_station_id(name)
`;

const BUYER_SELECT = `
  *,
  quotation_type:quotation_product_types(name),
  destination_station:stations!destination_station_id(name)
`;

// Per-line shipping rollup types — hoisted up here so the cache map
// (declared just below) can use them without a forward-reference TS
// error from invalidateLines().
export type LineRollup = { volume: number; amount: number };
export type LineRollups = {
  supplier: Record<string, LineRollup>;
  buyer:    Record<string, LineRollup>;
};

// Stale-while-revalidate caches keyed by dealId. Same deal opened twice
// in a session paints the variant cards instantly.
const supplierLinesCache = new Map<string, { data: DealSupplierLine[]; ts: number }>();
const buyerLinesCache = new Map<string, { data: DealBuyerLine[]; ts: number }>();
// Cache for the per-line aggregates — same TTL pattern as the variant
// queries above. Hoisted alongside the line caches so invalidateLines()
// can drop the rollup snapshot in lockstep.
const lineRollupsCache = new Map<string, { data: LineRollups; ts: number }>();
const LINES_TTL_MS = 60_000;

// Pub-sub so a write from deal-lines-editor invalidates every mounted
// reader (the deal-detail page uses bundle, but Excel export and any
// future direct-consumer path still use these hooks). Keyed by dealId.
const linesListeners = new Map<string, Set<() => void>>();
function notifyLines(dealId: string) {
  const ls = linesListeners.get(dealId);
  if (ls) for (const fn of ls) fn();
}
function subscribeLines(dealId: string, fn: () => void): () => void {
  let ls = linesListeners.get(dealId);
  if (!ls) { ls = new Set(); linesListeners.set(dealId, ls); }
  ls.add(fn);
  return () => {
    const set = linesListeners.get(dealId);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) linesListeners.delete(dealId);
  };
}

// Drop both side caches for a deal and bump subscribers. Also kicks
// the bundle and the deals list — line edits feed back into deal-level
// rollups (supplier_lines_count / buyer_lines_count + per-line price
// snapshots used by the Excel export).
function invalidateLines(dealId: string) {
  supplierLinesCache.delete(dealId);
  buyerLinesCache.delete(dealId);
  lineRollupsCache.delete(dealId);
  notifyLines(dealId);
}

export function useDealSupplierLines(dealId: string | null) {
  const cached = dealId ? supplierLinesCache.get(dealId) : null;
  const fresh = !!cached && Date.now() - cached.ts < LINES_TTL_MS;
  const [data, setData] = useState<DealSupplierLine[]>(cached?.data ?? []);
  const [loading, setLoading] = useState(!cached);
  const sb = useRef(createClient());

  // Same rationale as useDeal: don't toggle loading=true on reload,
  // otherwise the parent that gates render on `loading` would unmount
  // the variant card and lose all local state. Initial mount handles
  // it via useState; reloads silently swap data.
  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }
    const { data, error } = await sb.current
      .from("deal_supplier_lines")
      .select(SUPPLIER_SELECT)
      .eq("deal_id", dealId)
      .order("is_default", { ascending: false })
      .order("position", { ascending: true });
    if (error) toast.error(`Ошибка загрузки линий поставщика: ${error.message}`);
    else {
      const rows = (data ?? []) as DealSupplierLine[];
      setData(rows);
      supplierLinesCache.set(dealId, { data: rows, ts: Date.now() });
    }
    setLoading(false);
  }, [dealId]);

  useEffect(() => { if (!fresh) load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [load]);
  // Refetch on any mutation against this deal's lines (or rollups).
  useEffect(() => {
    if (!dealId) return;
    return subscribeLines(dealId, () => { load(); });
  }, [dealId, load]);
  return { data, loading, reload: load };
}

export function useDealBuyerLines(dealId: string | null) {
  const cached = dealId ? buyerLinesCache.get(dealId) : null;
  const fresh = !!cached && Date.now() - cached.ts < LINES_TTL_MS;
  const [data, setData] = useState<DealBuyerLine[]>(cached?.data ?? []);
  const [loading, setLoading] = useState(!cached);
  const sb = useRef(createClient());

  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }
    const { data, error } = await sb.current
      .from("deal_buyer_lines")
      .select(BUYER_SELECT)
      .eq("deal_id", dealId)
      .order("is_default", { ascending: false })
      .order("position", { ascending: true });
    if (error) toast.error(`Ошибка загрузки линий покупателя: ${error.message}`);
    else {
      const rows = (data ?? []) as DealBuyerLine[];
      setData(rows);
      buyerLinesCache.set(dealId, { data: rows, ts: Date.now() });
    }
    setLoading(false);
  }, [dealId]);

  useEffect(() => { if (!fresh) load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [load]);
  useEffect(() => {
    if (!dealId) return;
    return subscribeLines(dealId, () => { load(); });
  }, [dealId, load]);
  return { data, loading, reload: load };
}

// Helper — read deal_id off a line row so the post-write invalidation
// knows which bundle / deal-list entry to refresh. Cheap: only the
// single deal_id column comes back.
async function lineDealId(side: "supplier" | "buyer", id: string): Promise<string | null> {
  const sb = createClient();
  const table = side === "supplier" ? "deal_supplier_lines" : "deal_buyer_lines";
  const { data } = await sb.from(table).select("deal_id").eq("id", id).maybeSingle();
  return (data?.deal_id as string | undefined) ?? null;
}

function bumpAfterLineWrite(dealId: string | null) {
  if (!dealId) return;
  invalidateLines(dealId);
  invalidateDealBundle(dealId);
  // The lines table has AFTER INSERT/UPDATE/DELETE triggers that
  // recompute supplier_lines_count / buyer_lines_count on the deal row
  // (migration 00092) — drop the deals snapshot so the next read picks
  // up the new counter.
  invalidateDeal(dealId);
  invalidateAllDealsLists();
}

export async function updateSupplierLine(id: string, patch: Record<string, unknown>) {
  const sb = createClient();
  const dealId = await lineDealId("supplier", id);
  const { error } = await sb.from("deal_supplier_lines").update(patch).eq("id", id);
  if (error) { toast.error(`Ошибка: ${error.message}`); throw error; }
  bumpAfterLineWrite(dealId);
}

export async function updateBuyerLine(id: string, patch: Record<string, unknown>) {
  const sb = createClient();
  const dealId = await lineDealId("buyer", id);
  const { error } = await sb.from("deal_buyer_lines").update(patch).eq("id", id);
  if (error) { toast.error(`Ошибка: ${error.message}`); throw error; }
  bumpAfterLineWrite(dealId);
}

// Calls the recompute_line_shipment_prices(line_id, side) RPC
// (migration 00068). Use after flipping a variant to 'final' or after
// changing price/discount on a final-stage variant so the existing
// per-shipment rows in `deal_shipment_prices` get refreshed.
export async function recomputeLineShipmentPrices(
  lineId: string,
  side: "supplier" | "buyer",
): Promise<number> {
  const sb = createClient();
  const { data, error } = await sb.rpc(
    "recompute_line_shipment_prices" as never,
    { p_line_id: lineId, p_side: side } as never,
  );
  if (error) {
    toast.error(`Ошибка пересчёта цен: ${error.message}`);
    throw error;
  }
  return (data as number) ?? 0;
}

export async function addSupplierLine(dealId: string, position: number) {
  const sb = createClient();
  const { data, error } = await sb.from("deal_supplier_lines")
    .insert({ deal_id: dealId, position, is_default: false })
    .select("id")
    .single();
  if (error) { toast.error(`Ошибка: ${error.message}`); throw error; }
  bumpAfterLineWrite(dealId);
  return data?.id as string;
}

export async function addBuyerLine(dealId: string, position: number) {
  const sb = createClient();
  const { data, error } = await sb.from("deal_buyer_lines")
    .insert({ deal_id: dealId, position, is_default: false })
    .select("id")
    .single();
  if (error) { toast.error(`Ошибка: ${error.message}`); throw error; }
  bumpAfterLineWrite(dealId);
  return data?.id as string;
}

export async function deleteSupplierLine(id: string) {
  const sb = createClient();
  const dealId = await lineDealId("supplier", id);
  const { error } = await sb.from("deal_supplier_lines").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      toast.error("Эта линия используется в реестре отгрузок — нельзя удалить");
    } else {
      toast.error(`Ошибка: ${error.message}`);
    }
    throw error;
  }
  bumpAfterLineWrite(dealId);
}

export async function deleteBuyerLine(id: string) {
  const sb = createClient();
  const dealId = await lineDealId("buyer", id);
  const { error } = await sb.from("deal_buyer_lines").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      toast.error("Эта линия используется в реестре отгрузок — нельзя удалить");
    } else {
      toast.error(`Ошибка: ${error.message}`);
    }
    throw error;
  }
  bumpAfterLineWrite(dealId);
}

// lineRollupsCache + LineRollup / LineRollups types are declared near
// the top of this file (hoisted so invalidateLines can drop the rollup
// snapshot too). Keeping a re-export of the public types here so the
// public surface is stable for callers.

export function useDealLineRollups(dealId: string | null) {
  const cached = dealId ? lineRollupsCache.get(dealId) : null;
  const fresh = !!cached && Date.now() - cached.ts < LINES_TTL_MS;
  const [data, setData] = useState<LineRollups>(cached?.data ?? { supplier: {}, buyer: {} });
  const [loading, setLoading] = useState(!cached);
  const sb = useRef(createClient());

  // Same pattern: don't toggle loading on subsequent loads, just swap
  // data silently so the page stays mounted across edits.
  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }

    const [regRes, priceRes] = await Promise.all([
      sb.current.from("shipment_registry")
        .select("supplier_line_id, buyer_line_id, shipment_volume, loading_volume")
        .eq("deal_id", dealId),
      sb.current.from("deal_shipment_prices")
        .select("side, amount, shipment_registry_id, shipment_registry:shipment_registry_id(supplier_line_id, buyer_line_id)")
        .eq("deal_id", dealId),
    ]);

    if (regRes.error)   console.error("rollup: shipment_registry query failed", regRes.error);
    if (priceRes.error) console.error("rollup: deal_shipment_prices query failed", priceRes.error);

    const supplier: Record<string, LineRollup> = {};
    const buyer:    Record<string, LineRollup> = {};

    // PostgREST returns NUMERIC as JS number when within Number range, but
    // can return string for very large values. Always coerce with Number()
    // so the running sum stays numeric (string concat would silently produce
    // "54.0452.65" garbage that fails comparisons downstream).
    const num = (v: unknown) => {
      const n = typeof v === "number" ? v : v == null ? 0 : Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    // Налив (loading_volume) is the supplier-side number; отгрузка
    // (shipment_volume) is the buyer-side number. They're separate events
    // and should never substitute for each other in the rollup.
    type RegRow = { supplier_line_id: string | null; buyer_line_id: string | null; shipment_volume: number | string | null; loading_volume: number | string | null };
    for (const r of (regRes.data ?? []) as RegRow[]) {
      if (r.supplier_line_id && r.loading_volume != null) {
        const s = supplier[r.supplier_line_id] ?? { volume: 0, amount: 0 };
        s.volume += num(r.loading_volume);
        supplier[r.supplier_line_id] = s;
      }
      if (r.buyer_line_id && r.shipment_volume != null) {
        const b = buyer[r.buyer_line_id] ?? { volume: 0, amount: 0 };
        b.volume += num(r.shipment_volume);
        buyer[r.buyer_line_id] = b;
      }
    }

    // Embedded relation can come back as either a single object or an array
    // (PostgREST shape depends on how it resolves the FK). Normalize both.
    type RegShape = { supplier_line_id: string | null; buyer_line_id: string | null };
    type PriceRow = { side: string; amount: number | string | null; shipment_registry: RegShape | RegShape[] | null };
    for (const p of (priceRes.data ?? []) as unknown as PriceRow[]) {
      const regRaw = p.shipment_registry;
      const reg = Array.isArray(regRaw) ? regRaw[0] : regRaw;
      if (!reg) continue;
      const lineId = p.side === "supplier" ? reg.supplier_line_id : reg.buyer_line_id;
      if (!lineId) continue;
      const map = p.side === "supplier" ? supplier : buyer;
      const it = map[lineId] ?? { volume: 0, amount: 0 };
      it.amount += num(p.amount);
      map[lineId] = it;
    }

    const rollup = { supplier, buyer };
    setData(rollup);
    if (dealId) lineRollupsCache.set(dealId, { data: rollup, ts: Date.now() });
    setLoading(false);
  }, [dealId]);

  useEffect(() => { if (!fresh) load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [load]);
  useEffect(() => {
    if (!dealId) return;
    return subscribeLines(dealId, () => { load(); });
  }, [dealId, load]);
  return { data, loading, reload: load };
}

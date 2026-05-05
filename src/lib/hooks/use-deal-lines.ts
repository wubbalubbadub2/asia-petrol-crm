"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export type DealLineSide = "supplier" | "buyer";

export type DealSupplierLine = {
  id: string;
  deal_id: string;
  position: number;
  is_default: boolean;
  price_condition: "average_month" | "fixed" | "trigger" | "manual" | null;
  quotation_type_id: string | null;
  quotation: number | null;
  quotation_comment: string | null;
  discount: number | null;
  price: number | null;
  delivery_basis: string | null;
  departure_station_id: string | null;
  // joined
  quotation_type?: { name: string } | null;
  departure_station?: { name: string } | null;
};

export type DealBuyerLine = {
  id: string;
  deal_id: string;
  position: number;
  is_default: boolean;
  price_condition: "average_month" | "fixed" | "trigger" | "manual" | null;
  quotation_type_id: string | null;
  quotation: number | null;
  quotation_comment: string | null;
  discount: number | null;
  price: number | null;
  delivery_basis: string | null;
  destination_station_id: string | null;
  // joined
  quotation_type?: { name: string } | null;
  destination_station?: { name: string } | null;
};

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

export function useDealSupplierLines(dealId: string | null) {
  const [data, setData] = useState<DealSupplierLine[]>([]);
  const [loading, setLoading] = useState(true);
  const sb = useRef(createClient());

  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await sb.current
      .from("deal_supplier_lines")
      .select(SUPPLIER_SELECT)
      .eq("deal_id", dealId)
      .order("is_default", { ascending: false })
      .order("position", { ascending: true });
    if (error) toast.error(`Ошибка загрузки линий поставщика: ${error.message}`);
    else setData((data ?? []) as DealSupplierLine[]);
    setLoading(false);
  }, [dealId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load };
}

export function useDealBuyerLines(dealId: string | null) {
  const [data, setData] = useState<DealBuyerLine[]>([]);
  const [loading, setLoading] = useState(true);
  const sb = useRef(createClient());

  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await sb.current
      .from("deal_buyer_lines")
      .select(BUYER_SELECT)
      .eq("deal_id", dealId)
      .order("is_default", { ascending: false })
      .order("position", { ascending: true });
    if (error) toast.error(`Ошибка загрузки линий покупателя: ${error.message}`);
    else setData((data ?? []) as DealBuyerLine[]);
    setLoading(false);
  }, [dealId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load };
}

export async function updateSupplierLine(id: string, patch: Record<string, unknown>) {
  const sb = createClient();
  const { error } = await sb.from("deal_supplier_lines").update(patch).eq("id", id);
  if (error) { toast.error(`Ошибка: ${error.message}`); throw error; }
}

export async function updateBuyerLine(id: string, patch: Record<string, unknown>) {
  const sb = createClient();
  const { error } = await sb.from("deal_buyer_lines").update(patch).eq("id", id);
  if (error) { toast.error(`Ошибка: ${error.message}`); throw error; }
}

export async function addSupplierLine(dealId: string, position: number) {
  const sb = createClient();
  const { data, error } = await sb.from("deal_supplier_lines")
    .insert({ deal_id: dealId, position, is_default: false })
    .select("id")
    .single();
  if (error) { toast.error(`Ошибка: ${error.message}`); throw error; }
  return data?.id as string;
}

export async function addBuyerLine(dealId: string, position: number) {
  const sb = createClient();
  const { data, error } = await sb.from("deal_buyer_lines")
    .insert({ deal_id: dealId, position, is_default: false })
    .select("id")
    .single();
  if (error) { toast.error(`Ошибка: ${error.message}`); throw error; }
  return data?.id as string;
}

export async function deleteSupplierLine(id: string) {
  const sb = createClient();
  const { error } = await sb.from("deal_supplier_lines").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      toast.error("Эта линия используется в реестре отгрузок — нельзя удалить");
    } else {
      toast.error(`Ошибка: ${error.message}`);
    }
    throw error;
  }
}

export async function deleteBuyerLine(id: string) {
  const sb = createClient();
  const { error } = await sb.from("deal_buyer_lines").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      toast.error("Эта линия используется в реестре отгрузок — нельзя удалить");
    } else {
      toast.error(`Ошибка: ${error.message}`);
    }
    throw error;
  }
}

// Per-line shipping rollup: how much volume + amount have been attributed
// to each variant. Computed by joining shipment_registry (volumes, line_id)
// with deal_shipment_prices (amounts) — both grouped by line_id per side.
export type LineRollup = { volume: number; amount: number };
export type LineRollups = {
  supplier: Record<string, LineRollup>;
  buyer:    Record<string, LineRollup>;
};

export function useDealLineRollups(dealId: string | null) {
  const [data, setData] = useState<LineRollups>({ supplier: {}, buyer: {} });
  const [loading, setLoading] = useState(true);
  const sb = useRef(createClient());

  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }
    setLoading(true);

    const [regRes, priceRes] = await Promise.all([
      sb.current.from("shipment_registry")
        .select("supplier_line_id, buyer_line_id, shipment_volume, loading_volume")
        .eq("deal_id", dealId),
      sb.current.from("deal_shipment_prices")
        .select("side, amount, shipment_registry_id, shipment_registry:shipment_registry_id(supplier_line_id, buyer_line_id)")
        .eq("deal_id", dealId),
    ]);

    const supplier: Record<string, LineRollup> = {};
    const buyer:    Record<string, LineRollup> = {};

    type RegRow = { supplier_line_id: string | null; buyer_line_id: string | null; shipment_volume: number | null; loading_volume: number | null };
    for (const r of (regRes.data ?? []) as RegRow[]) {
      if (r.supplier_line_id) {
        const s = supplier[r.supplier_line_id] ?? { volume: 0, amount: 0 };
        s.volume += r.loading_volume ?? r.shipment_volume ?? 0;
        supplier[r.supplier_line_id] = s;
      }
      if (r.buyer_line_id) {
        const b = buyer[r.buyer_line_id] ?? { volume: 0, amount: 0 };
        b.volume += r.shipment_volume ?? 0;
        buyer[r.buyer_line_id] = b;
      }
    }

    type PriceRow = { side: string; amount: number | null; shipment_registry: { supplier_line_id: string | null; buyer_line_id: string | null } | null };
    for (const p of (priceRes.data ?? []) as unknown as PriceRow[]) {
      const reg = p.shipment_registry;
      if (!reg) continue;
      const lineId = p.side === "supplier" ? reg.supplier_line_id : reg.buyer_line_id;
      if (!lineId) continue;
      const map = p.side === "supplier" ? supplier : buyer;
      const it = map[lineId] ?? { volume: 0, amount: 0 };
      it.amount += p.amount ?? 0;
      map[lineId] = it;
    }

    setData({ supplier, buyer });
    setLoading(false);
  }, [dealId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load };
}

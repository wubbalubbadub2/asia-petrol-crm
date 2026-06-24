"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";
import type { TablesInsert, TablesUpdate } from "@/lib/types/database";
import { toast } from "sonner";

export type Application = {
  id: string;
  application_number: string | null;
  date: string;
  fuel_type_id: string | null;
  product_name: string | null;
  tonnage: number | null;
  destination_station_id: string | null;
  station_code: string | null;
  consignee_name: string | null;
  consignee_bin: string | null;
  consignor: string | null;
  carrier: string | null;
  is_ordered: boolean;
  assigned_manager_id: string | null;
  pdf_file_path: string | null;
  source_email: string | null;
  created_at: string;
  // Joined
  fuel_type?: { name: string; color: string } | null;
  destination_station?: { name: string } | null;
  assigned_manager?: { full_name: string } | null;
};

const APP_SELECT = `
  *,
  fuel_type:fuel_types(name, color),
  destination_station:stations!destination_station_id(name),
  assigned_manager:profiles!assigned_manager_id(full_name)
`;

// Stale-while-revalidate cache so navigating back to /applications
// paints the previous snapshot instantly.
let appsCache: { data: Application[]; ts: number } | null = null;
const APPS_TTL_MS = 60_000;

// Pub-sub for mutations — see use-deals.ts for the same pattern. Any
// applications write below bumps every mounted useApplications so the
// list re-renders without a manual page refresh.
const appsListeners = new Set<() => void>();
function notifyApps() { for (const fn of appsListeners) fn(); }
function subscribeApps(fn: () => void): () => void {
  appsListeners.add(fn);
  return () => { appsListeners.delete(fn); };
}

// Apply a partial patch to the cached row optimistically + notify
// subscribers. The list paints the new value immediately without a
// round-trip. If the row isn't in the cache (very first visit) we
// just bump the cache timestamp so the next mount refetches.
function patchAppCache(id: string, patch: Partial<Application>) {
  if (!appsCache) return;
  const idx = appsCache.data.findIndex((a) => a.id === id);
  if (idx === -1) return;
  const next = appsCache.data.slice();
  next[idx] = { ...next[idx], ...patch };
  appsCache = { data: next, ts: appsCache.ts };
  notifyApps();
}

function invalidateAppsCache() {
  if (appsCache) appsCache = { ...appsCache, ts: 0 };
  notifyApps();
}

export function useApplications() {
  const fresh = !!appsCache && Date.now() - appsCache.ts < APPS_TTL_MS;
  const [data, setData] = useState<Application[]>(appsCache?.data ?? []);
  const [loading, setLoading] = useState(!appsCache);
  const supabase = createClient();

  const load = useCallback(async () => {
    // Paginate around PostgREST Max-Rows=1000. Applications table grows
    // unbounded over time and the page renders the full historical list.
    // Background revalidation: don't toggle loading=true so the cached
    // snapshot stays painted while we silently refresh.
    const { data, error } = await fetchAllPaginated((from, to) =>
      supabase
        .from("applications")
        .select(APP_SELECT)
        .order("date", { ascending: false })
        .range(from, to),
    );

    if (error) {
      toast.error(`Ошибка загрузки заявок: ${error.message}`);
    } else {
      const rows = data as unknown as Application[];
      setData(rows);
      appsCache = { data: rows, ts: Date.now() };
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { if (!fresh) load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [load]);

  // Subscribe to cache patches/invalidations. Optimistic patches paint
  // the new snapshot from memory; invalidations (ts=0) force a refetch.
  useEffect(() => {
    return subscribeApps(() => {
      if (!appsCache) return;
      if (appsCache.ts === 0) load();
      else setData(appsCache.data);
    });
  }, [load]);

  return { data, loading, reload: load };
}

export async function createApplication(values: TablesInsert<"applications">) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("applications")
    .insert(values)
    .select()
    .single();

  if (error) {
    toast.error(`Ошибка создания заявки: ${error.message}`);
    return null;
  }
  toast.success("Заявка создана");
  // Inserts can't be optimistically patched without the joined ref
  // labels (fuel_type / station / manager names) — force a refetch.
  invalidateAppsCache();
  return data;
}

export async function updateApplication(id: string, values: TablesUpdate<"applications">) {
  const supabase = createClient();
  const { error } = await supabase.from("applications").update(values).eq("id", id);
  if (error) {
    toast.error(`Ошибка: ${error.message}`);
    return false;
  }
  // Scalar fields can be patched optimistically; foreign-key columns
  // (fuel_type_id / destination_station_id / assigned_manager_id) need
  // a refetch to repopulate the joined label, otherwise the dialog
  // shows the new id but the row still renders the old name. We patch
  // scalars in place AND invalidate so the background reload picks up
  // joined refs — best of both: instant feedback + correct labels.
  patchAppCache(id, values as Partial<Application>);
  invalidateAppsCache();
  return true;
}

export async function toggleOrdered(id: string, currentValue: boolean) {
  const supabase = createClient();
  const { error } = await supabase
    .from("applications")
    .update({ is_ordered: !currentValue })
    .eq("id", id);
  if (error) {
    toast.error(`Ошибка: ${error.message}`);
    return false;
  }
  toast.success(!currentValue ? "Заявка отмечена как заявлено" : "Заявка отмечена как не заявлено");
  patchAppCache(id, { is_ordered: !currentValue });
  return true;
}

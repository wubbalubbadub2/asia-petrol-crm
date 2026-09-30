"use client";
// Дислокация и сверхнормативный простой (миграция 00174).
//
// Все даты, сутки и суммы считает база: rail_demurrage и
// rail_demurrage_registry. Здесь — сетевой слой и фильтры.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";
import { railDb, dbErrorMessage } from "@/lib/dislocation/db";
import type {
  DemurrageRow,
  RegistryRow,
  SnapshotRow,
  UploadListRow,
  Protocol,
  ProtocolRoute,
} from "@/lib/dislocation/types";
import { sortByName } from "@/lib/sort-names";

export type Option = { value: string; label: string };

/**
 * Загрузка по запросу: состояние меняется только в колбэке промиса
 * (правило react-hooks/set-state-in-effect), «загрузка» — это «данные
 * получены не для текущего запроса». Ответ устаревшего запроса
 * отбрасывается, поэтому быстрые переключения фильтров не путают таблицу.
 */
function useLoaded<T>(fetcher: () => Promise<T>, initial: T) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ source: unknown; tick: number; data: T }>({
    source: null,
    tick: -1,
    data: initial,
  });
  useEffect(() => {
    let cancelled = false;
    void fetcher().then((data) => {
      if (!cancelled) setState({ source: fetcher, tick, data });
    });
    return () => {
      cancelled = true;
    };
  }, [fetcher, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, loading: state.source !== fetcher || state.tick !== tick, reload };
}

type References = { forwarders: Option[]; stations: Option[]; companyGroups: Option[]; fuelTypes: Option[] };
const NO_REFERENCES: References = { forwarders: [], stations: [], companyGroups: [], fuelTypes: [] };

async function fetchReferences(): Promise<References> {
  const sb = railDb();
  const opt = (rows: { id: string; name: string }[] | null) =>
    sortByName(rows ?? [], (r) => r.name).map((r) => ({ value: r.id, label: r.name }));
  const [f, s, c, t] = await Promise.all([
    sb.from("forwarders").select("id, name").eq("is_active", true).order("name"),
    sb.from("stations").select("id, name").eq("is_active", true).order("name"),
    sb.from("company_groups").select("id, name").order("name"),
    sb.from("fuel_types").select("id, name").eq("is_active", true).order("name"),
  ]);
  return { forwarders: opt(f.data), stations: opt(s.data), companyGroups: opt(c.data), fuelTypes: opt(t.data) };
}

/** Экспедиторы, станции, компании группы, ГСМ — для фильтров и форм. */
export function useRailReferences(): References {
  return useLoaded(fetchReferences, NO_REFERENCES).data;
}

export type DemurrageFilters = {
  forwarderId: string | null;
  /** Первое число месяца `YYYY-MM-01`: стоянки, пересекающие месяц. */
  month: string;
};

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/** Стоянки, пересекающие выбранный месяц. */
export function useDemurrage({ forwarderId, month }: DemurrageFilters) {
  const fetcher = useCallback(async () => {
    const sb = railDb();
    const { data: rows, error } = await fetchAllPaginated<DemurrageRow>((from, to) => {
      let q = sb
        .from("rail_demurrage")
        .select("*")
        // Без даты прибытия — тоже показываем: это и есть «требует проверки».
        .or(`arrival_date.is.null,arrival_date.lte.${monthEnd(month)}`)
        .gte("end_date", month);
      if (forwarderId) q = q.eq("forwarder_id", forwarderId);
      return q
        .order("station_name", { ascending: true })
        .order("wagon_number", { ascending: true })
        .order("stay_key", { ascending: true })
        .range(from, to);
    });
    if (error) toast.error(`Простой: ${dbErrorMessage(error)}`);
    return rows;
  }, [forwarderId, month]);
  return useLoaded<DemurrageRow[]>(fetcher, []);
}

/** Реестр в формате экспедитора за месяц — читается по кнопке выгрузки. */
export async function fetchRegistry(forwarderId: string | null, month: string): Promise<RegistryRow[]> {
  const sb = railDb();
  const { data, error } = await fetchAllPaginated<RegistryRow>((from, to) => {
    let q = sb.from("rail_demurrage_registry").select("*").eq("month", month);
    if (forwarderId) q = q.eq("forwarder_id", forwarderId);
    return q
      .order("wagon_number", { ascending: true })
      // Строка реестра — цикл «погрузка + выгрузка» за месяц: пара ключей
      // стоянок уникальна внутри месяца.
      .order("unloading_key", { ascending: true })
      .order("loading_key", { ascending: true })
      .range(from, to);
  });
  if (error) throw new Error(dbErrorMessage(error));
  return data;
}

async function fetchUploads(): Promise<UploadListRow[]> {
  const { data, error } = await railDb()
    .from("rail_dislocation_uploads")
    .select("id, forwarder_id, snapshot_at, file_name, row_count, created_at, forwarders(name)")
    .order("snapshot_at", { ascending: false })
    .limit(200);
  if (error) toast.error(`Загрузки: ${dbErrorMessage(error)}`);
  return (data ?? []) as unknown as UploadListRow[];
}

export function useUploads() {
  const { data, loading, reload } = useLoaded<UploadListRow[]>(fetchUploads, []);

  const remove = useCallback(
    async (id: string) => {
      const { error } = await railDb().from("rail_dislocation_uploads").delete().eq("id", id);
      if (error) {
        toast.error(dbErrorMessage(error));
        return;
      }
      toast.success("Файл удалён, рейсы пересчитаны");
      reload();
    },
    [reload],
  );

  return { data, loading, reload, remove };
}

/** Лента вагона: все снимки и стоянки по номеру. */
export function useWagon(wagonNumber: string) {
  const fetcher = useCallback(async () => {
    const sb = railDb();
    const [s, d] = await Promise.all([
      sb
        .from("rail_dislocation_snapshots")
        .select(
          "id, upload_id, forwarder_id, snapshot_at, wagon_number, departure_station, current_station, destination_station, waybill_number, waybill_date, last_operation_at, operation_code, operation_name, load_state, idle_at_station",
        )
        .eq("wagon_number", wagonNumber)
        .order("snapshot_at", { ascending: true }),
      sb
        .from("rail_demurrage")
        .select("*")
        .eq("wagon_number", wagonNumber)
        .order("arrival_date", { ascending: true }),
    ]);
    if (s.error) toast.error(`Снимки: ${dbErrorMessage(s.error)}`);
    if (d.error) toast.error(`Стоянки: ${dbErrorMessage(d.error)}`);
    return { snapshots: (s.data ?? []) as SnapshotRow[], stays: (d.data ?? []) as DemurrageRow[] };
  }, [wagonNumber]);
  const { data, loading, reload } = useLoaded(fetcher, { snapshots: [] as SnapshotRow[], stays: [] as DemurrageRow[] });
  return { ...data, loading, reload };
}

export async function saveStayOverride(input: {
  forwarderId: string;
  wagonNumber: string;
  arrivalWaybillNumber: string;
  field: "arrival" | "departure";
  value: string;
  reason: string;
}): Promise<boolean> {
  const { error } = await railDb()
    .from("rail_stay_overrides")
    .upsert(
      {
        forwarder_id: input.forwarderId,
        wagon_number: input.wagonNumber,
        arrival_waybill_number: input.arrivalWaybillNumber,
        field: input.field,
        value: input.value,
        reason: input.reason,
      },
      { onConflict: "forwarder_id,wagon_number,arrival_waybill_number,field" },
    );
  if (error) {
    toast.error(dbErrorMessage(error));
    return false;
  }
  return true;
}

export async function removeStayOverride(input: {
  forwarderId: string;
  wagonNumber: string;
  arrivalWaybillNumber: string;
  field: "arrival" | "departure";
}): Promise<boolean> {
  const { error } = await railDb()
    .from("rail_stay_overrides")
    .delete()
    .eq("forwarder_id", input.forwarderId)
    .eq("wagon_number", input.wagonNumber)
    .eq("arrival_waybill_number", input.arrivalWaybillNumber)
    .eq("field", input.field);
  if (error) {
    toast.error(dbErrorMessage(error));
    return false;
  }
  return true;
}

type ProtocolDbRow = Omit<Protocol, "routes"> & {
  id: string;
  rail_price_protocol_routes: (ProtocolRoute & { id: string })[];
};

async function fetchProtocols(): Promise<Protocol[]> {
  const { data, error } = await railDb()
    .from("rail_price_protocols")
    .select("*, rail_price_protocol_routes(*)")
    .order("valid_from", { ascending: false });
  if (error) toast.error(`Протоколы: ${dbErrorMessage(error)}`);
  return ((data ?? []) as ProtocolDbRow[]).map(({ rail_price_protocol_routes, ...p }) => ({
    ...p,
    routes: [...rail_price_protocol_routes].sort((a, b) => a.position - b.position),
  }));
}

export function useProtocols() {
  return useLoaded<Protocol[]>(fetchProtocols, []);
}

/**
 * Сохранение протокола: шапка, затем строки маршрутов целиком заменяются.
 * Два запроса — не транзакция; при ошибке на маршрутах шапка остаётся,
 * пользователь видит ошибку и сохраняет ещё раз.
 */
export async function saveProtocol(p: Protocol): Promise<boolean> {
  const sb = railDb();
  const { routes, id } = p;
  // Только колонки шапки: у протокола из базы есть ещё created_at и т. п.
  const header = {
    forwarder_id: p.forwarder_id,
    company_group_id: p.company_group_id,
    number: p.number,
    protocol_date: p.protocol_date,
    valid_from: p.valid_from,
    valid_to: p.valid_to,
    demurrage_rate: p.demurrage_rate,
    currency: p.currency,
    rate_includes_vat: p.rate_includes_vat,
    arrival_day_counts: p.arrival_day_counts,
    partial_day_counts_full: p.partial_day_counts_full,
    note: p.note,
  };
  const res = id
    ? await sb.from("rail_price_protocols").update(header).eq("id", id).select("id").single()
    : await sb.from("rail_price_protocols").insert(header).select("id").single();
  if (res.error) {
    toast.error(dbErrorMessage(res.error));
    return false;
  }
  const protocolId = (res.data as { id: string }).id;
  const del = await sb.from("rail_price_protocol_routes").delete().eq("protocol_id", protocolId);
  if (del.error) {
    toast.error(dbErrorMessage(del.error));
    return false;
  }
  if (routes.length > 0) {
    const ins = await sb.from("rail_price_protocol_routes").insert(
      routes.map((r, i) => ({
        protocol_id: protocolId,
        position: i,
        departure_station_id: r.departure_station_id,
        destination_station_id: r.destination_station_id,
        fuel_type_id: r.fuel_type_id,
        loading_norm_days: r.loading_norm_days,
        unloading_norm_days: r.unloading_norm_days,
        railway_tariff_per_ton: r.railway_tariff_per_ton,
        operator_rate_per_ton: r.operator_rate_per_ton,
        forwarding_fee_per_ton: r.forwarding_fee_per_ton,
      })),
    );
    if (ins.error) {
      toast.error(dbErrorMessage(ins.error));
      return false;
    }
  }
  return true;
}

export async function deleteProtocol(id: string): Promise<boolean> {
  const { error } = await railDb().from("rail_price_protocols").delete().eq("id", id);
  if (error) {
    toast.error(dbErrorMessage(error));
    return false;
  }
  return true;
}

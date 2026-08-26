"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { CrudTable } from "@/components/shared/crud-table";
import { useSupabaseTable } from "@/lib/hooks/use-references";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";

/**
 * Маршруты перевозки — справочник к заявке (00153).
 *
 * Маршрут хранится как УПОРЯДОЧЕННАЯ ЦЕПОЧКА станций, а не строкой:
 * коды уже лежат в справочнике станций, и печатная строка собирается из
 * них. Правка кода станции сразу отражается во всех маршрутах, а не
 * оставляет старые копии.
 *
 * Одна станция может встречаться в маршруте дважды — в образце ОРТ
 * «Турксиб-эксп.» стоит два раза под разными кодами, — поэтому строки
 * различаются позицией, а не станцией.
 */

type RouteStation = {
  position: number;
  station_id: string;
  stations?: { name: string; code: string | null } | null;
};

type Route = {
  id?: string;
  name: string;
  is_active?: boolean;
  transport_route_stations?: RouteStation[];
};

type StationOption = { id: string; name: string; code: string | null };

/** «Темир (660308) — Карабалта (715905)» — как печатается в заявке. */
function printedRoute(legs: RouteStation[]): string {
  return [...legs]
    .sort((a, b) => a.position - b.position)
    .map((l) => {
      const name = l.stations?.name ?? "—";
      return l.stations?.code ? `${name} (${l.stations.code})` : name;
    })
    .join(" — ");
}

const columns: ColumnDef<Route, unknown>[] = [
  {
    accessorKey: "name",
    header: "Наименование",
    cell: ({ row }) => row.original.name ?? "—",
  },
  {
    id: "printed",
    header: "Маршрут",
    cell: ({ row }) => {
      const legs = row.original.transport_route_stations ?? [];
      return legs.length ? (
        <span className="text-[13px]">{printedRoute(legs)}</span>
      ) : (
        <span className="text-muted-foreground">станции не заданы</span>
      );
    },
  },
  {
    id: "legs",
    header: "Станций",
    cell: ({ row }) => (row.original.transport_route_stations ?? []).length,
  },
  {
    accessorKey: "is_active",
    header: "Активен",
    cell: ({ row }) =>
      row.original.is_active !== false ? (
        <span className="text-green-600 font-medium">Да</span>
      ) : (
        <span className="text-muted-foreground">Нет</span>
      ),
  },
];

type FormProps = {
  item: Route | null;
  stations: StationOption[];
  onSave: (values: Partial<Route>) => Promise<void>;
  onClose: () => void;
};

function RouteForm({ item, stations, onSave, onClose }: FormProps) {
  const [name, setName] = useState(item?.name ?? "");
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [legs, setLegs] = useState<string[]>(() =>
    [...(item?.transport_route_stations ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((l) => l.station_id),
  );
  const [saving, setSaving] = useState(false);

  const options = useMemo(
    () =>
      stations.map((s) => ({
        value: s.id,
        label: s.code ? `${s.name} (${s.code})` : s.name,
      })),
    [stations],
  );

  const byId = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);

  function move(index: number, delta: number) {
    setLegs((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const preview = legs
    .filter(Boolean)
    .map((id) => {
      const s = byId.get(id);
      if (!s) return "—";
      return s.code ? `${s.name} (${s.code})` : s.name;
    })
    .join(" — ");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Наименование обязательно");
      return;
    }
    if (legs.some((id) => !id)) {
      toast.error("В маршруте есть незаполненная станция");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...(item?.id ? { id: item.id } : {}),
        name: name.trim(),
        is_active: isActive,
        transport_route_stations: legs.map((station_id, i) => ({
          station_id,
          position: i + 1,
        })),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label htmlFor="name">
          Наименование <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Темир — Карабалта"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Станции по порядку</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLegs((prev) => [...prev, ""])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Добавить станцию
          </Button>
        </div>

        {legs.length === 0 && (
          <p className="text-[12px] text-muted-foreground">
            Станции не добавлены. Первая — отправление, последняя — назначение.
          </p>
        )}

        <div className="space-y-1.5">
          {legs.map((stationId, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <SearchableSelect
                  options={options}
                  value={stationId}
                  onChange={(val) =>
                    setLegs((prev) => prev.map((v, idx) => (idx === i ? val : v)))
                  }
                  placeholder="Выберите станцию"
                  searchPlaceholder="Станция или код…"
                  triggerClassName="w-full"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label="Выше"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={i === legs.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Ниже"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-destructive"
                onClick={() => setLegs((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Убрать"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        {preview && (
          <div className="rounded border bg-muted/40 px-2.5 py-2">
            <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              В заявке напечатается
            </p>
            <p className="font-mono text-[12px] leading-snug">{preview}</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_active"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="is_active">Активен</Label>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Отмена
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Сохранение..." : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}

export default function RoutesPage() {
  const { data, loading, remove, reload } = useSupabaseTable<Route>(
    "transport_routes",
    "name",
    "id, name, is_active, transport_route_stations(position, station_id, stations(name, code))",
  );

  const [stations, setStations] = useState<StationOption[]>([]);
  const sbRef = useRef(createClient());

  useEffect(() => {
    sbRef.current
      .from("stations")
      .select("id, name, code")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setStations((data ?? []) as StationOption[]));
  }, []);

  /**
   * Станции маршрута лежат в отдельной таблице, поэтому общий CRUD-хук
   * их не сохранит. Порядок переписывается целиком: удалить и вставить
   * заново проще и надёжнее, чем сводить позиции по одной, — строк в
   * маршруте единицы.
   */
  async function saveRoute(values: Partial<Route>, isEdit: boolean) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = sbRef.current as any;
    const legs = values.transport_route_stations ?? [];
    const row = { name: values.name, is_active: values.is_active };

    let routeId = values.id;

    if (isEdit && routeId) {
      const { error } = await sb.from("transport_routes").update(row).eq("id", routeId);
      if (error) {
        toast.error(`Ошибка сохранения: ${error.message}`);
        throw error;
      }
      const { error: delErr } = await sb
        .from("transport_route_stations")
        .delete()
        .eq("route_id", routeId);
      if (delErr) {
        toast.error(`Ошибка сохранения станций: ${delErr.message}`);
        throw delErr;
      }
    } else {
      const { data: created, error } = await sb
        .from("transport_routes")
        .insert(row)
        .select("id")
        .single();
      if (error) {
        toast.error(`Ошибка добавления: ${error.message}`);
        throw error;
      }
      routeId = created.id as string;
    }

    if (legs.length > 0) {
      const { error } = await sb.from("transport_route_stations").insert(
        legs.map((l) => ({
          route_id: routeId,
          station_id: l.station_id,
          position: l.position,
        })),
      );
      if (error) {
        toast.error(`Ошибка сохранения станций: ${error.message}`);
        throw error;
      }
    }

    toast.success(isEdit ? "Сохранено" : "Добавлено");
    await reload();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CrudTable<Route>
        data={data}
        columns={columns}
        title="Маршруты"
        searchPlaceholder="Поиск маршрута..."
        onSave={saveRoute}
        onDelete={remove}
        renderForm={({ item, onSave, onClose }) => (
          <RouteForm item={item} stations={stations} onSave={onSave} onClose={onClose} />
        )}
      />
    </div>
  );
}

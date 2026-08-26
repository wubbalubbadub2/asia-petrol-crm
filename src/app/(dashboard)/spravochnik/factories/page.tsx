"use client";

import { useEffect, useRef, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CrudTable } from "@/components/shared/crud-table";
import { useSupabaseTable } from "@/lib/hooks/use-references";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createClient } from "@/lib/supabase/client";

/**
 * Коды ЕТСНГ и ГНГ — свойство ЗАВОДА, а не продукта: клиент 26.08.2026
 * прислал таблицу «КОД ГНГ, ТНВЭД», где ЕТСНГ у всех один (221066), а
 * ГНГ различается по заводу — марка мазута у них разная. Оттуда же
 * станция отправления: маршрут заявки начинается с неё.
 */
type Factory = {
  id?: string;
  name: string;
  code?: string;
  etsng_code?: string;
  gng_code?: string;
  departure_station_id?: string | null;
  departure_station?: { name: string; code: string | null } | null;
  is_active?: boolean;
};

type StationOption = { id: string; name: string; code: string | null };

const columns: ColumnDef<Factory, unknown>[] = [
  {
    accessorKey: "name",
    header: "Наименование",
    cell: ({ row }) => row.original.name ?? "—",
  },
  {
    accessorKey: "code",
    header: "Код",
    cell: ({ row }) => row.original.code ?? "—",
  },
  {
    id: "codes",
    header: "ЕТСНГ / ГНГ",
    cell: ({ row }) => {
      const { etsng_code: e, gng_code: g } = row.original;
      return e || g ? [e, g].filter(Boolean).join(", ") : "—";
    },
  },
  {
    id: "departure",
    header: "Станция отправления",
    cell: ({ row }) => {
      const st = row.original.departure_station;
      if (!st) return <span className="text-muted-foreground">—</span>;
      return st.code ? `${st.name} (${st.code})` : st.name;
    },
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
  item: Factory | null;
  onSave: (values: Partial<Factory>) => Promise<void>;
  onClose: () => void;
};

function FactoryForm({ item, onSave, onClose }: FormProps) {
  const [form, setForm] = useState<Partial<Factory>>({
    name: item?.name ?? "",
    code: item?.code ?? "",
    etsng_code: item?.etsng_code ?? "",
    gng_code: item?.gng_code ?? "",
    departure_station_id: item?.departure_station_id ?? null,
    is_active: item?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
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

  function set(key: keyof Factory, value: string | boolean | null) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name?.trim()) {
      toast.error("Наименование обязательно");
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...form, ...(item?.id ? { id: item.id } : {}) });
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
          value={form.name ?? ""}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Название завода"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="code">Код</Label>
        <Input
          id="code"
          value={form.code ?? ""}
          onChange={(e) => set("code", e.target.value)}
          placeholder="ЗАВОД-01"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="etsng_code">Код ЕТСНГ</Label>
          <Input
            id="etsng_code"
            value={form.etsng_code ?? ""}
            onChange={(e) => set("etsng_code", e.target.value)}
            placeholder="221066"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gng_code">Код ГНГ</Label>
          <Input
            id="gng_code"
            value={form.gng_code ?? ""}
            onChange={(e) => set("gng_code", e.target.value)}
            placeholder="27101967"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Станция отправления</Label>
        <SearchableSelect
          options={stations.map((st) => ({
            value: st.id,
            label: st.code ? `${st.name} (${st.code})` : st.name,
          }))}
          value={form.departure_station_id ?? ""}
          onChange={(val) => set("departure_station_id", val || null)}
          placeholder="Выберите станцию"
          searchPlaceholder="Станция или код…"
          triggerClassName="w-full"
        />
        <p className="text-[11px] text-muted-foreground">
          С неё начинается маршрут в заявке на перевозку.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_active"
          checked={form.is_active ?? true}
          onChange={(e) => set("is_active", e.target.checked)}
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

export default function FactoriesPage() {
  const { data, loading, save, remove } = useSupabaseTable<Factory>(
    "factories",
    "name",
    "id, name, code, etsng_code, gng_code, departure_station_id, " +
      "departure_station:stations(name, code), is_active"
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CrudTable<Factory>
        data={data}
        columns={columns}
        title="Заводы"
        searchPlaceholder="Поиск завода..."
        onSave={save}
        onDelete={remove}
        renderForm={({ item, onSave, onClose }) => (
          <FactoryForm item={item} onSave={onSave} onClose={onClose} />
        )}
      />
    </div>
  );
}

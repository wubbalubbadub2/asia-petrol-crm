"use client";

import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CrudTable } from "@/components/shared/crud-table";
import { useSupabaseTable } from "@/lib/hooks/use-references";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type FuelType = {
  id?: string;
  name: string;
  sulfur_percent?: number;
  color?: string;
  sort_order?: number;
  is_active?: boolean;
};

const columns: ColumnDef<FuelType, unknown>[] = [
  {
    accessorKey: "name",
    header: "Наименование",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        {row.original.color && (
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-full border border-black/10"
            style={{ backgroundColor: row.original.color }}
          />
        )}
        <span>{row.original.name}</span>
      </div>
    ),
  },
  {
    accessorKey: "sulfur_percent",
    header: "Содержание серы, %",
    cell: ({ row }) => {
      const val = row.original.sulfur_percent;
      return val != null ? `${val}%` : "—";
    },
  },
  {
    accessorKey: "color",
    header: "Цвет",
    cell: ({ row }) => {
      const val = row.original.color;
      if (!val) return <span className="text-muted-foreground">—</span>;
      return (
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-5 w-8 rounded border border-black/10"
            style={{ backgroundColor: val }}
          />
          <span className="font-mono text-xs text-muted-foreground">{val}</span>
        </div>
      );
    },
  },
  {
    accessorKey: "sort_order",
    header: "Порядок",
    cell: ({ row }) => row.original.sort_order ?? "—",
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
  item: FuelType | null;
  onSave: (values: Partial<FuelType>) => Promise<void>;
  onClose: () => void;
};

function FuelTypeForm({ item, onSave, onClose }: FormProps) {
  const [form, setForm] = useState<Partial<FuelType>>({
    name: item?.name ?? "",
    sulfur_percent: item?.sulfur_percent ?? undefined,
    color: item?.color ?? "#cccccc",
    sort_order: item?.sort_order ?? undefined,
    is_active: item?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FuelType>(key: K, value: FuelType[K]) {
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
          placeholder="Дизельное топливо"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sulfur_percent">Содержание серы, %</Label>
        <Input
          id="sulfur_percent"
          type="number"
          step="0.001"
          min="0"
          max="100"
          value={form.sulfur_percent ?? ""}
          onChange={(e) =>
            set(
              "sulfur_percent",
              e.target.value === "" ? undefined : parseFloat(e.target.value)
            )
          }
          placeholder="0.001"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="color">Цвет маркировки</Label>
        <div className="flex items-center gap-3">
          <input
            id="color"
            type="color"
            value={form.color ?? "#cccccc"}
            onChange={(e) => set("color", e.target.value)}
            className="h-8 w-14 cursor-pointer rounded border border-input bg-transparent p-0.5"
          />
          <span className="font-mono text-sm text-muted-foreground">
            {form.color ?? "#cccccc"}
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sort_order">Порядок сортировки</Label>
        <Input
          id="sort_order"
          type="number"
          min="0"
          step="1"
          value={form.sort_order ?? ""}
          onChange={(e) =>
            set(
              "sort_order",
              e.target.value === "" ? undefined : parseInt(e.target.value, 10)
            )
          }
          placeholder="1"
        />
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

export default function FuelTypesPage() {
  const { data, loading, save, remove } = useSupabaseTable<FuelType>(
    "fuel_types",
    "sort_order"
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
      <CrudTable<FuelType>
        data={data}
        columns={columns}
        title="Виды ГСМ"
        searchPlaceholder="Поиск вида топлива..."
        onSave={save}
        onDelete={remove}
        renderForm={({ item, onSave, onClose }) => (
          <FuelTypeForm item={item} onSave={onSave} onClose={onClose} />
        )}
      />
    </div>
  );
}

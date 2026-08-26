"use client";

import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CrudTable } from "@/components/shared/crud-table";
import { useSupabaseTable } from "@/lib/hooks/use-references";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// Перевозчик ЖД — строка «Наименование железной дороги» в заявке на
// перевозку (00153). В образце «АО «КТЖ - Грузовые перевозки»»; клиент
// 25.08: значение меняется, поэтому список, а не константа в коде.
type Carrier = {
  id?: string;
  name: string;
  is_active?: boolean;
};

const columns: ColumnDef<Carrier, unknown>[] = [
  {
    accessorKey: "name",
    header: "Наименование",
    cell: ({ row }) => row.original.name ?? "—",
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
  item: Carrier | null;
  onSave: (values: Partial<Carrier>) => Promise<void>;
  onClose: () => void;
};

function CarrierForm({ item, onSave, onClose }: FormProps) {
  const [form, setForm] = useState<Partial<Carrier>>({
    name: item?.name ?? "",
    is_active: item?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  function set(key: keyof Carrier, value: string | boolean) {
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
          placeholder="АО «КТЖ - Грузовые перевозки»"
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

export default function CarriersPage() {
  const { data, loading, save, remove } = useSupabaseTable<Carrier>(
    "transport_carriers",
    "name",
    "id, name, is_active"
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
      <CrudTable<Carrier>
        data={data}
        columns={columns}
        title="Перевозчики ЖД"
        searchPlaceholder="Поиск перевозчика..."
        onSave={save}
        onDelete={remove}
        renderForm={({ item, onSave, onClose }) => (
          <CarrierForm item={item} onSave={onSave} onClose={onClose} />
        )}
      />
    </div>
  );
}

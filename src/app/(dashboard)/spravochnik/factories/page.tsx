"use client";

import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CrudTable } from "@/components/shared/crud-table";
import { useSupabaseTable } from "@/lib/hooks/use-references";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type Factory = {
  id?: string;
  name: string;
  code?: string;
  is_active?: boolean;
};

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
    is_active: item?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  function set(key: keyof Factory, value: string | boolean) {
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
    "name"
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

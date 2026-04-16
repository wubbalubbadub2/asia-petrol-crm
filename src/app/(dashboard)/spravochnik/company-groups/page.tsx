"use client";

import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CrudTable } from "@/components/shared/crud-table";
import { useSupabaseTable } from "@/lib/hooks/use-references";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type CompanyGroup = {
  id?: string;
  name: string;
  full_name?: string;
  short_name?: string;
  bin_iin?: string;
  legal_address?: string;
  is_active?: boolean;
};

const columns: ColumnDef<CompanyGroup, unknown>[] = [
  {
    accessorKey: "full_name",
    header: "Полное наименование",
    cell: ({ row }) => row.original.full_name ?? row.original.name ?? "—",
  },
  {
    accessorKey: "short_name",
    header: "Краткое наименование",
    cell: ({ row }) => row.original.short_name ?? "—",
  },
  {
    accessorKey: "bin_iin",
    header: "БИН / ИИН",
    cell: ({ row }) => row.original.bin_iin ?? "—",
  },
  {
    accessorKey: "legal_address",
    header: "Юр. адрес",
    cell: ({ row }) => (
      <span className="truncate max-w-[200px] block">{row.original.legal_address ?? "—"}</span>
    ),
  },
  {
    accessorKey: "is_active",
    header: "Активна",
    cell: ({ row }) =>
      row.original.is_active !== false ? (
        <span className="text-green-600 font-medium">Да</span>
      ) : (
        <span className="text-muted-foreground">Нет</span>
      ),
  },
];

type FormProps = {
  item: CompanyGroup | null;
  onSave: (values: Partial<CompanyGroup>) => Promise<void>;
  onClose: () => void;
};

function CompanyGroupForm({ item, onSave, onClose }: FormProps) {
  const [form, setForm] = useState<Partial<CompanyGroup>>({
    name: item?.name ?? "",
    full_name: item?.full_name ?? "",
    short_name: item?.short_name ?? "",
    bin_iin: item?.bin_iin ?? "",
    legal_address: item?.legal_address ?? "",
    is_active: item?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  function set(key: keyof CompanyGroup, value: string | boolean) {
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
      await onSave({
        ...form,
        full_name: form.full_name || form.name,
        ...(item?.id ? { id: item.id } : {}),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label htmlFor="name">
          Наименование (системное) <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          value={form.name ?? ""}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Fuel Supply Company"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="full_name">Полное наименование</Label>
        <Input
          id="full_name"
          value={form.full_name ?? ""}
          onChange={(e) => set("full_name", e.target.value)}
          placeholder='ТОО "Fuel Supply Company"'
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="short_name">Краткое наименование</Label>
        <Input
          id="short_name"
          value={form.short_name ?? ""}
          onChange={(e) => set("short_name", e.target.value)}
          placeholder="FSC"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bin_iin">БИН / ИИН</Label>
        <Input
          id="bin_iin"
          value={form.bin_iin ?? ""}
          onChange={(e) => set("bin_iin", e.target.value)}
          placeholder="000000000000"
          maxLength={12}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="legal_address">Юридический адрес</Label>
        <Input
          id="legal_address"
          value={form.legal_address ?? ""}
          onChange={(e) => set("legal_address", e.target.value)}
          placeholder="г. Алматы, ул. ..."
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
        <Label htmlFor="is_active">Активна</Label>
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

export default function CompanyGroupsPage() {
  const { data, loading, save, remove } = useSupabaseTable<CompanyGroup>(
    "company_groups",
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
      <CrudTable<CompanyGroup>
        data={data}
        columns={columns}
        title="Группы компании"
        searchPlaceholder="Поиск группы..."
        onSave={save}
        onDelete={remove}
        renderForm={({ item, onSave, onClose }) => (
          <CompanyGroupForm item={item} onSave={onSave} onClose={onClose} />
        )}
      />
    </div>
  );
}

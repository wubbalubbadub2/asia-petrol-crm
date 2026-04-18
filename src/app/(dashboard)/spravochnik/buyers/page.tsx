"use client";

import { useState, useEffect, useCallback } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CrudTable } from "@/components/shared/crud-table";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type Counterparty = {
  id?: string;
  full_name: string;
  short_name?: string;
  bin_iin?: string;
  legal_address?: string;
  is_active?: boolean;
  type?: string;
};

const columns: ColumnDef<Counterparty, unknown>[] = [
  {
    accessorKey: "full_name",
    header: "Полное наименование",
    cell: ({ row }) => row.original.full_name ?? "—",
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
  item: Counterparty | null;
  onSave: (values: Partial<Counterparty>) => Promise<void>;
  onClose: () => void;
};

function BuyerForm({ item, onSave, onClose }: FormProps) {
  const [form, setForm] = useState<Partial<Counterparty>>({
    full_name: item?.full_name ?? "",
    short_name: item?.short_name ?? "",
    bin_iin: item?.bin_iin ?? "",
    legal_address: item?.legal_address ?? "",
    is_active: item?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  function set(key: keyof Counterparty, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name?.trim()) {
      toast.error("Полное наименование обязательно");
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
        <Label htmlFor="full_name">
          Полное наименование <span className="text-destructive">*</span>
        </Label>
        <Input
          id="full_name"
          value={form.full_name ?? ""}
          onChange={(e) => set("full_name", e.target.value)}
          placeholder="ТОО «Название компании»"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="short_name">Краткое наименование</Label>
        <Input
          id="short_name"
          value={form.short_name ?? ""}
          onChange={(e) => set("short_name", e.target.value)}
          placeholder="Название"
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

export default function BuyersPage() {
  const [data, setData] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    const { data: rows, error } = await supabase
      .from("counterparties")
      .select("*")
      .eq("type", "buyer")
      .order("full_name", { ascending: true });

    if (error) {
      toast.error(`Ошибка загрузки: ${error.message}`);
    } else {
      setData((rows ?? []) as Counterparty[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(values: Partial<Counterparty>, isEdit: boolean) {
    const payload = { ...values, type: "buyer" };
    if (isEdit && payload.id) {
      const { error } = await supabase
        .from("counterparties")
        .update(payload)
        .eq("id", payload.id);
      if (error) {
        toast.error(`Ошибка сохранения: ${error.message}`);
        throw error;
      }
      toast.success("Сохранено");
    } else {
      const { id: _id, type: _type, ...insertValues } = payload;
      void _id; void _type;
      const { error } = await supabase.from("counterparties").insert({
        ...insertValues,
        type: "buyer",
        full_name: insertValues.full_name ?? "",
      });
      if (error) {
        toast.error(`Ошибка добавления: ${error.message}`);
        throw error;
      }
      toast.success("Добавлено");
    }
    await load();
  }

  async function handleDelete(item: Counterparty) {
    if (!item.id) return;
    const { error } = await supabase
      .from("counterparties")
      .delete()
      .eq("id", item.id);
    if (error) {
      toast.error(`Ошибка удаления: ${error.message}`);
      throw error;
    }
    toast.success("Удалено");
    await load();
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
      <CrudTable<Counterparty>
        data={data}
        columns={columns}
        title="Покупатели"
        searchPlaceholder="Поиск покупателя..."
        onSave={handleSave}
        onDelete={handleDelete}
        renderForm={({ item, onSave, onClose }) => (
          <BuyerForm item={item} onSave={onSave} onClose={onClose} />
        )}
      />
    </div>
  );
}

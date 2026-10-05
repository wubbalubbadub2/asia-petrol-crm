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
  // Наша компания (Taur Trading / НАЗС / Таур Импекс): покупает топливо
  // у внешнего продавца — «Закупка» в сделке KG. Такой поставщик не
  // может быть продавцом в закупке (проверяет триггер БД).
  is_own_supplier?: boolean;
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
    accessorKey: "is_own_supplier",
    header: "Наша компания",
    cell: ({ row }) =>
      row.original.is_own_supplier ? (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Наша</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
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

function SupplierForm({ item, onSave, onClose }: FormProps) {
  const [form, setForm] = useState<Partial<Counterparty>>({
    full_name: item?.full_name ?? "",
    short_name: item?.short_name ?? "",
    bin_iin: item?.bin_iin ?? "",
    legal_address: item?.legal_address ?? "",
    is_active: item?.is_active ?? true,
    is_own_supplier: item?.is_own_supplier ?? false,
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

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_own_supplier"
          checked={form.is_own_supplier ?? false}
          onChange={(e) => set("is_own_supplier", e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="is_own_supplier">Наша компания</Label>
        <span className="text-[11px] text-muted-foreground">— в сделках KG у неё ведётся «Закупка»</span>
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

export default function SuppliersPage() {
  const [data, setData] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    const { data: rows, error } = await supabase
      .from("counterparties")
      .select("id, full_name, short_name, bin_iin, legal_address, is_active, type, is_own_supplier")
      .eq("type", "supplier")
      .order("full_name", { ascending: true });

    if (error) {
      toast.error(`Ошибка загрузки: ${error.message}`);
    } else {
      // database.ts ещё не знает is_own_supplier (миграция закупок) —
      // строка приходит с колонкой, тип её не видит.
      setData((rows ?? []) as unknown as Counterparty[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(values: Partial<Counterparty>, isEdit: boolean) {
    const payload = { ...values, type: "supplier" };
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
        type: "supplier",
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
        title="Поставщики"
        searchPlaceholder="Поиск поставщика..."
        onSave={handleSave}
        onDelete={handleDelete}
        renderForm={({ item, onSave, onClose }) => (
          <SupplierForm item={item} onSave={onSave} onClose={onClose} />
        )}
      />
    </div>
  );
}

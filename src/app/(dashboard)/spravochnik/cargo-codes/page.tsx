"use client";

import { useEffect, useRef, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CrudTable } from "@/components/shared/crud-table";
import { useSupabaseTable } from "@/lib/hooks/use-references";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";

/**
 * Коды груза для заявки на перевозку — по паре «завод + продукт».
 *
 * Клиент 26.08.2026: «в заводу и продукту». Присланная утром таблица
 * выглядела как «завод → коды» только потому, что в ней был один
 * продукт — «у всех продукт мазут, забыла добавить». У одного завода
 * мазут и дизель имеют разные ГНГ, а один и тот же мазут у разных
 * заводов — тоже разный: 27101966 против 27101967, марка отличается.
 */

type CargoCode = {
  id?: string;
  factory_id: string;
  fuel_type_id: string;
  etsng_code?: string;
  gng_code?: string;
  factory?: { name: string } | null;
  fuel_type?: { name: string } | null;
};

type Option = { id: string; name: string };

const columns: ColumnDef<CargoCode, unknown>[] = [
  {
    id: "factory",
    header: "Завод",
    accessorFn: (row) => row.factory?.name ?? "",
    cell: ({ row }) => row.original.factory?.name ?? "—",
  },
  {
    id: "fuel",
    header: "Продукт",
    accessorFn: (row) => row.fuel_type?.name ?? "",
    cell: ({ row }) => row.original.fuel_type?.name ?? "—",
  },
  {
    accessorKey: "etsng_code",
    header: "Код ЕТСНГ",
    cell: ({ row }) => row.original.etsng_code ?? "—",
  },
  {
    accessorKey: "gng_code",
    header: "Код ГНГ",
    cell: ({ row }) => row.original.gng_code ?? "—",
  },
];

type FormProps = {
  item: CargoCode | null;
  onSave: (values: Partial<CargoCode>) => Promise<void>;
  onClose: () => void;
};

function CargoCodeForm({ item, onSave, onClose }: FormProps) {
  const [form, setForm] = useState<Partial<CargoCode>>({
    factory_id: item?.factory_id ?? "",
    fuel_type_id: item?.fuel_type_id ?? "",
    etsng_code: item?.etsng_code ?? "",
    gng_code: item?.gng_code ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [factories, setFactories] = useState<Option[]>([]);
  const [fuels, setFuels] = useState<Option[]>([]);
  const sbRef = useRef(createClient());

  useEffect(() => {
    const sb = sbRef.current;
    Promise.all([
      sb.from("factories").select("id, name").eq("is_active", true).order("name"),
      sb.from("fuel_types").select("id, name").eq("is_active", true).order("name"),
    ]).then(([f, ft]) => {
      setFactories((f.data ?? []) as Option[]);
      setFuels((ft.data ?? []) as Option[]);
    });
  }, []);

  function set(key: keyof CargoCode, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.factory_id || !form.fuel_type_id) {
      toast.error("Выберите завод и продукт");
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...form, ...(item?.id ? { id: item.id } : {}) });
    } finally {
      setSaving(false);
    }
  }

  const opts = (rows: Option[]) => rows.map((r) => ({ value: r.id, label: r.name }));

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label>
          Завод <span className="text-destructive">*</span>
        </Label>
        <SearchableSelect
          options={opts(factories)}
          value={form.factory_id ?? ""}
          onChange={(val) => set("factory_id", val)}
          placeholder="Выберите завод"
          triggerClassName="w-full"
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          Продукт <span className="text-destructive">*</span>
        </Label>
        <SearchableSelect
          options={opts(fuels)}
          value={form.fuel_type_id ?? ""}
          onChange={(val) => set("fuel_type_id", val)}
          placeholder="Выберите продукт"
          triggerClassName="w-full"
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

export default function CargoCodesPage() {
  const { data, loading, save, remove } = useSupabaseTable<CargoCode>(
    "transport_cargo_codes",
    "created_at",
    "id, factory_id, fuel_type_id, etsng_code, gng_code, " +
      "factory:factories(name), fuel_type:fuel_types(name)",
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="max-w-3xl text-[13px] text-muted-foreground">
        Коды подставляются в заявку по паре «грузоотправитель + продукт». Пары нет —
        поля в заявке останутся пустыми, и их придётся заполнить вручную.
      </div>
      <CrudTable<CargoCode>
        data={data}
        columns={columns}
        title="Коды груза (ЕТСНГ / ГНГ)"
        searchPlaceholder="Поиск по заводу или продукту..."
        onSave={save}
        onDelete={remove}
        renderForm={({ item, onSave, onClose }) => (
          <CargoCodeForm item={item} onSave={onSave} onClose={onClose} />
        )}
      />
    </div>
  );
}

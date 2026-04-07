"use client";

import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CrudTable } from "@/components/shared/crud-table";
import { useSupabaseTable } from "@/lib/hooks/use-references";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type StationType = "departure" | "destination" | "both";

type Station = {
  id?: string;
  name: string;
  code?: string;
  type?: StationType;
  is_active?: boolean;
};

const STATION_TYPE_LABELS: Record<StationType, string> = {
  departure: "Отправление",
  destination: "Назначение",
  both: "Обе",
};

const columns: ColumnDef<Station, unknown>[] = [
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
    accessorKey: "type",
    header: "Тип",
    cell: ({ row }) => {
      const val = row.original.type;
      return val ? (STATION_TYPE_LABELS[val] ?? val) : "—";
    },
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
  item: Station | null;
  onSave: (values: Partial<Station>) => Promise<void>;
  onClose: () => void;
};

function StationForm({ item, onSave, onClose }: FormProps) {
  const [form, setForm] = useState<Partial<Station>>({
    name: item?.name ?? "",
    code: item?.code ?? "",
    type: item?.type ?? "departure",
    is_active: item?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof Station>(key: K, value: Station[K]) {
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
          placeholder="Название станции"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="code">Код</Label>
        <Input
          id="code"
          value={form.code ?? ""}
          onChange={(e) => set("code", e.target.value)}
          placeholder="СТАНЦ-01"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Тип станции</Label>
        <Select
          value={form.type ?? "departure"}
          onValueChange={(val) => set("type", val as StationType)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="departure">Отправление</SelectItem>
            <SelectItem value="destination">Назначение</SelectItem>
            <SelectItem value="both">Обе</SelectItem>
          </SelectContent>
        </Select>
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

export default function StationsPage() {
  const { data, loading, save, remove } = useSupabaseTable<Station>(
    "stations",
    "name"
  );
  const [typeFilter, setTypeFilter] = useState<"all" | "departure" | "destination" | "both">("all");

  const filtered = typeFilter === "all" ? data : data.filter((s) => s.type === typeFilter || s.type === "both");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Type filter tabs */}
      <div className="flex gap-1 border-b border-stone-200">
        {([
          { key: "all", label: "Все станции" },
          { key: "departure", label: "Ст. отправления" },
          { key: "destination", label: "Ст. назначения" },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTypeFilter(tab.key)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              typeFilter === tab.key ? "border-amber-500 text-amber-700" : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {tab.label} ({tab.key === "all" ? data.length : data.filter((s) => s.type === tab.key || s.type === "both").length})
          </button>
        ))}
      </div>

      <CrudTable<Station>
        data={filtered}
        columns={columns}
        title="Станции"
        searchPlaceholder="Поиск станции..."
        onSave={save}
        onDelete={remove}
        renderForm={({ item, onSave, onClose }) => (
          <StationForm item={item} onSave={onSave} onClose={onClose} />
        )}
      />
    </div>
  );
}

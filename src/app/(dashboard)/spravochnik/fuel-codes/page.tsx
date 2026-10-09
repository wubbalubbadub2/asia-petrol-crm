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
import { sortByName } from "@/lib/sort-names";
import { parseNum } from "@/lib/utils/parse-num";

/**
 * «Коды по видам ГСМ» (00182): ГНГ и ТН ВЭД по виду ГСМ и % серы.
 * У одного вида может быть несколько строк — по сере. Логисты заносят
 * сами. В заявку на перевозку эти коды идут, когда нет пары
 * «завод + продукт» в «Кодах груза», и только если строка у вида одна.
 * ЕТСНГ живёт на самом виде ГСМ (справочник «Виды ГСМ»).
 */
type FuelCode = {
  id?: string;
  fuel_type_id: string;
  sulfur_percent?: number | null;
  gng_code?: string | null;
  tnved_code?: string | null;
  comment?: string | null;
  fuel_type?: { name: string; etsng_code: string | null } | null;
};
type Option = { id: string; name: string; etsng_code?: string | null };

const fmtSulfur = (v: number | null | undefined) =>
  v == null ? "—" : `${Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}%`;

const columns: ColumnDef<FuelCode, unknown>[] = [
  {
    id: "fuel",
    header: "Вид ГСМ",
    accessorFn: (row) => row.fuel_type?.name ?? "",
    cell: ({ row }) => row.original.fuel_type?.name ?? "—",
  },
  {
    accessorKey: "sulfur_percent",
    header: "% серы",
    cell: ({ row }) => fmtSulfur(row.original.sulfur_percent),
  },
  {
    id: "etsng",
    header: "Код ЕТСНГ (с вида)",
    accessorFn: (row) => row.fuel_type?.etsng_code ?? "",
    cell: ({ row }) => row.original.fuel_type?.etsng_code ?? "—",
  },
  {
    accessorKey: "gng_code",
    header: "Код ГНГ",
    cell: ({ row }) => row.original.gng_code ?? "—",
  },
  {
    accessorKey: "tnved_code",
    header: "Код ТН ВЭД",
    cell: ({ row }) => row.original.tnved_code ?? "—",
  },
  {
    accessorKey: "comment",
    header: "Комментарий",
    cell: ({ row }) => row.original.comment ?? "",
  },
];

type FormState = { fuel_type_id: string; sulfur: string; gng_code: string; tnved_code: string; comment: string };

function FuelCodeForm({ item, onSave, onClose }: {
  item: FuelCode | null;
  onSave: (values: Partial<FuelCode>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    fuel_type_id: item?.fuel_type_id ?? "",
    sulfur: item?.sulfur_percent != null ? String(item.sulfur_percent) : "",
    gng_code: item?.gng_code ?? "",
    tnved_code: item?.tnved_code ?? "",
    comment: item?.comment ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [fuels, setFuels] = useState<Option[]>([]);
  const sbRef = useRef(createClient());

  useEffect(() => {
    sbRef.current.from("fuel_types").select("id, name, etsng_code").eq("is_active", true)
            // etsng_code (00153) нет в сгенерированных типах — через unknown.
      .then(({ data }) => setFuels(sortByName(((data ?? []) as unknown) as Option[], (r) => r.name)));
  }, []);

  const set = (key: keyof FormState, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fuel_type_id) { toast.error("Выберите вид ГСМ"); return; }
    const sulfur = form.sulfur.trim() === "" ? null : parseNum(form.sulfur);
    if (form.sulfur.trim() !== "" && (sulfur == null || sulfur < 0 || sulfur > 100)) {
      toast.error("% серы — число от 0 до 100");
      return;
    }
    if (!form.gng_code.trim() && !form.tnved_code.trim()) {
      toast.error("Укажите хотя бы один код — ГНГ или ТН ВЭД");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...(item?.id ? { id: item.id } : {}),
        fuel_type_id: form.fuel_type_id,
        sulfur_percent: sulfur,
        gng_code: form.gng_code.trim() || null,
        tnved_code: form.tnved_code.trim() || null,
        comment: form.comment.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label>Вид ГСМ <span className="text-destructive">*</span></Label>
        <SearchableSelect
          options={fuels.map((f) => ({ value: f.id, label: f.name }))}
          value={form.fuel_type_id}
          onChange={(val) => set("fuel_type_id", val)}
          placeholder="Выберите вид ГСМ"
          triggerClassName="w-full"
        />
      </div>
      {/* ЕТСНГ — с вида ГСМ, здесь только показывается (клиент 2026-10-09:
          «код ЕТСНГ дублируется — должен автоматом прописываться с вида»). */}
      <div className="space-y-1.5">
        <Label htmlFor="etsng">Код ЕТСНГ (из «Видов ГСМ»)</Label>
        <Input
          id="etsng"
          readOnly
          value={fuels.find((f) => f.id === form.fuel_type_id)?.etsng_code ?? ""}
          placeholder={form.fuel_type_id ? "у вида не задан — заполните в «Видах ГСМ»" : "выберите вид ГСМ"}
          className="font-mono bg-stone-50 text-stone-600"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sulfur">% серы</Label>
          <Input id="sulfur" inputMode="decimal" value={form.sulfur} onChange={(e) => set("sulfur", e.target.value)} placeholder="0,5" className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gng_code">Код ГНГ</Label>
          <Input id="gng_code" value={form.gng_code} onChange={(e) => set("gng_code", e.target.value)} placeholder="27101967" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tnved_code">Код ТН ВЭД</Label>
          <Input id="tnved_code" value={form.tnved_code} onChange={(e) => set("tnved_code", e.target.value)} placeholder="2710196201" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="comment">Комментарий</Label>
        <Input id="comment" value={form.comment} onChange={(e) => set("comment", e.target.value)} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Пусто в «% серы» — строка для вида без уточнения серы (одна на вид). Код ЕТСНГ задаётся в справочнике «Виды ГСМ» и сюда подставляется сам.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Отмена</Button>
        <Button type="submit" disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</Button>
      </div>
    </form>
  );
}

export default function FuelCodesPage() {
  const { data, loading, save, remove } = useSupabaseTable<FuelCode>(
    "fuel_type_codes",
    "created_at",
    "id, fuel_type_id, sulfur_percent, gng_code, tnved_code, comment, fuel_type:fuel_types(name, etsng_code)",
  );

  if (loading) {
    return <div className="flex h-40 items-center justify-center text-muted-foreground">Загрузка...</div>;
  }

  const sorted = [...data].sort((a, b) =>
    (a.fuel_type?.name ?? "").localeCompare(b.fuel_type?.name ?? "", "ru")
    || (a.sulfur_percent ?? -1) - (b.sulfur_percent ?? -1));

  return (
    <div className="space-y-4">
      <div className="max-w-3xl text-[13px] text-muted-foreground">
        Коды по виду ГСМ и содержанию серы. В заявку на перевозку подставляются, когда для
        пары «грузоотправитель + продукт» нет записи в «Кодах груза», и только если у вида
        одна строка — при нескольких код ГНГ выбирается вручную.
      </div>
      <CrudTable<FuelCode>
        data={sorted}
        columns={columns}
        title="Коды по видам ГСМ"
        searchPlaceholder="Поиск по виду ГСМ или коду..."
        onSave={save}
        onDelete={remove}
        renderForm={({ item, onSave, onClose }) => (
          <FuelCodeForm item={item} onSave={onSave} onClose={onClose} />
        )}
      />
    </div>
  );
}

"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useQuotationProductTypes,
  useQuotations,
  type Quotation,
} from "@/lib/hooks/use-quotations";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { useRole } from "@/lib/hooks/use-role";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

function getDaysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const daysCount = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysCount; d++) {
    days.push(
      `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    );
  }
  return days;
}

function formatDay(dateStr: string): string {
  return String(new Date(dateStr + "T00:00:00").getDate());
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00").getDay();
  return d === 0 || d === 6;
}

function EditableCell({
  value,
  onSave,
  disabled,
}: {
  value: number | null;
  onSave: (val: number | null) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");

  if (disabled) {
    return (
      <span className="font-mono text-[11px] tabular-nums text-stone-400">
        {value != null ? value.toFixed(2) : ""}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        onClick={() => {
          setLocalVal(value?.toString() ?? "");
          setEditing(true);
        }}
        className="w-full text-right font-mono text-[11px] tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px]"
      >
        {value != null ? value.toFixed(2) : ""}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      step="0.01"
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const num = localVal.trim() === "" ? null : parseFloat(localVal);
        if (num !== value) onSave(num);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
      className="w-16 border border-amber-400 rounded px-1 py-0 text-[11px] font-mono text-right bg-amber-50 focus:outline-none"
    />
  );
}

function AddProductTypeDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [subName, setSubName] = useState("");
  const [basis, setBasis] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) { toast.error("Введите наименование"); return; }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("quotation_product_types").insert({
      name: name.trim(),
      sub_name: subName.trim() || null,
      basis: basis.trim() || null,
      sort_order: 100,
    });
    if (error) { toast.error(`Ошибка: ${error.message}`); }
    else {
      toast.success("Тип котировки добавлен");
      setName(""); setSubName(""); setBasis("");
      onClose();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить тип котировки</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Наименование</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ГАЗОЙЛЬ 0,1%" />
          </div>
          <div>
            <Label>Подвид</Label>
            <Input value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="CIF NWE/Basis ARA" />
          </div>
          <div>
            <Label>Базис</Label>
            <Input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="FOB Rotterdam" />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? "Сохранение..." : "Добавить"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function QuotationsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const { data: productTypes, loading: typesLoading, reload: reloadTypes } = useQuotationProductTypes();
  const { data: quotations, loading: quotLoading, upsert, reload: reloadQuot } = useQuotations(year, month);
  const { isWritable } = useRole();

  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const quotMap = useMemo(() => {
    const map: Record<string, Quotation> = {};
    for (const q of quotations) map[`${q.product_type_id}|${q.date}`] = q;
    return map;
  }, [quotations]);

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  }

  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  }

  function getMonthAvg(ptId: string): number | null {
    const prices = quotations
      .filter((q) => q.product_type_id === ptId && q.price != null)
      .map((q) => q.price!);
    if (prices.length === 0) return null;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  // Only show loading if types haven't loaded yet; once types are loaded, show content
  const loading = typesLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Котировки</h1>
        <div className="flex items-center gap-2">
          {isWritable && (
            <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Тип котировки
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => { reloadTypes(); reloadQuot(); }}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Обновить
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium min-w-[140px] text-center capitalize">
          {MONTHS_RU[month - 1]} {year}
        </span>
        <Button variant="outline" size="sm" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Загрузка...</p>
      ) : productTypes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Нет типов котировок. Добавьте первый тип через кнопку "Тип котировки".
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto border rounded-md bg-white">
          <table className="w-full border-collapse" style={{ fontSize: "11px" }}>
            <thead>
              <tr className="bg-stone-50 border-b">
                <th className="sticky left-0 z-10 bg-stone-50 border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[36px]">
                  День
                </th>
                {productTypes.map((pt) => (
                  <th
                    key={pt.id}
                    className="border-r px-2 py-1.5 text-center font-medium text-stone-600 min-w-[80px]"
                    title={pt.sub_name ? `${pt.name} — ${pt.sub_name}` : pt.name}
                  >
                    <div className="truncate max-w-[100px]">{pt.name}</div>
                    {pt.sub_name && (
                      <div className="text-[10px] font-normal text-stone-400 truncate max-w-[100px]">
                        {pt.sub_name}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr
                  key={day}
                  className={`border-b ${isWeekend(day) ? "bg-stone-50/50" : "hover:bg-amber-50/30"}`}
                >
                  <td
                    className={`sticky left-0 z-10 border-r px-2 py-0.5 font-mono tabular-nums ${
                      isWeekend(day) ? "bg-stone-50/50 text-stone-400" : "bg-white text-stone-700"
                    }`}
                  >
                    {formatDay(day)}
                  </td>
                  {productTypes.map((pt) => {
                    const q = quotMap[`${pt.id}|${day}`];
                    return (
                      <td key={pt.id} className="border-r px-1 py-0.5 text-right">
                        <EditableCell
                          value={q?.price ?? null}
                          disabled={!isWritable}
                          onSave={(val) => upsert(pt.id, day, "price", val)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-amber-50/50 border-t-2 border-amber-200 font-medium">
                <td className="sticky left-0 z-10 bg-amber-50/50 border-r px-2 py-1 text-amber-800">
                  Среднее
                </td>
                {productTypes.map((pt) => {
                  const avg = getMonthAvg(pt.id);
                  return (
                    <td key={pt.id} className="border-r px-1 py-1 text-right font-mono tabular-nums text-amber-800">
                      {avg != null ? avg.toFixed(2) : "—"}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <AddProductTypeDialog
        open={showAddDialog}
        onClose={() => { setShowAddDialog(false); reloadTypes(); }}
      />
    </div>
  );
}

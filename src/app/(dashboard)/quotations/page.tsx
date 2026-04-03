"use client";

import { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useQuotationProductTypes,
  useQuotations,
  type Quotation,
  type QuotationProductType,
} from "@/lib/hooks/use-quotations";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { useRole } from "@/lib/hooks/use-role";
import { createClient } from "@/lib/supabase/client";
import { PriceCalculator } from "@/components/quotations/price-calculator";
import { QuotationSummary } from "@/components/quotations/quotation-summary";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

// --- Helpers ---
function getDaysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const daysCount = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysCount; d++) {
    days.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return days;
}
function formatDay(dateStr: string): string { return String(new Date(dateStr + "T00:00:00").getDate()); }
function isWeekend(dateStr: string): boolean { const d = new Date(dateStr + "T00:00:00").getDay(); return d === 0 || d === 6; }

// --- Editable Cell ---
function EditableCell({ value, onSave, disabled }: { value: number | null; onSave: (val: number | null) => void; disabled: boolean }) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  if (disabled) return <span className="font-mono text-[11px] tabular-nums text-stone-400">{value != null ? value.toFixed(2) : ""}</span>;
  if (!editing) return (
    <button onClick={() => { setLocalVal(value?.toString() ?? ""); setEditing(true); }}
      className="w-full text-right font-mono text-[11px] tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px]">
      {value != null ? value.toFixed(2) : ""}
    </button>
  );
  return (
    <input autoFocus type="number" step="0.01" value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => { setEditing(false); const num = localVal.trim() === "" ? null : parseFloat(localVal); if (num !== value) onSave(num); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-16 border border-amber-400 rounded px-1 py-0 text-[11px] font-mono text-right bg-amber-50 focus:outline-none" />
  );
}

// --- Add Product Type Dialog ---
function AddProductTypeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState(""); const [subName, setSubName] = useState(""); const [basis, setBasis] = useState(""); const [saving, setSaving] = useState(false);
  async function handleSave() {
    if (!name.trim()) { toast.error("Введите наименование"); return; }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("quotation_product_types").insert({ name: name.trim(), sub_name: subName.trim() || null, basis: basis.trim() || null, sort_order: 100 });
    if (error) toast.error(`Ошибка: ${error.message}`);
    else { toast.success("Тип котировки добавлен"); setName(""); setSubName(""); setBasis(""); onClose(); }
    setSaving(false);
  }
  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Добавить тип котировки</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Наименование</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ГАЗОЙЛЬ 0,1%" /></div>
          <div><Label>Подвид</Label><Input value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="CIF NWE/Basis ARA" /></div>
          <div><Label>Базис</Label><Input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="FOB Rotterdam" /></div>
          <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Сохранение..." : "Добавить"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Product Type Card (drill-down detail) ---
function QuotationDetail({ productType, onBack }: { productType: QuotationProductType; onBack: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { data: quotations, upsert, reload } = useQuotations(year, month);
  const { isWritable } = useRole();
  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const quotMap = useMemo(() => {
    const map: Record<string, Quotation> = {};
    for (const q of quotations) if (q.product_type_id === productType.id) map[q.date] = q;
    return map;
  }, [quotations, productType.id]);

  const PRICE_COLS = [
    { key: "price_cif_nwe", label: "CIF NWE/Basis ARA" },
    { key: "price_fob_med", label: "FOB MED" },
    { key: "price_fob_rotterdam", label: "FOB Rotterdam" },
    { key: "price", label: "Среднее" },
  ] as const;

  function getAvg(field: string): number | null {
    const vals = Object.values(quotMap).map((q) => (q as Record<string, unknown>)[field] as number | null).filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  function prevMonth() { if (month === 1) { setMonth(12); setYear(year - 1); } else setMonth(month - 1); }
  function nextMonth() { if (month === 12) { setMonth(1); setYear(year + 1); } else setMonth(month + 1); }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h2 className="text-lg font-bold">{productType.name}</h2>
          {productType.sub_name && <p className="text-[12px] text-stone-500">{productType.sub_name}</p>}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium min-w-[130px] text-center capitalize">{MONTHS_RU[month - 1]} {year}</span>
          <Button variant="outline" size="sm" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="overflow-x-auto border rounded-md bg-white">
        <table className="w-full border-collapse" style={{ fontSize: "11px" }}>
          <thead>
            <tr className="bg-stone-50 border-b">
              <th className="sticky left-0 z-10 bg-stone-50 border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[36px]">День</th>
              {PRICE_COLS.map((col) => (
                <th key={col.key} className="border-r px-2 py-1.5 text-center font-medium text-stone-600 min-w-[120px]">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const q = quotMap[day];
              return (
                <tr key={day} className={`border-b ${isWeekend(day) ? "bg-stone-50/50" : "hover:bg-amber-50/30"}`}>
                  <td className={`sticky left-0 z-10 border-r px-2 py-0.5 font-mono tabular-nums ${isWeekend(day) ? "bg-stone-50/50 text-stone-400" : "bg-white text-stone-700"}`}>
                    {formatDay(day)}
                  </td>
                  {PRICE_COLS.map((col) => (
                    <td key={col.key} className="border-r px-1 py-0.5 text-right">
                      <EditableCell
                        value={(q as Record<string, unknown> | undefined)?.[col.key] as number | null ?? null}
                        disabled={!isWritable}
                        onSave={(val) => upsert(productType.id, day, col.key, val)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr className="bg-amber-50/50 border-t-2 border-amber-200 font-medium">
              <td className="sticky left-0 z-10 bg-amber-50/50 border-r px-2 py-1 text-amber-800">Среднее</td>
              {PRICE_COLS.map((col) => {
                const avg = getAvg(col.key);
                return (
                  <td key={col.key} className="border-r px-1 py-1 text-right font-mono tabular-nums text-amber-800">
                    {avg != null ? avg.toFixed(2) : "—"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Main Page ---
const PAGE_TABS = [
  { key: "products", label: "Котировки" },
  { key: "summary", label: "Свод КОТ" },
  { key: "calculator", label: "Формирование цены" },
] as const;

export default function QuotationsPage() {
  const [activeTab, setActiveTab] = useState<"products" | "summary" | "calculator">("products");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<QuotationProductType | null>(null);
  const { data: productTypes, loading: typesLoading, reload: reloadTypes } = useQuotationProductTypes();
  const { isWritable } = useRole();

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
          <Button size="sm" variant="outline" onClick={() => reloadTypes()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Обновить
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-stone-200">
        {PAGE_TABS.map((tab) => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); setSelectedProduct(null); }}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === tab.key ? "border-amber-500 text-amber-700" : "border-transparent text-stone-500 hover:text-stone-700"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "summary" && <QuotationSummary />}
      {activeTab === "calculator" && <PriceCalculator />}

      {activeTab === "products" && !selectedProduct && (
        <>
          {typesLoading ? (
            <p className="text-muted-foreground text-sm">Загрузка...</p>
          ) : productTypes.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Нет типов котировок.</CardContent></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {productTypes.map((pt) => (
                <button key={pt.id} onClick={() => setSelectedProduct(pt)} className="text-left">
                  <Card className="group transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-amber-200">
                    <CardContent className="pt-4 pb-3">
                      <p className="text-[13px] font-medium text-stone-800 group-hover:text-amber-700">{pt.name}</p>
                      {pt.sub_name && <p className="text-[11px] text-stone-400 mt-0.5">{pt.sub_name}</p>}
                      {pt.basis && <p className="text-[10px] text-stone-400">{pt.basis}</p>}
                      <div className="mt-2 flex gap-1">
                        {["CIF", "FOB MED", "FOB Rot.", "Avg"].map((label) => (
                          <span key={label} className="rounded bg-stone-100 px-1.5 py-0.5 text-[9px] text-stone-500">{label}</span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === "products" && selectedProduct && (
        <QuotationDetail productType={selectedProduct} onBack={() => setSelectedProduct(null)} />
      )}

      <AddProductTypeDialog open={showAddDialog} onClose={() => { setShowAddDialog(false); reloadTypes(); }} />
    </div>
  );
}

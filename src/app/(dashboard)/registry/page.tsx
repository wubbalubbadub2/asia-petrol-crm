"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Upload, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRegistry, createRegistryEntry, type ShipmentRecord } from "@/lib/hooks/use-registry";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const tabs = [
  { key: "kg" as const, label: "KG (Экспорт)" },
  { key: "kz" as const, label: "KZ (Внутренний)" },
];

function formatNum(val: number | null | undefined): string {
  if (val == null) return "";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
}

function formatDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("ru-RU");
}

function AddEntryDialog({ open, onClose, registryType, onCreated }: {
  open: boolean; onClose: () => void; registryType: "KG" | "KZ"; onCreated: () => void;
}) {
  const supabaseRef = useRef(createClient());
  const [deals, setDeals] = useState<{ id: string; deal_code: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [waybill, setWaybill] = useState("");
  const [wagon, setWagon] = useState("");
  const [volume, setVolume] = useState("");
  const [dealId, setDealId] = useState("");
  const [tariff, setTariff] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!open) return;
    supabaseRef.current.from("deals").select("id, deal_code").eq("deal_type", registryType).eq("is_archived", false).order("deal_code")
      .then(({ data }) => setDeals((data ?? []) as { id: string; deal_code: string }[]));
  }, [open, registryType]);

  async function handleSave() {
    setSaving(true);
    const result = await createRegistryEntry({
      registry_type: registryType,
      date: date || null,
      waybill_number: waybill || null,
      wagon_number: wagon || null,
      shipment_volume: volume ? parseFloat(volume) : null,
      deal_id: dealId || null,
      railway_tariff: tariff ? parseFloat(tariff) : null,
      comment: comment || null,
    });
    setSaving(false);
    if (result) { onCreated(); onClose(); setWaybill(""); setWagon(""); setVolume(""); setDealId(""); setTariff(""); setComment(""); }
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Добавить запись в реестр {registryType}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[12px] text-stone-500">Дата</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Сделка</Label>
            <select value={dealId} onChange={(e) => setDealId(e.target.value)}
              className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer">
              <option value="">Выберите...</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.deal_code}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">№ накладной</Label>
            <Input value={waybill} onChange={(e) => setWaybill(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">№ вагона</Label>
            <Input value={wagon} onChange={(e) => setWagon(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Объем (тонн)</Label>
            <Input type="number" step="0.001" value={volume} onChange={(e) => setVolume(e.target.value)} className="h-8 text-[13px] font-mono" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Ж/Д тариф</Label>
            <Input type="number" step="0.01" value={tariff} onChange={(e) => setTariff(e.target.value)} className="h-8 text-[13px] font-mono" />
          </div>
          <div className="col-span-2">
            <Label className="text-[12px] text-stone-500">Комментарий</Label>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} className="h-8 text-[13px]" />
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="w-full mt-2">{saving ? "Сохранение..." : "Добавить"}</Button>
      </DialogContent>
    </Dialog>
  );
}

export default function RegistryPage() {
  const [activeTab, setActiveTab] = useState<"kg" | "kz">("kg");
  const { data: records, loading, reload } = useRegistry(activeTab === "kg" ? "KG" : "KZ");
  const currency = activeTab === "kg" ? "$" : "₸";
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Реестр отгрузки</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Добавить запись
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.href = "/import"}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Импорт Excel
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-stone-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-amber-500 text-amber-700"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-stone-400">
          {records.length} записей
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : records.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
          <Truck className="h-8 w-8 text-stone-300 mx-auto mb-2" />
          <p className="text-sm text-stone-500">
            Реестр {activeTab.toUpperCase()} пуст
          </p>
          <p className="text-[12px] text-stone-400 mt-1">
            Импортируйте данные из Excel через раздел Импорт
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50">
                <TableHead className="text-[11px] w-[50px]">№</TableHead>
                <TableHead className="text-[11px]">Дата</TableHead>
                <TableHead className="text-[11px]">№ накладной</TableHead>
                <TableHead className="text-[11px]">№ вагона</TableHead>
                <TableHead className="text-right text-[11px]">Объем</TableHead>
                <TableHead className="text-[11px]">Ст. назнач.</TableHead>
                <TableHead className="text-[11px]">Ст. отправ.</TableHead>
                <TableHead className="text-[11px]">ГСМ</TableHead>
                <TableHead className="text-[11px]">№ сделки</TableHead>
                <TableHead className="text-[11px]">Завод</TableHead>
                <TableHead className="text-[11px]">Экспедитор</TableHead>
                <TableHead className="text-right text-[11px]">Тариф</TableHead>
                <TableHead className="text-right text-[11px]">Сумма {currency}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((rec) => (
                <TableRow key={rec.id} className="hover:bg-amber-50/20">
                  <TableCell className="font-mono text-[11px] text-stone-400">{rec.row_number ?? ""}</TableCell>
                  <TableCell className="text-[11px]">{formatDate(rec.date)}</TableCell>
                  <TableCell className="font-mono text-[11px]">{rec.waybill_number ?? ""}</TableCell>
                  <TableCell className="font-mono text-[11px] max-w-[100px] truncate">{rec.wagon_number ?? ""}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums">{formatNum(rec.shipment_volume)}</TableCell>
                  <TableCell className="text-[11px] text-stone-600">{rec.destination_station?.name ?? ""}</TableCell>
                  <TableCell className="text-[11px] text-stone-600">{rec.departure_station?.name ?? ""}</TableCell>
                  <TableCell className="text-[11px]">
                    {rec.fuel_type ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: rec.fuel_type.color }} />
                        {rec.fuel_type.name}
                      </span>
                    ) : ""}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-amber-700">{rec.deal?.deal_code ?? ""}</TableCell>
                  <TableCell className="text-[11px] text-stone-600">{rec.factory?.name ?? ""}</TableCell>
                  <TableCell className="text-[11px] text-stone-600">{rec.forwarder?.name ?? ""}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums">{formatNum(rec.railway_tariff)}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums">{formatNum(rec.shipped_tonnage_amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddEntryDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        registryType={activeTab === "kg" ? "KG" : "KZ"}
        onCreated={reload}
      />
    </div>
  );
}

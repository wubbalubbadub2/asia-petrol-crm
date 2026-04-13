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

// Excel formulas replicated
function getQuarter(month: string | null): string {
  if (!month) return "";
  const m = month.toLowerCase();
  if (["январь", "февраль", "март"].includes(m)) return "I кв";
  if (["апрель", "май", "июнь"].includes(m)) return "II кв";
  if (["июль", "август", "сентябрь"].includes(m)) return "III кв";
  if (["октябрь", "ноябрь", "декабрь"].includes(m)) return "IV кв";
  return "";
}

function roundTonnage(vol: number | null): number | null {
  if (vol == null) return null;
  return Math.ceil(vol); // CEILING.MATH(value, 1, 0)
}

function calcShippedAmount(vol: number | null, tariff: number | null): number | null {
  const rounded = roundTonnage(vol);
  if (rounded == null || tariff == null) return null;
  return rounded * tariff;
}

type RefOption = { id: string; name: string };
type StationOption = { id: string; name: string; default_factory_id: string | null };

function AddEntryDialog({ open, onClose, registryType, onCreated }: {
  open: boolean; onClose: () => void; registryType: "KG" | "KZ"; onCreated: () => void;
}) {
  const supabaseRef = useRef(createClient());
  const [deals, setDeals] = useState<{ id: string; deal_code: string }[]>([]);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [factories, setFactories] = useState<RefOption[]>([]);
  const [fuelTypes, setFuelTypes] = useState<RefOption[]>([]);
  const [forwarders, setForwarders] = useState<RefOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [month, setMonth] = useState("");
  const [waybill, setWaybill] = useState("");
  const [wagon, setWagon] = useState("");
  const [volume, setVolume] = useState("");
  const [dealId, setDealId] = useState("");
  const [destStationId, setDestStationId] = useState("");
  const [depStationId, setDepStationId] = useState("");
  const [fuelTypeId, setFuelTypeId] = useState("");
  const [forwarderId, setForwarderId] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [tariff, setTariff] = useState("");
  const [invoiceNum, setInvoiceNum] = useState("");
  const [comment, setComment] = useState("");
  const [loadingVolume, setLoadingVolume] = useState("");
  const [companyGroupId, setCompanyGroupId] = useState("");
  const [additionalMonth, setAdditionalMonth] = useState("");
  const [companyGroups, setCompanyGroups] = useState<RefOption[]>([]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabaseRef.current.from("deals").select("id, deal_code").eq("deal_type", registryType).eq("is_archived", false).order("deal_code"),
      supabaseRef.current.from("stations").select("id, name, default_factory_id").eq("is_active", true).order("name"),
      supabaseRef.current.from("fuel_types").select("id, name").eq("is_active", true).order("sort_order"),
      supabaseRef.current.from("forwarders").select("id, name").eq("is_active", true).order("name"),
      supabaseRef.current.from("factories").select("id, name").eq("is_active", true).order("name"),
      supabaseRef.current.from("company_groups").select("id, name").eq("is_active", true).order("name"),
    ]).then(([d, s, ft, fw, fac, cg]) => {
      setDeals((d.data ?? []) as { id: string; deal_code: string }[]);
      setStations((s.data ?? []) as StationOption[]);
      setFuelTypes((ft.data ?? []) as RefOption[]);
      setForwarders((fw.data ?? []) as RefOption[]);
      setFactories((fac.data ?? []) as RefOption[]);
      setCompanyGroups((cg.data ?? []) as RefOption[]);
    });
  }, [open, registryType]);

  // Auto-fill factory from departure station
  useEffect(() => {
    if (!depStationId) return;
    const station = stations.find((s) => s.id === depStationId);
    if (station?.default_factory_id && !factoryId) {
      setFactoryId(station.default_factory_id);
    }
  }, [depStationId, stations, factoryId]);

  // Auto-lookup tariff by: departure + destination + fuel type + month
  useEffect(() => {
    if (!depStationId || !destStationId || !fuelTypeId || !month) return;
    if (tariff) return; // Don't override manual entry
    supabaseRef.current.from("tariffs")
      .select("planned_tariff")
      .eq("departure_station_id", depStationId)
      .eq("destination_station_id", destStationId)
      .eq("fuel_type_id", fuelTypeId)
      .eq("month", month)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.planned_tariff && !tariff) {
          setTariff(String(data.planned_tariff));
        }
      });
  }, [depStationId, destStationId, fuelTypeId, month, tariff]);

  async function handleSave() {
    setSaving(true);
    const result = await createRegistryEntry({
      registry_type: registryType,
      date: date || null,
      month: month || null,
      waybill_number: waybill || null,
      wagon_number: wagon || null,
      shipment_volume: volume ? parseFloat(volume) : null,
      deal_id: dealId || null,
      destination_station_id: destStationId || null,
      departure_station_id: depStationId || null,
      fuel_type_id: fuelTypeId || null,
      forwarder_id: forwarderId || null,
      factory_id: factoryId || null,
      railway_tariff: tariff ? parseFloat(tariff) : null,
      invoice_number: invoiceNum || null,
      comment: comment || null,
      loading_volume: loadingVolume ? parseFloat(loadingVolume) : null,
      company_group_id: companyGroupId || null,
      additional_month: additionalMonth || null,
    });
    setSaving(false);
    if (result) { onCreated(); onClose(); setWaybill(""); setWagon(""); setVolume(""); setDealId(""); setTariff(""); setComment(""); setInvoiceNum(""); setFactoryId(""); setLoadingVolume(""); setCompanyGroupId(""); setAdditionalMonth(""); }
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl">
        <DialogHeader><DialogTitle>Добавить запись в реестр {registryType}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
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
            <Label className="text-[12px] text-stone-500">Месяц</Label>
            <Input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="январь" className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">№ накладной</Label>
            <Input value={waybill} onChange={(e) => setWaybill(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">№ вагона / ТС</Label>
            <Input value={wagon} onChange={(e) => setWagon(e.target.value)} placeholder="35261683" className="h-8 text-[13px] font-mono" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Объем отгрузки (тонн)</Label>
            <Input type="number" step="0.001" value={volume} onChange={(e) => setVolume(e.target.value)} className="h-8 text-[13px] font-mono" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Налив тонн</Label>
            <Input type="number" step="0.001" value={loadingVolume} onChange={(e) => setLoadingVolume(e.target.value)} className="h-8 text-[13px] font-mono" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Ст. назначения</Label>
            <select value={destStationId} onChange={(e) => setDestStationId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer">
              <option value="">—</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Ст. отправления</Label>
            <select value={depStationId} onChange={(e) => setDepStationId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer">
              <option value="">—</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Вид ГСМ</Label>
            <select value={fuelTypeId} onChange={(e) => setFuelTypeId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer">
              <option value="">—</option>
              {fuelTypes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Экспедитор</Label>
            <select value={forwarderId} onChange={(e) => setForwarderId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer">
              <option value="">—</option>
              {forwarders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Завод</Label>
            <select value={factoryId} onChange={(e) => setFactoryId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer">
              <option value="">—</option>
              {factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Ж/Д тариф</Label>
            <Input type="number" step="0.01" value={tariff} onChange={(e) => setTariff(e.target.value)} className="h-8 text-[13px] font-mono" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Группа компании</Label>
            <select value={companyGroupId} onChange={(e) => setCompanyGroupId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer">
              <option value="">—</option>
              {companyGroups.map((cg) => <option key={cg.id} value={cg.id}>{cg.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Месяц доп.</Label>
            <Input value={additionalMonth} onChange={(e) => setAdditionalMonth(e.target.value)} placeholder="январь" className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">№ СФ</Label>
            <Input value={invoiceNum} onChange={(e) => setInvoiceNum(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <div className="sm:col-span-2 md:col-span-3">
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
                <TableHead className="text-[11px] w-[40px]">№</TableHead>
                <TableHead className="text-[11px] w-[45px]">Кварт.</TableHead>
                <TableHead className="text-[11px]">Месяц</TableHead>
                <TableHead className="text-[11px]">Дата</TableHead>
                <TableHead className="text-[11px]">№ накладной</TableHead>
                <TableHead className="text-[11px]">№ вагона</TableHead>
                <TableHead className="text-right text-[11px]">Объем</TableHead>
                <TableHead className="text-right text-[11px]">Налив</TableHead>
                <TableHead className="text-[11px]">Ст. назнач.</TableHead>
                <TableHead className="text-[11px]">Ст. отправ.</TableHead>
                <TableHead className="text-[11px]">ГСМ</TableHead>
                <TableHead className="text-[11px]">№ сделки</TableHead>
                <TableHead className="text-[11px]">Завод</TableHead>
                <TableHead className="text-[11px]">Поставщик</TableHead>
                <TableHead className="text-[11px]">Группа комп.</TableHead>
                <TableHead className="text-[11px]">Экспедитор</TableHead>
                <TableHead className="text-[11px]">Мес. отгр.</TableHead>
                <TableHead className="text-[11px]">Мес. доп.</TableHead>
                <TableHead className="text-right text-[11px]">Тариф</TableHead>
                <TableHead className="text-[11px]">Покупатель</TableHead>
                <TableHead className="text-right text-[11px]">Округл. тонн.</TableHead>
                <TableHead className="text-right text-[11px]">Сумма {currency}</TableHead>
                <TableHead className="text-[11px]">№ СФ</TableHead>
                <TableHead className="text-[11px]">Коммент.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((rec, idx) => (
                <TableRow key={rec.id} className="hover:bg-amber-50/20">
                  <TableCell className="font-mono text-[10px] text-stone-400">{idx + 1}</TableCell>
                  <TableCell className="text-[10px] text-stone-500">{getQuarter(rec.month)}</TableCell>
                  <TableCell className="text-[11px] text-stone-600">{rec.month ?? ""}</TableCell>
                  <TableCell className="text-[11px]">{formatDate(rec.date)}</TableCell>
                  <TableCell className="font-mono text-[10px]">{rec.waybill_number ?? ""}</TableCell>
                  <TableCell className="font-mono text-[10px] max-w-[100px] truncate">{rec.wagon_number ?? ""}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums">{formatNum(rec.shipment_volume)}</TableCell>
                  <TableCell className="text-right font-mono text-[10px] tabular-nums text-stone-500">{formatNum(rec.loading_volume)}</TableCell>
                  <TableCell className="text-[10px] text-stone-600">{rec.destination_station?.name ?? ""}</TableCell>
                  <TableCell className="text-[10px] text-stone-600">{rec.departure_station?.name ?? ""}</TableCell>
                  <TableCell className="text-[11px]">
                    {rec.fuel_type ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: rec.fuel_type.color }} />
                        {rec.fuel_type.name}
                      </span>
                    ) : ""}
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-amber-700">{rec.deal?.deal_code ?? ""}</TableCell>
                  <TableCell className="text-[10px] text-stone-600">{rec.factory?.name ?? ""}</TableCell>
                  <TableCell className="text-[10px] text-stone-600">{(rec as Record<string, unknown>).supplier_name as string ?? ""}</TableCell>
                  <TableCell className="text-[10px] text-stone-600">{rec.company_group?.name ?? ""}</TableCell>
                  <TableCell className="text-[10px] text-stone-600">{rec.forwarder?.name ?? ""}</TableCell>
                  <TableCell className="text-[10px] text-stone-500">{rec.shipment_month ?? ""}</TableCell>
                  <TableCell className="text-[10px] text-stone-500">{rec.additional_month ?? ""}</TableCell>
                  <TableCell className="text-right font-mono text-[10px] tabular-nums">{formatNum(rec.railway_tariff)}</TableCell>
                  <TableCell className="text-[10px] text-stone-600">{(rec as Record<string, unknown>).buyer_name as string ?? ""}</TableCell>
                  <TableCell className="text-right font-mono text-[10px] tabular-nums">{formatNum(roundTonnage(rec.shipment_volume))}</TableCell>
                  <TableCell className="text-right font-mono text-[10px] tabular-nums font-medium">{formatNum(calcShippedAmount(rec.shipment_volume, rec.railway_tariff))}</TableCell>
                  <TableCell className="font-mono text-[10px] text-stone-500">{rec.invoice_number ?? ""}</TableCell>
                  <TableCell className="text-[10px] text-stone-400 max-w-[80px] truncate">{rec.comment ?? ""}</TableCell>
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

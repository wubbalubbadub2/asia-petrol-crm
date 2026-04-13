"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Upload, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRegistry, createRegistryEntry, updateRegistryEntry, type ShipmentRecord } from "@/lib/hooks/use-registry";
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

function roundTonnage(vol: number | null): number | null {
  if (vol == null) return null;
  return Math.ceil(vol);
}

function calcShippedAmount(vol: number | null, tariff: number | null): number | null {
  const rounded = roundTonnage(vol);
  if (rounded == null || tariff == null) return null;
  return rounded * tariff;
}

// Inline editable text cell
function EditCell({ value, recId, field, onSaved, className = "" }: {
  value: string | null | undefined; recId: string; field: string; onSaved: () => void; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const pendingVal = useRef<string | null | undefined>(undefined);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) pendingVal.current = undefined;

  if (!editing) {
    return (
      <button onClick={() => { setLocalVal(shown ?? ""); setEditing(true); }}
        className={`w-full text-left text-[11px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px] truncate ${className}`}>
        {shown ?? ""}
      </button>
    );
  }
  return (
    <input autoFocus value={localVal} onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const newVal = localVal.trim() || null;
        if (newVal !== (value ?? null)) {
          pendingVal.current = newVal;
          updateRegistryEntry(recId, { [field]: newVal }).then(onSaved).catch(() => { pendingVal.current = undefined; });
        }
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-full border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none focus:border-amber-500"
    />
  );
}

// Inline editable number cell
function EditNumCell({ value, recId, field, onSaved }: {
  value: number | null | undefined; recId: string; field: string; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const pendingVal = useRef<number | null | undefined>(undefined);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) pendingVal.current = undefined;

  if (!editing) {
    return (
      <button onClick={() => { setLocalVal(shown?.toString() ?? ""); setEditing(true); }}
        className="w-full text-right font-mono text-[11px] tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px] min-w-[40px]">
        {formatNum(shown)}
      </button>
    );
  }
  return (
    <input autoFocus type="number" step="0.01" value={localVal} onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const num = localVal.trim() === "" ? null : parseFloat(localVal);
        if (num !== value) {
          pendingVal.current = num;
          updateRegistryEntry(recId, { [field]: num }).then(onSaved).catch(() => { pendingVal.current = undefined; });
        }
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-16 border border-amber-300 rounded px-1 py-0 text-[11px] font-mono text-right bg-amber-50/50 focus:outline-none focus:border-amber-500"
    />
  );
}

// Inline editable date cell
function EditDateCell({ value, recId, field, onSaved }: {
  value: string | null | undefined; recId: string; field: string; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const pendingVal = useRef<string | null | undefined>(undefined);
  const shown = pendingVal.current !== undefined ? pendingVal.current : value;
  if (pendingVal.current !== undefined && value === pendingVal.current) pendingVal.current = undefined;

  if (!editing) {
    return (
      <button onClick={() => { setLocalVal(shown ?? ""); setEditing(true); }}
        className="w-full text-left text-[11px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px]">
        {shown ? formatDate(shown) : ""}
      </button>
    );
  }
  return (
    <input autoFocus type="date" value={localVal} onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const newVal = localVal || null;
        if (newVal !== (value ?? null)) {
          pendingVal.current = newVal;
          updateRegistryEntry(recId, { [field]: newVal }).then(onSaved).catch(() => { pendingVal.current = undefined; });
        }
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-28 border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none focus:border-amber-500"
    />
  );
}

type RefOption = { id: string; name: string };
type StationOption = { id: string; name: string; default_factory_id: string | null };

type DealRef = {
  id: string; deal_code: string; month: string | null; factory_id: string | null;
  fuel_type_id: string | null; supplier_id: string | null; buyer_id: string | null;
  forwarder_id: string | null; buyer_destination_station_id: string | null;
  logistics_company_group_id: string | null;
  supplier?: { short_name: string | null; full_name: string } | null;
  buyer?: { short_name: string | null; full_name: string } | null;
};

function AddEntryDialog({ open, onClose, registryType, onCreated }: {
  open: boolean; onClose: () => void; registryType: "KG" | "KZ"; onCreated: () => void;
}) {
  const supabaseRef = useRef(createClient());
  const [deals, setDeals] = useState<DealRef[]>([]);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [factories, setFactories] = useState<RefOption[]>([]);
  const [fuelTypes, setFuelTypes] = useState<RefOption[]>([]);
  const [forwarders, setForwarders] = useState<RefOption[]>([]);
  const [companyGroups, setCompanyGroups] = useState<RefOption[]>([]);
  const [saving, setSaving] = useState(false);

  const [dealId, setDealId] = useState("");
  const [month, setMonth] = useState("");
  const [shipmentMonth, setShipmentMonth] = useState("");
  const [fuelTypeId, setFuelTypeId] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [forwarderId, setForwarderId] = useState("");
  const [destStationId, setDestStationId] = useState("");
  const [depStationId, setDepStationId] = useState("");
  const [companyGroupId, setCompanyGroupId] = useState("");
  const [tariff, setTariff] = useState("");
  // Per-shipment fields
  const [wagon, setWagon] = useState("");
  const [volume, setVolume] = useState("");
  const [loadingVolume, setLoadingVolume] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceNum, setInvoiceNum] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabaseRef.current.from("deals")
        .select("id, deal_code, month, factory_id, fuel_type_id, supplier_id, buyer_id, forwarder_id, buyer_destination_station_id, logistics_company_group_id, supplier:counterparties!supplier_id(short_name, full_name), buyer:counterparties!buyer_id(short_name, full_name)")
        .eq("deal_type", registryType).eq("is_archived", false).or("is_draft.is.null,is_draft.eq.false").order("deal_code"),
      supabaseRef.current.from("stations").select("id, name, default_factory_id").eq("is_active", true).order("name"),
      supabaseRef.current.from("fuel_types").select("id, name").eq("is_active", true).order("sort_order"),
      supabaseRef.current.from("forwarders").select("id, name").eq("is_active", true).order("name"),
      supabaseRef.current.from("factories").select("id, name").eq("is_active", true).order("name"),
      supabaseRef.current.from("company_groups").select("id, name").eq("is_active", true).order("name"),
    ]).then(([d, s, ft, fw, fac, cg]) => {
      setDeals((d.data ?? []) as unknown as DealRef[]);
      setStations((s.data ?? []) as StationOption[]);
      setFuelTypes((ft.data ?? []) as RefOption[]);
      setForwarders((fw.data ?? []) as RefOption[]);
      setFactories((fac.data ?? []) as RefOption[]);
      setCompanyGroups((cg.data ?? []) as RefOption[]);
    });
  }, [open, registryType]);

  // Auto-fill from deal
  useEffect(() => {
    if (!dealId) return;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return;
    if (deal.month) setMonth(deal.month);
    if (deal.fuel_type_id) setFuelTypeId(deal.fuel_type_id);
    if (deal.factory_id) setFactoryId(deal.factory_id);
    if (deal.forwarder_id) setForwarderId(deal.forwarder_id);
    if (deal.buyer_destination_station_id) setDestStationId(deal.buyer_destination_station_id);
    if (deal.logistics_company_group_id) setCompanyGroupId(deal.logistics_company_group_id);
  }, [dealId, deals]);

  // Auto-fill factory from departure station
  useEffect(() => {
    if (!depStationId) return;
    const station = stations.find((s) => s.id === depStationId);
    if (station?.default_factory_id && !factoryId) setFactoryId(station.default_factory_id);
  }, [depStationId, stations, factoryId]);

  // Auto-lookup tariff
  useEffect(() => {
    if (!depStationId || !destStationId || !fuelTypeId || !shipmentMonth) return;
    if (tariff) return;
    supabaseRef.current.from("tariffs").select("planned_tariff")
      .eq("departure_station_id", depStationId).eq("destination_station_id", destStationId)
      .eq("fuel_type_id", fuelTypeId).eq("month", shipmentMonth)
      .limit(1).single()
      .then(({ data }) => { if (data?.planned_tariff && !tariff) setTariff(String(data.planned_tariff)); });
  }, [depStationId, destStationId, fuelTypeId, shipmentMonth, tariff]);

  async function handleSave() {
    if (!wagon || !volume) { toast.error("Укажите № вагона и объем"); return; }
    setSaving(true);
    const deal = deals.find((d) => d.id === dealId);
    const result = await createRegistryEntry({
      registry_type: registryType,
      deal_id: dealId || null,
      month: month || null,
      shipment_month: shipmentMonth || null,
      fuel_type_id: fuelTypeId || null,
      factory_id: factoryId || null,
      supplier_id: deal?.supplier_id || null,
      buyer_id: deal?.buyer_id || null,
      forwarder_id: forwarderId || null,
      destination_station_id: destStationId || null,
      departure_station_id: depStationId || null,
      company_group_id: companyGroupId || null,
      railway_tariff: tariff ? parseFloat(tariff) : null,
      wagon_number: wagon,
      shipment_volume: parseFloat(volume),
      loading_volume: loadingVolume ? parseFloat(loadingVolume) : null,
      date: date || null,
      invoice_number: invoiceNum || null,
      comment: comment || null,
    });
    setSaving(false);
    if (result) {
      onCreated(); onClose();
      setWagon(""); setVolume(""); setLoadingVolume(""); setInvoiceNum(""); setComment("");
      setDealId(""); setMonth(""); setShipmentMonth(""); setFuelTypeId(""); setFactoryId("");
      setForwarderId(""); setDestStationId(""); setDepStationId(""); setCompanyGroupId(""); setTariff("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Добавить запись в реестр {registryType}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {/* Deal context */}
          <div className="rounded border border-amber-200 bg-amber-50/30 p-3">
            <p className="text-[11px] font-medium text-amber-700 mb-2">Контекст сделки (автозаполнение)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px] text-stone-500">Сделка</Label>
                <select value={dealId} onChange={(e) => { setDealId(e.target.value); setTariff(""); }}
                  className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">Выберите...</option>
                  {deals.map((d) => <option key={d.id} value={d.id}>{d.deal_code} — {d.supplier?.short_name ?? ""} → {d.buyer?.short_name ?? ""}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Месяц формир.</Label>
                <Input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="январь" className="h-8 text-[12px]" />
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Месяц отгрузки</Label>
                <Input value={shipmentMonth} onChange={(e) => setShipmentMonth(e.target.value)} placeholder="февраль" className="h-8 text-[12px]" />
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">ГСМ</Label>
                <select value={fuelTypeId} onChange={(e) => setFuelTypeId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">—</option>
                  {fuelTypes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Завод</Label>
                <select value={factoryId} onChange={(e) => setFactoryId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">—</option>
                  {factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Экспедитор</Label>
                <select value={forwarderId} onChange={(e) => setForwarderId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">—</option>
                  {forwarders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Группа компании</Label>
                <select value={companyGroupId} onChange={(e) => setCompanyGroupId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">—</option>
                  {companyGroups.map((cg) => <option key={cg.id} value={cg.id}>{cg.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Ст. назначения</Label>
                <select value={destStationId} onChange={(e) => setDestStationId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">—</option>
                  {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Ст. отправления</Label>
                <select value={depStationId} onChange={(e) => setDepStationId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">—</option>
                  {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Ж/Д тариф</Label>
                <Input type="number" step="0.01" value={tariff} onChange={(e) => setTariff(e.target.value)} className="h-8 text-[12px] font-mono" />
              </div>
            </div>
          </div>

          {/* Per-shipment fields */}
          <div className="rounded border border-stone-200 p-3">
            <p className="text-[11px] font-medium text-stone-600 mb-2">Данные отгрузки</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px] text-stone-500">№ вагона *</Label>
                <Input value={wagon} onChange={(e) => setWagon(e.target.value)} placeholder="51742534" className="h-8 text-[12px] font-mono" />
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Тонн *</Label>
                <Input type="number" step="0.001" value={volume} onChange={(e) => setVolume(e.target.value)} className="h-8 text-[12px] font-mono" />
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Налив тонн</Label>
                <Input type="number" step="0.001" value={loadingVolume} onChange={(e) => setLoadingVolume(e.target.value)} className="h-8 text-[12px] font-mono" />
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Дата отгрузки</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-[12px]" />
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">№ СФ</Label>
                <Input value={invoiceNum} onChange={(e) => setInvoiceNum(e.target.value)} className="h-8 text-[12px]" />
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Комментарий</Label>
                <Input value={comment} onChange={(e) => setComment(e.target.value)} className="h-8 text-[12px]" />
              </div>
            </div>
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
          <p className="text-sm text-stone-500">Реестр {activeTab.toUpperCase()} пуст</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
          <table className="w-max border-collapse" style={{ fontSize: "11px" }}>
            <thead>
              <tr className="bg-stone-50 border-b">
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">№ сделки</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">мес. доп</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">мес. отгр.</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">вид ГСМ</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[60px]">завод</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[110px]">поставщик</th>
                <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[60px]">Налив тонн</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[110px]">группа компании</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[110px]">покупатель</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[100px]">экспедитор</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px]">№ вагона</th>
                <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[60px]">Тонн</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px]">дата отгрузки</th>
                <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[60px]">Ж/Д тариф</th>
                <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[50px]">округл</th>
                <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px]">сумма {currency}</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px]">ст. назнач.</th>
                <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px]">ст. отправ.</th>
                <th className="px-2 py-1.5 text-left font-medium text-stone-600 min-w-[120px]">№ СФ</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => (
                <tr key={rec.id} className="border-b hover:bg-amber-50/20">
                  <td className="border-r px-2 py-0.5 font-mono text-amber-700">{rec.deal?.deal_code ?? ""}</td>
                  <td className="border-r px-1 py-0.5"><EditCell value={rec.additional_month} recId={rec.id} field="additional_month" onSaved={reload} /></td>
                  <td className="border-r px-1 py-0.5"><EditCell value={rec.shipment_month} recId={rec.id} field="shipment_month" onSaved={reload} /></td>
                  <td className="border-r px-2 py-0.5">
                    {rec.fuel_type ? <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: rec.fuel_type.color }} />{rec.fuel_type.name}</span> : ""}
                  </td>
                  <td className="border-r px-2 py-0.5 text-stone-600">{rec.factory?.name ?? ""}</td>
                  <td className="border-r px-2 py-0.5 text-stone-600 truncate max-w-[110px]">{(rec as Record<string, unknown>).supplier_name as string ?? ""}</td>
                  <td className="border-r px-1 py-0.5"><EditNumCell value={rec.loading_volume} recId={rec.id} field="loading_volume" onSaved={reload} /></td>
                  <td className="border-r px-2 py-0.5 text-stone-600">{rec.company_group?.name ?? ""}</td>
                  <td className="border-r px-2 py-0.5 text-stone-600 truncate max-w-[110px]">{(rec as Record<string, unknown>).buyer_name as string ?? ""}</td>
                  <td className="border-r px-2 py-0.5 text-stone-600">{rec.forwarder?.name ?? ""}</td>
                  <td className="border-r px-1 py-0.5"><EditCell value={rec.wagon_number} recId={rec.id} field="wagon_number" onSaved={reload} className="font-mono" /></td>
                  <td className="border-r px-1 py-0.5"><EditNumCell value={rec.shipment_volume} recId={rec.id} field="shipment_volume" onSaved={reload} /></td>
                  <td className="border-r px-1 py-0.5"><EditDateCell value={rec.date} recId={rec.id} field="date" onSaved={reload} /></td>
                  <td className="border-r px-1 py-0.5"><EditNumCell value={rec.railway_tariff} recId={rec.id} field="railway_tariff" onSaved={reload} /></td>
                  <td className="border-r px-2 py-0.5 text-right font-mono tabular-nums text-stone-500">{formatNum(roundTonnage(rec.shipment_volume))}</td>
                  <td className="border-r px-2 py-0.5 text-right font-mono tabular-nums font-medium">{formatNum(calcShippedAmount(rec.shipment_volume, rec.railway_tariff))}</td>
                  <td className="border-r px-2 py-0.5 text-stone-600">{rec.destination_station?.name ?? ""}</td>
                  <td className="border-r px-2 py-0.5 text-stone-600">{rec.departure_station?.name ?? ""}</td>
                  <td className="px-1 py-0.5"><EditCell value={rec.invoice_number} recId={rec.id} field="invoice_number" onSaved={reload} className="font-mono" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddEntryDialog open={showAdd} onClose={() => setShowAdd(false)} registryType={activeTab === "kg" ? "KG" : "KZ"} onCreated={reload} />
    </div>
  );
}

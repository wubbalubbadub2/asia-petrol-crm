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

type DealRef = {
  id: string;
  deal_code: string;
  month: string | null;
  factory_id: string | null;
  fuel_type_id: string | null;
  supplier_id: string | null;
  buyer_id: string | null;
  forwarder_id: string | null;
  buyer_destination_station_id: string | null;
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
  const [supplierId, setSupplierId] = useState("");
  const [buyerId, setBuyerId] = useState("");
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

  // Auto-fill fields from selected deal
  useEffect(() => {
    if (!dealId) return;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return;
    if (deal.month && !month) setMonth(deal.month);
    if (deal.fuel_type_id && !fuelTypeId) setFuelTypeId(deal.fuel_type_id);
    if (deal.factory_id && !factoryId) setFactoryId(deal.factory_id);
    if (deal.forwarder_id && !forwarderId) setForwarderId(deal.forwarder_id);
    if (deal.supplier_id) setSupplierId(deal.supplier_id);
    if (deal.buyer_id) setBuyerId(deal.buyer_id);
    if (deal.buyer_destination_station_id && !destStationId) setDestStationId(deal.buyer_destination_station_id);
    if (deal.logistics_company_group_id && !companyGroupId) setCompanyGroupId(deal.logistics_company_group_id);
  }, [dealId, deals]);

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
      supplier_id: supplierId || null,
      buyer_id: buyerId || null,
      factory_id: factoryId || null,
      railway_tariff: tariff ? parseFloat(tariff) : null,
      invoice_number: invoiceNum || null,
      comment: comment || null,
      loading_volume: loadingVolume ? parseFloat(loadingVolume) : null,
      company_group_id: companyGroupId || null,
      additional_month: additionalMonth || null,
    });
    setSaving(false);
    if (result) { onCreated(); onClose(); setWaybill(""); setWagon(""); setVolume(""); setDealId(""); setTariff(""); setComment(""); setInvoiceNum(""); setFactoryId(""); setLoadingVolume(""); setCompanyGroupId(""); setAdditionalMonth(""); setSupplierId(""); setBuyerId(""); setMonth(""); setFuelTypeId(""); setForwarderId(""); setDestStationId(""); setDepStationId(""); }
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
            <select value={dealId} onChange={(e) => { setDealId(e.target.value); setTariff(""); }}
              className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer">
              <option value="">Выберите...</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.deal_code} — {d.supplier?.short_name ?? d.supplier?.full_name ?? ""} → {d.buyer?.short_name ?? d.buyer?.full_name ?? ""}
                </option>
              ))}
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

// Inline form for adding a shipment within an expanded group
function InlineShipmentForm({ context, registryType, onCreated }: {
  context: ShipmentRecord;
  registryType: "KG" | "KZ";
  onCreated: () => void;
}) {
  const [wagon, setWagon] = useState("");
  const [volume, setVolume] = useState("");
  const [loadVol, setLoadVol] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [waybill, setWaybill] = useState("");
  const [invoiceNum, setInvoiceNum] = useState("");
  const [commentText, setCommentText] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!volume || !wagon) { toast.error("Укажите № вагона и объем"); return; }
    setSaving(true);
    const result = await createRegistryEntry({
      registry_type: registryType,
      deal_id: context.deal_id,
      month: context.month,
      shipment_month: context.shipment_month,
      fuel_type_id: context.fuel_type_id,
      factory_id: context.factory_id,
      forwarder_id: context.forwarder_id,
      supplier_id: context.supplier_id,
      buyer_id: context.buyer_id,
      destination_station_id: context.destination_station_id,
      departure_station_id: context.departure_station_id,
      railway_tariff: context.railway_tariff,
      company_group_id: context.company_group_id,
      wagon_number: wagon,
      shipment_volume: parseFloat(volume),
      loading_volume: loadVol ? parseFloat(loadVol) : null,
      date: date || null,
      waybill_number: waybill || null,
      invoice_number: invoiceNum || null,
      comment: commentText || null,
    });
    setSaving(false);
    if (result) {
      setWagon(""); setVolume(""); setLoadVol(""); setWaybill(""); setInvoiceNum(""); setCommentText("");
      onCreated();
    }
  }

  return (
    <div className="flex gap-2 items-end flex-wrap py-1.5 px-2 bg-amber-50/30 rounded">
      <div className="w-24">
        <Label className="text-[10px] text-stone-400">№ вагона *</Label>
        <Input value={wagon} onChange={(e) => setWagon(e.target.value)} placeholder="51742534" className="h-7 text-[11px] font-mono" />
      </div>
      <div className="w-20">
        <Label className="text-[10px] text-stone-400">Тонн *</Label>
        <Input type="number" step="0.001" value={volume} onChange={(e) => setVolume(e.target.value)} className="h-7 text-[11px] font-mono" />
      </div>
      <div className="w-20">
        <Label className="text-[10px] text-stone-400">Налив</Label>
        <Input type="number" step="0.001" value={loadVol} onChange={(e) => setLoadVol(e.target.value)} className="h-7 text-[11px] font-mono" />
      </div>
      <div className="w-28">
        <Label className="text-[10px] text-stone-400">Дата отгрузки</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-7 text-[11px]" />
      </div>
      <div className="w-24">
        <Label className="text-[10px] text-stone-400">№ накладной</Label>
        <Input value={waybill} onChange={(e) => setWaybill(e.target.value)} className="h-7 text-[11px]" />
      </div>
      <div className="w-28">
        <Label className="text-[10px] text-stone-400">№ СФ</Label>
        <Input value={invoiceNum} onChange={(e) => setInvoiceNum(e.target.value)} className="h-7 text-[11px]" />
      </div>
      <div className="flex-1 min-w-[80px]">
        <Label className="text-[10px] text-stone-400">Коммент.</Label>
        <Input value={commentText} onChange={(e) => setCommentText(e.target.value)} className="h-7 text-[11px]" />
      </div>
      <Button size="sm" onClick={handleAdd} disabled={saving} className="h-7 text-[10px] px-3">{saving ? "..." : "Добавить"}</Button>
    </div>
  );
}

// Group records by deal_id + shipment_month
type RecordGroup = {
  key: string;
  dealCode: string;
  month: string;
  shipmentMonth: string;
  fuelType: string;
  fuelColor: string;
  factory: string;
  supplier: string;
  buyer: string;
  forwarder: string;
  companyGroup: string;
  destStation: string;
  depStation: string;
  tariff: number | null;
  records: ShipmentRecord[];
  totalVolume: number;
  totalAmount: number;
  count: number;
};

function groupRecords(records: ShipmentRecord[]): RecordGroup[] {
  const groups = new Map<string, RecordGroup>();
  for (const rec of records) {
    const key = `${rec.deal_id ?? "none"}_${rec.shipment_month ?? rec.month ?? ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        dealCode: rec.deal?.deal_code ?? "",
        month: rec.month ?? "",
        shipmentMonth: rec.shipment_month ?? rec.month ?? "",
        fuelType: rec.fuel_type?.name ?? "",
        fuelColor: rec.fuel_type?.color ?? "#6B7280",
        factory: rec.factory?.name ?? "",
        supplier: (rec as Record<string, unknown>).supplier_name as string ?? "",
        buyer: (rec as Record<string, unknown>).buyer_name as string ?? "",
        forwarder: rec.forwarder?.name ?? "",
        companyGroup: rec.company_group?.name ?? "",
        destStation: rec.destination_station?.name ?? "",
        depStation: rec.departure_station?.name ?? "",
        tariff: rec.railway_tariff,
        records: [],
        totalVolume: 0,
        totalAmount: 0,
        count: 0,
      });
    }
    const g = groups.get(key)!;
    g.records.push(rec);
    g.totalVolume += rec.shipment_volume ?? 0;
    g.totalAmount += calcShippedAmount(rec.shipment_volume, rec.railway_tariff) ?? 0;
    g.count++;
  }
  return Array.from(groups.values());
}

export default function RegistryPage() {
  const [activeTab, setActiveTab] = useState<"kg" | "kz">("kg");
  const { data: records, loading, reload } = useRegistry(activeTab === "kg" ? "KG" : "KZ");
  const currency = activeTab === "kg" ? "$" : "₸";
  const [showAdd, setShowAdd] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const groups = groupRecords(records);

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
            Добавьте запись или импортируйте данные из Excel
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const isExpanded = expandedGroup === g.key;
            return (
              <div key={g.key} className="rounded-md border border-stone-200 bg-white overflow-hidden">
                {/* Group header row — click to expand */}
                <button
                  onClick={() => setExpandedGroup(isExpanded ? null : g.key)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-stone-50 transition-colors text-left"
                >
                  <span className={`text-[10px] transition-transform ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                  <span className="font-mono text-[12px] font-bold text-amber-700">{g.dealCode || "—"}</span>
                  <span className="text-[11px] text-stone-500">{g.month}</span>
                  <span className="text-[11px] text-stone-500">→ отгр: {g.shipmentMonth}</span>
                  <span className="inline-flex items-center gap-1 text-[11px]">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: g.fuelColor }} />
                    {g.fuelType}
                  </span>
                  <span className="text-[10px] text-stone-400">{g.factory}</span>
                  <span className="text-[10px] text-stone-500 truncate max-w-[100px]">{g.supplier}</span>
                  <span className="text-stone-300">→</span>
                  <span className="text-[10px] text-stone-500 truncate max-w-[100px]">{g.buyer}</span>
                  <span className="text-[10px] text-stone-400">{g.forwarder}</span>
                  <span className="text-[10px] text-stone-400">{g.destStation}</span>
                  <span className="ml-auto flex items-center gap-3">
                    <span className="text-[10px] text-stone-400">тариф: {formatNum(g.tariff)}</span>
                    <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      {g.count} вагон{g.count === 1 ? "" : g.count < 5 ? "а" : "ов"}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums font-medium text-stone-700">{formatNum(g.totalVolume)} т</span>
                    <span className="font-mono text-[11px] tabular-nums text-stone-500">{formatNum(g.totalAmount)} {currency}</span>
                  </span>
                </button>

                {/* Expanded: individual shipment rows */}
                {isExpanded && (
                  <div className="border-t border-stone-200 bg-stone-50/50">
                    <div className="overflow-x-auto">
                      <table className="w-full" style={{ fontSize: "11px" }}>
                        <thead>
                          <tr className="bg-stone-100/50 text-stone-500">
                            <th className="px-2 py-1 text-left font-medium w-[30px]">№</th>
                            <th className="px-2 py-1 text-left font-medium">№ вагона</th>
                            <th className="px-2 py-1 text-right font-medium">Тонн</th>
                            <th className="px-2 py-1 text-right font-medium">Налив</th>
                            <th className="px-2 py-1 text-left font-medium">Дата отгрузки</th>
                            <th className="px-2 py-1 text-right font-medium">Округл.</th>
                            <th className="px-2 py-1 text-right font-medium">Сумма {currency}</th>
                            <th className="px-2 py-1 text-left font-medium">№ накладной</th>
                            <th className="px-2 py-1 text-left font-medium">№ СФ</th>
                            <th className="px-2 py-1 text-left font-medium">Коммент.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.records.map((rec, idx) => (
                            <tr key={rec.id} className="border-b border-stone-100 hover:bg-amber-50/20">
                              <td className="px-2 py-1 font-mono text-[10px] text-stone-400">{idx + 1}</td>
                              <td className="px-2 py-1 font-mono text-[11px]">{rec.wagon_number ?? ""}</td>
                              <td className="px-2 py-1 text-right font-mono tabular-nums">{formatNum(rec.shipment_volume)}</td>
                              <td className="px-2 py-1 text-right font-mono tabular-nums text-stone-500">{formatNum(rec.loading_volume)}</td>
                              <td className="px-2 py-1">{formatDate(rec.date)}</td>
                              <td className="px-2 py-1 text-right font-mono tabular-nums">{formatNum(roundTonnage(rec.shipment_volume))}</td>
                              <td className="px-2 py-1 text-right font-mono tabular-nums font-medium">{formatNum(calcShippedAmount(rec.shipment_volume, rec.railway_tariff))}</td>
                              <td className="px-2 py-1 font-mono text-[10px]">{rec.waybill_number ?? ""}</td>
                              <td className="px-2 py-1 font-mono text-[10px] text-stone-500">{rec.invoice_number ?? ""}</td>
                              <td className="px-2 py-1 text-[10px] text-stone-400 truncate max-w-[100px]">{rec.comment ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Inline add shipment form */}
                    <div className="border-t border-stone-200 p-2">
                      <InlineShipmentForm
                        context={g.records[0]}
                        registryType={activeTab === "kg" ? "KG" : "KZ"}
                        onCreated={reload}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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

"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Upload, Truck, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
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
function calcAmount(vol: number | null, tariff: number | null): number | null {
  const r = roundTonnage(vol);
  if (r == null || tariff == null) return null;
  return r * tariff;
}

// --- Inline editable cells ---
function EditCell({ value, recId, field, onSaved, className = "" }: {
  value: string | null | undefined; recId: string; field: string; onSaved: () => void; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [lv, setLv] = useState("");
  const pv = useRef<string | null | undefined>(undefined);
  const shown = pv.current !== undefined ? pv.current : value;
  if (pv.current !== undefined && value === pv.current) pv.current = undefined;
  if (!editing) return <button onClick={() => { setLv(shown ?? ""); setEditing(true); }} className={`w-full text-left text-[11px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px] truncate ${className}`}>{shown ?? ""}</button>;
  return <input autoFocus value={lv} onChange={(e) => setLv(e.target.value)} onBlur={() => { setEditing(false); const nv = lv.trim() || null; if (nv !== (value ?? null)) { pv.current = nv; updateRegistryEntry(recId, { [field]: nv }).then(onSaved).catch(() => { pv.current = undefined; }); } }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }} className="w-full border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none" />;
}
function EditNumCell({ value, recId, field, onSaved }: {
  value: number | null | undefined; recId: string; field: string; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [lv, setLv] = useState("");
  const pv = useRef<number | null | undefined>(undefined);
  const shown = pv.current !== undefined ? pv.current : value;
  if (pv.current !== undefined && value === pv.current) pv.current = undefined;
  if (!editing) return <button onClick={() => { setLv(shown?.toString() ?? ""); setEditing(true); }} className="w-full text-right font-mono text-[11px] tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px] min-w-[40px]">{formatNum(shown)}</button>;
  return <input autoFocus type="number" step="0.01" value={lv} onChange={(e) => setLv(e.target.value)} onBlur={() => { setEditing(false); const n = lv.trim() === "" ? null : parseFloat(lv); if (n !== value) { pv.current = n; updateRegistryEntry(recId, { [field]: n }).then(onSaved).catch(() => { pv.current = undefined; }); } }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }} className="w-16 border border-amber-300 rounded px-1 py-0 text-[11px] font-mono text-right bg-amber-50/50 focus:outline-none" />;
}
function EditDateCell({ value, recId, field, onSaved }: {
  value: string | null | undefined; recId: string; field: string; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [lv, setLv] = useState("");
  const pv = useRef<string | null | undefined>(undefined);
  const shown = pv.current !== undefined ? pv.current : value;
  if (pv.current !== undefined && value === pv.current) pv.current = undefined;
  if (!editing) return <button onClick={() => { setLv(shown ?? ""); setEditing(true); }} className="w-full text-left text-[11px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px]">{shown ? formatDate(shown) : ""}</button>;
  return <input autoFocus type="date" value={lv} onChange={(e) => setLv(e.target.value)} onBlur={() => { setEditing(false); const nv = lv || null; if (nv !== (value ?? null)) { pv.current = nv; updateRegistryEntry(recId, { [field]: nv }).then(onSaved).catch(() => { pv.current = undefined; }); } }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }} className="w-28 border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none" />;
}

// --- Group records by deal ---
type RecordGroup = {
  key: string;
  dealId: string | null;
  dealCode: string;
  month: string;
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
};

function groupRecords(records: ShipmentRecord[]): RecordGroup[] {
  const groups = new Map<string, RecordGroup>();
  for (const rec of records) {
    const key = rec.deal_id ?? `orphan-${rec.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key, dealId: rec.deal_id,
        dealCode: rec.deal?.deal_code ?? "—",
        month: rec.month ?? "",
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
        records: [], totalVolume: 0, totalAmount: 0,
      });
    }
    const g = groups.get(key)!;
    g.records.push(rec);
    g.totalVolume += rec.shipment_volume ?? 0;
    g.totalAmount += calcAmount(rec.shipment_volume, rec.railway_tariff) ?? 0;
  }
  return Array.from(groups.values());
}

// --- Inline add row within a group ---
function InlineAddRow({ context, registryType, onCreated }: {
  context: ShipmentRecord; registryType: "KG" | "KZ"; onCreated: () => void;
}) {
  const [wagon, setWagon] = useState("");
  const [volume, setVolume] = useState("");
  const [loadVol, setLoadVol] = useState("");
  const [date, setDate] = useState("");
  const [shipMonth, setShipMonth] = useState("");
  const [invoiceNum, setInvoiceNum] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!wagon || !volume) return;
    setSaving(true);
    await createRegistryEntry({
      registry_type: registryType,
      deal_id: context.deal_id, month: context.month,
      shipment_month: shipMonth || context.shipment_month,
      fuel_type_id: context.fuel_type_id, factory_id: context.factory_id,
      supplier_id: context.supplier_id, buyer_id: context.buyer_id,
      forwarder_id: context.forwarder_id,
      destination_station_id: context.destination_station_id,
      departure_station_id: context.departure_station_id,
      railway_tariff: context.railway_tariff,
      company_group_id: context.company_group_id,
      wagon_number: wagon, shipment_volume: parseFloat(volume),
      loading_volume: loadVol ? parseFloat(loadVol) : null,
      date: date || null, invoice_number: invoiceNum || null,
    });
    setSaving(false);
    setWagon(""); setVolume(""); setLoadVol(""); setDate(""); setInvoiceNum("");
    onCreated();
  }

  return (
    <tr className="bg-amber-50/30 border-t border-amber-200">
      <td className="px-1 py-1 border-r" colSpan={2}></td>
      <td className="px-1 py-1 border-r"><input value={shipMonth} onChange={(e) => setShipMonth(e.target.value)} placeholder="мес." className="w-full h-6 text-[10px] border border-stone-200 rounded px-1" /></td>
      <td className="px-1 py-1 border-r" colSpan={4}></td>
      <td className="px-1 py-1 border-r"><input value={wagon} onChange={(e) => setWagon(e.target.value)} placeholder="№ вагона" className="w-full h-6 text-[10px] font-mono border border-stone-200 rounded px-1" /></td>
      <td className="px-1 py-1 border-r"><input type="number" step="0.001" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="тонн" className="w-full h-6 text-[10px] font-mono border border-stone-200 rounded px-1 text-right" /></td>
      <td className="px-1 py-1 border-r"><input type="number" step="0.001" value={loadVol} onChange={(e) => setLoadVol(e.target.value)} placeholder="налив" className="w-full h-6 text-[10px] font-mono border border-stone-200 rounded px-1 text-right" /></td>
      <td className="px-1 py-1 border-r"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full h-6 text-[10px] border border-stone-200 rounded px-1" /></td>
      <td className="px-1 py-1 border-r" colSpan={2}></td>
      <td className="px-1 py-1 border-r" colSpan={2}></td>
      <td className="px-1 py-1 border-r"><input value={invoiceNum} onChange={(e) => setInvoiceNum(e.target.value)} placeholder="№ СФ" className="w-full h-6 text-[10px] font-mono border border-stone-200 rounded px-1" /></td>
      <td className="px-1 py-1">
        <Button size="sm" onClick={handleAdd} disabled={saving || !wagon || !volume} className="h-6 text-[9px] px-2">{saving ? "..." : "+ строка"}</Button>
      </td>
    </tr>
  );
}

// --- Add Entry Dialog (creates first row for a new deal) ---
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
  const sbRef = useRef(createClient());
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
  const [wagon, setWagon] = useState("");
  const [volume, setVolume] = useState("");
  const [loadingVolume, setLoadingVolume] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceNum, setInvoiceNum] = useState("");

  useEffect(() => {
    if (!open) return;
    Promise.all([
      sbRef.current.from("deals").select("id, deal_code, month, factory_id, fuel_type_id, supplier_id, buyer_id, forwarder_id, buyer_destination_station_id, logistics_company_group_id, supplier:counterparties!supplier_id(short_name, full_name), buyer:counterparties!buyer_id(short_name, full_name)")
        .eq("deal_type", registryType).eq("is_archived", false).or("is_draft.is.null,is_draft.eq.false").order("deal_code"),
      sbRef.current.from("stations").select("id, name, default_factory_id").eq("is_active", true).order("name"),
      sbRef.current.from("fuel_types").select("id, name").eq("is_active", true).order("sort_order"),
      sbRef.current.from("forwarders").select("id, name").eq("is_active", true).order("name"),
      sbRef.current.from("factories").select("id, name").eq("is_active", true).order("name"),
      sbRef.current.from("company_groups").select("id, name").eq("is_active", true).order("name"),
    ]).then(([d, s, ft, fw, fac, cg]) => {
      setDeals((d.data ?? []) as unknown as DealRef[]);
      setStations((s.data ?? []) as StationOption[]);
      setFuelTypes((ft.data ?? []) as RefOption[]);
      setForwarders((fw.data ?? []) as RefOption[]);
      setFactories((fac.data ?? []) as RefOption[]);
      setCompanyGroups((cg.data ?? []) as RefOption[]);
    });
  }, [open, registryType]);

  useEffect(() => {
    if (!dealId) return;
    const d = deals.find((x) => x.id === dealId);
    if (!d) return;
    if (d.month) setMonth(d.month);
    if (d.fuel_type_id) setFuelTypeId(d.fuel_type_id);
    if (d.factory_id) setFactoryId(d.factory_id);
    if (d.forwarder_id) setForwarderId(d.forwarder_id);
    if (d.buyer_destination_station_id) setDestStationId(d.buyer_destination_station_id);
    if (d.logistics_company_group_id) setCompanyGroupId(d.logistics_company_group_id);
  }, [dealId, deals]);

  useEffect(() => {
    if (!depStationId) return;
    const st = stations.find((s) => s.id === depStationId);
    if (st?.default_factory_id && !factoryId) setFactoryId(st.default_factory_id);
  }, [depStationId, stations, factoryId]);

  useEffect(() => {
    if (!depStationId || !destStationId || !fuelTypeId || !shipmentMonth || tariff) return;
    sbRef.current.from("tariffs").select("planned_tariff")
      .eq("departure_station_id", depStationId).eq("destination_station_id", destStationId)
      .eq("fuel_type_id", fuelTypeId).eq("month", shipmentMonth).limit(1).single()
      .then(({ data }) => { if (data?.planned_tariff) setTariff(String(data.planned_tariff)); });
  }, [depStationId, destStationId, fuelTypeId, shipmentMonth, tariff]);

  async function handleSave() {
    if (!wagon || !volume) { toast.error("Укажите № вагона и объем"); return; }
    setSaving(true);
    const deal = deals.find((d) => d.id === dealId);
    await createRegistryEntry({
      registry_type: registryType, deal_id: dealId || null, month: month || null,
      shipment_month: shipmentMonth || null, fuel_type_id: fuelTypeId || null,
      factory_id: factoryId || null, supplier_id: deal?.supplier_id || null,
      buyer_id: deal?.buyer_id || null, forwarder_id: forwarderId || null,
      destination_station_id: destStationId || null, departure_station_id: depStationId || null,
      company_group_id: companyGroupId || null, railway_tariff: tariff ? parseFloat(tariff) : null,
      wagon_number: wagon, shipment_volume: parseFloat(volume),
      loading_volume: loadingVolume ? parseFloat(loadingVolume) : null,
      date: date || null, invoice_number: invoiceNum || null,
    });
    setSaving(false);
    onCreated(); onClose();
    setWagon(""); setVolume(""); setLoadingVolume(""); setInvoiceNum("");
    setDealId(""); setMonth(""); setShipmentMonth(""); setFuelTypeId(""); setFactoryId("");
    setForwarderId(""); setDestStationId(""); setDepStationId(""); setCompanyGroupId(""); setTariff("");
  }

  const Sel = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
    <div>
      <Label className="text-[10px] text-stone-500">{label}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
        <option value="">—</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Новая запись в реестр {registryType}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded border border-amber-200 bg-amber-50/30 p-3">
            <p className="text-[11px] font-medium text-amber-700 mb-2">Контекст сделки</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px] text-stone-500">Сделка</Label>
                <select value={dealId} onChange={(e) => { setDealId(e.target.value); setTariff(""); }} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">Выберите...</option>
                  {deals.map((d) => <option key={d.id} value={d.id}>{d.deal_code} — {d.supplier?.short_name ?? ""} → {d.buyer?.short_name ?? ""}</option>)}
                </select>
              </div>
              <div><Label className="text-[10px] text-stone-500">Месяц формир.</Label><Input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="январь" className="h-8 text-[12px]" /></div>
              <div><Label className="text-[10px] text-stone-500">Месяц отгрузки</Label><Input value={shipmentMonth} onChange={(e) => setShipmentMonth(e.target.value)} placeholder="февраль" className="h-8 text-[12px]" /></div>
              <Sel label="ГСМ" value={fuelTypeId} onChange={setFuelTypeId} options={fuelTypes.map((f) => ({ value: f.id, label: f.name }))} />
              <Sel label="Завод" value={factoryId} onChange={setFactoryId} options={factories.map((f) => ({ value: f.id, label: f.name }))} />
              <Sel label="Экспедитор" value={forwarderId} onChange={setForwarderId} options={forwarders.map((f) => ({ value: f.id, label: f.name }))} />
              <Sel label="Группа комп." value={companyGroupId} onChange={setCompanyGroupId} options={companyGroups.map((c) => ({ value: c.id, label: c.name }))} />
              <Sel label="Ст. назначения" value={destStationId} onChange={setDestStationId} options={stations.map((s) => ({ value: s.id, label: s.name }))} />
              <Sel label="Ст. отправления" value={depStationId} onChange={setDepStationId} options={stations.map((s) => ({ value: s.id, label: s.name }))} />
              <div><Label className="text-[10px] text-stone-500">Ж/Д тариф</Label><Input type="number" step="0.01" value={tariff} onChange={(e) => setTariff(e.target.value)} className="h-8 text-[12px] font-mono" /></div>
            </div>
          </div>
          <div className="rounded border border-stone-200 p-3">
            <p className="text-[11px] font-medium text-stone-600 mb-2">Первая отгрузка</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              <div><Label className="text-[10px] text-stone-500">№ вагона *</Label><Input value={wagon} onChange={(e) => setWagon(e.target.value)} placeholder="51742534" className="h-8 text-[12px] font-mono" /></div>
              <div><Label className="text-[10px] text-stone-500">Тонн *</Label><Input type="number" step="0.001" value={volume} onChange={(e) => setVolume(e.target.value)} className="h-8 text-[12px] font-mono" /></div>
              <div><Label className="text-[10px] text-stone-500">Налив тонн</Label><Input type="number" step="0.001" value={loadingVolume} onChange={(e) => setLoadingVolume(e.target.value)} className="h-8 text-[12px] font-mono" /></div>
              <div><Label className="text-[10px] text-stone-500">Дата отгрузки</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-[12px]" /></div>
              <div><Label className="text-[10px] text-stone-500">№ СФ</Label><Input value={invoiceNum} onChange={(e) => setInvoiceNum(e.target.value)} className="h-8 text-[12px]" /></div>
            </div>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="w-full mt-2">{saving ? "Сохранение..." : "Создать"}</Button>
      </DialogContent>
    </Dialog>
  );
}

// --- Main page ---
export default function RegistryPage() {
  const [activeTab, setActiveTab] = useState<"kg" | "kz">("kg");
  const { data: records, loading, reload } = useRegistry(activeTab === "kg" ? "KG" : "KZ");
  const currency = activeTab === "kg" ? "$" : "₸";
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = groupRecords(records);
  const toggle = (key: string) => setExpanded((prev) => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Реестр отгрузки</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Добавить</Button>
          <Button size="sm" variant="outline" onClick={() => window.location.href = "/import"}><Upload className="mr-1.5 h-3.5 w-3.5" />Импорт</Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-stone-200">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${activeTab === tab.key ? "border-amber-500 text-amber-700" : "border-transparent text-stone-500 hover:text-stone-700"}`}>
            {tab.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-stone-400">{records.length} записей | {groups.length} сделок</span>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Загрузка...</p>
      : groups.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
          <Truck className="h-8 w-8 text-stone-300 mx-auto mb-2" />
          <p className="text-sm text-stone-500">Реестр {activeTab.toUpperCase()} пуст</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = expanded.has(g.key);
            return (
              <div key={g.key} className="rounded-lg border border-stone-200 bg-white overflow-hidden">
                {/* Deal header */}
                <button onClick={() => toggle(g.key)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-stone-50 transition-colors text-left">
                  <ChevronDown className={`h-3.5 w-3.5 text-stone-400 transition-transform shrink-0 ${isOpen ? "" : "-rotate-90"}`} />
                  <span className="font-mono text-[12px] font-bold text-amber-700">{g.dealCode}</span>
                  <span className="text-[11px] text-stone-500">{g.month}</span>
                  <span className="inline-flex items-center gap-1 text-[11px]">
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: g.fuelColor }} />{g.fuelType}
                  </span>
                  <span className="text-[10px] text-stone-400">{g.factory}</span>
                  <span className="text-[10px] text-stone-500 truncate max-w-[80px]">{g.supplier}</span>
                  <span className="text-stone-300 text-[10px]">→</span>
                  <span className="text-[10px] text-stone-500 truncate max-w-[80px]">{g.buyer}</span>
                  <span className="text-[10px] text-stone-400">{g.forwarder}</span>
                  <span className="ml-auto flex items-center gap-3 shrink-0">
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{g.records.length} шт</span>
                    <span className="font-mono text-[11px] tabular-nums font-medium">{formatNum(g.totalVolume)} т</span>
                    <span className="font-mono text-[11px] tabular-nums text-stone-500">{formatNum(g.totalAmount)} {currency}</span>
                  </span>
                </button>

                {/* Expanded: Excel-style table */}
                {isOpen && (
                  <div className="border-t border-stone-200">
                    <div className="overflow-x-auto">
                      <table className="w-max border-collapse" style={{ fontSize: "11px" }}>
                        <thead>
                          <tr className="bg-stone-100/70 border-b text-stone-500">
                            <th className="border-r px-2 py-1 text-left font-medium min-w-[60px]">№ сделки</th>
                            <th className="border-r px-2 py-1 text-left font-medium min-w-[60px]">мес. доп</th>
                            <th className="border-r px-2 py-1 text-left font-medium min-w-[70px]">мес. отгр.</th>
                            <th className="border-r px-2 py-1 text-left font-medium min-w-[60px]">ГСМ</th>
                            <th className="border-r px-2 py-1 text-left font-medium min-w-[50px]">завод</th>
                            <th className="border-r px-2 py-1 text-left font-medium min-w-[100px]">поставщик</th>
                            <th className="border-r px-2 py-1 text-right font-medium min-w-[55px]">Налив</th>
                            <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">№ вагона</th>
                            <th className="border-r px-2 py-1 text-right font-medium min-w-[55px]">Тонн</th>
                            <th className="border-r px-2 py-1 text-right font-medium min-w-[55px]">Налив т.</th>
                            <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">дата отгр.</th>
                            <th className="border-r px-2 py-1 text-right font-medium min-w-[55px]">тариф</th>
                            <th className="border-r px-2 py-1 text-right font-medium min-w-[45px]">округл</th>
                            <th className="border-r px-2 py-1 text-right font-medium min-w-[65px]">сумма {currency}</th>
                            <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">ст. назн.</th>
                            <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">ст. отпр.</th>
                            <th className="px-2 py-1 text-left font-medium min-w-[100px]">№ СФ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.records.map((rec) => (
                            <tr key={rec.id} className="border-b border-stone-100 hover:bg-amber-50/20">
                              <td className="border-r px-2 py-0.5 font-mono text-amber-700 text-[10px]">{rec.deal?.deal_code ?? ""}</td>
                              <td className="border-r px-1 py-0.5"><EditCell value={rec.additional_month} recId={rec.id} field="additional_month" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><EditCell value={rec.shipment_month} recId={rec.id} field="shipment_month" onSaved={reload} /></td>
                              <td className="border-r px-2 py-0.5 text-[10px]">{rec.fuel_type?.name ?? ""}</td>
                              <td className="border-r px-2 py-0.5 text-[10px] text-stone-500">{rec.factory?.name ?? ""}</td>
                              <td className="border-r px-2 py-0.5 text-[10px] text-stone-500 truncate max-w-[100px]">{(rec as Record<string, unknown>).supplier_name as string ?? ""}</td>
                              <td className="border-r px-1 py-0.5"><EditNumCell value={rec.loading_volume} recId={rec.id} field="loading_volume" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><EditCell value={rec.wagon_number} recId={rec.id} field="wagon_number" onSaved={reload} className="font-mono" /></td>
                              <td className="border-r px-1 py-0.5"><EditNumCell value={rec.shipment_volume} recId={rec.id} field="shipment_volume" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><EditNumCell value={rec.loading_volume} recId={rec.id} field="loading_volume" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><EditDateCell value={rec.date} recId={rec.id} field="date" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><EditNumCell value={rec.railway_tariff} recId={rec.id} field="railway_tariff" onSaved={reload} /></td>
                              <td className="border-r px-2 py-0.5 text-right font-mono tabular-nums text-stone-400">{formatNum(roundTonnage(rec.shipment_volume))}</td>
                              <td className="border-r px-2 py-0.5 text-right font-mono tabular-nums font-medium">{formatNum(calcAmount(rec.shipment_volume, rec.railway_tariff))}</td>
                              <td className="border-r px-2 py-0.5 text-[10px] text-stone-500">{rec.destination_station?.name ?? ""}</td>
                              <td className="border-r px-2 py-0.5 text-[10px] text-stone-500">{rec.departure_station?.name ?? ""}</td>
                              <td className="px-1 py-0.5"><EditCell value={rec.invoice_number} recId={rec.id} field="invoice_number" onSaved={reload} className="font-mono" /></td>
                            </tr>
                          ))}
                          <InlineAddRow context={g.records[0]} registryType={activeTab === "kg" ? "KG" : "KZ"} onCreated={reload} />
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AddEntryDialog open={showAdd} onClose={() => setShowAdd(false)} registryType={activeTab === "kg" ? "KG" : "KZ"} onCreated={reload} />
    </div>
  );
}

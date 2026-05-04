"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Plus, Upload, Truck, ChevronDown, Trash2, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRegistry, createRegistryEntry, updateRegistryEntry, bulkInsertRegistry, type ShipmentRecord, type RegistryUpdate } from "@/lib/hooks/use-registry";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { BulkAddDialog, type BulkAddGroupContext } from "@/components/registry/bulk-add-dialog";
import { parseBulkWagons, type ParsedWagon } from "@/lib/parsers/bulk-wagons";

const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
const CURRENCIES: { value: string; label: string }[] = [
  { value: "USD", label: "USD $" },
  { value: "KZT", label: "KZT ₸" },
  { value: "KGS", label: "KGS сом" },
  { value: "RUB", label: "RUB ₽" },
];
const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", KZT: "₸", KGS: "сом", RUB: "₽" };
const tabs = [{ key: "kg" as const, label: "KG (Экспорт)" }, { key: "kz" as const, label: "KZ (Внутренний)" }];

function fmtNum(v: number | null | undefined, d = 3) { return v == null ? "" : v.toLocaleString("ru-RU", { maximumFractionDigits: d }); }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString("ru-RU") : ""; }
function ceil(v: number | null) { return v == null ? null : Math.ceil(v); }
function calcAmt(v: number | null, t: number | null) { const r = ceil(v); return r == null || t == null ? null : r * t; }
function currencyFor(r: ShipmentRecord, tab: "kg" | "kz"): string {
  const cur = r.currency ?? r.deal?.currency ?? (tab === "kg" ? "USD" : "KZT");
  return CURRENCY_SYMBOLS[cur] ?? cur;
}

function MonthSelect({ value, onChange, className = "" }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`h-7 rounded border border-stone-200 bg-white px-1 text-[11px] focus:border-amber-400 focus:outline-none cursor-pointer ${className}`}>
      <option value="">—</option>
      {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}

// --- Inline editable cells ---
function EC({ value, recId, field, onSaved, cls = "" }: { value: string | null | undefined; recId: string; field: string; onSaved: () => void; cls?: string }) {
  const [ed, setEd] = useState(false); const [lv, setLv] = useState(""); const pv = useRef<string | null | undefined>(undefined);
  const sh = pv.current !== undefined ? pv.current : value; if (pv.current !== undefined && value === pv.current) pv.current = undefined;
  if (!ed) return <button onClick={() => { setLv(sh ?? ""); setEd(true); }} className={`w-full text-left text-[11px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px] truncate ${cls}`}>{sh ?? ""}</button>;
  return <input autoFocus value={lv} onChange={(e) => setLv(e.target.value)} onBlur={() => { setEd(false); const nv = lv.trim() || null; if (nv !== (value ?? null)) { pv.current = nv; updateRegistryEntry(recId, { [field]: nv }).then(onSaved).catch(() => { pv.current = undefined; }); } }} onKeyDown={(e) => { if (e.key==="Enter") (e.target as HTMLInputElement).blur(); if (e.key==="Escape") setEd(false); }} className="w-full border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none" />;
}
function EN({ value, recId, field, onSaved }: { value: number | null | undefined; recId: string; field: string; onSaved: () => void }) {
  const [ed, setEd] = useState(false); const [lv, setLv] = useState(""); const pv = useRef<number | null | undefined>(undefined);
  const sh = pv.current !== undefined ? pv.current : value; if (pv.current !== undefined && value === pv.current) pv.current = undefined;
  if (!ed) return <button onClick={() => { setLv(sh?.toString() ?? ""); setEd(true); }} className="w-full text-right font-mono text-[11px] tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px] min-w-[40px]">{fmtNum(sh)}</button>;
  return <input autoFocus type="number" step="0.01" value={lv} onChange={(e) => setLv(e.target.value)} onBlur={() => { setEd(false); const n = lv.trim()==="" ? null : parseFloat(lv); if (n !== value) { pv.current = n; updateRegistryEntry(recId, { [field]: n }).then(onSaved).catch(() => { pv.current = undefined; }); } }} onKeyDown={(e) => { if (e.key==="Enter") (e.target as HTMLInputElement).blur(); if (e.key==="Escape") setEd(false); }} className="w-16 border border-amber-300 rounded px-1 py-0 text-[11px] font-mono text-right bg-amber-50/50 focus:outline-none" />;
}
function ED({ value, recId, field, onSaved }: { value: string | null | undefined; recId: string; field: string; onSaved: () => void }) {
  const [ed, setEd] = useState(false); const [lv, setLv] = useState(""); const pv = useRef<string | null | undefined>(undefined);
  const sh = pv.current !== undefined ? pv.current : value; if (pv.current !== undefined && value === pv.current) pv.current = undefined;
  if (!ed) return <button onClick={() => { setLv(sh ?? ""); setEd(true); }} className="w-full text-left text-[11px] hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px]">{sh ? fmtDate(sh) : ""}</button>;
  return <input autoFocus type="date" value={lv} onChange={(e) => setLv(e.target.value)} onBlur={() => { setEd(false); const nv = lv || null; if (nv !== (value ?? null)) { pv.current = nv; updateRegistryEntry(recId, { [field]: nv }).then(onSaved).catch(() => { pv.current = undefined; }); } }} onKeyDown={(e) => { if (e.key==="Enter") (e.target as HTMLInputElement).blur(); if (e.key==="Escape") setEd(false); }} className="w-28 border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none" />;
}
// Editable month cell (dropdown)
function EM({ value, recId, field, onSaved }: { value: string | null | undefined; recId: string; field: string; onSaved: () => void }) {
  return (
    <select value={value ?? ""} onChange={(e) => { const nv = e.target.value || null; updateRegistryEntry(recId, { [field]: nv }).then(onSaved); }}
      className="w-full h-6 text-[11px] rounded border-0 bg-transparent hover:bg-amber-50 px-0.5 cursor-pointer focus:outline-none focus:bg-amber-50">
      <option value="">—</option>
      {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}
// Editable amount cell with override semantics. Writes both
// shipped_tonnage_amount and shipped_tonnage_amount_override so the value
// survives subsequent row edits. Clearing reverts to auto-compute.
function EAmount({ value, override, recId, onSaved, suffix = "" }: {
  value: number | null | undefined;
  override: boolean | null | undefined;
  recId: string;
  onSaved: () => void;
  suffix?: string;
}) {
  const [ed, setEd] = useState(false);
  const [lv, setLv] = useState("");
  if (!ed) return (
    <button
      onClick={() => { setLv(value == null ? "" : String(value)); setEd(true); }}
      title={override ? "Сумма переопределена вручную. Очистите поле, чтобы вернуть авто-расчёт." : "Авто-расчёт: ⌈тонн⌉ × тариф. Введите значение, чтобы переопределить."}
      className={`w-full text-right font-mono tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px] min-w-[60px] ${override ? "italic text-amber-700" : "font-medium"}`}
    >
      {fmtNum(value, 2)} {suffix}
    </button>
  );
  return (
    <input
      autoFocus
      type="number"
      step="0.01"
      value={lv}
      onChange={(e) => setLv(e.target.value)}
      onBlur={() => {
        setEd(false);
        const raw = lv.trim();
        if (raw === "") {
          // Clear → revert to auto-compute on next trigger pass.
          if (override) {
            updateRegistryEntry(recId, {
              shipped_tonnage_amount: null,
              shipped_tonnage_amount_override: false,
            } as RegistryUpdate).then(onSaved).catch(() => {});
          }
          return;
        }
        const n = parseFloat(raw.replace(",", "."));
        if (!Number.isFinite(n)) return;
        if (n === value && override) return;
        updateRegistryEntry(recId, {
          shipped_tonnage_amount: n,
          shipped_tonnage_amount_override: true,
        } as RegistryUpdate).then(onSaved).catch(() => {});
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }}
      className="w-20 border border-amber-300 rounded px-1 py-0 text-[11px] font-mono text-right bg-amber-50/50 focus:outline-none"
    />
  );
}

// Editable reference-select cell: shows label text by default, turns into <select> on click.
function ES({ value, displayLabel, recId, field, options, onSaved, className = "" }: {
  value: string | null | undefined; displayLabel: string; recId: string; field: string;
  options: { value: string; label: string }[]; onSaved: () => void; className?: string;
}) {
  const [ed, setEd] = useState(false);
  if (!ed) return (
    <button
      onClick={() => setEd(true)}
      className={`w-full text-left text-[10px] hover:bg-amber-50 rounded px-1 py-0.5 cursor-pointer min-h-[20px] truncate ${className}`}
    >
      {displayLabel || "—"}
    </button>
  );
  return (
    <select
      autoFocus
      defaultValue={value ?? ""}
      onBlur={() => setEd(false)}
      onChange={(e) => {
        const nv = e.target.value || null;
        setEd(false);
        updateRegistryEntry(recId, { [field]: nv }).then(onSaved).catch(() => {});
      }}
      className="w-full h-6 text-[10px] rounded border border-amber-300 bg-amber-50/50 px-0.5 cursor-pointer focus:outline-none"
    >
      <option value="">—</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// --- Group by deal ---
type RGroup = {
  key: string;
  dealId: string | null;
  dealCode: string;
  dealYear: number | null;
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
  totalVol: number;
  totalAmt: number;
  // Raw IDs kept for bulk-add pre-fill
  ids: {
    shipmentMonth: string | null;
    fuelTypeId: string | null;
    factoryId: string | null;
    supplierId: string | null;
    buyerId: string | null;
    forwarderId: string | null;
    companyGroupId: string | null;
    destinationStationId: string | null;
    departureStationId: string | null;
    currency: string | null;
  };
};

function groupRecs(records: ShipmentRecord[]): RGroup[] {
  const m = new Map<string, RGroup>();
  for (const r of records) {
    const k = r.deal_id ?? `o-${r.id}`;
    if (!m.has(k)) m.set(k, {
      key: k, dealId: r.deal_id, dealCode: r.deal?.deal_code ?? "—",
      dealYear: r.deal?.year ?? null,
      month: r.month ?? "",
      fuelType: r.fuel_type?.name ?? "", fuelColor: r.fuel_type?.color ?? "#6B7280",
      factory: r.factory?.name ?? "",
      supplier: r.supplier?.short_name ?? r.supplier?.full_name ?? "",
      buyer: r.buyer?.short_name ?? r.buyer?.full_name ?? "",
      forwarder: r.forwarder?.name ?? "",
      companyGroup: r.company_group?.name ?? "",
      destStation: r.destination_station?.name ?? "",
      depStation: r.departure_station?.name ?? "",
      tariff: r.railway_tariff,
      records: [], totalVol: 0, totalAmt: 0,
      ids: {
        shipmentMonth: r.shipment_month,
        fuelTypeId: r.fuel_type_id,
        factoryId: r.factory_id,
        supplierId: r.supplier_id,
        buyerId: r.buyer_id,
        forwarderId: r.forwarder_id,
        companyGroupId: r.company_group_id,
        destinationStationId: r.destination_station_id,
        departureStationId: r.departure_station_id,
        currency: r.currency ?? r.deal?.currency ?? null,
      },
    });
    const g = m.get(k)!; g.records.push(r); g.totalVol += r.shipment_volume ?? 0;
    // Prefer the stored amount (trigger-computed OR user-overridden) over a
    // client recompute so manual overrides flow into rollups. Fall back to
    // the computation only when nothing is stored yet (rare).
    g.totalAmt += r.shipped_tonnage_amount ?? calcAmt(r.shipment_volume, r.railway_tariff) ?? 0;
  }
  return Array.from(m.values());
}

// --- Inline add: full pre-filled row below table ---
function InlineAdd({ dealId, group, regType, onDone, onCancel }: {
  dealId: string | null; group: RGroup; regType: "KG" | "KZ"; onDone: () => void; onCancel: () => void;
}) {
  const sb = useRef(createClient());
  const [deal, setDeal] = useState<DRef | null>(null);
  const [w, setW] = useState(""); const [v, setV] = useState(""); const [lv, setLv] = useState("");
  const [dt, setDt] = useState(""); const [sm, setSm] = useState(""); const [sf, setSf] = useState("");
  const [cm, setCm] = useState("");
  const [tariffVal, setTariffVal] = useState<number | null>(group.tariff);
  const [curOverride, setCurOverride] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Fetch deal data to get all fields
  useEffect(() => {
    if (!dealId) return;
    sb.current.from("deals")
      .select("id, deal_code, year, month, factory_id, fuel_type_id, supplier_id, buyer_id, forwarder_id, buyer_destination_station_id, supplier_departure_station_id, logistics_company_group_id, supplier:counterparties!supplier_id(short_name, full_name), buyer:counterparties!buyer_id(short_name, full_name), factory:factories(name), fuel_type:fuel_types(name, color), forwarder:forwarders(name)")
      .eq("id", dealId).single()
      .then(({ data }) => { if (data) setDeal(data as unknown as DRef); });
  }, [dealId]);

  // Auto-lookup tariff. The tariffs table is keyed by (dep, dest, fuel,
  // forwarder, month, year) — every dimension is required, otherwise
  // duplicate rows for different years cause the lookup to silently fail.
  useEffect(() => {
    if (!deal || tariffVal) return;
    const firstRec = group.records[0];
    const depId = deal.supplier_departure_station_id || firstRec?.departure_station_id;
    const destId = deal.buyer_destination_station_id || firstRec?.destination_station_id;
    const ftId = deal.fuel_type_id;
    const fwId = deal.forwarder_id;
    const month = sm || firstRec?.shipment_month || deal.month;
    const year = deal.year;
    if (!depId || !destId || !ftId || !fwId || !month || !year) return;
    sb.current.from("tariffs").select("planned_tariff")
      .eq("departure_station_id", depId).eq("destination_station_id", destId)
      .eq("fuel_type_id", ftId).eq("forwarder_id", fwId)
      .eq("month", month).eq("year", year)
      .limit(1).maybeSingle()
      .then(({ data }) => { if (data?.planned_tariff) setTariffVal(data.planned_tariff); });
  }, [deal, sm, group.records, tariffVal]);

  const tariff = tariffVal;
  const firstRec = group.records[0];

  async function add() {
    if (!w || !v) return;
    setSaving(true);
    await createRegistryEntry({
      registry_type: regType, deal_id: dealId,
      month: deal?.month || group.month || null,
      shipment_month: sm || firstRec?.shipment_month || null,
      fuel_type_id: deal?.fuel_type_id || firstRec?.fuel_type_id || null,
      factory_id: deal?.factory_id || firstRec?.factory_id || null,
      supplier_id: deal?.supplier_id || firstRec?.supplier_id || null,
      buyer_id: deal?.buyer_id || firstRec?.buyer_id || null,
      forwarder_id: deal?.forwarder_id || firstRec?.forwarder_id || null,
      destination_station_id: deal?.buyer_destination_station_id || firstRec?.destination_station_id || null,
      departure_station_id: deal?.supplier_departure_station_id || firstRec?.departure_station_id || null,
      railway_tariff: tariff, company_group_id: deal?.logistics_company_group_id || firstRec?.company_group_id || null,
      wagon_number: w, shipment_volume: parseFloat(v),
      loading_volume: lv ? parseFloat(lv) : null, date: dt || null, invoice_number: sf || null,
      currency: curOverride || null, comment: cm || null,
    });
    setSaving(false); setW(""); setV(""); setLv(""); setDt(""); setSf(""); setSm(""); setCurOverride(""); setCm(""); onDone();
  }

  // Show deal info in the row (from fetched deal or group)
  const di = deal as Record<string, unknown> | null;
  const suppName = (di?.supplier as Record<string, string>)?.short_name ?? (di?.supplier as Record<string, string>)?.full_name ?? group.supplier;
  const buyerName = (di?.buyer as Record<string, string>)?.short_name ?? (di?.buyer as Record<string, string>)?.full_name ?? group.buyer;
  const fuelName = (di?.fuel_type as Record<string, string>)?.name ?? group.fuelType;
  const facName = (di?.factory as Record<string, string>)?.name ?? group.factory;
  const fwName = (di?.forwarder as Record<string, string>)?.name ?? group.forwarder;

  return (
    <tr className="bg-green-50/50 border-t-2 border-green-300">
      <td className="border-r px-2 py-1 font-mono text-amber-700 text-[10px]">{group.dealCode}</td>
      <td className="border-r px-1 py-1"></td>
      <td className="border-r px-1 py-1"><MonthSelect value={sm} onChange={setSm} className="w-full" /></td>
      <td className="border-r px-2 py-1 text-[10px] text-stone-600">{fuelName}</td>
      <td className="border-r px-2 py-1 text-[10px] text-stone-500">{facName}</td>
      <td className="border-r px-2 py-1 text-[10px] text-stone-500">{suppName}</td>
      <td className="border-r px-1 py-1"><input type="number" step="0.001" value={lv} onChange={(e) => setLv(e.target.value)} placeholder="налив" className="w-full h-6 text-[10px] font-mono border border-green-300 rounded px-1 text-right bg-green-50" /></td>
      <td className="border-r px-2 py-1 text-[10px] text-stone-500">{group.companyGroup}</td>
      <td className="border-r px-2 py-1 text-[10px] text-stone-500">{buyerName}</td>
      <td className="border-r px-2 py-1 text-[10px] text-stone-500">{fwName}</td>
      <td className="border-r px-1 py-1"><input value={w} onChange={(e) => setW(e.target.value)} placeholder="№ вагона *" className="w-full h-6 text-[10px] font-mono border border-green-300 rounded px-1 bg-green-50" /></td>
      <td className="border-r px-1 py-1"><input type="number" step="0.001" value={v} onChange={(e) => setV(e.target.value)} placeholder="тонн *" className="w-full h-6 text-[10px] font-mono border border-green-300 rounded px-1 text-right bg-green-50" /></td>
      <td className="border-r px-1 py-1"><input type="date" value={dt} onChange={(e) => setDt(e.target.value)} className="w-full h-6 text-[10px] border border-green-300 rounded px-1 bg-green-50" /></td>
      <td className="border-r px-1 py-1">
        <input
          type="number" step="0.01"
          value={tariffVal == null ? "" : String(tariffVal)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") { setTariffVal(null); return; }
            const n = parseFloat(raw.replace(",", "."));
            setTariffVal(Number.isFinite(n) ? n : null);
          }}
          placeholder="тариф"
          className="w-full h-6 text-[10px] font-mono border border-green-300 rounded px-1 text-right bg-green-50"
        />
      </td>
      <td className="border-r px-2 py-1 text-right font-mono text-[10px] text-stone-400">{v ? fmtNum(ceil(parseFloat(v))) : ""}</td>
      <td className="border-r px-2 py-1 text-right font-mono text-[10px] text-stone-500">{v && tariff != null ? fmtNum(calcAmt(parseFloat(v), tariff), 2) : ""}</td>
      <td className="border-r px-1 py-1">
        <select value={curOverride} onChange={(e) => setCurOverride(e.target.value)} className="w-full h-6 text-[10px] border border-green-300 rounded px-0.5 bg-green-50 cursor-pointer focus:outline-none">
          <option value="">сделка</option>
          {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </td>
      <td className="border-r px-2 py-1 text-[10px] text-stone-400">{group.destStation}</td>
      <td className="border-r px-2 py-1 text-[10px] text-stone-400">{group.depStation}</td>
      <td className="border-r px-1 py-1">
        <input value={sf} onChange={(e) => setSf(e.target.value)} placeholder="№ СФ" className="w-full h-6 text-[10px] font-mono border border-green-300 rounded px-1 bg-green-50" />
      </td>
      <td className="px-1 py-1">
        <div className="flex gap-1">
          <input value={cm} onChange={(e) => setCm(e.target.value)} placeholder="коммент." className="flex-1 h-6 text-[10px] border border-green-300 rounded px-1 bg-green-50" />
          <Button size="sm" onClick={add} disabled={saving || !w || !v} className="h-6 text-[9px] px-2 bg-green-600 hover:bg-green-700">{saving ? "..." : "✓"}</Button>
          <Button size="sm" variant="outline" onClick={onCancel} className="h-6 text-[9px] px-1.5">✕</Button>
        </div>
      </td>
    </tr>
  );
}

// --- Types ---
type Ref = { id: string; name: string };
type DRef2 = { id: string; short_name: string | null; full_name: string };
type StRef = { id: string; name: string; default_factory_id: string | null };
type DRef = { id: string; deal_code: string; year: number | null; month: string | null; factory_id: string | null; fuel_type_id: string | null; supplier_id: string | null; buyer_id: string | null; forwarder_id: string | null; buyer_destination_station_id: string | null; supplier_departure_station_id: string | null; logistics_company_group_id: string | null; supplier?: { short_name: string | null; full_name: string } | null; buyer?: { short_name: string | null; full_name: string } | null; factory?: { name: string } | null; fuel_type?: { name: string; color: string } | null; forwarder?: { name: string } | null };

function AddDialog({ open, onClose, regType, onDone }: { open: boolean; onClose: () => void; regType: "KG" | "KZ"; onDone: () => void }) {
  const sb = useRef(createClient());
  const [deals, setDeals] = useState<DRef[]>([]); const [stations, setStations] = useState<StRef[]>([]);
  const [factories, setFactories] = useState<Ref[]>([]); const [fuelTypes, setFuelTypes] = useState<Ref[]>([]);
  const [forwarders, setForwarders] = useState<Ref[]>([]); const [cgs, setCgs] = useState<Ref[]>([]);
  const [saving, setSaving] = useState(false);
  const [dealId, setDealId] = useState(""); const [month, setMonth] = useState(""); const [shipMonth, setShipMonth] = useState("");
  const [ftId, setFtId] = useState(""); const [facId, setFacId] = useState(""); const [fwId, setFwId] = useState("");
  const [destId, setDestId] = useState(""); const [depId, setDepId] = useState(""); const [cgId, setCgId] = useState("");
  const [tariff, setTariff] = useState("");
  const [pasted, setPasted] = useState("");
  // Which parsed-volume column to write — "ship" (отгрузка / shipment_volume) is the
  // factory-to-us side, "load" (налив / loading_volume) is the us-to-buyer side.
  const [volumeTarget, setVolumeTarget] = useState<"ship" | "load">("ship");

  useEffect(() => {
    if (!open) return;
    Promise.all([
      sb.current.from("deals").select("id, deal_code, year, month, factory_id, fuel_type_id, supplier_id, buyer_id, forwarder_id, buyer_destination_station_id, supplier_departure_station_id, logistics_company_group_id, supplier:counterparties!supplier_id(short_name, full_name), buyer:counterparties!buyer_id(short_name, full_name)").eq("deal_type", regType).eq("is_archived", false).or("is_draft.is.null,is_draft.eq.false").order("deal_code"),
      sb.current.from("stations").select("id, name, default_factory_id").eq("is_active", true).order("name"),
      sb.current.from("fuel_types").select("id, name").eq("is_active", true).order("sort_order"),
      sb.current.from("forwarders").select("id, name").eq("is_active", true).order("name"),
      sb.current.from("factories").select("id, name").eq("is_active", true).order("name"),
      sb.current.from("company_groups").select("id, name").eq("is_active", true).order("name"),
    ]).then(([d, s, ft, fw, fac, cg]) => {
      setDeals((d.data ?? []) as unknown as DRef[]); setStations((s.data ?? []) as StRef[]);
      setFuelTypes((ft.data ?? []) as Ref[]); setForwarders((fw.data ?? []) as Ref[]);
      setFactories((fac.data ?? []) as Ref[]); setCgs((cg.data ?? []) as Ref[]);
    });
  }, [open, regType]);

  // Auto-fill from deal. Company group is intentionally NOT auto-filled:
  // a shipment chain can involve two different groups, so logistics always picks it manually.
  useEffect(() => {
    if (!dealId) return;
    const d = deals.find((x) => x.id === dealId);
    if (!d) return;
    if (d.month) setMonth(d.month);
    if (d.fuel_type_id) setFtId(d.fuel_type_id);
    if (d.factory_id) setFacId(d.factory_id);
    if (d.forwarder_id) setFwId(d.forwarder_id);
    if (d.buyer_destination_station_id) setDestId(d.buyer_destination_station_id);
    if (d.supplier_departure_station_id) setDepId(d.supplier_departure_station_id);
  }, [dealId, deals]);

  // Factory from station
  useEffect(() => {
    if (!depId) return;
    const st = stations.find((s) => s.id === depId);
    if (st?.default_factory_id && !facId) setFacId(st.default_factory_id);
  }, [depId, stations, facId]);

  // Tariffs are keyed by SHIPMENT month (rate changes by RR timetable month).
  // Месяц формирования (deal.month) and месяц отгрузки can diverge — e.g. a
  // май-formed deal can ship in февраль. Prefer shipMonth; fall back to month.
  const dealYear = deals.find((x) => x.id === dealId)?.year ?? null;
  useEffect(() => {
    const lookupMonth = shipMonth || month;
    if (!depId || !destId || !ftId || !lookupMonth || !fwId || !dealYear || tariff) return;
    sb.current.from("tariffs").select("planned_tariff")
      .eq("departure_station_id", depId).eq("destination_station_id", destId)
      .eq("fuel_type_id", ftId).eq("forwarder_id", fwId)
      .eq("month", lookupMonth).eq("year", dealYear)
      .limit(1).maybeSingle()
      .then(({ data }) => { if (data?.planned_tariff) setTariff(String(data.planned_tariff)); });
  }, [depId, destId, ftId, month, shipMonth, fwId, dealYear, tariff]);

  const parsed: ParsedWagon[] = useMemo(() => parseBulkWagons(pasted), [pasted]);
  const validCount = parsed.filter((p) => !p.error).length;
  const errorCount = parsed.filter((p) => p.error).length;

  function resetAll() {
    setDealId(""); setMonth(""); setShipMonth("");
    setFtId(""); setFacId(""); setFwId(""); setDestId(""); setDepId(""); setCgId(""); setTariff("");
    setPasted(""); setVolumeTarget("ship");
  }

  async function save() {
    const valid = parsed.filter((p) => !p.error);
    if (valid.length === 0) { toast.error("Нет валидных строк для добавления"); return; }
    if (errorCount > 0 && !confirm(`${errorCount} строк с ошибками будут пропущены. Добавить ${valid.length} валидных?`)) return;
    setSaving(true);
    const d = deals.find((x) => x.id === dealId);
    const tariffNum = tariff ? parseFloat(tariff) : null;
    const rows = valid.map((p) => ({
      registry_type: regType,
      deal_id: dealId || null,
      month: month || null,
      shipment_month: shipMonth || null,
      fuel_type_id: ftId || null,
      factory_id: facId || null,
      supplier_id: d?.supplier_id || null,
      buyer_id: d?.buyer_id || null,
      forwarder_id: fwId || null,
      destination_station_id: destId || null,
      departure_station_id: depId || null,
      company_group_id: cgId || null,
      railway_tariff: tariffNum,
      wagon_number: p.wagon,
      shipment_volume: volumeTarget === "ship" ? p.volume : null,
      loading_volume: volumeTarget === "load" ? p.volume : null,
      date: p.date || null,
      waybill_number: p.waybill || null,
    }));
    const result = await bulkInsertRegistry(rows);
    setSaving(false);
    if (result) { onDone(); onClose(); resetAll(); }
  }

  const Sel = ({ l, v, fn, opts }: { l: string; v: string; fn: (v: string) => void; opts: { value: string; label: string }[] }) => (
    <div><Label className="text-[10px] text-stone-500">{l}</Label>
      <select value={v} onChange={(e) => fn(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer"><option value="">—</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Новая запись в реестр {regType}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded border border-amber-200 bg-amber-50/30 p-3">
            <p className="text-[11px] font-medium text-amber-700 mb-2">Контекст сделки</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              <div><Label className="text-[10px] text-stone-500">Сделка</Label>
                <select value={dealId} onChange={(e) => { setDealId(e.target.value); setTariff(""); }} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">Выберите...</option>
                  {deals.map((d) => <option key={d.id} value={d.id}>{d.deal_code} — {d.supplier?.short_name ?? ""} → {d.buyer?.short_name ?? ""}</option>)}
                </select>
              </div>
              <div><Label className="text-[10px] text-stone-500">Месяц формир.</Label>
                <select value={month} onChange={(e) => setMonth(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">—</option>{MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div><Label className="text-[10px] text-stone-500">Месяц отгрузки</Label>
                <select value={shipMonth} onChange={(e) => setShipMonth(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">—</option>{MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <Sel l="ГСМ" v={ftId} fn={setFtId} opts={fuelTypes.map((f) => ({ value: f.id, label: f.name }))} />
              <Sel l="Завод" v={facId} fn={setFacId} opts={factories.map((f) => ({ value: f.id, label: f.name }))} />
              <Sel l="Экспедитор" v={fwId} fn={setFwId} opts={forwarders.map((f) => ({ value: f.id, label: f.name }))} />
              <Sel l="Группа комп." v={cgId} fn={setCgId} opts={cgs.map((c) => ({ value: c.id, label: c.name }))} />
              <Sel l="Ст. назначения" v={destId} fn={setDestId} opts={stations.map((s) => ({ value: s.id, label: s.name }))} />
              <Sel l="Ст. отправления" v={depId} fn={setDepId} opts={stations.map((s) => ({ value: s.id, label: s.name }))} />
              <div><Label className="text-[10px] text-stone-500">Ж/Д тариф</Label><Input type="number" step="0.01" value={tariff} onChange={(e) => setTariff(e.target.value)} className="h-8 text-[12px] font-mono" /></div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-[11px] text-stone-600 flex items-center gap-1">
                <ClipboardPaste className="h-3 w-3" /> Вагоны (один на строку; TAB или пробелы между колонками)
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-stone-500">Объём идёт в:</span>
                <div className="inline-flex rounded border border-stone-200 bg-white overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setVolumeTarget("ship")}
                    className={`px-2 py-0.5 text-[11px] transition-colors ${volumeTarget === "ship" ? "bg-amber-600 text-white" : "text-stone-600 hover:bg-stone-50"}`}
                  >
                    Отгрузка
                  </button>
                  <button
                    type="button"
                    onClick={() => setVolumeTarget("load")}
                    className={`px-2 py-0.5 text-[11px] transition-colors border-l border-stone-200 ${volumeTarget === "load" ? "bg-amber-600 text-white" : "text-stone-600 hover:bg-stone-50"}`}
                  >
                    Налив
                  </button>
                </div>
              </div>
            </div>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={"51742534\t54,719\t05.11.2025\tЭД0012345\n51667558\t54,719\t05.11.2025\n75040170\t54,719"}
              rows={6}
              className="w-full rounded-md border border-stone-200 bg-white p-2 text-[12px] font-mono focus:border-amber-400 focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-stone-400">
              Колонки: <code>№ вагона ⇥ объём ⇥ дата ⇥ № накладной</code>. Последние три — опциональны. Запятая и точка в числах поддерживаются.
            </p>
          </div>

          {parsed.length > 0 && (
            <div className="rounded border border-stone-200">
              <div className="flex items-center justify-between px-3 py-1.5 bg-stone-50 border-b border-stone-200">
                <p className="text-[11px] font-medium text-stone-600">Предпросмотр ({parsed.length} строк)</p>
                <div className="text-[10px]">
                  {validCount > 0 && <span className="mr-2 text-green-700">✓ валидных: {validCount}</span>}
                  {errorCount > 0 && <span className="text-red-700">✗ с ошибками: {errorCount}</span>}
                </div>
              </div>
              <div className="max-h-[250px] overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-stone-50 text-stone-500 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1 w-8">#</th>
                      <th className="text-left px-2 py-1">№ вагона</th>
                      <th className="text-right px-2 py-1">{volumeTarget === "ship" ? "Отгрузка" : "Налив"}</th>
                      <th className="text-left px-2 py-1">Дата (стр.)</th>
                      <th className="text-left px-2 py-1">№ накладной</th>
                      <th className="text-left px-2 py-1">Ошибка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((p, i) => (
                      <tr key={i} className={`border-t border-stone-100 ${p.error ? "bg-red-50/50" : ""}`}>
                        <td className="px-2 py-0.5 text-stone-400">{i + 1}</td>
                        <td className="px-2 py-0.5 font-mono">{p.wagon || <span className="text-red-500">(пусто)</span>}</td>
                        <td className="px-2 py-0.5 font-mono text-right">{p.volume != null ? p.volume.toLocaleString("ru-RU", { maximumFractionDigits: 3 }) : "—"}</td>
                        <td className="px-2 py-0.5 text-stone-500">{p.date ?? "—"}</td>
                        <td className="px-2 py-0.5 font-mono text-stone-500">{p.waybill ?? "—"}</td>
                        <td className="px-2 py-0.5 text-red-600 text-[10px]">{p.error ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1">Отмена</Button>
          <Button onClick={save} disabled={saving || validCount === 0} className="flex-1">
            {saving ? "Сохранение..." : `+ Добавить ${validCount} отгрузок${errorCount > 0 ? ` (${errorCount} с ошибками пропустим)` : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Main page ---
export default function RegistryPage() {
  const [tab, setTab] = useState<"kg" | "kz">("kg");
  const { data: records, loading, reload } = useRegistry(tab === "kg" ? "KG" : "KZ");
  const [showAdd, setShowAdd] = useState(false);
  const [bulkIn, setBulkIn] = useState<RGroup | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingIn, setAddingIn] = useState<string | null>(null); // which group is adding
  const groups = groupRecs(records);
  const toggle = (k: string) => setExpanded((p) => { const s = new Set(p); s.has(k) ? s.delete(k) : s.add(k); return s; });

  // Page-level reference data (loaded once, shared with inline ES cells)
  const [refs, setRefs] = useState<{
    factories: Ref[]; suppliers: DRef2[]; buyers: DRef2[]; companyGroups: Ref[];
    forwarders: Ref[]; fuelTypes: Ref[]; stations: Ref[];
  }>({ factories: [], suppliers: [], buyers: [], companyGroups: [], forwarders: [], fuelTypes: [], stations: [] });

  useEffect(() => {
    const sb = createClient();
    Promise.all([
      sb.from("factories").select("id, name").eq("is_active", true).order("name"),
      sb.from("counterparties").select("id, short_name, full_name").eq("type", "supplier").eq("is_active", true).order("full_name"),
      sb.from("counterparties").select("id, short_name, full_name").eq("type", "buyer").eq("is_active", true).order("full_name"),
      sb.from("company_groups").select("id, name").eq("is_active", true).order("name"),
      sb.from("forwarders").select("id, name").eq("is_active", true).order("name"),
      sb.from("fuel_types").select("id, name").eq("is_active", true).order("sort_order"),
      sb.from("stations").select("id, name").eq("is_active", true).order("name"),
    ]).then(([fac, sup, buy, cg, fw, ft, st]) => {
      setRefs({
        factories: (fac.data ?? []) as Ref[],
        suppliers: (sup.data ?? []) as DRef2[],
        buyers: (buy.data ?? []) as DRef2[],
        companyGroups: (cg.data ?? []) as Ref[],
        forwarders: (fw.data ?? []) as Ref[],
        fuelTypes: (ft.data ?? []) as Ref[],
        stations: (st.data ?? []) as Ref[],
      });
    });
  }, []);

  const factoryOpts = useMemo(() => refs.factories.map((f) => ({ value: f.id, label: f.name })), [refs.factories]);
  const supplierOpts = useMemo(() => refs.suppliers.map((c) => ({ value: c.id, label: c.short_name ?? c.full_name })), [refs.suppliers]);
  const buyerOpts = useMemo(() => refs.buyers.map((c) => ({ value: c.id, label: c.short_name ?? c.full_name })), [refs.buyers]);
  const cgOpts = useMemo(() => refs.companyGroups.map((c) => ({ value: c.id, label: c.name })), [refs.companyGroups]);
  const fwOpts = useMemo(() => refs.forwarders.map((c) => ({ value: c.id, label: c.name })), [refs.forwarders]);
  const ftOpts = useMemo(() => refs.fuelTypes.map((c) => ({ value: c.id, label: c.name })), [refs.fuelTypes]);
  const stOpts = useMemo(() => refs.stations.map((c) => ({ value: c.id, label: c.name })), [refs.stations]);

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
        {tabs.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${tab === t.key ? "border-amber-500 text-amber-700" : "border-transparent text-stone-500 hover:text-stone-700"}`}>{t.label}</button>)}
        <span className="ml-auto self-center text-[11px] text-stone-400">{records.length} записей | {groups.length} сделок</span>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Загрузка...</p>
      : groups.length === 0 ? <div className="rounded-md border border-stone-200 bg-white py-12 text-center"><Truck className="h-8 w-8 text-stone-300 mx-auto mb-2" /><p className="text-sm text-stone-500">Реестр {tab.toUpperCase()} пуст</p></div>
      : <div className="space-y-2">
          {groups.map((g) => {
            const open = expanded.has(g.key);
            return (
              <div key={g.key} className="rounded-lg border border-stone-200 bg-white overflow-hidden">
                <button onClick={() => toggle(g.key)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-stone-50 transition-colors text-left">
                  <ChevronDown className={`h-3.5 w-3.5 text-stone-400 transition-transform shrink-0 ${open ? "" : "-rotate-90"}`} />
                  <span className="font-mono text-[12px] font-bold text-amber-700">{g.dealCode}</span>
                  <span className="text-[11px] text-stone-500">{g.month}</span>
                  <span className="inline-flex items-center gap-1 text-[11px]"><span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: g.fuelColor }} />{g.fuelType}</span>
                  <span className="text-[10px] text-stone-400">{g.factory}</span>
                  <span className="text-[10px] text-stone-500 truncate max-w-[80px]">{g.supplier}</span>
                  <span className="text-stone-300 text-[10px]">→</span>
                  <span className="text-[10px] text-stone-500 truncate max-w-[80px]">{g.buyer}</span>
                  <span className="text-[10px] text-stone-400">{g.forwarder}</span>
                  <span className="ml-auto flex items-center gap-3 shrink-0">
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{g.records.length} шт</span>
                    <span className="font-mono text-[11px] tabular-nums font-medium">{fmtNum(g.totalVol)} т</span>
                    {(() => {
                      const cs = new Set(g.records.map((r) => r.currency ?? r.deal?.currency ?? (tab === "kg" ? "USD" : "KZT")));
                      const gcur = cs.size === 1 ? CURRENCY_SYMBOLS[[...cs][0]] ?? [...cs][0] : "смеш.";
                      return <span className="font-mono text-[11px] tabular-nums text-stone-500">{fmtNum(g.totalAmt)} {gcur}</span>;
                    })()}
                  </span>
                </button>
                {open && (
                  <div className="border-t border-stone-200">
                    <div className="overflow-x-auto">
                      <table className="w-max border-collapse" style={{ fontSize: "11px" }}>
                        <thead><tr className="bg-stone-100/70 border-b text-stone-500">
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[60px]">№ сделки</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[70px]">мес. доп</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[75px]">мес. отгр.</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">ГСМ</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">завод</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[110px]">поставщик</th>
                          <th className="border-r px-2 py-1 text-right font-medium min-w-[55px]">Налив</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[100px]">группа комп.</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[110px]">покупатель</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[100px]">экспедитор</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">№ вагона</th>
                          <th className="border-r px-2 py-1 text-right font-medium min-w-[55px]">Тонн</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">дата отгр.</th>
                          <th className="border-r px-2 py-1 text-right font-medium min-w-[55px]">тариф</th>
                          <th className="border-r px-2 py-1 text-right font-medium min-w-[45px]">округл</th>
                          <th className="border-r px-2 py-1 text-right font-medium min-w-[65px]">сумма</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[70px]">валюта</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[90px]">ст. назн.</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[90px]">ст. отпр.</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[100px]">№ СФ</th>
                          <th className="px-2 py-1 text-left font-medium min-w-[130px]">коммент.</th>
                          <th className="px-1 py-1 w-[25px]"></th>
                        </tr></thead>
                        <tbody>
                          {g.records.map((r) => (
                            <tr key={r.id} className="border-b border-stone-100 hover:bg-amber-50/20">
                              <td className="border-r px-2 py-0.5 font-mono text-amber-700 text-[10px]">{r.deal?.deal_code ?? ""}</td>
                              <td className="border-r px-1 py-0.5"><EM value={r.additional_month} recId={r.id} field="additional_month" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><EM value={r.shipment_month} recId={r.id} field="shipment_month" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.fuel_type_id} displayLabel={r.fuel_type?.name ?? ""} recId={r.id} field="fuel_type_id" options={ftOpts} onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.factory_id} displayLabel={r.factory?.name ?? ""} recId={r.id} field="factory_id" options={factoryOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.supplier_id} displayLabel={r.supplier?.short_name ?? r.supplier?.full_name ?? ""} recId={r.id} field="supplier_id" options={supplierOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><EN value={r.loading_volume} recId={r.id} field="loading_volume" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.company_group_id} displayLabel={r.company_group?.name ?? ""} recId={r.id} field="company_group_id" options={cgOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.buyer_id} displayLabel={r.buyer?.short_name ?? r.buyer?.full_name ?? ""} recId={r.id} field="buyer_id" options={buyerOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.forwarder_id} displayLabel={r.forwarder?.name ?? ""} recId={r.id} field="forwarder_id" options={fwOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><EC value={r.wagon_number} recId={r.id} field="wagon_number" onSaved={reload} cls="font-mono" /></td>
                              <td className="border-r px-1 py-0.5"><EN value={r.shipment_volume} recId={r.id} field="shipment_volume" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><ED value={r.date} recId={r.id} field="date" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><EN value={r.railway_tariff} recId={r.id} field="railway_tariff" onSaved={reload} /></td>
                              <td className="border-r px-2 py-0.5 text-right font-mono tabular-nums text-stone-400">{fmtNum(ceil(r.shipment_volume))}</td>
                              <td className="border-r px-1 py-0.5">
                                <EAmount
                                  value={r.shipped_tonnage_amount}
                                  override={r.shipped_tonnage_amount_override}
                                  recId={r.id}
                                  onSaved={reload}
                                  suffix={currencyFor(r, tab)}
                                />
                              </td>
                              <td className="border-r px-1 py-0.5">
                                <ES
                                  value={r.currency}
                                  displayLabel={r.currency ?? `${r.deal?.currency ?? ""} (сделка)`}
                                  recId={r.id}
                                  field="currency"
                                  options={CURRENCIES}
                                  onSaved={reload}
                                />
                              </td>
                              <td className="border-r px-1 py-0.5"><ES value={r.destination_station_id} displayLabel={r.destination_station?.name ?? ""} recId={r.id} field="destination_station_id" options={stOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.departure_station_id} displayLabel={r.departure_station?.name ?? ""} recId={r.id} field="departure_station_id" options={stOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><EC value={r.invoice_number} recId={r.id} field="invoice_number" onSaved={reload} cls="font-mono" /></td>
                              <td className="px-1 py-0.5"><EC value={r.comment} recId={r.id} field="comment" onSaved={reload} /></td>
                              <td className="px-1 py-0.5">
                                <button onClick={async () => {
                                  if (!confirm("Удалить запись?")) return;
                                  const s = createClient();
                                  const { error } = await s.from("shipment_registry").delete().eq("id", r.id);
                                  if (error) toast.error(error.message); else reload();
                                }} className="rounded p-0.5 text-stone-300 hover:text-red-500 transition-colors"><Trash2 className="h-3 w-3" /></button>
                              </td>
                            </tr>
                          ))}
                          {addingIn === g.key && (
                            <InlineAdd dealId={g.dealId} group={g} regType={tab === "kg" ? "KG" : "KZ"} onDone={() => { reload(); setAddingIn(null); }} onCancel={() => setAddingIn(null)} />
                          )}
                        </tbody>
                      </table>
                    </div>
                    {/* Add row buttons below table */}
                    {addingIn !== g.key && (
                      <div className="border-t border-stone-100 px-3 py-1.5 flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setAddingIn(g.key)} className="h-6 text-[10px] text-stone-500">
                          <Plus className="h-3 w-3 mr-1" />Добавить отгрузку
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setBulkIn(g)} className="h-6 text-[10px] text-stone-500">
                          <ClipboardPaste className="h-3 w-3 mr-1" />Массово
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      }
      <AddDialog open={showAdd} onClose={() => setShowAdd(false)} regType={tab === "kg" ? "KG" : "KZ"} onDone={reload} />

      <BulkAddDialog
        open={bulkIn != null}
        onClose={() => setBulkIn(null)}
        regType={tab === "kg" ? "KG" : "KZ"}
        context={bulkIn ? {
          dealId: bulkIn.dealId,
          dealCode: bulkIn.dealCode,
          month: bulkIn.month || null,
          shipmentMonth: bulkIn.ids.shipmentMonth,
          fuelTypeId: bulkIn.ids.fuelTypeId,
          factoryId: bulkIn.ids.factoryId,
          supplierId: bulkIn.ids.supplierId,
          buyerId: bulkIn.ids.buyerId,
          forwarderId: bulkIn.ids.forwarderId,
          companyGroupId: bulkIn.ids.companyGroupId,
          destinationStationId: bulkIn.ids.destinationStationId,
          departureStationId: bulkIn.ids.departureStationId,
          railwayTariff: bulkIn.tariff,
          dealYear: bulkIn.dealYear,
          currency: bulkIn.ids.currency,
        } : null}
        onDone={reload}
      />
    </div>
  );
}

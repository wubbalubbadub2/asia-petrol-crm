"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClipboardPaste } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { bulkInsertRegistry } from "@/lib/hooks/use-registry";
import { parseBulkWagons, type ParsedWagon } from "@/lib/parsers/bulk-wagons";
import { toast } from "sonner";

const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
const CURRENCIES = [
  { value: "USD", label: "USD $" },
  { value: "KZT", label: "KZT ₸" },
  { value: "KGS", label: "KGS сом" },
  { value: "RUB", label: "RUB ₽" },
];

// Group context passed from the registry page — values pre-fill the "shared fields" section.
export type BulkAddGroupContext = {
  dealId: string | null;
  dealCode: string;
  month: string | null;
  shipmentMonth: string | null;
  fuelTypeId: string | null;
  factoryId: string | null;
  supplierId: string | null;
  buyerId: string | null;
  forwarderId: string | null;
  companyGroupId: string | null;
  destinationStationId: string | null;
  departureStationId: string | null;
  railwayTariff: number | null;
  currency: string | null; // deal currency
};

type Ref = { id: string; name: string };

export function BulkAddDialog({
  open,
  onClose,
  regType,
  context,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  regType: "KG" | "KZ";
  context: BulkAddGroupContext | null;
  onDone: () => void;
}) {
  // Shared-fields state (pre-filled from context on open)
  const [dealId, setDealId] = useState<string | null>(null);
  const [month, setMonth] = useState("");
  const [shipmentMonth, setShipmentMonth] = useState("");
  const [fuelTypeId, setFuelTypeId] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [forwarderId, setForwarderId] = useState("");
  const [companyGroupId, setCompanyGroupId] = useState("");
  const [destinationStationId, setDestinationStationId] = useState("");
  const [departureStationId, setDepartureStationId] = useState("");
  const [tariff, setTariff] = useState("");
  const [currency, setCurrency] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceNum, setInvoiceNum] = useState("");
  const [bulkComment, setBulkComment] = useState("");

  // Paste + preview
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  // Volume column target: "ship" (отгрузка → shipment_volume, Завод отписывает нам) vs
  // "load" (налив → loading_volume, мы отписываем). Logisticians pick which side
  // the pasted "Объём" column represents.
  const [volumeTarget, setVolumeTarget] = useState<"ship" | "load">("ship");

  // References
  const [factories, setFactories] = useState<Ref[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; short_name: string | null; full_name: string }[]>([]);
  const [buyers, setBuyers] = useState<{ id: string; short_name: string | null; full_name: string }[]>([]);
  const [companyGroups, setCompanyGroups] = useState<Ref[]>([]);
  const [forwarders, setForwarders] = useState<Ref[]>([]);
  const [fuelTypes, setFuelTypes] = useState<Ref[]>([]);
  const [stations, setStations] = useState<Ref[]>([]);

  useEffect(() => {
    if (!open) return;
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
      setFactories((fac.data ?? []) as Ref[]);
      setSuppliers((sup.data ?? []) as { id: string; short_name: string | null; full_name: string }[]);
      setBuyers((buy.data ?? []) as { id: string; short_name: string | null; full_name: string }[]);
      setCompanyGroups((cg.data ?? []) as Ref[]);
      setForwarders((fw.data ?? []) as Ref[]);
      setFuelTypes((ft.data ?? []) as Ref[]);
      setStations((st.data ?? []) as Ref[]);
    });
  }, [open]);

  // Pre-fill from context when dialog opens
  useEffect(() => {
    if (!open || !context) return;
    setDealId(context.dealId);
    setMonth(context.month ?? "");
    setShipmentMonth(context.shipmentMonth ?? "");
    setFuelTypeId(context.fuelTypeId ?? "");
    setFactoryId(context.factoryId ?? "");
    setSupplierId(context.supplierId ?? "");
    setBuyerId(context.buyerId ?? "");
    setForwarderId(context.forwarderId ?? "");
    setCompanyGroupId(context.companyGroupId ?? "");
    setDestinationStationId(context.destinationStationId ?? "");
    setDepartureStationId(context.departureStationId ?? "");
    setTariff(context.railwayTariff != null ? String(context.railwayTariff) : "");
    setCurrency(""); // empty = inherit from deal
    setPasted("");
    setInvoiceNum("");
    setBulkComment("");
    setVolumeTarget("ship");
  }, [open, context]);

  const parsed: ParsedWagon[] = useMemo(() => parseBulkWagons(pasted), [pasted]);
  const validCount = parsed.filter((p) => !p.error).length;
  const errorCount = parsed.filter((p) => p.error).length;

  async function save() {
    const validRows = parsed.filter((p) => !p.error);
    if (validRows.length === 0) { toast.error("Нет валидных строк для добавления"); return; }
    if (errorCount > 0 && !confirm(`${errorCount} строк с ошибками будут пропущены. Добавить ${validRows.length} валидных?`)) return;
    setSaving(true);

    const tariffNum = tariff ? parseFloat(tariff) : null;
    const rows = validRows.map((p) => ({
      registry_type: regType,
      deal_id: dealId,
      month: month || null,
      shipment_month: shipmentMonth || null,
      fuel_type_id: fuelTypeId || null,
      factory_id: factoryId || null,
      supplier_id: supplierId || null,
      buyer_id: buyerId || null,
      forwarder_id: forwarderId || null,
      company_group_id: companyGroupId || null,
      destination_station_id: destinationStationId || null,
      departure_station_id: departureStationId || null,
      railway_tariff: tariffNum,
      currency: currency || null,
      wagon_number: p.wagon,
      shipment_volume: volumeTarget === "ship" ? p.volume : null,
      loading_volume: volumeTarget === "load" ? p.volume : null,
      date: p.date ?? date ?? null,
      waybill_number: p.waybill || null,
      invoice_number: invoiceNum || null,
      comment: bulkComment || null,
    }));

    const result = await bulkInsertRegistry(rows);
    setSaving(false);
    if (result) {
      onDone();
      onClose();
    }
  }

  const supplierOpts = suppliers.map((c) => ({ value: c.id, label: c.short_name ?? c.full_name }));
  const buyerOpts = buyers.map((c) => ({ value: c.id, label: c.short_name ?? c.full_name }));

  const Sel = ({ l, v, fn, opts }: { l: string; v: string; fn: (v: string) => void; opts: { value: string; label: string }[] }) => (
    <div>
      <Label className="text-[10px] text-stone-500">{l}</Label>
      <select value={v} onChange={(e) => fn(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
        <option value="">—</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Массовое добавление отгрузок{context?.dealCode ? ` — ${context.dealCode}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Shared fields */}
          <div className="rounded border border-amber-200 bg-amber-50/30 p-3">
            <p className="text-[11px] font-medium text-amber-700 mb-2">Общие поля (применяются ко всем вагонам)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <Label className="text-[10px] text-stone-500">Месяц формир.</Label>
                <select value={month} onChange={(e) => setMonth(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">—</option>{MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Месяц отгрузки</Label>
                <select value={shipmentMonth} onChange={(e) => setShipmentMonth(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">—</option>{MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Дата отгрузки (по умолч.)</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-[12px]" />
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">Валюта</Label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">как в сделке{context?.currency ? ` (${context.currency})` : ""}</option>
                  {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <Sel l="ГСМ" v={fuelTypeId} fn={setFuelTypeId} opts={fuelTypes.map((f) => ({ value: f.id, label: f.name }))} />
              <Sel l="Завод" v={factoryId} fn={setFactoryId} opts={factories.map((f) => ({ value: f.id, label: f.name }))} />
              <Sel l="Поставщик" v={supplierId} fn={setSupplierId} opts={supplierOpts} />
              <Sel l="Покупатель" v={buyerId} fn={setBuyerId} opts={buyerOpts} />
              <Sel l="Экспедитор" v={forwarderId} fn={setForwarderId} opts={forwarders.map((f) => ({ value: f.id, label: f.name }))} />
              <Sel l="Группа комп." v={companyGroupId} fn={setCompanyGroupId} opts={companyGroups.map((c) => ({ value: c.id, label: c.name }))} />
              <Sel l="Ст. отправления" v={departureStationId} fn={setDepartureStationId} opts={stations.map((s) => ({ value: s.id, label: s.name }))} />
              <Sel l="Ст. назначения" v={destinationStationId} fn={setDestinationStationId} opts={stations.map((s) => ({ value: s.id, label: s.name }))} />
              <div>
                <Label className="text-[10px] text-stone-500">Ж/Д тариф</Label>
                <Input type="number" step="0.01" value={tariff} onChange={(e) => setTariff(e.target.value)} className="h-8 text-[12px] font-mono" />
              </div>
              <div>
                <Label className="text-[10px] text-stone-500">№ СФ (если общий)</Label>
                <Input value={invoiceNum} onChange={(e) => setInvoiceNum(e.target.value)} className="h-8 text-[12px]" placeholder="Необязательно" />
              </div>
              <div className="md:col-span-3">
                <Label className="text-[10px] text-stone-500">Коммент.</Label>
                <Input value={bulkComment} onChange={(e) => setBulkComment(e.target.value)} className="h-8 text-[12px]" />
              </div>
            </div>
          </div>

          {/* Paste textarea */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-[11px] text-stone-600 flex items-center gap-1">
                <ClipboardPaste className="h-3 w-3" /> Вагоны (один на строку; TAB между колонками)
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

          {/* Preview */}
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
          <Button
            onClick={save}
            disabled={saving || validCount === 0}
            className="flex-1"
          >
            {saving ? "Сохранение..." : `+ Добавить ${validCount} отгрузок${errorCount > 0 ? ` (${errorCount} с ошибками пропустим)` : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

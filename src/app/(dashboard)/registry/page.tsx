"use client";

import { useState, useEffect, useRef, useMemo, useDeferredValue } from "react";
import { useQueryState, parseAsJson, parseAsArrayOf, parseAsString } from "nuqs";
import { Plus, Upload, Truck, ChevronDown, Trash2, ClipboardPaste, X, Filter, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useRegistry, createRegistryEntry, updateRegistryEntry, bulkInsertRegistry, type ShipmentRecord, type RegistryUpdate } from "@/lib/hooks/use-registry";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { BulkAddDialog, type BulkAddGroupContext } from "@/components/registry/bulk-add-dialog";
import { parseBulkWagons, type ParsedWagon } from "@/lib/parsers/bulk-wagons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useGlobalRefs } from "@/lib/refs";
import { useDelayed } from "@/lib/hooks/use-delayed";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import Link from "next/link";
import { useTabs } from "@/lib/contexts/tabs-context";
import { DoubleScrollX } from "@/components/ui/double-scroll-x";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
const CURRENCIES: { value: string; label: string }[] = [
  { value: "USD", label: "USD $" },
  { value: "KZT", label: "KZT ₸" },
  { value: "KGS", label: "KGS сом" },
  { value: "RUB", label: "RUB ₽" },
];
const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", KZT: "₸", KGS: "сом", RUB: "₽" };
const tabs = [{ key: "kg" as const, label: "KG (Экспорт)" }, { key: "kz" as const, label: "KZ (Внутренний)" }];

// Translucent fuel-type tint for registry rows — mirrors the passport
// row coloring introduced 2026-06-23 (commit 7e989e9 / d4a6390).
// Single uniform alpha (0.12) per operator's «не нужно чередовать
// цвета, использовать только цвета ГСМ, но чтобы было читабельно».
function hexToRgba(hex: string | null | undefined, alpha: number): string {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) return "transparent";
  const h = hex.length === 4
    ? hex.slice(1).split("").map((c) => c + c).join("")
    : hex.slice(1);
  if (h.length !== 6) return "transparent";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return "transparent";
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function fmtNum(v: number | null | undefined, d = 3) { return v == null ? "" : v.toLocaleString("ru-RU", { maximumFractionDigits: d }); }
// Money canon 2026-07-07: always 2 decimals (сумма, тариф, etc).
function fmtMoney(v: number | null | undefined) { return v == null ? "" : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// Tonnage display: always 3 decimals, even for whole / 2-decimal values.
// Per client request — "после запятой 3 ноля должно быть".
function fmtVol(v: number | null | undefined) { return v == null ? "" : v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString("ru-RU") : ""; }
function ceil(v: number | null) { return v == null ? null : Math.ceil(v); }
function calcAmt(v: number | null, t: number | null) { const r = ceil(v); return r == null || t == null ? null : r * t; }
function currencyFor(r: ShipmentRecord, tab: "kg" | "kz"): string {
  // Клиент 2026-07-16: валюта логистики сделки должна отражаться в
  // реестре сразу. Приоритет: явная валюта строки → logistics_currency
  // сделки → legacy deals.currency → дефолт таба.
  const cur = r.currency ?? r.deal?.logistics_currency ?? r.deal?.currency ?? (tab === "kg" ? "USD" : "KZT");
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
  return <input autoFocus onFocus={(e) => e.currentTarget.select()} value={lv} onChange={(e) => setLv(e.target.value)} onBlur={() => { setEd(false); const nv = lv.trim() || null; if (nv !== (value ?? null)) { pv.current = nv; updateRegistryEntry(recId, { [field]: nv }).then(onSaved).catch(() => { pv.current = undefined; }); } }} onKeyDown={(e) => { if (e.key==="Enter") (e.target as HTMLInputElement).blur(); if (e.key==="Escape") setEd(false); }} className="w-full border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none" />;
}
function EN({ value, recId, field, onSaved, overrideField, overridden }: { value: number | null | undefined; recId: string; field: string; onSaved: () => void; overrideField?: string; overridden?: boolean | null }) {
  const [ed, setEd] = useState(false); const [lv, setLv] = useState(""); const pv = useRef<number | null | undefined>(undefined);
  const sh = pv.current !== undefined ? pv.current : value; if (pv.current !== undefined && value === pv.current) pv.current = undefined;
  // Volume fields render with the always-3-decimals formatter; everything
  // else (tariff/amount — money) с 2 знаками per client canon 2026-07-07.
  const isVol = field === "loading_volume" || field === "shipment_volume";
  if (!ed) return <button onClick={() => { setLv(sh?.toString() ?? ""); setEd(true); }} title={overrideField ? (overridden ? "Тариф введён вручную — справочник Тарифы эту строку не обновляет." : "Авто из справочника Тарифы. Введите значение, чтобы закрепить вручную.") : undefined} className={`w-full text-right font-mono text-[11px] tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px] min-w-[40px] ${overridden ? "italic text-amber-700" : ""}`}>{isVol ? fmtVol(sh) : fmtMoney(sh)}</button>;
  // Ручная правка помечает строку override-флагом (overrideField):
  // propagation из справочника тарифов её больше не трогает. Очистка —
  // тоже ручной ввод (клиент: «ручной ввод всегда приоритетнее»).
  return <input autoFocus onFocus={(e) => e.currentTarget.select()} type="number" step="0.001" value={lv} onChange={(e) => setLv(e.target.value)} onBlur={() => { setEd(false); const n = lv.trim()==="" ? null : parseFloat(lv); if (n !== value) { pv.current = n; const patch = overrideField ? { [field]: n, [overrideField]: true } : { [field]: n }; updateRegistryEntry(recId, patch as RegistryUpdate).then(onSaved).catch(() => { pv.current = undefined; }); } }} onKeyDown={(e) => { if (e.key==="Enter") (e.target as HTMLInputElement).blur(); if (e.key==="Escape") setEd(false); }} className="w-16 border border-amber-300 rounded px-1 py-0 text-[11px] font-mono text-right bg-amber-50/50 focus:outline-none" />;
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
// Editable «округл» cell. Auto = CEIL(rawVolume) when roundVolume,
// else rawVolume as-is. Manual override (rounded_volume_override) trumps
// both. The tiny ⌈⌉ toggle next to the value flips roundVolume per row
// without losing auto-tracking (unlike the manual override which freezes
// the number — client req 06.2026).
function ERound({ rawVolume, override, roundVolume, recId, onSaved }: {
  rawVolume: number | null | undefined;
  override: number | null | undefined;
  roundVolume: boolean | null | undefined;
  recId: string;
  onSaved: () => void;
}) {
  const [ed, setEd] = useState(false);
  const [lv, setLv] = useState("");
  const isRounded = roundVolume !== false; // default TRUE
  const auto = rawVolume == null ? null : (isRounded ? Math.ceil(rawVolume) : rawVolume);
  const display = override != null ? override : auto;
  const isOverridden = override != null;
  const toggle = () => {
    updateRegistryEntry(recId, { round_volume: !isRounded } as RegistryUpdate)
      .then(onSaved).catch(() => {});
  };
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        title={isRounded ? "Округлять до целого (вкл). Кликни — выключить." : "Без округления (выкл). Кликни — включить."}
        className={`text-[9px] leading-none font-mono px-1 py-0.5 rounded transition-colors ${
          isRounded
            ? "bg-stone-100 text-stone-500 hover:bg-stone-200"
            : "bg-amber-100 text-amber-700 hover:bg-amber-200"
        }`}
      >
        {isRounded ? "⌈⌉" : "≈"}
      </button>
      {ed ? (
        <input
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          type="number"
          step="0.01"
          value={lv}
          onChange={(e) => setLv(e.target.value)}
          onBlur={() => {
            setEd(false);
            const raw = lv.trim();
            if (raw === "") {
              if (isOverridden) {
                updateRegistryEntry(recId, { rounded_volume_override: null } as RegistryUpdate)
                  .then(onSaved).catch(() => {});
              }
              return;
            }
            const n = parseFloat(raw.replace(",", "."));
            if (!Number.isFinite(n)) return;
            if (n === override) return;
            updateRegistryEntry(recId, { rounded_volume_override: n } as RegistryUpdate)
              .then(onSaved).catch(() => {});
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }}
          className="w-14 border border-amber-300 rounded px-1 py-0 text-[11px] font-mono text-right bg-amber-50/50 focus:outline-none"
        />
      ) : (
        <button
          onClick={() => { setLv(display == null ? "" : String(display)); setEd(true); }}
          title={isOverridden ? "Округл переопределён вручную. Очистите поле, чтобы вернуть авто-расчёт." : (isRounded ? "Авто: ⌈тонн⌉. Введите значение, чтобы переопределить." : "Авто: тонн (без округления). Введите значение, чтобы переопределить.")}
          className={`flex-1 text-right font-mono tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px] ${isOverridden ? "italic text-amber-700" : "text-stone-400"}`}
        >
          {fmtVol(display)}
        </button>
      )}
    </div>
  );
}

// Editable amount cell. Пишет и shipped_tonnage_amount, и override,
// чтобы значение не пересчитывалось триггером на след. апдейте.
//
// Клиент 2026-07-09: UX как в Excel — правки в UI сразу, не ждут
// ответа с бэка. Реализовано через pv-паттерн: ref на локально
// «в полёте» значение; отдаём его в отрисовку до тех пор пока
// value из props не догонит. При провале запроса — откат.
//
// Ручной ввод = override=true и всегда переопределяет авто-расчёт.
// Очистка (пустой инпут) = override=false → триггер либо
// пересчитает, либо оставит NULL (если базы или тарифа нет).
function EAmount({ value, override, recId, onSaved, suffix = "" }: {
  value: number | null | undefined;
  override: boolean | null | undefined;
  recId: string;
  onSaved: () => void;
  suffix?: string;
}) {
  const [ed, setEd] = useState(false);
  const [lv, setLv] = useState("");
  const pv = useRef<number | null | undefined>(undefined);
  const pvOverride = useRef<boolean | undefined>(undefined);
  const [, force] = useState(0);

  const shown = pv.current !== undefined ? pv.current : value;
  const shownOverride = pvOverride.current !== undefined ? pvOverride.current : override;
  if (pv.current !== undefined && value === pv.current) pv.current = undefined;
  if (pvOverride.current !== undefined && override === pvOverride.current) pvOverride.current = undefined;

  function commit(nextAmount: number | null, nextOverride: boolean) {
    pv.current = nextAmount;
    pvOverride.current = nextOverride;
    force((n) => n + 1);
    updateRegistryEntry(recId, {
      shipped_tonnage_amount: nextAmount,
      shipped_tonnage_amount_override: nextOverride,
    } as RegistryUpdate).then(onSaved).catch(() => {
      pv.current = undefined;
      pvOverride.current = undefined;
      force((n) => n + 1);
    });
  }

  if (!ed) return (
    <button
      onClick={() => { setLv(shown == null ? "" : String(shown)); setEd(true); }}
      title={shownOverride ? "Сумма переопределена вручную. Очистите поле, чтобы вернуть авто-расчёт." : "Авто-расчёт: ⌈тонн⌉ × тариф. Введите значение, чтобы переопределить."}
      className={`w-full text-right font-mono tabular-nums hover:bg-amber-50 px-1 py-0.5 rounded cursor-text min-h-[20px] min-w-[60px] ${shownOverride ? "italic text-amber-700" : "font-medium"}`}
    >
      {fmtMoney(shown)} {suffix}
    </button>
  );
  return (
    <input
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      type="number"
      step="0.01"
      value={lv}
      onChange={(e) => setLv(e.target.value)}
      onBlur={() => {
        setEd(false);
        const raw = lv.trim();
        if (raw === "") {
          // Клиент 2026-07-09: юзер очистил → это ЯВНОЕ намерение
          // держать сумму пустой. commit(null, override=TRUE) — тогда
          // триггер уважает и не пересчитает обратно. Раньше слали
          // (null, false), и триггер тут же пересчитывал auto-сумму
          // если тариф+база валидны — user видел flicker.
          if (shown != null) commit(null, true);
          return;
        }
        const n = parseFloat(raw.replace(",", "."));
        if (!Number.isFinite(n)) return;
        commit(n, true);
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

// Label resolvers — names used to come from FK joins embedded into
// REG_SELECT (8 sub-selects per row). They've been dropped; the
// rendering layer now resolves names by id from the warmed global-refs
// cache. The render site builds these maps once via useMemo and passes
// them in.
type GroupLabelMaps = {
  fuelType: Map<string, { name: string; color: string }>;
  factory: Map<string, string>;
  supplier: Map<string, string>;
  buyer: Map<string, string>;
  forwarder: Map<string, string>;
  companyGroup: Map<string, string>;
  station: Map<string, string>;
};

function groupRecs(records: ShipmentRecord[], labels: GroupLabelMaps): RGroup[] {
  const m = new Map<string, RGroup>();
  for (const r of records) {
    const k = r.deal_id ?? `o-${r.id}`;
    if (!m.has(k)) {
      const ft = r.fuel_type_id ? labels.fuelType.get(r.fuel_type_id) : undefined;
      m.set(k, {
        key: k, dealId: r.deal_id, dealCode: r.deal?.deal_code ?? "—",
        dealYear: r.deal?.year ?? null,
        month: r.month ?? "",
        fuelType: ft?.name ?? "", fuelColor: ft?.color ?? "#6B7280",
        factory: (r.factory_id && labels.factory.get(r.factory_id)) || "",
        supplier: (r.supplier_id && labels.supplier.get(r.supplier_id)) || "",
        buyer: (r.buyer_id && labels.buyer.get(r.buyer_id)) || "",
        forwarder: (r.forwarder_id && labels.forwarder.get(r.forwarder_id)) || "",
        companyGroup: (r.company_group_id && labels.companyGroup.get(r.company_group_id)) || "",
        destStation: (r.destination_station_id && labels.station.get(r.destination_station_id)) || "",
        depStation: (r.departure_station_id && labels.station.get(r.departure_station_id)) || "",
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
          currency: r.currency ?? r.deal?.logistics_currency ?? r.deal?.currency ?? null,
        },
      });
    }
    const g = m.get(k)!; g.records.push(r); g.totalVol += r.shipment_volume ?? 0;
    // Sum exactly what the «сумма» column renders (raw shipped_tonnage_amount).
    // The old fallback to calcAmt(shipment_volume, tariff) phantom-filled rows
    // with NULL stored amount — and for KZ that fallback used the wrong base
    // (shipment_volume instead of loading_volume), so the group header tally
    // diverged from the sum of the column the operator was looking at. If a
    // row's stored amount is NULL, the trigger hasn't been able to compute it
    // yet (missing volume/tariff) — counting it as zero matches what the
    // column shows.
    g.totalAmt += r.shipped_tonnage_amount ?? 0;
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
  const [cm, setCm] = useState(""); const [wb, setWb] = useState("");
  const [tariffVal, setTariffVal] = useState<number | null>(group.tariff);
  const [curOverride, setCurOverride] = useState<string>("");
  const [saving, setSaving] = useState(false);
  // Appendix-based variant resolution. Fetched per deal; if the deal
  // has appendices set on its variants, the operator can pick one and
  // we resolve supplier_line_id / buyer_line_id by matching label on
  // each side independently.
  type ApxLine = { id: string; appendix: string | null };
  const [supLines, setSupLines] = useState<ApxLine[]>([]);
  const [buyLinesArr, setBuyLines] = useState<ApxLine[]>([]);
  const [apx, setApx] = useState("");

  // Fetch deal data to get all fields
  useEffect(() => {
    if (!dealId) return;
    sb.current.from("deals")
      .select("id, deal_code, year, month, logistics_shipment_month, factory_id, fuel_type_id, supplier_id, buyer_id, forwarder_id, buyer_destination_station_id, supplier_departure_station_id, logistics_company_group_id, supplier:counterparties!supplier_id(short_name, full_name), buyer:counterparties!buyer_id(short_name, full_name), factory:factories(name), fuel_type:fuel_types(name, color), forwarder:forwarders(name)")
      .eq("id", dealId).single()
      .then(({ data }) => { if (data) setDeal(data as unknown as DRef); });
    // Load variant appendix labels for both sides so the operator can
    // pick «Прил. 1» / etc. and we resolve supplier_line_id +
    // buyer_line_id at save time.
    // Cast through unknown — generated database.ts pre-dates migration
    // 00072 and doesn't know about the appendix column yet. Postgres
    // returns it fine.
    Promise.all([
      sb.current.from("deal_supplier_lines").select("id, appendix").eq("deal_id", dealId),
      sb.current.from("deal_buyer_lines").select("id, appendix").eq("deal_id", dealId),
    ]).then(([s, b]) => {
      setSupLines(((s.data as unknown) ?? []) as ApxLine[]);
      setBuyLines(((b.data as unknown) ?? []) as ApxLine[]);
    });
  }, [dealId]);

  // Distinct appendix values across both sides, sorted; empty values
  // hidden — the operator only sees real labels, blank = leave default.
  const apxOptions = useMemo(() => {
    const s = new Set<string>();
    for (const l of supLines) if (l.appendix) s.add(l.appendix);
    for (const l of buyLinesArr) if (l.appendix) s.add(l.appendix);
    return [...s].sort();
  }, [supLines, buyLinesArr]);

  // Auto-lookup tariff. The tariffs table is keyed by (dep, dest, fuel,
  // forwarder, month, year) — every dimension is required, otherwise
  // duplicate rows for different years cause the lookup to silently fail.
  // Month resolution priority: form-level pick → row's shipment_month
  // → deal.logistics_shipment_month (deal-level override, migration
  // 00069) → deal.month (the deal's own calendar month).
  useEffect(() => {
    if (!deal || tariffVal) return;
    const firstRec = group.records[0];
    const depId = deal.supplier_departure_station_id || firstRec?.departure_station_id;
    const destId = deal.buyer_destination_station_id || firstRec?.destination_station_id;
    const ftId = deal.fuel_type_id;
    const fwId = deal.forwarder_id;
    const month = sm
      || firstRec?.shipment_month
      || (deal as { logistics_shipment_month?: string | null }).logistics_shipment_month
      || deal.month;
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
    // Match appendix on each side independently. Unset → leaves
    // supplier_line_id/buyer_line_id null and the autoprice trigger
    // falls back to is_default = true.
    const supLineMatch = apx ? supLines.find((l) => l.appendix === apx) : null;
    const buyLineMatch = apx ? buyLinesArr.find((l) => l.appendix === apx) : null;
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
      waybill_number: wb || null,
      loading_volume: lv ? parseFloat(lv) : null, date: dt || null, invoice_number: sf || null,
      currency: curOverride || null, comment: cm || null,
      supplier_line_id: supLineMatch?.id ?? null,
      buyer_line_id: buyLineMatch?.id ?? null,
      supplier_appendix: supLineMatch?.appendix ?? null,
      buyer_appendix: buyLineMatch?.appendix ?? null,
    });
    setSaving(false); setW(""); setV(""); setLv(""); setDt(""); setSf(""); setSm(""); setCurOverride(""); setCm(""); setApx(""); setWb(""); onDone();
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
      <td className="border-r px-1 py-1"></td>
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
      <td className="border-r px-1 py-1"><input value={wb} onChange={(e) => setWb(e.target.value)} placeholder="№ накл." className="w-full h-6 text-[10px] font-mono border border-green-300 rounded px-1 bg-green-50" /></td>
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
      <td className="border-r px-2 py-1 text-right font-mono text-[10px] text-stone-500">{v && tariff != null ? fmtMoney(calcAmt(parseFloat(v), tariff)) : ""}</td>
      <td className="border-r px-1 py-1">
        <select value={curOverride} onChange={(e) => setCurOverride(e.target.value)} className="w-full h-6 text-[10px] border border-green-300 rounded px-0.5 bg-green-50 cursor-pointer focus:outline-none">
          <option value="">сделка</option>
          {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </td>
      <td className="border-r px-2 py-1 text-[10px] text-stone-400">{group.destStation}</td>
      <td className="border-r px-2 py-1 text-[10px] text-stone-400">{group.depStation}</td>
      <td className="border-r px-1 py-1">
        {/* Приложение — если у сделки есть варианты с приложениями,
            показываем компактный select. Иначе ячейка пустая. */}
        {apxOptions.length > 0 ? (
          <select
            value={apx}
            onChange={(e) => setApx(e.target.value)}
            className="w-full h-6 text-[10px] border border-green-300 rounded px-0.5 bg-green-50 cursor-pointer focus:outline-none"
          >
            <option value="">—</option>
            {apxOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        ) : null}
      </td>
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
type DRef = { id: string; deal_code: string; year: number | null; month: string | null; logistics_shipment_month?: string | null; factory_id: string | null; fuel_type_id: string | null; supplier_id: string | null; buyer_id: string | null; forwarder_id: string | null; buyer_destination_station_id: string | null; supplier_departure_station_id: string | null; logistics_company_group_id: string | null; supplier?: { short_name: string | null; full_name: string } | null; buyer?: { short_name: string | null; full_name: string } | null; factory?: { name: string } | null; fuel_type?: { name: string; color: string } | null; forwarder?: { name: string } | null; deal_company_groups?: { position: number; company_group?: { name?: string | null; full_name?: string | null } | null }[] };

// «Продублировать отгрузку» auto-rule (operator 2026-06-24): if chain
// positions 1 AND 2 are BOTH «ОсОО» or «Singularity» companies, default
// the checkbox to ON. Latin + Cyrillic variants checked for both
// — paranoid coverage of how the legal-form prefix might appear in
// company_groups.full_name. Case-insensitive via .toLowerCase() which
// in JS handles Unicode case-folding correctly.
function isOsooOrSingularityGroup(g: { name?: string | null; full_name?: string | null } | null | undefined): boolean {
  if (!g) return false;
  const haystack = `${g.full_name ?? ""} ${g.name ?? ""}`.toLowerCase();
  return (
    haystack.includes("осоо") ||      // Cyrillic
    haystack.includes("osoo") ||      // Latin
    haystack.includes("singularity") ||
    haystack.includes("сингулярити")
  );
}

// Operator 2026-06-25 whitelist: deals whose chain has BOTH pos1 AND
// pos2 occupied by a company from this list should ALSO default
// «Продублировать отгрузку» to ON. Matching is case-insensitive and
// ignores whitespace + hyphens (so «Дот-Трейдинг» / «Дот Трейдинг» /
// «ДОТТРЕЙДИНГ» all match). Substring match against name + full_name
// so the legal-form prefix («ОсОО», «ТОО», etc.) doesn't break it.
// Same name on both positions also qualifies (operator confirmation:
// answer #3 — Fuel Supply → Fuel Supply applies the rule too).
const AUTO_DUP_WHITELIST_NORM = [
  "caodl",
  "fuelsupplycompany",
  "geowax",
  "kerneltradegmbh",
  "singularitytradinggmbh",
  "tengriweyfzco",
  "аблинк",
  "бетта",
  "бренттрейдинг",
  "доттрейдинг",
  "ойлресурстрейдинг",
  "ордомунайимпекс",
];
function _normalizeForWhitelist(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[\s\-_.]+/g, "");
}
function isWhitelistGroup(g: { name?: string | null; full_name?: string | null } | null | undefined): boolean {
  if (!g) return false;
  const h = _normalizeForWhitelist(`${g.full_name ?? ""}${g.name ?? ""}`);
  return AUTO_DUP_WHITELIST_NORM.some((w) => h.includes(w));
}

function shouldAutoDupShipment(deal: DRef | undefined | null): boolean {
  if (!deal?.deal_company_groups) return false;
  const pos1 = deal.deal_company_groups.find((g) => g.position === 1)?.company_group;
  const pos2 = deal.deal_company_groups.find((g) => g.position === 2)?.company_group;
  // Rule (operator clarification 2026-06-25):
  //   • pos1 MUST match whitelist OR ОсОО — empty pos1 never triggers.
  //   • pos2 may be either empty OR a matching company. A non-empty
  //     pos2 with a NON-matching company explicitly DISQUALIFIES the
  //     pair («не должны включать если есть компании не из whitelist
  //     или осоо»).
  if (!pos1) return false;
  const pos1Matches = isOsooOrSingularityGroup(pos1) || isWhitelistGroup(pos1);
  if (!pos1Matches) return false;
  if (!pos2) return true; // pos2 empty + pos1 matches → дублируем
  return isOsooOrSingularityGroup(pos2) || isWhitelistGroup(pos2);
}

function AddDialog({ open, onClose, regType, onDone, minimized = false, onMinimize }: { open: boolean; onClose: () => void; regType: "KG" | "KZ"; onDone: () => void; minimized?: boolean; onMinimize?: () => void }) {
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
  // 2026-06-26: default "load" so the «Входящее СНТ» button
  // (supplier-side) is pre-selected on dialog open.
  const [volumeTarget, setVolumeTarget] = useState<"ship" | "load">("load");
  // «Продублировать отгрузку» — when checked, the parsed volume is
  // written into BOTH shipment_volume and loading_volume. Useful for
  // KG export deals where the same tonnage is the исходящая + входящая
  // СНТ on the same wagon — operator request 2026-06-24.
  // Auto-toggled to ON when the picked deal's chain has positions 1
  // AND 2 BOTH occupied by an ОсОО/Singularity entity — see
  // shouldAutoDupShipment(). The operator can still flip it manually.
  const [dupShipment, setDupShipment] = useState<boolean>(false);
  // True once the operator has manually toggled the checkbox for the
  // current deal selection. Suppresses the auto-rule from clobbering
  // their explicit choice until they pick a different deal.
  const [dupShipmentUserTouched, setDupShipmentUserTouched] = useState<boolean>(false);

  // Multi-line variant selection. Loaded for the selected deal; auto-picks
  // the default line. User can switch to another variant and we mirror the
  // line's station onto the per-row station state.
  type SupLine = { id: string; is_default: boolean; position: number; price: number | null; appendix: string | null; departure_station_id: string | null; departure_station: { name: string } | null };
  type BuyLine = { id: string; is_default: boolean; position: number; price: number | null; appendix: string | null; destination_station_id: string | null; destination_station: { name: string } | null };
  const [supplierLines, setSupplierLines] = useState<SupLine[]>([]);
  const [buyerLines, setBuyerLines]       = useState<BuyLine[]>([]);
  const [supplierLineId, setSupplierLineId] = useState("");
  const [buyerLineId, setBuyerLineId]       = useState("");

  useEffect(() => {
    if (!open) return;
    Promise.all([
      sb.current.from("deals").select("id, deal_code, year, month, logistics_shipment_month, factory_id, fuel_type_id, supplier_id, buyer_id, forwarder_id, buyer_destination_station_id, supplier_departure_station_id, logistics_company_group_id, supplier:counterparties!supplier_id(short_name, full_name), buyer:counterparties!buyer_id(short_name, full_name), deal_company_groups(position, company_group:company_groups(name, full_name))").eq("deal_type", regType).eq("is_archived", false).or("is_draft.is.null,is_draft.eq.false").order("deal_code"),
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
  // Месяц отгрузки: prefer the deal-level logistics_shipment_month
  // override (migration 00069) over the deal's own calendar month.
  useEffect(() => {
    if (!dealId) return;
    const d = deals.find((x) => x.id === dealId);
    if (!d) return;
    if (d.month) setMonth(d.month);
    const shipMonthOverride = (d as { logistics_shipment_month?: string | null }).logistics_shipment_month;
    if (shipMonthOverride) setShipMonth(shipMonthOverride);
    if (d.fuel_type_id) setFtId(d.fuel_type_id);
    if (d.factory_id) setFacId(d.factory_id);
    if (d.forwarder_id) setFwId(d.forwarder_id);
    if (d.buyer_destination_station_id) setDestId(d.buyer_destination_station_id);
    if (d.supplier_departure_station_id) setDepId(d.supplier_departure_station_id);
    // Auto-tick «Продублировать отгрузку» for ОсОО↔Singularity chains.
    // Reset the user-touched flag too: a different deal means the
    // operator's previous override no longer applies.
    setDupShipment(shouldAutoDupShipment(d));
    setDupShipmentUserTouched(false);
  }, [dealId, deals]);

  // Load pricing variants for the selected deal — preselect the defaults.
  // Hides itself entirely when both sides have a single variant (most cases).
  useEffect(() => {
    if (!dealId) {
      setSupplierLines([]); setBuyerLines([]);
      setSupplierLineId(""); setBuyerLineId("");
      return;
    }
    Promise.all([
      sb.current.from("deal_supplier_lines")
        .select("id, is_default, position, price, appendix, departure_station_id, departure_station:stations!departure_station_id(name)")
        .eq("deal_id", dealId)
        .order("is_default", { ascending: false }).order("position"),
      sb.current.from("deal_buyer_lines")
        .select("id, is_default, position, price, appendix, destination_station_id, destination_station:stations!destination_station_id(name)")
        .eq("deal_id", dealId)
        .order("is_default", { ascending: false }).order("position"),
    ]).then(([s, b]) => {
      const sl = (s.data ?? []) as unknown as SupLine[];
      const bl = (b.data ?? []) as unknown as BuyLine[];
      setSupplierLines(sl); setBuyerLines(bl);
      const sd = sl.find((l) => l.is_default) ?? sl[0];
      const bd = bl.find((l) => l.is_default) ?? bl[0];
      if (sd) setSupplierLineId(sd.id);
      if (bd) setBuyerLineId(bd.id);
    });
  }, [dealId]);

  // When the user picks a non-default variant, mirror its station onto
  // the per-row state so the rest of the dialog (tariff lookup, insert)
  // uses that station instead of the deal's default.
  useEffect(() => {
    const l = supplierLines.find((x) => x.id === supplierLineId);
    if (l?.departure_station_id) setDepId(l.departure_station_id);
  }, [supplierLineId, supplierLines]);

  useEffect(() => {
    const l = buyerLines.find((x) => x.id === buyerLineId);
    if (l?.destination_station_id) setDestId(l.destination_station_id);
  }, [buyerLineId, buyerLines]);

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
    setPasted(""); setVolumeTarget("ship"); setDupShipment(false); setDupShipmentUserTouched(false);
    setSupplierLineId(""); setBuyerLineId("");
    setSupplierLines([]); setBuyerLines([]);
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
      // dupShipment overrides the single-target rule: write the same
      // volume into BOTH sides. Useful when исходящее СНТ == входящее
      // СНТ on a wagon (KG export pattern).
      shipment_volume: dupShipment ? p.volume : (volumeTarget === "ship" ? p.volume : null),
      loading_volume:  dupShipment ? p.volume : (volumeTarget === "load" ? p.volume : null),
      date: p.date || null,
      waybill_number: p.waybill || null,
      supplier_line_id: supplierLineId || null,
      buyer_line_id: buyerLineId || null,
      supplier_appendix: supplierLines.find((x) => x.id === supplierLineId)?.appendix ?? null,
      buyer_appendix:    buyerLines.find((x)    => x.id === buyerLineId)?.appendix    ?? null,
    }));
    const result = await bulkInsertRegistry(rows);
    setSaving(false);
    if (result) { onDone(); onClose(); resetAll(); }
  }

  // Sel — раньше нативный <select>, теперь cmdk-backed picker с
  // встроенным поиском. Списки экспедиторов / станций / групп компаний
  // длинные, без поиска оператору приходилось скроллить пальцами.
  const Sel = ({ l, v, fn, opts }: { l: string; v: string; fn: (v: string) => void; opts: { value: string; label: string }[] }) => (
    <div>
      <Label className="text-[10px] text-stone-500">{l}</Label>
      <SearchableSelect
        value={v}
        onChange={fn}
        options={opts}
        placeholder="—"
        searchPlaceholder={`Поиск ${l.toLowerCase()}…`}
        triggerClassName="h-8 text-[12px]"
      />
    </div>
  );

  return (
    /* keepMounted preserves form state when the operator minimises:
       closing the dialog (open=false) would normally unmount the
       portal and wipe all useState values; keepMounted=true holds the
       React tree alive while making the dialog invisible. */
    <Dialog open={open && !minimized} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent keepMounted className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0">
          <DialogTitle>Новая запись в реестр {regType}</DialogTitle>
          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              aria-label="Свернуть"
              title="Свернуть — форма останется заполненной"
              className="mr-7 inline-flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors"
            >
              <span className="block h-0.5 w-3 bg-current rounded" />
            </button>
          )}
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded border border-amber-200 bg-amber-50/30 p-3">
            <p className="text-[11px] font-medium text-amber-700 mb-2">Контекст сделки</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] text-stone-500">Сделка</Label>
                  {/* «Провалиться в сделку» — клиент 18.06.2026: чтобы быстро
                      проверить контекст сделки не теряя введённые данные в
                      этом диалоге. Открывается в новой вкладке только когда
                      сделка выбрана. */}
                  {dealId && (
                    <a
                      href={`/deals/${dealId}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Открыть сделку в новой вкладке"
                      className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 hover:text-amber-700"
                    >
                      Открыть
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
                <SearchableSelect
                  value={dealId}
                  onChange={(v) => { setDealId(v); setTariff(""); }}
                  options={deals.map((d) => ({
                    value: d.id,
                    label: `${d.deal_code} — ${d.supplier?.short_name ?? ""} → ${d.buyer?.short_name ?? ""}`,
                  }))}
                  placeholder="Выберите..."
                  searchPlaceholder="Поиск сделки…"
                  triggerClassName="h-8 text-[12px]"
                />
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
              <Sel l="Плательщик ж/д тарифа" v={cgId} fn={setCgId} opts={cgs.map((c) => ({ value: c.id, label: c.name }))} />
              <Sel l="Ст. назначения" v={destId} fn={setDestId} opts={stations.map((s) => ({ value: s.id, label: s.name }))} />
              <Sel l="Ст. отправления" v={depId} fn={setDepId} opts={stations.map((s) => ({ value: s.id, label: s.name }))} />
              <div><Label className="text-[10px] text-stone-500">Ж/Д тариф</Label><Input type="number" step="0.01" value={tariff} onChange={(e) => setTariff(e.target.value)} className="h-8 text-[12px] font-mono" /></div>

              {/* Variant pickers — only shown when the deal has >1 line
                  on a side. Below each, a sibling «Приложение» picker
                  (always shown if at least one variant has an appendix
                  set) lets the operator switch variants by their
                  contractual appendix label instead of the variant
                  index. Picking an appendix auto-selects the line.
                  Selecting the variant keeps the picker in sync via
                  the derived `supplier_appendix` value. */}
              {supplierLines.length > 1 && (
                <div>
                  <Label className="text-[10px] text-stone-500">Вариант поставщика</Label>
                  <select
                    value={supplierLineId}
                    onChange={(e) => setSupplierLineId(e.target.value)}
                    className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer"
                  >
                    {supplierLines.map((l, idx) => (
                      <option key={l.id} value={l.id}>
                        {l.appendix ? `${l.appendix} · ` : ""}
                        {l.is_default ? "★ Основной" : `Вариант ${idx + 1}`}
                        {l.departure_station?.name ? ` — ${l.departure_station.name}` : ""}
                        {l.price != null ? ` · ${l.price}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {supplierLines.some((l) => l.appendix) && (
                <div>
                  <Label className="text-[10px] text-stone-500">Прилож. поставщика</Label>
                  <select
                    value={supplierLines.find((l) => l.id === supplierLineId)?.appendix ?? ""}
                    onChange={(e) => {
                      const match = supplierLines.find((l) => (l.appendix ?? "") === e.target.value);
                      if (match) setSupplierLineId(match.id);
                    }}
                    className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer"
                  >
                    {supplierLines.map((l) => (
                      <option key={l.id} value={l.appendix ?? ""}>
                        {l.appendix || "(без приложения)"}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {buyerLines.length > 1 && (
                <div>
                  <Label className="text-[10px] text-stone-500">Вариант покупателя</Label>
                  <select
                    value={buyerLineId}
                    onChange={(e) => setBuyerLineId(e.target.value)}
                    className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer"
                  >
                    {buyerLines.map((l, idx) => (
                      <option key={l.id} value={l.id}>
                        {l.appendix ? `${l.appendix} · ` : ""}
                        {l.is_default ? "★ Основной" : `Вариант ${idx + 1}`}
                        {l.destination_station?.name ? ` — ${l.destination_station.name}` : ""}
                        {l.price != null ? ` · ${l.price}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {buyerLines.some((l) => l.appendix) && (
                <div>
                  <Label className="text-[10px] text-stone-500">Прилож. покупателя</Label>
                  <select
                    value={buyerLines.find((l) => l.id === buyerLineId)?.appendix ?? ""}
                    onChange={(e) => {
                      const match = buyerLines.find((l) => (l.appendix ?? "") === e.target.value);
                      if (match) setBuyerLineId(match.id);
                    }}
                    className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer"
                  >
                    {buyerLines.map((l) => (
                      <option key={l.id} value={l.appendix ?? ""}>
                        {l.appendix || "(без приложения)"}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-[11px] text-stone-600 flex items-center gap-1">
                <ClipboardPaste className="h-3 w-3" /> Вагоны (один на строку; TAB или пробелы между колонками)
              </Label>
              <div className="flex items-center gap-3">
                {/* Шорткат для случая когда обе СНТ совпадают по
                    объёму (типовой для KG-экспорта). Когда галка
                    стоит, мы пишем значение в обе колонки и тоггл
                    Исходящее/Входящее перестаёт иметь значение —
                    приглушаем его. Операторский запрос 2026-06-24. */}
                <label className="flex items-center gap-1.5 text-[11px] text-stone-600 select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dupShipment}
                    onChange={(e) => { setDupShipment(e.target.checked); setDupShipmentUserTouched(true); }}
                    className="h-3.5 w-3.5 cursor-pointer accent-amber-600"
                  />
                  Продублировать отгрузку
                </label>
                <span className={`text-[10px] ${dupShipment ? "text-stone-300" : "text-stone-500"}`}>Объём идёт в:</span>
                <div className={`inline-flex rounded border border-stone-200 bg-white overflow-hidden ${dupShipment ? "opacity-40 pointer-events-none" : ""}`}>
                  {/*
                    Operator 2026-06-26: «Входящее» = поставщик-сторона.
                    По БД (migration 00044) supplier_shipped_volume =
                    SUM(loading_volume), buyer_shipped_volume =
                    SUM(shipment_volume). Поэтому:
                      Входящее СНТ → loading_volume → supplier
                      Исходящее СНТ → shipment_volume → buyer
                  */}
                  <button
                    type="button"
                    onClick={() => setVolumeTarget("load")}
                    className={`px-2 py-0.5 text-[11px] transition-colors ${volumeTarget === "load" ? "bg-amber-600 text-white" : "text-stone-600 hover:bg-stone-50"}`}
                    title="столбец loading_volume (поставщик)"
                  >
                    Входящее СНТ
                  </button>
                  <button
                    type="button"
                    onClick={() => setVolumeTarget("ship")}
                    className={`px-2 py-0.5 text-[11px] transition-colors border-l border-stone-200 ${volumeTarget === "ship" ? "bg-amber-600 text-white" : "text-stone-600 hover:bg-stone-50"}`}
                    title="столбец shipment_volume (покупатель)"
                  >
                    Исходящее СНТ
                  </button>
                </div>
              </div>
            </div>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={"05.11.2025\tЭД0012345\t51742534\t54,719\n05.11.2025\tЭД0012346\t51667558\t54,719\n05.11.2025\t\t75040170\t54,719"}
              rows={6}
              className="w-full rounded-md border border-stone-200 bg-white p-2 text-[12px] font-mono focus:border-amber-400 focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-stone-400">
              Колонки: <code>дата ⇥ № накладной ⇥ № вагона ⇥ объём</code> (4 столбца) или <code>дата ⇥ № вагона ⇥ объём</code> (3 столбца, без накладной). Старый порядок <code>вагон ⇥ объём ⇥ дата ⇥ накладная</code> тоже распознаётся. Запятая и точка в числах поддерживаются.
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
                      <th className="text-right px-2 py-1">{volumeTarget === "load" ? "Входящее СНТ" : "Исходящее СНТ"}</th>
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
                        <td className="px-2 py-0.5 font-mono text-right">{p.volume != null ? p.volume.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—"}</td>
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

// --- Column-header funnel filter ---
// Per-column popover that lists the unique values from the column and
// lets the operator pick one. Used as a tiny funnel icon next to the
// table header cell. Click → popover with a cmdk search input + list.
//
// The value column is the actual stored value used for matching (e.g.
// an id for fk fields, the raw string for currency/month). The label
// column is what the operator sees — for fk fields we resolve via the
// refs cache; for plain strings it's the value itself.
type CFOption = { value: string; label: string };
function ColumnFilterPopover({
  colKey,
  options,
  currentValue,
  onChange,
  align = "start",
}: {
  colKey: string;
  options: CFOption[];
  currentValue: string;
  onChange: (next: string) => void;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const active = !!currentValue;
  const sorted = useMemo(
    () => [...options].sort((a, b) => a.label.localeCompare(b.label, "ru")),
    [options],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title={`Фильтр по столбцу${active ? " (активен)" : ""}`}
        aria-label={`Фильтр ${colKey}`}
        className={`inline-flex items-center justify-center rounded p-0.5 transition-colors shrink-0 ${
          active ? "text-amber-600 hover:text-amber-700" : "text-stone-400 hover:text-amber-600"
        }`}
      >
        <Filter className="h-3 w-3" />
        {active && (
          <span className="ml-0.5 inline-block h-1 w-1 rounded-full bg-amber-600" aria-hidden="true" />
        )}
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[240px]" align={align} sideOffset={4}>
        <Command
          shouldFilter
          // CommandItem.value is `${label} ${value}` so cmdk's internal
          // key dedup doesn't drop options that share a resolved label
          // (e.g. two suppliers with identical short_name). The filter
          // below only matches against the label portion so typing
          // doesn't accidentally match characters inside an id.
          filter={(itemValue, search) => {
            const needle = search.trim().toLowerCase();
            if (!needle) return 1;
            const lastSpace = itemValue.lastIndexOf(" ");
            const label = (lastSpace > 0 ? itemValue.slice(0, lastSpace) : itemValue).toLowerCase();
            return label.includes(needle) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Поиск…" className="text-[12px]" />
          <CommandList className="max-h-[260px]">
            <CommandEmpty className="text-[11px] py-3 text-center text-stone-400">
              Нет значений
            </CommandEmpty>
            <CommandGroup>
              {sorted.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  onSelect={() => {
                    onChange(o.value === currentValue ? "" : o.value);
                    setOpen(false);
                  }}
                  className="text-[11px]"
                >
                  <span
                    className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${
                      o.value === currentValue ? "bg-amber-600" : "bg-transparent"
                    }`}
                  />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="border-t border-stone-100 p-1">
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            disabled={!active}
            className="w-full text-left text-[11px] text-stone-500 hover:text-red-600 disabled:text-stone-300 disabled:hover:text-stone-300 px-2 py-1 rounded transition-colors"
          >
            Сбросить фильтр
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Validator for the URL-persisted column-filter map. parseAsJson accepts
// the raw decoded JSON; we reject anything that isn't a flat
// string→string object so a malformed URL doesn't crash the page.
function validateColumnFilters(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k === "string" && typeof val === "string" && val) out[k] = val;
  }
  return out;
}

// Column keys eligible for header-funnel filters. Used both for
// rendering the icon and for the records-filter pass.
const COL_FILTER_KEYS = [
  "additional_month",
  "shipment_month",
  "fuel_type_id",
  "factory_id",
  "supplier_id",
  "company_group_id",
  "buyer_id",
  "forwarder_id",
  "currency",
  "destination_station_id",
  "departure_station_id",
] as const;
type ColFilterKey = (typeof COL_FILTER_KEYS)[number];

// --- Main page ---
export default function RegistryPage() {
  // Tab persisted in URL — operator 2026-06-25: «поставили фильтр в
  // реестре KZ, перешли на другую вкладку workspace, вернулись — таб
  // сбрасывался на KG, а URL-фильтр оставался → 0 совпадений». Now
  // both `tab` and the filters round-trip via the URL, so returning
  // lands the operator exactly where they were.
  // throttleMs: 0 on every URL-state — operator 2026-06-25 still saw
  // stale filter after rapid filter change → tab switch → return.
  // nuqs default throttle is 50ms (Chrome) / 120-320ms (Safari); within
  // that window window.location.search is still the pre-change URL, so
  // the workspace-tab capture grabbed the OLD filter and stored it.
  // Flushing immediately on each setState fixes the race; with
  // shallow: true (nuqs default) every update is just a
  // history.replaceState — cheap, no extra renders.
  const NUQS_INSTANT = { throttleMs: 0 } as const;
  const [tabRaw, setTabRaw] = useQueryState("tab", { defaultValue: "kg", ...NUQS_INSTANT });
  const tab: "kg" | "kz" = tabRaw === "kz" ? "kz" : "kg";
  const setTab = (next: "kg" | "kz") => { void setTabRaw(next === "kg" ? null : next); };
  const { data: records, loading, reload } = useRegistry(tab === "kg" ? "KG" : "KZ");
  const showRegistryLoader = useDelayed(loading);
  // Workspace-tab integration: clicking a deal code in a group header
  // opens the deal passport as a workspace tab (operator request
  // 2026-06-25: «добавим возможность открыть сделку с реестра при
  // нажатии на номер сделки»).
  const { openTab } = useTabs();
  const [showAdd, setShowAdd] = useState(false);
  // Минимизация диалога «Новая запись» — операторский запрос 2026-06-25
  // («сделать кнопку "свернуть"»). При свёрнутом состоянии Dialog
  // open=false (overlay уходит), но keepMounted=true держит React-tree
  // живым, так что заполненные поля и вставленный текст не теряются.
  const [addMinimized, setAddMinimized] = useState(false);
  const [bulkIn, setBulkIn] = useState<RGroup | null>(null);
  // Excel export — disabled while the workbook is being built so a
  // double-click can't trigger two downloads. Operator request
  // 2026-06-24: «Добавь выгрузку Реестр отгрузок отдельно эксель файлом».
  const [exporting, setExporting] = useState(false);
  // Expanded deal-group keys are persisted to the URL via nuqs so that
  // switching workspace tabs and coming back (or sharing the URL) keeps
  // the same groups open — operator complaint 2026-06-22: «expanded
  // groups collapsed on tab switch». Stored as a comma-separated string
  // in `?expanded=KG/26/002,KZ/26/001`.
  const [expandedList, setExpandedList] = useQueryState(
    "expanded",
    { ...parseAsArrayOf(parseAsString).withDefault([]), ...NUQS_INSTANT },
  );
  const expanded = useMemo(() => new Set(expandedList), [expandedList]);
  const setExpanded = (updater: (prev: Set<string>) => Set<string>) => {
    setExpandedList(Array.from(updater(new Set(expandedList))));
  };
  const [addingIn, setAddingIn] = useState<string | null>(null); // which group is adding
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Цепочка групп компании по каждой сделке. Ключ = deal_id, значение
  // = массив из 3 имён (пустая строка на позициях без группы). Клиент
  // 2026-07-08: показывать цепочку в шапке group-card реестра И
  // добавить 3 колонки в полный Excel. Максимум бывает 3 группы.
  const [dealChains, setDealChains] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    const sb = createClient();
    sb.from("deal_company_groups")
      .select("deal_id, position, company_group:company_groups(name)")
      .in("position", [1, 2, 3])
      .then(({ data }) => {
        const m = new Map<string, string[]>();
        type Row = { deal_id: string; position: number; company_group: { name: string | null } | null };
        for (const row of ((data as unknown) ?? []) as Row[]) {
          if (!row.deal_id) continue;
          const chain = m.get(row.deal_id) ?? ["", "", ""];
          chain[row.position - 1] = row.company_group?.name ?? "";
          m.set(row.deal_id, chain);
        }
        setDealChains(m);
      });
  }, []);
  // Header filters — narrow visible shipments without round-tripping
  // the server. Combined with the tab (KG/KZ) which is server-side.
  //
  // All filters are URL-persisted via nuqs so that:
  //   1. Navigating /registry → /deals → /registry restores the
  //      operator's selections (operator complaint 2026-06-18 same
  //      pattern as /deals page).
  //   2. URLs become shareable: /registry?forwarderFilter=…&columnFilters=…
  // history: "replace" (nuqs default) keeps the back stack clean.
  const [forwarderFilter, setForwarderFilter] = useQueryState("forwarderFilter", { defaultValue: "", ...NUQS_INSTANT });
  const [dealFilter, setDealFilter] = useQueryState("dealFilter", { defaultValue: "", ...NUQS_INSTANT });
  const [companyGroupFilter, setCompanyGroupFilter] = useQueryState("companyGroupFilter", { defaultValue: "", ...NUQS_INSTANT });
  // Substring filters on wagon / waybill numbers — operator needs to
  // jump straight to a specific shipment without scrolling groups.
  const [wagonFilter, setWagonFilter] = useQueryState("wagonFilter", { defaultValue: "", ...NUQS_INSTANT });
  const [waybillFilter, setWaybillFilter] = useQueryState("waybillFilter", { defaultValue: "", ...NUQS_INSTANT });
  // New: page-level month-of-shipment filter — separate from the
  // per-column funnel filter because the operator's primary
  // narrow-by axis is месяц отгрузки (client req 2026-06-18).
  const [shipmentMonthFilter, setShipmentMonthFilter] = useQueryState("shipmentMonthFilter", { defaultValue: "", ...NUQS_INSTANT });
  // Per-column funnel filters — single map keyed by column name. Stored
  // as URL-encoded JSON so the operator can share a filtered view.
  // useDeferredValue isolates the heavy filter pass from the cmdk
  // popover keystrokes (~5000 shipments per registry).
  const [columnFilters, setColumnFilters] = useQueryState(
    "columnFilters",
    { ...parseAsJson<Record<string, string>>(validateColumnFilters).withDefault({}), ...NUQS_INSTANT },
  );
  const deferredColumnFilters = useDeferredValue(columnFilters);
  function setColumnFilter(col: ColFilterKey, value: string) {
    const next = { ...columnFilters };
    if (value) next[col] = value; else delete next[col];
    // nuqs serializer treats an empty object the same as null → clears
    // the URL param. Setting to null explicitly when empty keeps the
    // URL tidy.
    setColumnFilters(Object.keys(next).length === 0 ? null : next);
  }

  // Reset selection when tab switches — selected ids belong to the previous tab.
  useEffect(() => { setSelected(new Set()); }, [tab]);

  function toggleSelect(id: string) {
    setSelected((p) => {
      const s = new Set(p);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }
  function toggleSelectGroup(g: RGroup) {
    const ids = g.records.map((r) => r.id);
    setSelected((p) => {
      const s = new Set(p);
      const allSelected = ids.every((id) => s.has(id));
      if (allSelected) ids.forEach((id) => s.delete(id));
      else ids.forEach((id) => s.add(id));
      return s;
    });
  }
  async function handleExportExcel(variant: "pts" | "full") {
    if (exporting) return;
    if (filteredRecords.length === 0) {
      toast.error("Нет записей для выгрузки");
      return;
    }
    setExporting(true);
    try {
      const { exportRegistryToExcel } = await import("@/lib/exports/registry-excel");
      // No yearFilter on this page — pick the most common deal.year
      // across the currently filtered records, falling back to the
      // current calendar year if nothing resolves. Filename only;
      // doesn't constrain the export contents.
      const yearCounts = new Map<number, number>();
      for (const r of filteredRecords) {
        const y = r.deal?.year;
        if (typeof y === "number") yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
      }
      let year = new Date().getFullYear();
      let best = 0;
      for (const [y, n] of yearCounts) if (n > best) { year = y; best = n; }
      await exportRegistryToExcel(filteredRecords, {
        type: tab === "kg" ? "KG" : "KZ",
        year,
        labels: labelMaps,
        variant,
        dealChains,
      });
      toast.success(`Выгружено ${filteredRecords.length} строк`);
    } catch (e) {
      toast.error(`Ошибка выгрузки: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleBulkDelete() {
    const n = selected.size;
    if (n === 0) return;
    if (!confirm(`Удалить ${n} ${n === 1 ? "отгрузку" : "отгрузок"}?`)) return;
    const sb = createClient();
    const { error } = await sb.from("shipment_registry").delete().in("id", Array.from(selected));
    if (error) { toast.error(`Ошибка: ${error.message}`); return; }
    toast.success(`Удалено ${n}`);
    setSelected(new Set());
    reload();
  }
  // Page-level reference data — read from the shared cache so a tab
  // flip or registry → deal → registry round-trip doesn't refire the
  // seven parallel ref queries every time. Cache is warmed in the
  // dashboard layout.
  const { refs: globalRefs } = useGlobalRefs();
  const refs = useMemo(() => ({
    factories: globalRefs.factories as Ref[],
    suppliers: globalRefs.suppliers as unknown as DRef2[],
    buyers: globalRefs.buyers as unknown as DRef2[],
    companyGroups: globalRefs.companyGroups as Ref[],
    forwarders: globalRefs.forwarders as Ref[],
    fuelTypes: globalRefs.fuelTypes as Ref[],
    stations: globalRefs.stations as Ref[],
  }), [globalRefs]);

  // Resolver maps — registry rows used to read joined names from the
  // shipment_registry query (r.supplier?.short_name etc), but those
  // eight embeds were the cold-paint bottleneck on 5000+-row registries.
  // REG_SELECT keeps only the `deal` embed; everything else resolves
  // here from the already-warmed refs cache. O(1) per lookup, zero
  // extra round-trips.
  const supplierLabels = useMemo(
    () => new Map(refs.suppliers.map((c) => [c.id, c.short_name ?? c.full_name])),
    [refs.suppliers],
  );
  const buyerLabels = useMemo(
    () => new Map(refs.buyers.map((c) => [c.id, c.short_name ?? c.full_name])),
    [refs.buyers],
  );
  const factoryLabels = useMemo(() => new Map(refs.factories.map((r) => [r.id, r.name])), [refs.factories]);
  const fuelTypeLabels = useMemo(
    () => new Map(refs.fuelTypes.map((r) => [r.id, { name: r.name, color: (r as unknown as { color?: string | null }).color ?? "#6B7280" }])),
    [refs.fuelTypes],
  );
  const forwarderLabels = useMemo(() => new Map(refs.forwarders.map((r) => [r.id, r.name])), [refs.forwarders]);
  const cgLabels = useMemo(() => new Map(refs.companyGroups.map((r) => [r.id, r.name])), [refs.companyGroups]);
  const stationLabels = useMemo(() => new Map(refs.stations.map((r) => [r.id, r.name])), [refs.stations]);

  const labelMaps: GroupLabelMaps = useMemo(() => ({
    fuelType: fuelTypeLabels,
    factory: factoryLabels,
    supplier: supplierLabels,
    buyer: buyerLabels,
    forwarder: forwarderLabels,
    companyGroup: cgLabels,
    station: stationLabels,
  }), [fuelTypeLabels, factoryLabels, supplierLabels, buyerLabels, forwarderLabels, cgLabels, stationLabels]);

  // Apply header filters before grouping. Tab is already server-side
  // (useRegistry pulls KG xor KZ); the rest narrow the rendered set.
  // Column-header funnel filters are folded into the same pass; using
  // deferredColumnFilters so cmdk popover keystrokes don't block the
  // big filter loop on ~5000-row registries.
  const filteredRecords = useMemo(() => {
    const wq = wagonFilter.trim().toLowerCase();
    const bq = waybillFilter.trim().toLowerCase();
    const cf = deferredColumnFilters;
    const cfEntries = Object.entries(cf);
    return records.filter((r) => {
      if (forwarderFilter && r.forwarder_id !== forwarderFilter) return false;
      if (dealFilter && r.deal_id !== dealFilter) return false;
      if (companyGroupFilter && r.company_group_id !== companyGroupFilter) return false;
      if (shipmentMonthFilter && r.shipment_month !== shipmentMonthFilter) return false;
      if (wq && !(r.wagon_number ?? "").toLowerCase().includes(wq)) return false;
      if (bq && !(r.waybill_number ?? "").toLowerCase().includes(bq)) return false;
      for (const [col, val] of cfEntries) {
        // Each column maps to a top-level field on ShipmentRecord. A
        // strict equality check is correct for both string ids (uuids)
        // and the plain-string fields (currency, *_month).
        const rv = (r as unknown as Record<string, unknown>)[col];
        if ((rv ?? "") !== val) return false;
      }
      return true;
    });
  }, [
    records,
    forwarderFilter,
    dealFilter,
    companyGroupFilter,
    shipmentMonthFilter,
    wagonFilter,
    waybillFilter,
    deferredColumnFilters,
  ]);
  const groups = groupRecs(filteredRecords, labelMaps);
  const toggle = (k: string) => setExpanded((p) => { const s = new Set(p); s.has(k) ? s.delete(k) : s.add(k); return s; });

  // Deals dropdown — derived from the current tab's records so we only
  // list deals that actually have shipments here.
  const dealOpts = useMemo(() => {
    const seen = new Map<string, string>(); // id → code
    for (const r of records) {
      if (r.deal_id && r.deal?.deal_code && !seen.has(r.deal_id)) {
        seen.set(r.deal_id, r.deal.deal_code);
      }
    }
    return [...seen.entries()]
      .map(([id, code]) => ({ id, label: code }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [records]);

  const activeFilterCount =
    (forwarderFilter ? 1 : 0) + (dealFilter ? 1 : 0) + (companyGroupFilter ? 1 : 0) +
    (shipmentMonthFilter ? 1 : 0) +
    (wagonFilter.trim() ? 1 : 0) + (waybillFilter.trim() ? 1 : 0) +
    Object.keys(columnFilters).length;
  function clearRegistryFilters() {
    // Empty string matches each filter's default, so nuqs drops the
    // param from the URL. Same idiom the /deals page uses.
    setForwarderFilter(""); setDealFilter(""); setCompanyGroupFilter("");
    setWagonFilter(""); setWaybillFilter("");
    setShipmentMonthFilter("");
    setColumnFilters(null);
  }

  const factoryOpts = useMemo(() => refs.factories.map((f) => ({ value: f.id, label: f.name })), [refs.factories]);
  const supplierOpts = useMemo(() => refs.suppliers.map((c) => ({ value: c.id, label: c.short_name ?? c.full_name })), [refs.suppliers]);
  const buyerOpts = useMemo(() => refs.buyers.map((c) => ({ value: c.id, label: c.short_name ?? c.full_name })), [refs.buyers]);
  const cgOpts = useMemo(() => refs.companyGroups.map((c) => ({ value: c.id, label: c.name })), [refs.companyGroups]);
  const fwOpts = useMemo(() => refs.forwarders.map((c) => ({ value: c.id, label: c.name })), [refs.forwarders]);
  const ftOpts = useMemo(() => refs.fuelTypes.map((c) => ({ value: c.id, label: c.name })), [refs.fuelTypes]);
  const stOpts = useMemo(() => refs.stations.map((c) => ({ value: c.id, label: c.name })), [refs.stations]);
  const monthOpts = useMemo(() => MONTHS_RU.map((m) => ({ value: m, label: m })), []);

  // Per-column funnel options — distinct values currently present in
  // the loaded `records`, resolved to labels via the refs cache for fk
  // columns. Building from the records (not from the full refs list)
  // keeps the dropdown short: only values actually used in this tab's
  // shipments show up.
  const columnFilterOpts = useMemo(() => {
    type V = { value: string; label: string };
    const make = (key: ColFilterKey, resolve: (id: string) => string): V[] => {
      const seen = new Map<string, string>();
      for (const r of records) {
        const v = (r as unknown as Record<string, unknown>)[key];
        if (typeof v !== "string" || !v) continue;
        if (!seen.has(v)) seen.set(v, resolve(v));
      }
      return [...seen.entries()].map(([value, label]) => ({ value, label }));
    };
    return {
      additional_month: make("additional_month", (v) => v),
      shipment_month: make("shipment_month", (v) => v),
      fuel_type_id: make("fuel_type_id", (id) => fuelTypeLabels.get(id)?.name ?? id),
      factory_id: make("factory_id", (id) => factoryLabels.get(id) ?? id),
      supplier_id: make("supplier_id", (id) => supplierLabels.get(id) ?? id),
      company_group_id: make("company_group_id", (id) => cgLabels.get(id) ?? id),
      buyer_id: make("buyer_id", (id) => buyerLabels.get(id) ?? id),
      forwarder_id: make("forwarder_id", (id) => forwarderLabels.get(id) ?? id),
      currency: make("currency", (v) => v),
      destination_station_id: make("destination_station_id", (id) => stationLabels.get(id) ?? id),
      departure_station_id: make("departure_station_id", (id) => stationLabels.get(id) ?? id),
    } as Record<ColFilterKey, CFOption[]>;
  }, [
    records,
    fuelTypeLabels,
    factoryLabels,
    supplierLabels,
    cgLabels,
    buyerLabels,
    forwarderLabels,
    stationLabels,
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Реестр отгрузки</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Добавить</Button>
          <Button size="sm" variant="outline" onClick={() => window.location.href = "/import"}><Upload className="mr-1.5 h-3.5 w-3.5" />Импорт</Button>
          <DropdownMenu>
            {/* DropdownMenuTrigger не поддерживает asChild в этой
                версии типов, поэтому воспроизводим стили sm outline
                Button один в один (h-7, gap-1, px-2.5, размер svg
                3.5), чтобы визуально сесть в ряд с «Добавить» /
                «Импорт». */}
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center whitespace-nowrap gap-1 h-7 rounded-md border border-stone-200 bg-white px-2.5 text-[0.8rem] shadow-xs hover:bg-stone-50 transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              disabled={exporting}
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? "Выгрузка…" : "Excel"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => handleExportExcel("full")} disabled={exporting}>
                <div className="flex flex-col">
                  <span className="font-medium">Полная выгрузка</span>
                  <span className="text-[11px] text-stone-500">Все колонки в порядке экрана</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportExcel("pts")} disabled={exporting}>
                <div className="flex flex-col">
                  <span className="font-medium">PTS</span>
                  <span className="text-[11px] text-stone-500">Формат для экспедитора PTC</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex gap-1 border-b border-stone-200">
        {tabs.map((t) => {
          // Same palette + underline pattern as /deals.
          const isActive = tab === t.key;
          const bg =
            t.key === "kg"
              ? isActive
                ? "bg-emerald-800 text-white font-semibold"
                : "bg-emerald-700 text-emerald-50 hover:bg-emerald-800"
              : isActive
                ? "bg-blue-800 text-white font-semibold"
                : "bg-blue-700 text-blue-50 hover:bg-blue-800";
          const underline = isActive
            ? "border-b-4 border-amber-500"
            : "border-b-2 border-transparent";
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-[13px] font-medium ${bg} ${underline}`}
            >
              {t.label}
            </button>
          );
        })}
        <span className="ml-auto self-center text-[11px] text-stone-400">
          {filteredRecords.length}{activeFilterCount > 0 ? ` из ${records.length}` : ""} записей | {groups.length} сделок
        </span>
      </div>

      {/* Header filters — narrow the visible shipments by forwarder /
          deal / company group / month of shipment + substring search
          by вагон / накладная. Tab (KG/KZ) is already a separate axis.
          Dropdowns are cmdk-backed so long lists stay navigable; the
          two text inputs filter via case-insensitive includes.
          The «месяц отгрузки» (shipment_month) filter is the primary
          axis the operator narrows by — added 2026-06-18 per client
          request. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        <SearchableSelect
          value={forwarderFilter} onChange={setForwarderFilter}
          options={fwOpts}
          placeholder="Все экспедиторы" searchPlaceholder="Поиск экспедитора…"
          triggerClassName="h-9 rounded-lg text-[12px]"
        />
        <SearchableSelect
          value={dealFilter} onChange={setDealFilter}
          options={dealOpts.map((o) => ({ value: o.id, label: o.label }))}
          placeholder="Все сделки" searchPlaceholder="Поиск сделки…"
          triggerClassName="h-9 rounded-lg text-[12px]"
        />
        <SearchableSelect
          value={companyGroupFilter} onChange={setCompanyGroupFilter}
          options={cgOpts}
          placeholder="Все группы компаний" searchPlaceholder="Поиск группы…"
          triggerClassName="h-9 rounded-lg text-[12px]"
        />
        <SearchableSelect
          value={shipmentMonthFilter} onChange={setShipmentMonthFilter}
          options={monthOpts}
          placeholder="Все месяцы отгр." searchPlaceholder="Поиск месяца…"
          triggerClassName="h-9 rounded-lg text-[12px]"
        />
        <Input
          value={wagonFilter}
          onChange={(e) => setWagonFilter(e.target.value)}
          placeholder="№ вагона…"
          className="h-9 text-[12px] font-mono"
        />
        <Input
          value={waybillFilter}
          onChange={(e) => setWaybillFilter(e.target.value)}
          placeholder="№ ЖД накладной…"
          className="h-9 text-[12px] font-mono"
        />
        {activeFilterCount > 0 && (
          <Button size="sm" variant="ghost" onClick={clearRegistryFilters} className="h-7 text-[11px] text-stone-500 hover:text-red-600 justify-self-start">
            <X className="h-3 w-3 mr-0.5" />
            Сбросить ({activeFilterCount})
          </Button>
        )}
      </div>

      {/* Bulk-action bar — shows when at least one shipment is checked.
          Sticky at the top of the viewport so it stays accessible while
          scrolling through long groups. */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2 border-b border-amber-200 bg-amber-50/95 backdrop-blur flex items-center gap-3">
          <span className="text-[12px] text-amber-900 font-medium">
            Выбрано: {selected.size}
          </span>
          <Button size="sm" variant="destructive" onClick={handleBulkDelete} className="h-7 text-[11px]">
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Удалить
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())} className="h-7 text-[11px]">
            Снять выделение
          </Button>
        </div>
      )}

      {showRegistryLoader && groups.length === 0 ? <p className="text-sm text-muted-foreground">Загрузка...</p>
      : !loading && groups.length === 0 ? (
        // Differentiate truly-empty registry from filter-empty registry.
        // Operator 2026-06-25: returning from /deals → /registry could
        // land on «Реестр пуст» even though 8000+ rows were loaded,
        // because the URL-persisted filter had no matches. Now we show
        // the real reason + a one-click reset.
        records.length === 0 ? (
          <div className="rounded-md border border-stone-200 bg-white py-12 text-center"><Truck className="h-8 w-8 text-stone-300 mx-auto mb-2" /><p className="text-sm text-stone-500">Реестр {tab.toUpperCase()} пуст</p></div>
        ) : (
          <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
            <Filter className="h-8 w-8 text-stone-300 mx-auto mb-2" />
            <p className="text-sm text-stone-500">Ни одна из {records.length} записей не подошла под фильтры</p>
            {activeFilterCount > 0 && (
              <Button size="sm" variant="outline" onClick={clearRegistryFilters} className="mt-3 h-7 text-[11px]">
                <X className="h-3 w-3 mr-1" /> Сбросить фильтры ({activeFilterCount})
              </Button>
            )}
          </div>
        )
      )
      : <div className="space-y-2">
          {groups.map((g) => {
            const open = expanded.has(g.key);
            return (
              <div key={g.key} className="rounded-lg border border-stone-200 bg-white overflow-hidden">
                {/* role="button" instead of <button> so we can nest a
                    <Link> for the deal code (invalid as a child of
                    <button>). Keyboard accessibility preserved via
                    tabIndex + onKeyDown. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(g.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(g.key);
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-stone-50 transition-colors text-left cursor-pointer"
                >
                  <ChevronDown className={`h-3.5 w-3.5 text-stone-400 transition-transform shrink-0 ${open ? "" : "-rotate-90"}`} />
                  {g.dealId ? (
                    <Link
                      href={`/deals/${g.dealId}`}
                      onClick={(e) => {
                        // Don't toggle the group when the link is clicked.
                        e.stopPropagation();
                        // Background tab on ⌘/Ctrl-click; default = open
                        // and switch. Right-click / middle-click stay
                        // browser-native so «open in new window» works.
                        if (e.button !== 0) return;
                        const placeholderTitle = `Сделка ${g.dealCode}`;
                        if (e.metaKey || e.ctrlKey) {
                          e.preventDefault();
                          openTab(`/deals/${g.dealId}`, { background: true, title: placeholderTitle });
                          return;
                        }
                        e.preventDefault();
                        openTab(`/deals/${g.dealId}`, { title: placeholderTitle });
                      }}
                      onAuxClick={(e) => {
                        if (e.button === 1) {
                          e.preventDefault();
                          e.stopPropagation();
                          openTab(`/deals/${g.dealId}`, { background: true, title: `Сделка ${g.dealCode}` });
                        }
                      }}
                      className="font-mono text-[12px] font-bold text-amber-700 underline decoration-amber-300 hover:decoration-amber-600 hover:text-amber-900 transition-colors"
                    >
                      {g.dealCode}
                    </Link>
                  ) : (
                    <span className="font-mono text-[12px] font-bold text-amber-700">{g.dealCode}</span>
                  )}
                  {/* Компактный header группы — клиент 2026-07-08 просил
                      явно подписать что есть что. Каждое поле идёт с
                      маленьким лейблом в stone-300 и значением в
                      stone-700; разделитель — «·» stone-300. */}
                  <span className="text-[11px] text-stone-500 font-medium">{g.month}</span>
                  <span className="text-stone-300 text-[10px]">·</span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-stone-700"><span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: g.fuelColor }} />{g.fuelType}</span>
                  {g.factory ? <>
                    <span className="text-stone-300 text-[10px]">·</span>
                    <span className="text-[10px]"><span className="text-stone-400">Завод: </span><span className="text-stone-700">{g.factory}</span></span>
                  </> : null}
                  {(g.supplier || g.buyer) ? <>
                    <span className="text-stone-300 text-[10px]">·</span>
                    <span className="text-[10px]"><span className="text-stone-400">Пост.: </span><span className="text-stone-700">{g.supplier || "—"}</span></span>
                    <span className="text-stone-300 text-[10px]">→</span>
                    <span className="text-[10px]"><span className="text-stone-400">Покуп.: </span><span className="text-stone-700">{g.buyer || "—"}</span></span>
                  </> : null}
                  {g.forwarder ? <>
                    <span className="text-stone-300 text-[10px]">·</span>
                    <span className="text-[10px]"><span className="text-stone-400">Эксп.: </span><span className="text-stone-700">{g.forwarder}</span></span>
                  </> : null}
                  {(() => {
                    const chain = g.dealId ? (dealChains.get(g.dealId) ?? []).filter(Boolean) : [];
                    if (chain.length === 0) return null;
                    return (
                      <>
                        <span className="text-stone-300 text-[10px]">·</span>
                        <span className="text-[10px] truncate max-w-[320px]" title={`Цепочка групп компании: ${chain.join(" → ")}`}>
                          <span className="text-stone-400">Цепочка: </span><span className="text-stone-700">{chain.join(" → ")}</span>
                        </span>
                      </>
                    );
                  })()}
                  <span className="ml-auto flex items-center gap-3 shrink-0">
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{g.records.length} шт</span>
                    <span className="font-mono text-[11px] tabular-nums font-medium">{fmtVol(g.totalVol)} т</span>
                    {(() => {
                      const cs = new Set(g.records.map((r) => r.currency ?? r.deal?.logistics_currency ?? r.deal?.currency ?? (tab === "kg" ? "USD" : "KZT")));
                      const gcur = cs.size === 1 ? CURRENCY_SYMBOLS[[...cs][0]] ?? [...cs][0] : "смеш.";
                      return <span className="font-mono text-[11px] tabular-nums text-stone-500">{fmtMoney(g.totalAmt)} {gcur}</span>;
                    })()}
                  </span>
                </div>
                {open && (
                  <div className="border-t border-stone-200">
                    {/* DoubleScrollX добавляет верхнюю полосу прокрутки
                        над таблицей + нижнюю под ней. Клиент 2026-07-07:
                        не хочет мотать до низа таблицы за скроллбаром.
                        Локальная прокрутка тут же означает: sticky
                        column headers работают в рамках одной карточки
                        группы (когда таблица уже своя scroll-контекст),
                        а не относительно всего <main>. Для 6-строчных
                        таблиц из скрина это визуально то же самое. */}
                    <DoubleScrollX>
                      <table className="w-max border-collapse" style={{ fontSize: "11px" }}>
                        {/* Sticky header band — anchors to whichever
                            scroll ancestor exists. С DoubleScrollX
                            вокруг таблицы горизонтальный скролл теперь
                            локальный (bottomRef), поэтому вертикальный
                            sticky относится к нему же; для коротких
                            групп это визуально то же самое, что и до. */}
                        <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-stone-100"><tr className="bg-stone-100 border-b text-stone-500">
                          <th className="border-r px-2 py-1 w-[28px] text-center">
                            <input
                              type="checkbox"
                              checked={g.records.length > 0 && g.records.every((r) => selected.has(r.id))}
                              ref={(el) => {
                                if (!el) return;
                                const some = g.records.some((r) => selected.has(r.id));
                                const all  = g.records.every((r) => selected.has(r.id));
                                el.indeterminate = some && !all;
                              }}
                              onChange={() => toggleSelectGroup(g)}
                              title="Выделить все в группе"
                              className="h-3 w-3 cursor-pointer"
                            />
                          </th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[60px]">№ сделки</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[70px]">
                            <span className="inline-flex items-center gap-1">
                              мес. доп
                              <ColumnFilterPopover
                                colKey="additional_month"
                                options={columnFilterOpts.additional_month}
                                currentValue={columnFilters.additional_month ?? ""}
                                onChange={(v) => setColumnFilter("additional_month", v)}
                              />
                            </span>
                          </th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[75px]">
                            <span className="inline-flex items-center gap-1">
                              мес. отгр.
                              <ColumnFilterPopover
                                colKey="shipment_month"
                                options={columnFilterOpts.shipment_month}
                                currentValue={columnFilters.shipment_month ?? ""}
                                onChange={(v) => setColumnFilter("shipment_month", v)}
                              />
                            </span>
                          </th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">
                            <span className="inline-flex items-center gap-1">
                              ГСМ
                              <ColumnFilterPopover
                                colKey="fuel_type_id"
                                options={columnFilterOpts.fuel_type_id}
                                currentValue={columnFilters.fuel_type_id ?? ""}
                                onChange={(v) => setColumnFilter("fuel_type_id", v)}
                              />
                            </span>
                          </th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">
                            <span className="inline-flex items-center gap-1">
                              завод
                              <ColumnFilterPopover
                                colKey="factory_id"
                                options={columnFilterOpts.factory_id}
                                currentValue={columnFilters.factory_id ?? ""}
                                onChange={(v) => setColumnFilter("factory_id", v)}
                              />
                            </span>
                          </th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[110px]">
                            <span className="inline-flex items-center gap-1">
                              поставщик
                              <ColumnFilterPopover
                                colKey="supplier_id"
                                options={columnFilterOpts.supplier_id}
                                currentValue={columnFilters.supplier_id ?? ""}
                                onChange={(v) => setColumnFilter("supplier_id", v)}
                              />
                            </span>
                          </th>
                          <th className="border-r px-2 py-1 text-right font-medium min-w-[55px]" title="loading_volume — supplier-side. Operator 2026-06-26: Входящее СНТ = поставщик (SUM(loading_volume) = supplier_shipped_volume per 00044).">Входящее СНТ</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[110px]">
                            <span className="inline-flex items-center gap-1">
                              Плательщик ж/д тарифа
                              <ColumnFilterPopover
                                colKey="company_group_id"
                                options={columnFilterOpts.company_group_id}
                                currentValue={columnFilters.company_group_id ?? ""}
                                onChange={(v) => setColumnFilter("company_group_id", v)}
                              />
                            </span>
                          </th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[110px]">
                            <span className="inline-flex items-center gap-1">
                              покупатель
                              <ColumnFilterPopover
                                colKey="buyer_id"
                                options={columnFilterOpts.buyer_id}
                                currentValue={columnFilters.buyer_id ?? ""}
                                onChange={(v) => setColumnFilter("buyer_id", v)}
                              />
                            </span>
                          </th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[100px]">
                            <span className="inline-flex items-center gap-1">
                              экспедитор
                              <ColumnFilterPopover
                                colKey="forwarder_id"
                                options={columnFilterOpts.forwarder_id}
                                currentValue={columnFilters.forwarder_id ?? ""}
                                onChange={(v) => setColumnFilter("forwarder_id", v)}
                              />
                            </span>
                          </th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">№ вагона</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[90px]">№ ЖД накл.</th>
                          <th className="border-r px-2 py-1 text-right font-medium min-w-[55px]" title="shipment_volume — buyer-side. Operator 2026-06-26: Исходящее СНТ = покупатель (SUM(shipment_volume) = buyer_shipped_volume per 00044).">Исходящее СНТ</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[80px]">дата отгр.</th>
                          <th className="border-r px-2 py-1 text-right font-medium min-w-[70px]" title="Тариф логистов (railway_tariff). Умножается на округл. базу → «Сумма».">Тариф (логисты)</th>
                          <th className="border-r px-2 py-1 text-right font-medium min-w-[70px]">округл</th>
                          <th className="border-r px-2 py-1 text-right font-medium min-w-[65px]">сумма</th>
                          {tab === "kz" && (
                            <th className="border-r px-2 py-1 text-right font-medium min-w-[80px]" title="Тариф менеджера (manager_tariff, только KZ). Умножается на округл. базу → «Сумма грузоотправителя».">Тариф (менеджер)</th>
                          )}
                          <th className="border-r px-2 py-1 text-right font-medium min-w-[90px]" title="Сумма грузоотправителя. Если в сделке включена галочка «Грузоотправитель в цене» — плюсуется к балансу поставщика.">Сумма грузоотправителя</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[70px]">
                            <span className="inline-flex items-center gap-1">
                              валюта
                              <ColumnFilterPopover
                                colKey="currency"
                                options={columnFilterOpts.currency}
                                currentValue={columnFilters.currency ?? ""}
                                onChange={(v) => setColumnFilter("currency", v)}
                              />
                            </span>
                          </th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[90px]">
                            <span className="inline-flex items-center gap-1">
                              ст. назн.
                              <ColumnFilterPopover
                                colKey="destination_station_id"
                                options={columnFilterOpts.destination_station_id}
                                currentValue={columnFilters.destination_station_id ?? ""}
                                onChange={(v) => setColumnFilter("destination_station_id", v)}
                              />
                            </span>
                          </th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[90px]">
                            <span className="inline-flex items-center gap-1">
                              ст. отпр.
                              <ColumnFilterPopover
                                colKey="departure_station_id"
                                options={columnFilterOpts.departure_station_id}
                                currentValue={columnFilters.departure_station_id ?? ""}
                                onChange={(v) => setColumnFilter("departure_station_id", v)}
                              />
                            </span>
                          </th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[90px]">прил.</th>
                          <th className="border-r px-2 py-1 text-left font-medium min-w-[100px]">№ СФ</th>
                          <th className="px-2 py-1 text-left font-medium min-w-[130px]">коммент.</th>
                          <th className="px-1 py-1 w-[25px]"></th>
                        </tr></thead>
                        <tbody>
                          {g.records.map((r) => {
                            // Fuel-type tint per row (operator request
                            // 2026-06-23: «цветовая гамма должна быть
                            // ещё в реестре»). Selection highlight
                            // (amber-50/60) wins over the tint —
                            // selection is the operator's intent so
                            // they need it clearly visible. Hover stays
                            // amber too for the same reason.
                            const fuel = r.fuel_type_id ? fuelTypeLabels.get(r.fuel_type_id) : null;
                            const rowBg = hexToRgba(fuel?.color, 0.12);
                            const rowBgHover = hexToRgba(fuel?.color, 0.22);
                            const isSelected = selected.has(r.id);
                            return (
                            <tr
                              key={r.id}
                              style={isSelected ? undefined : { "--row-bg": rowBg, "--row-bg-hover": rowBgHover } as React.CSSProperties}
                              className={`border-b border-stone-100 ${
                                isSelected
                                  ? "bg-amber-50/60 hover:bg-amber-50/80"
                                  : "bg-[var(--row-bg)] hover:bg-[var(--row-bg-hover)]"
                              }`}
                            >
                              <td className="border-r px-1 py-0.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={selected.has(r.id)}
                                  onChange={() => toggleSelect(r.id)}
                                  className="h-3 w-3 cursor-pointer"
                                />
                              </td>
                              <td className="border-r px-2 py-0.5 font-mono text-amber-700 text-[10px]">{r.deal?.deal_code ?? ""}</td>
                              {/* мес. доп defaults to the parent deal's month —
                                  operator request: this column IS the deal's
                                  month unless explicitly overridden. The
                                  override is still written into the row's
                                  own additional_month field on edit. */}
                              <td className="border-r px-1 py-0.5"><EM value={r.additional_month ?? r.deal?.month ?? null} recId={r.id} field="additional_month" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><EM value={r.shipment_month} recId={r.id} field="shipment_month" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.fuel_type_id} displayLabel={(r.fuel_type_id && fuelTypeLabels.get(r.fuel_type_id)?.name) || ""} recId={r.id} field="fuel_type_id" options={ftOpts} onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.factory_id} displayLabel={(r.factory_id && factoryLabels.get(r.factory_id)) || ""} recId={r.id} field="factory_id" options={factoryOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.supplier_id} displayLabel={(r.supplier_id && supplierLabels.get(r.supplier_id)) || ""} recId={r.id} field="supplier_id" options={supplierOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><EN value={r.loading_volume} recId={r.id} field="loading_volume" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.company_group_id} displayLabel={(r.company_group_id && cgLabels.get(r.company_group_id)) || ""} recId={r.id} field="company_group_id" options={cgOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.buyer_id} displayLabel={(r.buyer_id && buyerLabels.get(r.buyer_id)) || ""} recId={r.id} field="buyer_id" options={buyerOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.forwarder_id} displayLabel={(r.forwarder_id && forwarderLabels.get(r.forwarder_id)) || ""} recId={r.id} field="forwarder_id" options={fwOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><EC value={r.wagon_number} recId={r.id} field="wagon_number" onSaved={reload} cls="font-mono" /></td>
                              <td className="border-r px-1 py-0.5"><EC value={r.waybill_number} recId={r.id} field="waybill_number" onSaved={reload} cls="font-mono" /></td>
                              <td className="border-r px-1 py-0.5"><EN value={r.shipment_volume} recId={r.id} field="shipment_volume" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><ED value={r.date} recId={r.id} field="date" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5"><EN value={r.railway_tariff} recId={r.id} field="railway_tariff" overrideField="railway_tariff_override" overridden={r.railway_tariff_override} onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5">
                                <ERound
                                  rawVolume={r.registry_type === "KZ" ? r.loading_volume : r.shipment_volume}
                                  override={r.rounded_volume_override}
                                  roundVolume={r.round_volume}
                                  recId={r.id}
                                  onSaved={reload}
                                />
                              </td>
                              <td className="border-r px-1 py-0.5">
                                <EAmount
                                  value={r.shipped_tonnage_amount}
                                  override={r.shipped_tonnage_amount_override}
                                  recId={r.id}
                                  onSaved={reload}
                                  suffix={currencyFor(r, tab)}
                                />
                              </td>
                              {tab === "kz" && (
                                <td className="border-r px-1 py-0.5"><EN value={r.manager_tariff} recId={r.id} field="manager_tariff" onSaved={reload} /></td>
                              )}
                              <td className="border-r px-1 py-0.5"><EN value={r.additional_expenses} recId={r.id} field="additional_expenses" onSaved={reload} /></td>
                              <td className="border-r px-1 py-0.5">
                                <ES
                                  value={r.currency}
                                  displayLabel={r.currency ?? `${r.deal?.logistics_currency ?? r.deal?.currency ?? ""} (сделка)`}
                                  recId={r.id}
                                  field="currency"
                                  options={CURRENCIES}
                                  onSaved={reload}
                                />
                              </td>
                              <td className="border-r px-1 py-0.5"><ES value={r.destination_station_id} displayLabel={(r.destination_station_id && stationLabels.get(r.destination_station_id)) || ""} recId={r.id} field="destination_station_id" options={stOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5"><ES value={r.departure_station_id} displayLabel={(r.departure_station_id && stationLabels.get(r.departure_station_id)) || ""} recId={r.id} field="departure_station_id" options={stOpts} onSaved={reload} className="text-stone-500" /></td>
                              <td className="border-r px-1 py-0.5">
                                {/* Прил. — supplier-side label; buyer-side
                                    appears as a subscript when it differs.
                                    Inline edit hits supplier_appendix only;
                                    buyer side edits via the add dialog. */}
                                <div className="flex flex-col">
                                  <EC value={r.supplier_appendix} recId={r.id} field="supplier_appendix" onSaved={reload} cls="text-[10px]" />
                                  {r.buyer_appendix && r.buyer_appendix !== r.supplier_appendix && (
                                    <span className="text-[9px] text-stone-400 px-1" title="Приложение покупателя">
                                      пк: {r.buyer_appendix}
                                    </span>
                                  )}
                                </div>
                              </td>
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
                          );
                          })}
                          {addingIn === g.key && (
                            <InlineAdd dealId={g.dealId} group={g} regType={tab === "kg" ? "KG" : "KZ"} onDone={() => { reload(); setAddingIn(null); }} onCancel={() => setAddingIn(null)} />
                          )}
                        </tbody>
                      </table>
                    </DoubleScrollX>
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
      <AddDialog
        open={showAdd}
        onClose={() => { setShowAdd(false); setAddMinimized(false); }}
        regType={tab === "kg" ? "KG" : "KZ"}
        onDone={() => { reload(); setAddMinimized(false); }}
        minimized={addMinimized}
        onMinimize={() => setAddMinimized(true)}
      />
      {showAdd && addMinimized && (
        <div className="fixed bottom-4 right-4 z-50">
          <button
            type="button"
            onClick={() => setAddMinimized(false)}
            className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-[12px] font-medium text-white shadow-lg hover:bg-amber-600 transition-colors"
            title="Развернуть форму новой записи"
          >
            <Plus className="h-3.5 w-3.5" />
            Новая запись в реестр {tab === "kg" ? "KG" : "KZ"} — свёрнута
          </button>
        </div>
      )}

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

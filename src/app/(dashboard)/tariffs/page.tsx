"use client";

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  createContext,
  useContext,
  memo,
} from "react";
import { Plus, Filter, Trash2, X, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";
import { useGlobalRefs } from "@/lib/refs";
import type { TablesUpdate } from "@/lib/types/database";
import { ImportTariffsDialog } from "@/components/tariffs/import-dialog";

type Station = { id: string; name: string };
type Forwarder = { id: string; name: string };
type FuelType = { id: string; name: string; color?: string };
type Factory = { id: string; name: string };

// Tariff rows now carry only their FK ids — joined name embeds were
// dropped from the SELECT. All displayable labels (station / forwarder
// / fuel type / factory names) resolve through the global refs cache
// via the label Maps built in TariffsPage. Cuts payload by ~5
// sub-selects per row and matches the PassportTable pattern.
type Tariff = {
  id: string;
  destination_station_id: string | null;
  departure_station_id: string | null;
  forwarder_id: string | null;
  fuel_type_id: string | null;
  month: string | null;
  year: number | null;
  planned_tariff: number | null;
  factory_id: string | null;
  norm_days: number | null;
};

const MONTHS_RU_FULL = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <Label className="text-[12px] text-stone-500">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
      >
        <option value="">Выберите...</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function AddTariffDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [stations, setStations] = useState<Station[]>([]);
  const [forwarders, setForwarders] = useState<Forwarder[]>([]);
  const [fuelTypes, setFuelTypes] = useState<FuelType[]>([]);
  const [factories, setFactories] = useState<Factory[]>([]);
  const [saving, setSaving] = useState(false);

  const [destStationId, setDestStationId] = useState("");
  const [depStationId, setDepStationId] = useState("");
  const [forwarderId, setForwarderId] = useState("");
  const [fuelTypeId, setFuelTypeId] = useState("");
  const [month, setMonth] = useState(MONTHS_RU_FULL[new Date().getMonth()]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [tariffAmount, setTariffAmount] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [normDays, setNormDays] = useState("");

  useEffect(() => {
    if (!open) return;
    const sb = createClient();
    // Add-dialog still needs default_factory_id which isn't in the
    // global refs cache, so keep this targeted fetch as-is.
    Promise.all([
      sb.from("stations").select("id, name, default_factory_id").eq("is_active", true).order("name"),
      sb.from("forwarders").select("id, name").eq("is_active", true).order("name"),
      sb.from("fuel_types").select("id, name, color").eq("is_active", true).order("sort_order"),
      sb.from("factories").select("id, name").order("name"),
    ]).then(([st, fw, ft, fa]) => {
      setStations((st.data ?? []) as (Station & { default_factory_id?: string | null })[]);
      setForwarders((fw.data ?? []) as Forwarder[]);
      setFuelTypes((ft.data ?? []) as FuelType[]);
      setFactories((fa.data ?? []) as Factory[]);
    });
  }, [open]);

  // Auto-fill factory from departure station
  useEffect(() => {
    if (!depStationId) return;
    const station = stations.find((s) => s.id === depStationId) as (Station & { default_factory_id?: string | null }) | undefined;
    if (station?.default_factory_id && !factoryId) {
      setFactoryId(station.default_factory_id);
    }
  }, [depStationId, stations, factoryId]);

  async function handleSave() {
    if (!tariffAmount) {
      toast.error("Укажите тариф");
      return;
    }
    if (!month) {
      toast.error("Укажите месяц");
      return;
    }
    if (!year) {
      toast.error("Укажите год");
      return;
    }
    setSaving(true);
    const sb = createClient();
    const { error } = await sb.from("tariffs").insert({
      destination_station_id: destStationId || null,
      departure_station_id: depStationId || null,
      forwarder_id: forwarderId || null,
      fuel_type_id: fuelTypeId || null,
      month,
      year: parseInt(year),
      planned_tariff: tariffAmount ? parseFloat(tariffAmount) : null,
      factory_id: factoryId || null,
      norm_days: normDays ? parseFloat(normDays) : null,
    });
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
    } else {
      toast.success("Тариф добавлен");
      onCreated();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Добавить тариф</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField
            label="Ст. назначения"
            value={destStationId}
            onChange={setDestStationId}
            options={stations.map((s) => ({ value: s.id, label: s.name }))}
          />
          <SelectField
            label="Ст. отправления"
            value={depStationId}
            onChange={setDepStationId}
            options={stations.map((s) => ({ value: s.id, label: s.name }))}
          />
          <SelectField
            label="Экспедитор"
            value={forwarderId}
            onChange={setForwarderId}
            options={forwarders.map((f) => ({ value: f.id, label: f.name }))}
          />
          <SelectField
            label="Груз"
            value={fuelTypeId}
            onChange={setFuelTypeId}
            options={fuelTypes.map((f) => ({ value: f.id, label: f.name }))}
          />
          <div>
            <Label className="text-[12px] text-stone-500">Месяц</Label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
            >
              {MONTHS_RU_FULL.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Год</Label>
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="h-8 text-[13px] font-mono"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">
              Ставка, USD/тонна без НДС <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              step="0.01"
              value={tariffAmount}
              onChange={(e) => setTariffAmount(e.target.value)}
              className="h-8 text-[13px] font-mono"
              placeholder="0.00"
            />
          </div>
          <SelectField
            label="Завод"
            value={factoryId}
            onChange={setFactoryId}
            options={factories.map((f) => ({ value: f.id, label: f.name }))}
          />
          <div>
            <Label className="text-[12px] text-stone-500">Норм. суток</Label>
            <Input
              type="number"
              step="0.5"
              value={normDays}
              onChange={(e) => setNormDays(e.target.value)}
              className="h-8 text-[13px] font-mono"
              placeholder="0"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
          >
            {saving ? "Сохранение..." : "Добавить тариф"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Inline editable cells for tariff table
function InlineSelect({ value, displayLabel, options, onSave }: {
  value: string | null | undefined; displayLabel: string;
  options: { value: string; label: string }[];
  onSave: (v: string | null) => Promise<void>;
}) {
  const [ed, setEd] = useState(false);
  if (!ed) return (
    <button onClick={() => setEd(true)} className="w-full text-left text-[12px] hover:bg-amber-50 rounded px-1 py-0.5 cursor-pointer truncate">
      {displayLabel || "—"}
    </button>
  );
  return (
    <select
      autoFocus defaultValue={value ?? ""} onBlur={() => setEd(false)}
      onChange={(e) => { const nv = e.target.value || null; setEd(false); onSave(nv); }}
      className="w-full h-7 text-[12px] border border-amber-300 rounded px-1 bg-amber-50/50 focus:outline-none cursor-pointer"
    >
      <option value="">—</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
function InlineNum({ value, onSave, d = 3 }: { value: number | null | undefined; onSave: (v: number | null) => Promise<void>; d?: number }) {
  const [ed, setEd] = useState(false);
  const [lv, setLv] = useState("");
  if (!ed) return (
    <button onClick={() => { setLv(value == null ? "" : String(value)); setEd(true); }}
      className="w-full text-right font-mono text-[11px] tabular-nums hover:bg-amber-50 rounded px-1 py-0.5 cursor-text">
      {value == null ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: d })}
    </button>
  );
  return (
    <input autoFocus type="number" step="0.001" value={lv}
      onChange={(e) => setLv(e.target.value)}
      onBlur={() => { setEd(false); const n = lv.trim() === "" ? null : parseFloat(lv.replace(",", ".")); if (n !== value) onSave(Number.isFinite(n as number) ? n : null); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }}
      className="w-full text-right font-mono text-[11px] border border-amber-300 rounded px-1 bg-amber-50/50 focus:outline-none" />
  );
}

// ─────────────────────────────────────────────────────────────────────
//  TariffRefsContext
//
//  Read-only lookup data (option arrays + label maps) shared by every
//  row. Rows pull from it via useContext so the only React.memo-
//  relevant prop a row receives is `tariff` (+ the stable callbacks
//  from the parent). When `updateTariff` swaps a single tariff in the
//  list, only that row's `tariff` reference changes; the rest of the
//  array's references stay equal and React.memo bails them out.
// ─────────────────────────────────────────────────────────────────────

type Opt = { value: string; label: string };

type TariffRefsValue = {
  stationOpts: Opt[];
  forwarderOpts: Opt[];
  fuelOpts: Opt[];
  factoryOpts: Opt[];
  monthOpts: Opt[];
  stationLabels: Map<string, string>;
  forwarderLabels: Map<string, string>;
  fuelLabels: Map<string, string>;
  factoryLabels: Map<string, string>;
};

const TariffRefsContext = createContext<TariffRefsValue | null>(null);

function useTariffRefs(): TariffRefsValue {
  const ctx = useContext(TariffRefsContext);
  if (!ctx) throw new Error("TariffRow must be rendered inside <TariffRefsContext>");
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────
//  TariffRow
//
//  React.memo'd so re-renders only happen when this row's `tariff` ref
//  changes (or the stable callbacks). All ref/label data flows through
//  context, so it doesn't participate in the memo comparison. With
//  ~270 tariffs in view today and room to grow, this lets the
//  virtualizer cheaply mount/unmount only the visible window without
//  re-rendering off-screen rows.
// ─────────────────────────────────────────────────────────────────────

type TariffRowProps = {
  t: Tariff;
  onUpdate: (id: string, patch: TablesUpdate<"tariffs">) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

const TariffRow = memo(function TariffRow({ t, onUpdate, onDelete }: TariffRowProps) {
  const {
    stationOpts,
    forwarderOpts,
    fuelOpts,
    factoryOpts,
    monthOpts,
    stationLabels,
    forwarderLabels,
    fuelLabels,
    factoryLabels,
  } = useTariffRefs();

  return (
    <tr className="border-b hover:bg-amber-50/30">
      <td className="text-[12px] text-stone-700 px-2 py-1 align-middle">
        <InlineSelect
          value={t.destination_station_id}
          displayLabel={(t.destination_station_id && stationLabels.get(t.destination_station_id)) || ""}
          options={stationOpts}
          onSave={(v) => onUpdate(t.id, { destination_station_id: v })}
        />
      </td>
      <td className="text-[12px] text-stone-700 px-2 py-1 align-middle">
        <InlineSelect
          value={t.departure_station_id}
          displayLabel={(t.departure_station_id && stationLabels.get(t.departure_station_id)) || ""}
          options={stationOpts}
          onSave={(v) => onUpdate(t.id, { departure_station_id: v })}
        />
      </td>
      <td className="text-[12px] text-stone-600 px-2 py-1 align-middle">
        <InlineSelect
          value={t.forwarder_id}
          displayLabel={(t.forwarder_id && forwarderLabels.get(t.forwarder_id)) || ""}
          options={forwarderOpts}
          onSave={(v) => onUpdate(t.id, { forwarder_id: v })}
        />
      </td>
      <td className="text-[12px] px-2 py-1 align-middle">
        <InlineSelect
          value={t.fuel_type_id}
          displayLabel={(t.fuel_type_id && fuelLabels.get(t.fuel_type_id)) || ""}
          options={fuelOpts}
          onSave={(v) => onUpdate(t.id, { fuel_type_id: v })}
        />
      </td>
      <td className="text-[12px] text-stone-600 px-2 py-1 align-middle">
        <InlineSelect
          value={t.month}
          displayLabel={t.month ?? ""}
          options={monthOpts}
          onSave={(v) => onUpdate(t.id, { month: v ?? undefined })}
        />
      </td>
      <td className="text-right px-2 py-1 align-middle">
        <InlineNum value={t.planned_tariff} onSave={(v) => onUpdate(t.id, { planned_tariff: v })} />
      </td>
      <td className="text-[12px] text-stone-600 px-2 py-1 align-middle">
        <InlineSelect
          value={t.factory_id}
          displayLabel={(t.factory_id && factoryLabels.get(t.factory_id)) || ""}
          options={factoryOpts}
          onSave={(v) => onUpdate(t.id, { factory_id: v })}
        />
      </td>
      <td className="text-right px-2 py-1 align-middle">
        <InlineNum value={t.norm_days} onSave={(v) => onUpdate(t.id, { norm_days: v })} d={0} />
      </td>
      <td className="px-2 py-1 align-middle">
        <button
          onClick={() => onDelete(t.id)}
          className="rounded p-0.5 text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </td>
    </tr>
  );
});

// ─────────────────────────────────────────────────────────────────────
//  Skeleton row (warm reload only)
//
//  The route boundary (loading.tsx → PageSkeleton) covers cold paint.
//  These rows show during a warm reload (filter change, mutation
//  refetch) so the table chrome doesn't blank out under a spinner.
//  Matches the 9-column geometry so column widths don't jump when
//  real rows arrive.
// ─────────────────────────────────────────────────────────────────────

const TOTAL_COLS = 9;

function TariffSkeletonRow() {
  return (
    <tr className="border-b animate-pulse">
      {Array.from({ length: TOTAL_COLS }).map((_, i) => (
        <td key={i} className="px-2 py-1.5">
          <div className="h-3 rounded-sm bg-stone-100" />
        </td>
      ))}
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  VirtualizedRows
//
//  Renders only the rows currently visible in the scroll container
//  (+ overscan). Reserves the unrendered range with two spacer <tr>s
//  carrying explicit heights so the <table> preserves its column
//  widths (which cascade from <thead>) and avoids layout shift on
//  scroll. Pattern lifted from PassportTable.
// ─────────────────────────────────────────────────────────────────────

type VirtualizerInstance = ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;

function VirtualizedRows({
  tariffs,
  virtualizer,
  onUpdate,
  onDelete,
}: {
  tariffs: Tariff[];
  virtualizer: VirtualizerInstance;
  onUpdate: (id: string, patch: TablesUpdate<"tariffs">) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <>
      {paddingTop > 0 && (
        <tr aria-hidden style={{ height: paddingTop }}>
          <td colSpan={TOTAL_COLS} />
        </tr>
      )}
      {virtualItems.map((vi) => {
        const t = tariffs[vi.index];
        if (!t) return null;
        return (
          <TariffRow
            key={t.id}
            t={t}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        );
      })}
      {paddingBottom > 0 && (
        <tr aria-hidden style={{ height: paddingBottom }}>
          <td colSpan={TOTAL_COLS} />
        </tr>
      )}
    </>
  );
}

export default function TariffsPage() {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Per-column filters. Each holds the selected id (or month name for month).
  const [destFilter, setDestFilter] = useState("");
  const [depFilter, setDepFilter] = useState("");
  const [forwarderFilter, setForwarderFilter] = useState("");
  const [fuelFilter, setFuelFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [factoryFilter, setFactoryFilter] = useState("");

  // Refs come from the global cache — same data, zero per-mount round
  // trips. Stations / forwarders / fuel types / factories are exactly
  // what InlineSelect dropdowns + label resolvers need.
  const { refs: g } = useGlobalRefs();

  async function updateTariff(id: string, patch: TablesUpdate<"tariffs">) {
    const sb = createClient();
    const { error } = await sb.from("tariffs").update(patch).eq("id", id);
    if (error) { toast.error(`Ошибка: ${error.message}`); return; }
    await loadTariffs();
  }

  async function loadTariffs() {
    setLoading(true);
    const sb = createClient();
    // Paginate — a single year can easily exceed PostgREST's
    // Max-Rows=1000 across all (forwarder × route × fuel × month)
    // combinations, especially as fuel types and forwarders grow.
    //
    // Joined name embeds (destination_station / departure_station /
    // forwarder / fuel_type / factory) were dropped — those 5 sub-
    // selects per row were ~270×5 extra projections per refetch. All
    // names resolve client-side from the global refs cache via the
    // label Maps in this component.
    const { data, error } = await fetchAllPaginated((from, to) =>
      sb
        .from("tariffs")
        .select(
          `id,
           destination_station_id,
           departure_station_id,
           forwarder_id,
           fuel_type_id,
           month,
           year,
           planned_tariff,
           factory_id,
           norm_days`
        )
        .eq("year", yearFilter)
        .order("month")
        .order("planned_tariff")
        .range(from, to),
    );

    setLoading(false);
    if (error) {
      toast.error("Ошибка загрузки тарифов");
      return;
    }
    setTariffs(data as unknown as Tariff[]);
  }

  useEffect(() => {
    loadTariffs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearFilter]);

  const filtered = useMemo(() => tariffs.filter((t) => {
    if (destFilter      && t.destination_station_id !== destFilter)      return false;
    if (depFilter       && t.departure_station_id   !== depFilter)       return false;
    if (forwarderFilter && t.forwarder_id           !== forwarderFilter) return false;
    if (fuelFilter      && t.fuel_type_id           !== fuelFilter)      return false;
    if (monthFilter     && t.month                  !== monthFilter)     return false;
    if (factoryFilter   && t.factory_id             !== factoryFilter)   return false;
    return true;
  }), [tariffs, destFilter, depFilter, forwarderFilter, fuelFilter, monthFilter, factoryFilter]);

  // Option arrays + label maps built once from the global refs cache.
  // O(1) lookups per row instead of joined-row reads. The Map values
  // are stable as long as the underlying ref arrays are — refs change
  // rarely (first load + manual reloads from /spravochnik), so per-
  // row context reads don't churn on filter keystrokes.
  const stationOpts = useMemo(
    () => g.stations.map((s) => ({ value: s.id, label: s.name })),
    [g.stations],
  );
  const forwarderOpts = useMemo(
    () => g.forwarders.map((f) => ({ value: f.id, label: f.name })),
    [g.forwarders],
  );
  const fuelOpts = useMemo(
    () => g.fuelTypes.map((f) => ({ value: f.id, label: f.name })),
    [g.fuelTypes],
  );
  const factoryOpts = useMemo(
    () => g.factories.map((f) => ({ value: f.id, label: f.name })),
    [g.factories],
  );
  const monthOpts = useMemo(
    () => MONTHS_RU_FULL.map((m) => ({ value: m, label: m })),
    [],
  );
  const stationLabels = useMemo(
    () => new Map(g.stations.map((s) => [s.id, s.name])),
    [g.stations],
  );
  const forwarderLabels = useMemo(
    () => new Map(g.forwarders.map((f) => [f.id, f.name])),
    [g.forwarders],
  );
  const fuelLabels = useMemo(
    () => new Map(g.fuelTypes.map((f) => [f.id, f.name])),
    [g.fuelTypes],
  );
  const factoryLabels = useMemo(
    () => new Map(g.factories.map((f) => [f.id, f.name])),
    [g.factories],
  );

  const refsContextValue = useMemo<TariffRefsValue>(() => ({
    stationOpts,
    forwarderOpts,
    fuelOpts,
    factoryOpts,
    monthOpts,
    stationLabels,
    forwarderLabels,
    fuelLabels,
    factoryLabels,
  }), [
    stationOpts, forwarderOpts, fuelOpts, factoryOpts, monthOpts,
    stationLabels, forwarderLabels, fuelLabels, factoryLabels,
  ]);

  // Virtualization: 270 tariffs × 9 cells today is borderline (~2.4k
  // <td>s), but the table grows linearly with active forwarders ×
  // routes × fuel types × months. Render only rows visible in the
  // scroll container (+ overscan); two phantom <tr>s with explicit
  // heights reserve the rest so the table layout stays intact.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    // Row geometry is ~32 px (text-[12px] + px-2 py-1). The virtual-
    // izer re-measures real rows post-mount, so this only needs to
    // be close; overscan=8 absorbs any slop on initial scroll.
    estimateSize: () => 32,
    overscan: 8,
  });

  // Stable delete callback — wraps confirm + delete so TariffRow can
  // receive a single function reference that doesn't churn on every
  // parent render (keeps React.memo effective for off-screen rows).
  async function deleteTariff(id: string) {
    if (!confirm("Удалить тариф?")) return;
    const sb = createClient();
    const { error } = await sb.from("tariffs").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Удалено");
      loadTariffs();
    }
  }

  const activeFilterCount =
    (destFilter ? 1 : 0) + (depFilter ? 1 : 0) + (forwarderFilter ? 1 : 0)
    + (fuelFilter ? 1 : 0) + (monthFilter ? 1 : 0) + (factoryFilter ? 1 : 0);
  function clearFilters() {
    setDestFilter(""); setDepFilter(""); setForwarderFilter("");
    setFuelFilter(""); setMonthFilter(""); setFactoryFilter("");
  }

  const isColdLoad = loading && tariffs.length === 0;

  return (
    // flex/h-full mirrors /deals — the table's scroll container needs
    // a bounded height to virtualize. The page itself doesn't scroll;
    // the table does, and the sticky <thead> sticks against the
    // table's own scroll context.
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Тарифы</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowImport(true)}
          >
            <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
            Импорт из Excel
          </Button>
          <Button
            size="sm"
            className="bg-amber-500 hover:bg-amber-600 text-white"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Добавить тариф
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-stone-400" />
          <span className="text-[12px] text-stone-500">Год:</span>
          <Input
            type="number"
            value={yearFilter}
            onChange={(e) => setYearFilter(Number(e.target.value))}
            className="w-20 h-7 text-[12px]"
          />
        </div>
        {activeFilterCount > 0 && (
          <Button size="sm" variant="ghost" onClick={clearFilters} className="h-7 text-[11px] text-stone-500 hover:text-red-600">
            <X className="h-3 w-3 mr-0.5" />
            Сбросить ({activeFilterCount})
          </Button>
        )}
        <span className="text-[11px] text-stone-400 ml-auto">
          {filtered.length}{activeFilterCount > 0 ? ` из ${tariffs.length}` : ""} тарифов
        </span>
      </div>

      {/* Per-column filters. Все searchable — длинные списки станций
          / экспедиторов остаются навигируемыми через поиск внутри. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        <SearchableSelect
          value={destFilter} onChange={setDestFilter}
          options={stationOpts}
          placeholder="Все ст. назначения" searchPlaceholder="Поиск станции…"
        />
        <SearchableSelect
          value={depFilter} onChange={setDepFilter}
          options={stationOpts}
          placeholder="Все ст. отправления" searchPlaceholder="Поиск станции…"
        />
        <SearchableSelect
          value={forwarderFilter} onChange={setForwarderFilter}
          options={forwarderOpts}
          placeholder="Все экспедиторы" searchPlaceholder="Поиск экспедитора…"
        />
        <SearchableSelect
          value={fuelFilter} onChange={setFuelFilter}
          options={fuelOpts}
          placeholder="Все грузы" searchPlaceholder="Поиск груза…"
        />
        <SearchableSelect
          value={monthFilter} onChange={setMonthFilter}
          options={monthOpts}
          placeholder="Все месяцы" searchPlaceholder="Поиск месяца…"
        />
        <SearchableSelect
          value={factoryFilter} onChange={setFactoryFilter}
          options={factoryOpts}
          placeholder="Все заводы" searchPlaceholder="Поиск завода…"
        />
      </div>

      {/* Empty states (not cold-load) — keep showing the message when
          the fetch finished and there's truly nothing. Cold-load
          falls through to the skeleton branch. */}
      {!loading && tariffs.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
          <p className="text-sm text-stone-500">Нет тарифов за {yearFilter} год</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => setShowAdd(true)}
            >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Добавить первый тариф
          </Button>
        </div>
      ) : !loading && filtered.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
          <p className="text-sm text-stone-500">Под фильтры ничего не подошло</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={clearFilters}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Сбросить фильтры
          </Button>
        </div>
      ) : (
        <TariffRefsContext.Provider value={refsContextValue}>
          {/* The scroll container owns the virtualizer's height. The
              sticky <thead> sticks against this container's top
              edge — that's why we use a raw <table> here (the shadcn
              <Table> wrapper adds its own overflow-x-auto div which
              breaks per-cell sticky positioning).

              flex-1 min-h-0 lets the container take all remaining
              vertical space from the page's flex column without
              overflowing the parent <main>. */}
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-auto rounded-md border border-stone-200 bg-white"
          >
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-stone-50 border-b">
                  <th className="sticky top-0 z-20 bg-stone-50 h-9 px-2 text-left align-middle font-medium text-stone-600 text-[11px] whitespace-nowrap">Ст. назначения</th>
                  <th className="sticky top-0 z-20 bg-stone-50 h-9 px-2 text-left align-middle font-medium text-stone-600 text-[11px] whitespace-nowrap">Ст. отправления</th>
                  <th className="sticky top-0 z-20 bg-stone-50 h-9 px-2 text-left align-middle font-medium text-stone-600 text-[11px] whitespace-nowrap">Экспедитор</th>
                  <th className="sticky top-0 z-20 bg-stone-50 h-9 px-2 text-left align-middle font-medium text-stone-600 text-[11px] whitespace-nowrap">Груз</th>
                  <th className="sticky top-0 z-20 bg-stone-50 h-9 px-2 text-left align-middle font-medium text-stone-600 text-[11px] whitespace-nowrap">Месяц</th>
                  <th className="sticky top-0 z-20 bg-stone-50 h-9 px-2 text-right align-middle font-medium text-stone-600 text-[11px] whitespace-nowrap">Ставка, USD/тонна без НДС</th>
                  <th className="sticky top-0 z-20 bg-stone-50 h-9 px-2 text-left align-middle font-medium text-stone-600 text-[11px] whitespace-nowrap">Завод</th>
                  <th className="sticky top-0 z-20 bg-stone-50 h-9 px-2 text-right align-middle font-medium text-stone-600 text-[11px] whitespace-nowrap">Норм. суток</th>
                  <th className="sticky top-0 z-20 bg-stone-50 h-9 w-[30px]"></th>
                </tr>
              </thead>
              <tbody>
                {isColdLoad ? (
                  Array.from({ length: 10 }).map((_, i) => <TariffSkeletonRow key={`sk-${i}`} />)
                ) : (
                  <VirtualizedRows
                    tariffs={filtered}
                    virtualizer={rowVirtualizer}
                    onUpdate={updateTariff}
                    onDelete={deleteTariff}
                  />
                )}
              </tbody>
            </table>
          </div>
        </TariffRefsContext.Provider>
      )}

      <AddTariffDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={loadTariffs}
      />

      <ImportTariffsDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={loadTariffs}
        refs={{
          stations: g.stations,
          forwarders: g.forwarders,
          fuelTypes: g.fuelTypes,
        }}
      />
    </div>
  );
}

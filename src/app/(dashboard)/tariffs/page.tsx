"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Filter, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";

type Station = { id: string; name: string };
type Forwarder = { id: string; name: string };
type FuelType = { id: string; name: string; color?: string };
type Factory = { id: string; name: string };

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
  destination_station?: { name: string } | null;
  departure_station?: { name: string } | null;
  forwarder?: { name: string } | null;
  fuel_type?: { name: string; color?: string } | null;
  factory?: { name: string } | null;
};

const MONTHS_RU_SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

const MONTHS_RU_FULL = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function formatNum(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

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
  const supabase = createClient();
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
    setSaving(true);
    const sb = createClient();
    const { error } = await sb.from("tariffs").insert({
      destination_station_id: destStationId || null,
      departure_station_id: depStationId || null,
      forwarder_id: forwarderId || null,
      fuel_type_id: fuelTypeId || null,
      month: month || null,
      year: year ? parseInt(year) : null,
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
            label="Товар (ГСМ)"
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
              Тариф <span className="text-destructive">*</span>
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

export default function TariffsPage() {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [showAdd, setShowAdd] = useState(false);

  async function loadTariffs() {
    setLoading(true);
    const sb = createClient();
    const { data, error } = await sb
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
         norm_days,
         destination_station:stations!destination_station_id(name),
         departure_station:stations!departure_station_id(name),
         forwarder:forwarders(name),
         fuel_type:fuel_types(name, color),
         factory:factories(name)`
      )
      .eq("year", yearFilter)
      .order("month")
      .order("planned_tariff");

    setLoading(false);
    if (error) {
      toast.error("Ошибка загрузки тарифов");
      return;
    }
    setTariffs((data ?? []) as unknown as Tariff[]);
  }

  useEffect(() => {
    loadTariffs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Тарифы</h1>
        <Button
          size="sm"
          className="bg-amber-500 hover:bg-amber-600 text-white"
          onClick={() => setShowAdd(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Добавить тариф
        </Button>
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
        <span className="text-[11px] text-stone-400 ml-auto">
          {tariffs.length} тарифов
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : tariffs.length === 0 ? (
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
      ) : (
        <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50">
                <TableHead className="text-[11px]">Ст. назначения</TableHead>
                <TableHead className="text-[11px]">Ст. отправления</TableHead>
                <TableHead className="text-[11px]">Экспедитор</TableHead>
                <TableHead className="text-[11px]">Товар (ГСМ)</TableHead>
                <TableHead className="text-[11px]">Месяц</TableHead>
                <TableHead className="text-right text-[11px]">Тариф</TableHead>
                <TableHead className="text-[11px]">Завод</TableHead>
                <TableHead className="text-right text-[11px]">Норм. суток</TableHead>
                <TableHead className="w-[30px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tariffs.map((t) => (
                <TableRow key={t.id} className="hover:bg-amber-50/30">
                  <TableCell className="text-[12px] text-stone-700">
                    {(t.destination_station as any)?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-700">
                    {(t.departure_station as any)?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-600">
                    {(t.forwarder as any)?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px]">
                    {(t.fuel_type as any) ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: (t.fuel_type as any).color ?? "#6B7280" }}
                        />
                        {(t.fuel_type as any).name}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-600">
                    {t.month ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums text-stone-800">
                    {formatNum(t.planned_tariff)}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-600">
                    {(t.factory as any)?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums text-stone-600">
                    {t.norm_days != null ? formatNum(t.norm_days) : "—"}
                  </TableCell>
                  <TableCell>
                    <button onClick={async () => {
                      if (!confirm("Удалить тариф?")) return;
                      const s = createClient();
                      const { error } = await s.from("tariffs").delete().eq("id", t.id);
                      if (error) toast.error(error.message); else { toast.success("Удалено"); loadTariffs(); }
                    }} className="rounded p-0.5 text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddTariffDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={loadTariffs}
      />
    </div>
  );
}

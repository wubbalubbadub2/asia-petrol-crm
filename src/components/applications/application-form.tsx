"use client";

/**
 * Поля заявки — одни на «Новую заявку» и «Редактировать заявку».
 *
 * Клиент 2026-10-09: вид ГСМ и % серы → автоматом три кода (ЕТСНГ, ГНГ,
 * ТН ВЭД); станция назначения фильтром → код станции; грузополучатель
 * фильтром → БИН; перевозчик фильтром; ответственный — текущий
 * сотрудник; сделка фильтром; плюс станция отправления и
 * грузоотправитель. Всё подставленное остаётся правимым.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createClient } from "@/lib/supabase/client";
import { sortByName } from "@/lib/sort-names";
import { toast } from "sonner";
import type { TablesInsert } from "@/lib/types/database";
import type { Application } from "@/lib/hooks/use-applications";
import { defaultManagerId, stationCodeOnPick } from "@/lib/application-autofill";
import {
  applicationCargoCodes, codeOnPick, consignorOnStation, productLabel,
  sulfurKey, sulfurOptions, type FuelCodeRef, type FuelRef,
} from "@/lib/applications/cargo";

type StationRef = { id: string; name: string; code: string | null; default_factory_id: string | null };
type NamedRef = { id: string; name: string };
type ConsigneeRef = { id: string; name: string; bin_iin: string | null };
type ProfileRef = { id: string; full_name: string };

export type ApplicationRefs = {
  fuels: FuelRef[];
  fuelCodes: FuelCodeRef[];
  stations: StationRef[];
  factories: NamedRef[];
  consignees: ConsigneeRef[];
  carriers: NamedRef[];
  managers: ProfileRef[];
  loaded: boolean;
};

const EMPTY_REFS: ApplicationRefs = {
  fuels: [], fuelCodes: [], stations: [], factories: [], consignees: [], carriers: [], managers: [], loaded: false,
};

/** Справочники формы — грузятся, пока диалог открыт. */
export function useApplicationRefs(open: boolean): ApplicationRefs {
  const [refs, setRefs] = useState<ApplicationRefs>(EMPTY_REFS);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Как в use-transport-refs: fuel_type_codes (00182) и transport_carriers
    // нет в сгенерированных типах — имя таблицы строкой.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any;
    const from = (t: string) => sb.from(t);
    Promise.all([
      from("fuel_types").select("id, name, etsng_code").eq("is_active", true).order("sort_order"),
      from("fuel_type_codes").select("fuel_type_id, sulfur_percent, gng_code, tnved_code"),
      from("stations").select("id, name, code, default_factory_id").eq("is_active", true).order("name"),
      from("factories").select("id, name").eq("is_active", true).order("name"),
      from("consignees").select("id, name, bin_iin").eq("is_active", true).order("name"),
      from("transport_carriers").select("id, name").eq("is_active", true).order("name"),
      from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    ]).then(([ft, fc, st, fa, co, ca, m]) => {
      if (cancelled) return;
      const bad = [ft, fc, st, fa, co, ca, m].find((r: { error: { message: string } | null }) => r.error);
      if (bad?.error) toast.error(`Не удалось загрузить справочники: ${bad.error.message}`);
      setRefs({
        // Виды ГСМ — в порядке справочника (sort_order), как и раньше.
        fuels: ((ft.data ?? []) as unknown) as FuelRef[],
        fuelCodes: ((fc.data ?? []) as unknown) as FuelCodeRef[],
        stations: sortByName(((st.data ?? []) as unknown) as StationRef[], (r) => r.name),
        factories: sortByName((fa.data ?? []) as NamedRef[], (r) => r.name),
        consignees: sortByName((co.data ?? []) as ConsigneeRef[], (r) => r.name),
        carriers: sortByName((ca.data ?? []) as NamedRef[], (r) => r.name),
        managers: sortByName((m.data ?? []) as ProfileRef[], (r) => r.full_name),
        loaded: true,
      });
    });
    return () => { cancelled = true; };
  }, [open]);
  return refs;
}

export type ApplicationFormValues = {
  appNumber: string;
  date: string;
  fuelTypeId: string;
  /** Ключ серы для select — `sulfurKey(число)`; «» — не указана. */
  sulfur: string;
  tonnage: string;
  etsng: string;
  gng: string;
  tnved: string;
  departureStationId: string;
  consignorFactoryId: string;
  consignor: string;
  stationId: string;
  stationCode: string;
  consigneeId: string;
  consigneeName: string;
  consigneeBin: string;
  carrierId: string;
  carrier: string;
  /** null — ещё не выбирали: подставляется текущий сотрудник. */
  managerId: string | null;
  sourceEmail: string;
};

export function emptyApplicationValues(): ApplicationFormValues {
  return {
    appNumber: "", date: new Date().toISOString().split("T")[0], fuelTypeId: "", sulfur: "", tonnage: "",
    etsng: "", gng: "", tnved: "", departureStationId: "", consignorFactoryId: "", consignor: "",
    stationId: "", stationCode: "", consigneeId: "", consigneeName: "", consigneeBin: "",
    carrierId: "", carrier: "", managerId: null, sourceEmail: "",
  };
}

export function valuesFromApplication(a: Application): ApplicationFormValues {
  return {
    appNumber: a.application_number ?? "",
    date: a.date ? a.date.split("T")[0] : "",
    fuelTypeId: a.fuel_type_id ?? "",
    sulfur: sulfurKey(a.sulfur_percent),
    tonnage: a.tonnage != null ? String(a.tonnage) : "",
    etsng: a.etsng_code ?? "",
    gng: a.gng_code ?? "",
    tnved: a.tnved_code ?? "",
    departureStationId: a.departure_station_id ?? "",
    consignorFactoryId: a.consignor_factory_id ?? "",
    consignor: a.consignor ?? "",
    stationId: a.destination_station_id ?? "",
    stationCode: a.station_code ?? "",
    consigneeId: a.consignee_id ?? "",
    consigneeName: a.consignee_name ?? "",
    consigneeBin: a.consignee_bin ?? "",
    carrierId: a.carrier_id ?? "",
    carrier: a.carrier ?? "",
    managerId: a.assigned_manager_id ?? "",
    sourceEmail: a.source_email ?? "",
  };
}

const sulfurNumber = (key: string): number | null => (key.trim() === "" ? null : Number(key.replace(",", ".")));

/** Ответственный менеджер: выбранный, а пока не выбирали — текущий сотрудник. */
export function resolvedManagerId(values: ApplicationFormValues, currentUserId: string | undefined, refs: ApplicationRefs): string {
  return values.managerId ?? defaultManagerId(currentUserId, refs.managers);
}

/** Строка для insert/update. «Продукт» собирается из вида ГСМ и серы. */
export function applicationPayload(
  values: ApplicationFormValues,
  refs: ApplicationRefs,
  managerId: string,
): Omit<TablesInsert<"applications">, "date"> & { date: string } {
  const sulfur = sulfurNumber(values.sulfur);
  const fuelName = refs.fuels.find((f) => f.id === values.fuelTypeId)?.name ?? null;
  return {
    application_number: values.appNumber || null,
    date: values.date,
    fuel_type_id: values.fuelTypeId || null,
    sulfur_percent: sulfur != null && Number.isFinite(sulfur) ? sulfur : null,
    product_name: productLabel(fuelName, sulfur) || null,
    tonnage: values.tonnage ? parseFloat(values.tonnage) : null,
    etsng_code: values.etsng.trim() || null,
    gng_code: values.gng.trim() || null,
    tnved_code: values.tnved.trim() || null,
    departure_station_id: values.departureStationId || null,
    consignor_factory_id: values.consignorFactoryId || null,
    consignor: values.consignor.trim() || null,
    destination_station_id: values.stationId || null,
    station_code: values.stationCode.trim() || null,
    consignee_id: values.consigneeId || null,
    consignee_name: values.consigneeName.trim() || null,
    consignee_bin: values.consigneeBin.trim() || null,
    carrier_id: values.carrierId || null,
    carrier: values.carrier.trim() || null,
    assigned_manager_id: managerId || null,
    source_email: values.sourceEmail.trim() || null,
  };
}

const NONE = { value: "", label: "—" };
const field = "h-8 text-[13px]";
const selectCls = "w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer";

export function ApplicationForm({
  values, onChange, refs, currentUserId, children,
}: {
  values: ApplicationFormValues;
  onChange: (next: ApplicationFormValues) => void;
  refs: ApplicationRefs;
  /** Текущий сотрудник — для «Ответственного менеджера» по умолчанию. */
  currentUserId?: string;
  /** Поля в конце формы (сделка, файл) — только у «Новой заявки». */
  children?: React.ReactNode;
}) {
  const set = (patch: Partial<ApplicationFormValues>) => onChange({ ...values, ...patch });

  /** Коды по виду и сере поверх текущих; пустой код из справочника ничего не трёт. */
  function withCodes(v: ApplicationFormValues): ApplicationFormValues {
    const c = applicationCargoCodes(refs.fuels, refs.fuelCodes, v.fuelTypeId, sulfurNumber(v.sulfur));
    return { ...v, etsng: codeOnPick(v.etsng, c.etsng), gng: codeOnPick(v.gng, c.gng), tnved: codeOnPick(v.tnved, c.tnved) };
  }

  function pickFuel(id: string) {
    const options = sulfurOptions(refs.fuelCodes, id).map(sulfurKey);
    // Сера другого вида не подходит — сбрасываем, если её нет у нового вида.
    const sulfur = options.includes(values.sulfur) ? values.sulfur : "";
    onChange(withCodes({ ...values, fuelTypeId: id, sulfur }));
  }
  function pickSulfur(key: string) { onChange(withCodes({ ...values, sulfur: key })); }

  function pickDeparture(id: string) {
    const st = refs.stations.find((s) => s.id === id);
    const factoryId = consignorOnStation(values.consignorFactoryId, st?.default_factory_id);
    const factoryName = refs.factories.find((f) => f.id === factoryId)?.name;
    set({ departureStationId: id, consignorFactoryId: factoryId, consignor: factoryId !== values.consignorFactoryId && factoryName ? factoryName : values.consignor });
  }
  function pickConsignor(id: string) {
    const name = refs.factories.find((f) => f.id === id)?.name ?? "";
    set({ consignorFactoryId: id, consignor: id ? name : values.consignor });
  }
  function pickDestination(id: string) {
    const code = refs.stations.find((s) => s.id === id)?.code;
    set({ stationId: id, stationCode: stationCodeOnPick(values.stationCode, code) });
  }
  function pickConsignee(id: string) {
    const c = refs.consignees.find((x) => x.id === id);
    if (!c) { set({ consigneeId: "" }); return; }
    set({ consigneeId: id, consigneeName: c.name, consigneeBin: codeOnPick(values.consigneeBin, (c.bin_iin ?? "").trim()) });
  }
  function pickCarrier(id: string) {
    const name = refs.carriers.find((x) => x.id === id)?.name ?? "";
    set({ carrierId: id, carrier: id ? name : values.carrier });
  }

  const sulfurOpts = sulfurOptions(refs.fuelCodes, values.fuelTypeId).map(sulfurKey);
  // Сохранённая сера, которой нет в справочнике, — тоже в списке, иначе
  // поле показало бы «—» при непустом значении.
  const sulfurList = values.sulfur !== "" && !sulfurOpts.includes(values.sulfur) ? [values.sulfur, ...sulfurOpts] : sulfurOpts;
  const managerId = resolvedManagerId(values, currentUserId, refs);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label className="text-[12px] text-stone-500">№ заявки</Label>
        <Input value={values.appNumber} onChange={(e) => set({ appNumber: e.target.value })} placeholder="239" className={field} />
      </div>
      <div>
        <Label className="text-[12px] text-stone-500">Дата</Label>
        <Input type="date" value={values.date} onChange={(e) => set({ date: e.target.value })} className={field} />
      </div>

      <div>
        <Label className="text-[12px] text-stone-500">Вид ГСМ</Label>
        <SearchableSelect
          options={[NONE, ...refs.fuels.map((f) => ({ value: f.id, label: f.name }))]}
          value={values.fuelTypeId}
          onChange={pickFuel}
          placeholder="Выберите..."
          searchPlaceholder="Вид ГСМ"
          triggerClassName={field}
        />
      </div>
      <div>
        <Label className="text-[12px] text-stone-500">% серы</Label>
        {sulfurList.length > 0 ? (
          <select value={values.sulfur} onChange={(e) => pickSulfur(e.target.value)} className={selectCls}>
            <option value="">—</option>
            {sulfurList.map((k) => <option key={k} value={k}>{k.replace(".", ",")} %</option>)}
          </select>
        ) : (
          <Input
            inputMode="decimal"
            value={values.sulfur}
            onChange={(e) => pickSulfur(e.target.value)}
            placeholder={values.fuelTypeId ? "в «Кодах по видам ГСМ» нет строк — введите" : "сначала вид ГСМ"}
            className={`${field} font-mono`}
          />
        )}
      </div>

      <div>
        <Label className="text-[12px] text-stone-500">Тоннаж</Label>
        <Input type="number" step="0.01" value={values.tonnage} onChange={(e) => set({ tonnage: e.target.value })} className={`${field} font-mono`} />
      </div>
      <div>
        <Label className="text-[12px] text-stone-500">Код ЕТСНГ</Label>
        <Input value={values.etsng} onChange={(e) => set({ etsng: e.target.value })} placeholder="из «Видов ГСМ»" className={`${field} font-mono`} />
      </div>
      <div>
        <Label className="text-[12px] text-stone-500">Код ГНГ</Label>
        <Input value={values.gng} onChange={(e) => set({ gng: e.target.value })} placeholder="из «Кодов по видам ГСМ»" className={`${field} font-mono`} />
      </div>
      <div>
        <Label className="text-[12px] text-stone-500">Код ТН ВЭД</Label>
        <Input value={values.tnved} onChange={(e) => set({ tnved: e.target.value })} placeholder="из «Кодов по видам ГСМ»" className={`${field} font-mono`} />
      </div>

      <div>
        <Label className="text-[12px] text-stone-500">Станция отправления</Label>
        <SearchableSelect
          options={[NONE, ...refs.stations.map((s) => ({ value: s.id, label: s.name }))]}
          value={values.departureStationId}
          onChange={pickDeparture}
          placeholder="Выберите..."
          searchPlaceholder="Станция"
          triggerClassName={field}
        />
      </div>
      <div>
        <Label className="text-[12px] text-stone-500">Грузоотправитель</Label>
        <SearchableSelect
          options={[NONE, ...refs.factories.map((f) => ({ value: f.id, label: f.name }))]}
          value={values.consignorFactoryId}
          onChange={pickConsignor}
          placeholder="Выберите..."
          searchPlaceholder="Грузоотправитель"
          triggerClassName={field}
        />
      </div>

      <div>
        <Label className="text-[12px] text-stone-500">Станция назначения</Label>
        <SearchableSelect
          options={[NONE, ...refs.stations.map((s) => ({ value: s.id, label: s.name }))]}
          value={values.stationId}
          onChange={pickDestination}
          placeholder="Выберите..."
          searchPlaceholder="Станция"
          triggerClassName={field}
        />
      </div>
      <div>
        <Label className="text-[12px] text-stone-500">Код станции</Label>
        <Input value={values.stationCode} onChange={(e) => set({ stationCode: e.target.value })} placeholder="700204" className={`${field} font-mono`} />
      </div>

      <div>
        <Label className="text-[12px] text-stone-500">Грузополучатель</Label>
        <SearchableSelect
          options={[NONE, ...refs.consignees.map((c) => ({ value: c.id, label: c.name }))]}
          value={values.consigneeId}
          onChange={pickConsignee}
          placeholder={values.consigneeName || "Выберите..."}
          searchPlaceholder="Грузополучатель"
          emptyMessage="Нет в справочнике «Грузополучатели»"
          triggerClassName={field}
        />
        {refs.loaded && refs.consignees.length === 0 && (
          <p className="text-[10px] text-stone-400 mt-0.5">
            Справочник пуст — <Link href="/spravochnik/consignees" className="underline">заполнить «Грузополучатели»</Link>
          </p>
        )}
      </div>
      <div>
        <Label className="text-[12px] text-stone-500">БИН грузополучателя</Label>
        <Input value={values.consigneeBin} onChange={(e) => set({ consigneeBin: e.target.value })} placeholder="из справочника" className={`${field} font-mono`} />
      </div>

      <div>
        <Label className="text-[12px] text-stone-500">Перевозчик</Label>
        <SearchableSelect
          options={[NONE, ...refs.carriers.map((c) => ({ value: c.id, label: c.name }))]}
          value={values.carrierId}
          onChange={pickCarrier}
          placeholder={values.carrier || "Выберите..."}
          searchPlaceholder="Перевозчик"
          emptyMessage="Нет в справочнике «Перевозчики ЖД»"
          triggerClassName={field}
        />
        {refs.loaded && refs.carriers.length === 0 && (
          <p className="text-[10px] text-stone-400 mt-0.5">
            Справочник пуст — <Link href="/spravochnik/carriers" className="underline">заполнить «Перевозчики ЖД»</Link>
          </p>
        )}
      </div>
      <div>
        <Label className="text-[12px] text-stone-500">Ответственный менеджер</Label>
        <SearchableSelect
          options={[NONE, ...refs.managers.map((m) => ({ value: m.id, label: m.full_name }))]}
          value={managerId}
          onChange={(v) => set({ managerId: v })}
          placeholder="Выберите..."
          searchPlaceholder="Сотрудник"
          triggerClassName={field}
        />
      </div>

      {children}

      <div className="col-span-2">
        <Label className="text-[12px] text-stone-500">Email источника</Label>
        <Input value={values.sourceEmail} onChange={(e) => set({ sourceEmail: e.target.value })} placeholder="buyer@company.com" className={field} />
      </div>
    </div>
  );
}

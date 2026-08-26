"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import {
  useTransportRefs,
  printedRoute,
  type TransportRefs,
} from "@/lib/hooks/use-transport-refs";

/**
 * Форма заявки на перевозку.
 *
 * ГЛАВНОЕ ТРЕБОВАНИЕ ТЗ: «пользователь не набирает каждый раз всю заявку
 * вручную, а выбирает данные из списков и меняет только количество,
 * дату, период перевозки и другие переменные поля». Поэтому при выборе
 * компании форма заполняется значениями ЕЁ ПОСЛЕДНЕЙ заявки — маршрут,
 * грузополучатель, экспедитор и продукт обычно повторяются. Дата всегда
 * сегодняшняя: это дата составления (клиент 25.08).
 *
 * Коды не вводятся руками: код станции показывается из справочника
 * станций, ИНН/код/ОКПО/адрес — из грузополучателя, ЕТСНГ и ГНГ — из
 * ГСМ. В заявке хранится ссылка, а не переписанный текст, поэтому
 * правка справочника не оставляет старых копий.
 *
 * Вагоны считаются как тонны ÷ 60 и правятся вручную (клиент 25.08:
 * «норма всегда 58-60 тонн на вагон, можно брать всегда 60 и дать
 * возможность поменять вручную»). Расчёт только подсказывает: если
 * менеджер поставил своё число, оно больше не перебивается.
 */

/** Норма загрузки на вагон. Клиент 25.08: берём 60, правится вручную. */
export const WAGON_NORM_TONNES = 60;

export function suggestWagons(tonnage: number | null | undefined): number | null {
  if (!tonnage || tonnage <= 0) return null;
  return Math.ceil(tonnage / WAGON_NORM_TONNES);
}

export type RequestFormValues = {
  id?: string;
  date: string;
  company_group_id: string;
  fuel_type_id: string;
  tonnage: string;
  wagons: string;
  cargo_purpose: string;
  destination_station_id: string;
  siding: string;
  carrier_id: string;
  consignee_id: string;
  etsng_code: string;
  gng_code: string;
  special_marks: string;
  consignor_factory_id: string;
  wagon_owner_forwarder_id: string;
  forwarder_kzh_id: string;
  payer_krg_consignee_id: string;
  route_id: string;
  buyer_id: string;
  period_month: string;
  period_year: string;
};

const CARGO_PURPOSES: { value: string; label: string }[] = [
  { value: "export", label: "Экспорт" },
  { value: "import", label: "Импорт" },
  { value: "domestic", label: "Внутренний" },
];

/** Колонки заявки, которые переносятся в новую при копировании. */
export const CARRIED_OVER_COLUMNS = [
  "company_group_id", "fuel_type_id", "tonnage", "wagons", "cargo_purpose",
  "destination_station_id", "siding", "carrier_id", "consignee_id",
  "etsng_code", "gng_code", "special_marks", "consignor_factory_id",
  "wagon_owner_forwarder_id", "forwarder_kzh_id", "payer_krg_consignee_id",
  "route_id", "buyer_id", "period_month", "period_year",
] as const;

const today = () => new Date().toISOString().slice(0, 10);

export function emptyValues(): RequestFormValues {
  return {
    date: today(),
    company_group_id: "", fuel_type_id: "", tonnage: "", wagons: "",
    cargo_purpose: "export", destination_station_id: "", siding: "",
    carrier_id: "", consignee_id: "", etsng_code: "", gng_code: "",
    special_marks: "", consignor_factory_id: "", wagon_owner_forwarder_id: "",
    forwarder_kzh_id: "", payer_krg_consignee_id: "", route_id: "",
    buyer_id: "", period_month: "", period_year: "",
  };
}

/** Строка БД → значения формы. Пустые поля становятся пустыми строками. */
export function valuesFromRow(row: Record<string, unknown>): RequestFormValues {
  const str = (k: string) => {
    const v = row[k];
    return v == null ? "" : String(v);
  };
  return {
    id: str("id") || undefined,
    date: str("date") || today(),
    company_group_id: str("company_group_id"),
    fuel_type_id: str("fuel_type_id"),
    tonnage: str("tonnage"),
    wagons: str("wagons"),
    cargo_purpose: str("cargo_purpose") || "export",
    destination_station_id: str("destination_station_id"),
    siding: str("siding"),
    carrier_id: str("carrier_id"),
    consignee_id: str("consignee_id"),
    etsng_code: str("etsng_code"),
    gng_code: str("gng_code"),
    special_marks: str("special_marks"),
    consignor_factory_id: str("consignor_factory_id"),
    wagon_owner_forwarder_id: str("wagon_owner_forwarder_id"),
    forwarder_kzh_id: str("forwarder_kzh_id"),
    payer_krg_consignee_id: str("payer_krg_consignee_id"),
    route_id: str("route_id"),
    buyer_id: str("buyer_id"),
    period_month: str("period_month"),
    period_year: str("period_year"),
  };
}

/** Значения формы → строка БД. Пустые строки становятся NULL. */
function rowFromValues(v: RequestFormValues) {
  const nul = (s: string) => (s.trim() === "" ? null : s.trim());
  const num = (s: string) => {
    const n = Number(s.replace(",", "."));
    return s.trim() === "" || Number.isNaN(n) ? null : n;
  };
  return {
    date: v.date,
    company_group_id: v.company_group_id,
    fuel_type_id: nul(v.fuel_type_id),
    tonnage: num(v.tonnage),
    wagons: num(v.wagons),
    cargo_purpose: nul(v.cargo_purpose),
    destination_station_id: nul(v.destination_station_id),
    siding: nul(v.siding),
    carrier_id: nul(v.carrier_id),
    consignee_id: nul(v.consignee_id),
    etsng_code: nul(v.etsng_code),
    gng_code: nul(v.gng_code),
    special_marks: nul(v.special_marks),
    consignor_factory_id: nul(v.consignor_factory_id),
    wagon_owner_forwarder_id: nul(v.wagon_owner_forwarder_id),
    forwarder_kzh_id: nul(v.forwarder_kzh_id),
    payer_krg_consignee_id: nul(v.payer_krg_consignee_id),
    route_id: nul(v.route_id),
    buyer_id: nul(v.buyer_id),
    period_month: num(v.period_month),
    period_year: num(v.period_year),
  };
}

const opts = (rows: { id: string; name: string }[]) =>
  rows.map((r) => ({ value: r.id, label: r.name }));

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px]">{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Подставленное из справочника значение — видно, но не редактируется. */
function Derived({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      <div className="flex h-9 items-center rounded-md border border-dashed bg-muted/40 px-3 font-mono text-[12px]">
        {value || <span className="text-muted-foreground">из справочника</span>}
      </div>
    </div>
  );
}

type Props = {
  initial: RequestFormValues;
  /** Существующая заявка — номер показывается в шапке. */
  heading: string;
  /** Подставлять ли данные последней заявки при выборе компании. */
  prefillFromLast: boolean;
};

export function TransportRequestForm({ initial, heading, prefillFromLast }: Props) {
  const router = useRouter();
  const { refs, loading } = useTransportRefs();
  const [v, setV] = useState<RequestFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const sbRef = useRef(createClient());
  // Пока менеджер не тронул поле «Вагонов», оно следует за тоннажем.
  const wagonsTouched = useRef(initial.wagons !== "");

  function set<K extends keyof RequestFormValues>(key: K, value: RequestFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  const fuel = refs.fuels.find((f) => f.id === v.fuel_type_id);
  const station = refs.stations.find((s) => s.id === v.destination_station_id);
  const consignee = refs.consignees.find((c) => c.id === v.consignee_id);
  const route = refs.routes.find((r) => r.id === v.route_id);

  const routeText = useMemo(() => printedRoute(route), [route]);

  /** Продукт задаёт печатное наименование и коды. */
  function pickFuel(id: string) {
    const f = refs.fuels.find((x) => x.id === id);
    setV((prev) => ({
      ...prev,
      fuel_type_id: id,
      etsng_code: f?.etsng_code ?? prev.etsng_code,
      gng_code: f?.gng_code ?? prev.gng_code,
    }));
  }

  /** Оплату по КРГ по умолчанию несёт грузополучатель (клиент 25.08). */
  function pickConsignee(id: string) {
    setV((prev) => ({
      ...prev,
      consignee_id: id,
      payer_krg_consignee_id: prev.payer_krg_consignee_id || id,
    }));
  }

  function pickTonnage(raw: string) {
    setV((prev) => {
      const next = { ...prev, tonnage: raw };
      if (!wagonsTouched.current) {
        const w = suggestWagons(Number(raw.replace(",", ".")));
        next.wagons = w == null ? "" : String(w);
      }
      return next;
    });
  }

  /**
   * Выбор компании подтягивает её последнюю заявку. Это и есть «не
   * набирать каждый раз заново»: у пары «компания + маршрут» почти всё
   * повторяется, меняются количество, дата и период.
   */
  async function pickCompany(id: string) {
    set("company_group_id", id);
    if (!prefillFromLast || !id) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = sbRef.current as any;
    const { data, error } = await sb
      .from("transport_requests")
      .select("*")
      .eq("company_group_id", id)
      .order("date", { ascending: false })
      .order("request_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return;

    const prev = valuesFromRow(data);
    setV((cur) => ({
      ...prev,
      id: undefined,
      // Дата — всегда сегодня: это дата составления заявления.
      date: cur.date,
      company_group_id: id,
    }));
    wagonsTouched.current = true;
    toast.success("Поля заполнены по прошлой заявке этой компании");
  }

  async function persist(status: "draft" | "issued") {
    if (!v.company_group_id) {
      toast.error("Выберите компанию");
      return;
    }
    if (!v.date) {
      toast.error("Укажите дату заявки");
      return;
    }
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = sbRef.current as any;
      const row = { ...rowFromValues(v), status };

      if (v.id) {
        const { error } = await sb.from("transport_requests").update(row).eq("id", v.id);
        if (error) throw error;
        toast.success("Сохранено");
        router.refresh();
      } else {
        const { data, error } = await sb
          .from("transport_requests")
          .insert(row)
          .select("id")
          .single();
        if (error) throw error;
        toast.success("Заявка создана");
        router.replace(`/transport-requests/${data.id}`);
      }
    } catch (e) {
      toast.error(`Не удалось сохранить: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        Загрузка справочников...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{heading}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => persist("draft")} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            Сохранить черновик
          </Button>
          <Button size="sm" onClick={() => persist("issued")} disabled={saving}>
            Сохранить заявку
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Компания и документ ─────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Компания и документ</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Компания"
              hint={prefillFromLast ? "Подставит поля прошлой заявки этой компании" : undefined}
            >
              <SearchableSelect
                options={opts(refs.companies)}
                value={v.company_group_id}
                onChange={pickCompany}
                placeholder="Выберите компанию"
                triggerClassName="w-full"
              />
            </Field>
            <Field label="Дата заявки" hint="Дата составления">
              <Input type="date" value={v.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label="Покупатель">
              <SearchableSelect
                options={opts(refs.buyers)}
                value={v.buyer_id}
                onChange={(val) => set("buyer_id", val)}
                placeholder="Выберите покупателя"
                triggerClassName="w-full"
              />
            </Field>
            <Field label="Назначение груза">
              <SearchableSelect
                options={CARGO_PURPOSES}
                value={v.cargo_purpose}
                onChange={(val) => set("cargo_purpose", val)}
                placeholder="Выберите назначение"
                triggerClassName="w-full"
              />
            </Field>
          </CardContent>
        </Card>

        {/* ── Груз ────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Груз</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Наименование нефтепродукта">
                <SearchableSelect
                  options={opts(refs.fuels)}
                  value={v.fuel_type_id}
                  onChange={pickFuel}
                  placeholder="Выберите продукт"
                  triggerClassName="w-full"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Derived label="В заявке напечатается" value={fuel?.full_name || fuel?.name || ""} />
            </div>
            <Field label="Кол-во, тонн">
              <Input
                inputMode="decimal"
                value={v.tonnage}
                onChange={(e) => pickTonnage(e.target.value)}
                placeholder="455"
              />
            </Field>
            <Field label="Вагонов" hint={`Подсказка: тонны ÷ ${WAGON_NORM_TONNES}`}>
              <Input
                inputMode="numeric"
                value={v.wagons}
                onChange={(e) => {
                  wagonsTouched.current = true;
                  set("wagons", e.target.value);
                }}
                placeholder="7"
              />
            </Field>
            <Field label="Код ЕТСНГ">
              <Input value={v.etsng_code} onChange={(e) => set("etsng_code", e.target.value)} placeholder="221066" />
            </Field>
            <Field label="Код ГНГ">
              <Input value={v.gng_code} onChange={(e) => set("gng_code", e.target.value)} placeholder="27101967" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Особые отметки">
                <Textarea
                  rows={2}
                  value={v.special_marks}
                  onChange={(e) => set("special_marks", e.target.value)}
                  placeholder="Обычно пусто"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* ── Маршрут и станции ───────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Маршрут и станции</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Станция назначения">
              <SearchableSelect
                options={refs.stations.map((s) => ({
                  value: s.id,
                  label: s.code ? `${s.name} (${s.code})` : s.name,
                }))}
                value={v.destination_station_id}
                onChange={(val) => set("destination_station_id", val)}
                placeholder="Выберите станцию"
                triggerClassName="w-full"
              />
            </Field>
            <Derived label="Код станции" value={station?.code ?? ""} />
            <Field label="Тупик">
              <Input value={v.siding} onChange={(e) => set("siding", e.target.value)} placeholder="Обычно пусто" />
            </Field>
            <Field label="Наименование железной дороги">
              <SearchableSelect
                options={opts(refs.carriers)}
                value={v.carrier_id}
                onChange={(val) => set("carrier_id", val)}
                placeholder="Выберите перевозчика"
                triggerClassName="w-full"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Маршрут транспортировки">
                <SearchableSelect
                  options={opts(refs.routes)}
                  value={v.route_id}
                  onChange={(val) => set("route_id", val)}
                  placeholder="Выберите маршрут"
                  triggerClassName="w-full"
                />
              </Field>
            </div>
            {routeText && (
              <div className="sm:col-span-2 rounded border bg-muted/40 px-2.5 py-2">
                <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  В заявке напечатается
                </p>
                <p className="font-mono text-[12px] leading-snug">{routeText}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Участники ───────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Участники перевозки</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Грузополучатель">
                <SearchableSelect
                  options={opts(refs.consignees)}
                  value={v.consignee_id}
                  onChange={pickConsignee}
                  placeholder="Выберите грузополучателя"
                  triggerClassName="w-full"
                />
              </Field>
            </div>
            <Derived label="ИНН / БИН" value={consignee?.bin_iin ?? ""} />
            <Derived label="Код грузополучателя" value={consignee?.code_4 ?? ""} />
            <Derived label="Код ОКПО" value={consignee?.okpo ?? ""} />
            <Derived label="Адрес" value={consignee?.address ?? ""} />
            <Field label="Грузоотправитель">
              <SearchableSelect
                options={opts(refs.factories)}
                value={v.consignor_factory_id}
                onChange={(val) => set("consignor_factory_id", val)}
                placeholder="Выберите завод"
                triggerClassName="w-full"
              />
            </Field>
            <Field label="Принадлежность вагонов">
              <SearchableSelect
                options={opts(refs.forwarders)}
                value={v.wagon_owner_forwarder_id}
                onChange={(val) => set("wagon_owner_forwarder_id", val)}
                placeholder="Выберите экспедитора"
                triggerClassName="w-full"
              />
            </Field>
            <Field label="Оплата по КЗХ">
              <SearchableSelect
                options={opts(refs.forwarders)}
                value={v.forwarder_kzh_id}
                onChange={(val) => set("forwarder_kzh_id", val)}
                placeholder="Выберите экспедитора"
                triggerClassName="w-full"
              />
            </Field>
            <Field label="Оплата по КРГ" hint="По умолчанию — грузополучатель">
              <SearchableSelect
                options={opts(refs.consignees)}
                value={v.payer_krg_consignee_id}
                onChange={(val) => set("payer_krg_consignee_id", val)}
                placeholder="Выберите плательщика"
                triggerClassName="w-full"
              />
            </Field>
          </CardContent>
        </Card>

        {/* ── Период ──────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Период перевозки</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <Field label="Месяц">
              <SearchableSelect
                options={MONTHS_RU.map((m, i) => ({ value: String(i + 1), label: m }))}
                value={v.period_month}
                onChange={(val) => set("period_month", val)}
                placeholder="Выберите месяц"
                triggerClassName="w-full"
              />
            </Field>
            <Field label="Год">
              <Input
                inputMode="numeric"
                value={v.period_year}
                onChange={(e) => set("period_year", e.target.value)}
                placeholder="2026"
              />
            </Field>
            <div className="sm:col-span-2">
              <Derived
                label="В заявке напечатается"
                value={
                  v.period_month && v.period_year
                    ? `${MONTHS_RU[Number(v.period_month) - 1]} ${v.period_year} г.`
                    : ""
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export type { TransportRefs };

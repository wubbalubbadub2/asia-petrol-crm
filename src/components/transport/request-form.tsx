"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, FileDown, Loader2, Plus, Save, Trash2, X } from "lucide-react";
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
  codesForPair,
  type TransportRefs,
} from "@/lib/hooks/use-transport-refs";
import { fillTemplate } from "@/lib/transport/fill-template";
import {
  buildTemplateValues,
  formatPeriod,
  formatRequestDate,
  documentFileName,
  type RequestDocumentInput,
} from "@/lib/transport/request-values";
import {
  downloadTemplate,
  saveRequestFile,
  triggerDownload,
  deleteRequestWithFiles,
} from "@/lib/transport/storage";
import { useRole } from "@/lib/role-context";

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
  /** Последний месяц периода: «Август-сентябрь 2026 г.». Пусто — один месяц. */
  period_month_to: string;
  period_year: string;
  destination_country: string;
  port: string;
  wagon_numbers: string;
};

/** Строка «Оплата по <дорога> …» в ячейке «Экспедитор по ЖД». */
export type PayerLine = { railway: string; text: string };

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
  "route_id", "buyer_id", "period_month", "period_month_to", "period_year",
  "destination_country", "port", "wagon_numbers",
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
    buyer_id: "", period_month: "", period_month_to: "", period_year: "",
    destination_country: "", port: "", wagon_numbers: "",
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
    period_month_to: str("period_month_to"),
    period_year: str("period_year"),
    destination_country: str("destination_country"),
    port: str("port"),
    wagon_numbers: str("wagon_numbers"),
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
    period_month_to: num(v.period_month_to),
    period_year: num(v.period_year),
    destination_country: nul(v.destination_country),
    port: nul(v.port),
    wagon_numbers: nul(v.wagon_numbers),
  };
}

const opts = (rows: { id: string; name: string }[]) =>
  rows.map((r) => ({ value: r.id, label: r.name }));

function movePayer(list: PayerLine[], index: number, delta: number): PayerLine[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

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
  /** Номер сохранённой заявки — уходит в имя файла. */
  requestNumber?: number | null;
  /** Строки оплат сохранённой заявки. */
  initialPayers?: PayerLine[];
};

export function TransportRequestForm({
  initial,
  heading,
  prefillFromLast,
  requestNumber,
  initialPayers,
}: Props) {
  const router = useRouter();
  const { isAdmin } = useRole();
  const { refs, loading } = useTransportRefs();
  const [v, setV] = useState<RequestFormValues>(initial);
  const [payers, setPayers] = useState<PayerLine[]>(initialPayers ?? []);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  // Ровно те строки, что уйдут в ячейку «Экспедитор по ЖД».
  const payerPreview = useMemo(
    () =>
      payers
        .map((p) => `Оплата по ${p.railway.trim()} ${p.text.trim()}`.trim())
        .filter((line) => line !== "Оплата по"),
    [payers],
  );

  /**
   * Коды груза зависят от ПАРЫ «завод + продукт» (00155). Клиент 26.08:
   * «в заводу и продукту» — у одного завода мазут и дизель имеют разные
   * ГНГ, а один и тот же мазут у разных заводов тоже разный.
   *
   * Коды следуют за парой: сменил завод или продукт — подставились
   * коды новой пары, а если её нет в справочнике, поля очищаются. Иначе
   * в заявке остался бы код от прежнего завода — правдоподобный и
   * неверный.
   */
  function applyPair(factoryId: string, fuelId: string) {
    const { etsng, gng } = codesForPair(refs.cargoCodes, factoryId, fuelId);
    setV((prev) => ({
      ...prev,
      consignor_factory_id: factoryId,
      fuel_type_id: fuelId,
      etsng_code: etsng,
      gng_code: gng,
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

    // Оплаты по ЖД у одной компании тоже повторяются от заявки к
    // заявке — переносим вместе с остальными полями.
    const { data: lines } = await sb
      .from("transport_request_payers")
      .select("railway, payer_text")
      .eq("request_id", data.id)
      .order("position");
    setPayers(
      ((lines ?? []) as { railway: string; payer_text: string | null }[]).map((l) => ({
        railway: l.railway,
        text: l.payer_text ?? "",
      })),
    );

    wagonsTouched.current = true;
    toast.success("Поля заполнены по прошлой заявке этой компании");
  }

  /**
   * Строки оплат переписываются целиком: удалить и вставить заново
   * надёжнее, чем сводить позиции по одной, — их единицы.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function savePayers(sb: any, requestId: string) {
    const { error: delErr } = await sb
      .from("transport_request_payers")
      .delete()
      .eq("request_id", requestId);
    if (delErr) throw delErr;

    const rows = payers
      .filter((p) => p.railway.trim() !== "")
      .map((p, i) => ({
        request_id: requestId,
        position: i + 1,
        railway: p.railway.trim(),
        payer_text: p.text.trim() || null,
      }));
    if (rows.length === 0) return;

    const { error } = await sb.from("transport_request_payers").insert(rows);
    if (error) throw error;
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
        await savePayers(sb, v.id);
        toast.success("Сохранено");
        router.refresh();
      } else {
        const { data, error } = await sb
          .from("transport_requests")
          .insert(row)
          .select("id")
          .single();
        if (error) throw error;
        await savePayers(sb, data.id as string);
        toast.success("Заявка создана");
        router.replace(`/transport-requests/${data.id}`);
      }
    } catch (e) {
      toast.error(`Не удалось сохранить: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  /** Значения для документа — уже разрешённые названия, не идентификаторы. */
  function documentInput(): RequestDocumentInput {
    const name = (rows: { id: string; name: string }[], id: string) =>
      rows.find((r) => r.id === id)?.name ?? "";
    return {
      date: v.date,
      fuelName: fuel?.full_name || fuel?.name || "",
      tonnage: v.tonnage === "" ? null : Number(v.tonnage.replace(",", ".")),
      wagons: v.wagons === "" ? null : Number(v.wagons),
      cargoPurpose: v.cargo_purpose,
      stationName: station?.name ?? "",
      stationCode: station?.code ?? "",
      siding: v.siding,
      carrierName: name(refs.carriers, v.carrier_id),
      consigneeName: consignee?.name ?? "",
      consigneeBin: consignee?.bin_iin ?? "",
      consigneeCode: consignee?.code_4 ?? "",
      consigneeAddress: consignee?.address ?? "",
      consigneeOkpo: consignee?.okpo ?? "",
      etsngCode: v.etsng_code,
      gngCode: v.gng_code,
      specialMarks: v.special_marks,
      consignorName: name(refs.factories, v.consignor_factory_id),
      wagonOwnerName: name(refs.forwarders, v.wagon_owner_forwarder_id),
      payers: payers.filter((p) => p.railway.trim() !== ""),
      routeText,
      buyerName: name(refs.buyers, v.buyer_id),
      periodMonth: v.period_month === "" ? null : Number(v.period_month),
      periodMonthTo: v.period_month_to === "" ? null : Number(v.period_month_to),
      periodYear: v.period_year === "" ? null : Number(v.period_year),
      destinationCountry: v.destination_country,
      port: v.port,
      wagonNumbers: v.wagon_numbers,
    };
  }

  /**
   * Word собирается ПОВЕРХ бланка компании: шапка, подпись и печать
   * остаются её, меняются только значения в правой колонке и дата.
   * Копия документа кладётся рядом с заявкой — чтобы было видно, какой
   * именно файл ушёл контрагенту.
   */
  async function generateWord() {
    if (!v.id) {
      toast.error("Сначала сохраните заявку");
      return;
    }
    setGenerating(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = sbRef.current as any;
      const { data: tpl, error } = await sb
        .from("transport_company_templates")
        .select("id, file_path")
        .eq("company_group_id", v.company_group_id)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      if (!tpl) {
        toast.error("У компании нет загруженного бланка — добавьте его в справочнике «Бланки компаний»");
        return;
      }

      const bytes = await downloadTemplate(tpl.file_path);
      const blob = await fillTemplate(bytes, {
        date: formatRequestDate(v.date),
        values: buildTemplateValues(documentInput()),
      });

      const company = refs.companies.find((c) => c.id === v.company_group_id)?.name;
      const fileName = documentFileName(requestNumber, v.date, company, "docx");
      triggerDownload(blob, fileName);

      const stamp = Date.now();
      // Файл у менеджера уже скачан; неудача с историей не должна
      // выглядеть как неудача выгрузки.
      try {
        await saveRequestFile({ requestId: v.id, kind: "docx", blob, fileName, stampMs: stamp });
        await sb.from("transport_requests").update({ template_id: tpl.id }).eq("id", v.id);
      } catch (e) {
        toast.warning(`Документ скачан, но не сохранился в истории: ${(e as Error).message}`);
      }
    } catch (e) {
      toast.error(`Не удалось сформировать документ: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function removeRequest() {
    if (!v.id) return;
    const label = requestNumber ? `№ ${requestNumber}` : "черновик";
    if (!confirm(`Удалить заявку ${label}? Сформированные файлы тоже удалятся.`)) return;
    setDeleting(true);
    try {
      await deleteRequestWithFiles(v.id);
      toast.success("Заявка удалена");
      router.replace("/transport-requests");
    } catch (e) {
      toast.error(`Не удалось удалить: ${(e as Error).message}`);
      setDeleting(false);
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
          <Button
            variant="secondary"
            size="sm"
            onClick={generateWord}
            disabled={generating || !v.id}
            title={v.id ? "Заполнить бланк компании" : "Сначала сохраните заявку"}
          >
            {generating ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileDown className="mr-1 h-3.5 w-3.5" />
            )}
            Скачать Word
          </Button>
          {v.id && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={removeRequest}
              disabled={!isAdmin || deleting}
              title={isAdmin ? "Удалить заявку" : "Удалять заявки может администратор"}
            >
              {deleting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-3.5 w-3.5" />
              )}
              Удалить
            </Button>
          )}
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
                  onChange={(val) => applyPair(v.consignor_factory_id, val)}
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
            <Field label="Код ЕТСНГ" hint="Из справочника «Коды груза»">
              <Input value={v.etsng_code} onChange={(e) => set("etsng_code", e.target.value)} placeholder="221066" />
            </Field>
            <Field label="Код ГНГ">
              <Input value={v.gng_code} onChange={(e) => set("gng_code", e.target.value)} placeholder="27101967" />
            </Field>
            <div className="sm:col-span-2">
              <Field
                label="Номера вагонов-цистерн"
                hint="Если номера известны заранее; через запятую"
              >
                <Textarea
                  rows={2}
                  value={v.wagon_numbers}
                  onChange={(e) => set("wagon_numbers", e.target.value)}
                  placeholder="51694719, 51726354, …"
                />
              </Field>
            </div>
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
            <Field
              label="Страна назначения"
              hint="Только если груз уходит за пределы КЗХ"
            >
              <Input
                value={v.destination_country}
                onChange={(e) => set("destination_country", e.target.value)}
                placeholder="Грузия, далее водным транспортом"
              />
            </Field>
            <Field label="Порт" hint="Если есть перевалка на воду">
              <Input
                value={v.port}
                onChange={(e) => set("port", e.target.value)}
                placeholder="Батуми"
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
            <Field label="Грузоотправитель" hint="Вместе с продуктом задаёт коды груза">
              <SearchableSelect
                options={opts(refs.factories)}
                value={v.consignor_factory_id}
                onChange={(val) => applyPair(val, v.fuel_type_id)}
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
            <div className="sm:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px]">Экспедитор по ЖД — оплаты</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPayers((prev) => [...prev, { railway: "", text: "" }])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Добавить оплату
                </Button>
              </div>
              {payers.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Обычно две строки: КЗХ и КРГ. У экспортной заявки бывает больше — РЖД,
                  АЗЖД, ГРЖД.
                </p>
              )}
              {payers.map((line, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <Input
                    className="w-24 shrink-0"
                    value={line.railway}
                    onChange={(e) =>
                      setPayers((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, railway: e.target.value } : x)),
                      )
                    }
                    placeholder="КЗХ"
                  />
                  <Input
                    className="min-w-0 flex-1"
                    value={line.text}
                    onChange={(e) =>
                      setPayers((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, text: e.target.value } : x)),
                      )
                    }
                    placeholder="– ТОО «PTC Operator»"
                  />
                  <Button
                    type="button" variant="ghost" size="icon" className="h-9 w-8 shrink-0"
                    disabled={i === 0}
                    onClick={() => setPayers((prev) => movePayer(prev, i, -1))}
                    aria-label="Выше"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button" variant="ghost" size="icon" className="h-9 w-8 shrink-0"
                    disabled={i === payers.length - 1}
                    onClick={() => setPayers((prev) => movePayer(prev, i, 1))}
                    aria-label="Ниже"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button" variant="ghost" size="icon"
                    className="h-9 w-8 shrink-0 text-destructive"
                    onClick={() => setPayers((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label="Убрать"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {payerPreview.length > 0 && (
                <div className="rounded border bg-muted/40 px-2.5 py-2">
                  <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    В заявке напечатается
                  </p>
                  {payerPreview.map((line, i) => (
                    <p key={i} className="font-mono text-[12px] leading-snug">{line}</p>
                  ))}
                </div>
              )}
            </div>
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
            <Field label="по месяц" hint="Если период — диапазон">
              <SearchableSelect
                options={[
                  { value: "", label: "— один месяц —" },
                  ...MONTHS_RU.map((m, i) => ({ value: String(i + 1), label: m })),
                ]}
                value={v.period_month_to}
                onChange={(val) => set("period_month_to", val)}
                placeholder="— один месяц —"
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
            <div className="sm:col-span-4">
              <Derived
                label="В заявке напечатается"
                value={formatPeriod(
                  v.period_month === "" ? null : Number(v.period_month),
                  v.period_year === "" ? null : Number(v.period_year),
                  v.period_month_to === "" ? null : Number(v.period_month_to),
                )}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export type { TransportRefs };

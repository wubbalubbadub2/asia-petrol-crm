"use client";
// Дислокация — сверхнормативный простой вагонов (этап 1).
// Спека: docs/superpowers/specs/2026-09-27-dislocation-demurrage-design.md
//
// Вся арифметика — в представлениях 00174 (rail_demurrage,
// rail_demurrage_registry). Здесь фильтры, таблица и выгрузка.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryState, parseAsString, parseAsStringEnum } from "nuqs";
import { toast } from "sonner";
import { useDemurrage, useRailReferences, fetchRegistry } from "@/lib/hooks/use-dislocation";
import { exportDemurrageRegistry } from "@/lib/exports/demurrage-registry-excel";
import type { DemurrageRow } from "@/lib/dislocation/types";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatDMY } from "@/lib/format";

const FILTERS = ["all", "check", "noproto", "noship", "over"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = {
  all: "Все",
  check: "Требует проверки",
  noproto: "Нет протокола",
  noship: "Без отгрузки",
  over: "Есть сверхнорматив",
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function matches(r: DemurrageRow, f: Filter): boolean {
  switch (f) {
    case "check":
      return r.needs_check;
    case "noproto":
      return r.protocol_status !== "ok";
    case "noship":
      return r.stay_kind === "loading" && !r.loaded_waybill_number;
    case "over":
      return (r.overage_days ?? 0) > 0;
    default:
      return true;
  }
}

const num = (v: number | null) => (v == null ? "—" : v.toLocaleString("ru-RU"));
const money = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DislocationPage() {
  const [forwarderId, setForwarderId] = useQueryState("fwd", parseAsString.withDefault(""));
  const [monthInput, setMonthInput] = useQueryState("month", parseAsString.withDefault(currentMonth()));
  const [filter, setFilter] = useQueryState("f", parseAsStringEnum([...FILTERS]).withDefault("all"));
  const [exporting, setExporting] = useState(false);
  const { forwarders } = useRailReferences();

  const month = `${monthInput}-01`;
  const { data, loading } = useDemurrage({ forwarderId: forwarderId || null, month });

  const rows = useMemo(() => data.filter((r) => matches(r, filter as Filter)), [data, filter]);
  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    for (const f of FILTERS) c[f] = data.filter((r) => matches(r, f)).length;
    return c;
  }, [data]);
  const totals = useMemo(() => {
    const byCurrency = new Map<string, { days: number; amount: number }>();
    for (const r of rows) {
      if (!r.currency || r.amount == null) continue;
      const t = byCurrency.get(r.currency) ?? { days: 0, amount: 0 };
      t.days += r.overage_days ?? 0;
      t.amount += Number(r.amount);
      byCurrency.set(r.currency, t);
    }
    return [...byCurrency.entries()];
  }, [rows]);

  async function onExport() {
    setExporting(true);
    try {
      const reg = await fetchRegistry(forwarderId || null, month);
      if (reg.length === 0) {
        toast.info("За месяц нет гружёных рейсов для реестра");
        return;
      }
      await exportDemurrageRegistry(reg, month);
    } catch (e) {
      toast.error(`Выгрузка: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  const th = "border-r px-2 py-1 text-left font-medium whitespace-nowrap";
  const thNum = "border-r px-2 py-1 text-right font-medium whitespace-nowrap";
  const td = "border-r px-2 py-1 whitespace-nowrap";
  const tdNum = "border-r px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap";

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Дислокация — простой вагонов</h1>
        <div className="flex gap-2">
          <Link href="/dislocation/upload" className="rounded border border-stone-300 bg-white px-3 py-1.5 text-[12px] font-medium hover:bg-stone-50">
            Загрузить дислокацию
          </Link>
          <Link href="/dislocation/protocols" className="rounded border border-stone-300 bg-white px-3 py-1.5 text-[12px] font-medium hover:bg-stone-50">
            Протоколы цены
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label className="text-[11px] text-stone-500">Экспедитор</Label>
          <SearchableSelect
            options={forwarders}
            value={forwarderId}
            onChange={(v) => setForwarderId(v || null)}
            placeholder="Все экспедиторы"
            triggerClassName="h-8 w-56 text-[12px]"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] text-stone-500">Месяц</Label>
          <Input type="month" value={monthInput} onChange={(e) => e.target.value && setMonthInput(e.target.value)}
                 className="h-8 w-40 text-[12px]" />
        </div>
        <div className="inline-flex overflow-hidden rounded border border-stone-200 bg-white">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`cursor-pointer px-3 py-1.5 text-[12px] font-medium transition-colors ${filter === f ? "bg-amber-500 text-white" : "text-stone-600 hover:bg-stone-50"}`}>
              {FILTER_LABEL[f]} <span className="opacity-70">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
        <Button onClick={onExport} disabled={exporting} className="ml-auto h-8 text-[12px]">
          {exporting ? "Выгрузка…" : "Реестр в Excel"}
        </Button>
      </div>

      <div className="flex gap-4 text-[12px] text-stone-600">
        <span>{rows.length} стоянок</span>
        {totals.map(([cur, t]) => (
          <span key={cur} className="font-mono tabular-nums">
            сверх {num(t.days)} сут · {money(t.amount)} {cur}
          </span>
        ))}
        <span className="text-stone-400">Суммы незакрытых стоянок — предварительные</span>
      </div>

      {loading ? (
        <p className="text-sm text-stone-500">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-stone-500">Нет стоянок за выбранный месяц.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded border border-stone-200 bg-white">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-stone-100">
              <tr className="border-b">
                <th className={th}>Вагон</th>
                <th className={th}>Экспедитор</th>
                <th className={th}>Станция</th>
                <th className={th}>Этап</th>
                <th className={th}>Прибытие</th>
                <th className={th}>Уход</th>
                <th className={thNum}>Сутки</th>
                <th className={thNum}>Норма</th>
                <th className={thNum}>Сверх</th>
                <th className={thNum}>Сумма</th>
                <th className={th}>Статус</th>
                <th className={th}>Протокол</th>
                <th className={th}>Накладная гружёная</th>
                <th className={th}>Сделка</th>
                <th className={th}>Проверка</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.stay_key} className={`border-b hover:bg-amber-50/40 ${r.needs_check ? "bg-red-50/40" : ""}`}>
                  <td className={`${td} font-mono`}>
                    <Link href={`/dislocation/wagon/${r.wagon_number}`} className="text-amber-700 hover:underline">
                      {r.wagon_number}
                    </Link>
                  </td>
                  <td className={td}>{r.forwarder_name}</td>
                  <td className={td}>{r.station_name ?? "—"}</td>
                  <td className={td}>{r.stay_kind === "loading" ? "Погрузка" : "Выгрузка"}</td>
                  <td className={`${td} font-mono`}>{r.arrival_date ? formatDMY(r.arrival_date) : "—"}</td>
                  <td className={`${td} font-mono`}>
                    {r.departure_date ? formatDMY(r.departure_date) : <span className="text-stone-400">на {r.end_date ? formatDMY(r.end_date) : "—"}</span>}
                  </td>
                  <td className={tdNum}>{num(r.total_days)}</td>
                  <td className={tdNum}>{num(r.norm_days)}</td>
                  <td className={`${tdNum} ${(r.overage_days ?? 0) > 0 ? "font-semibold text-red-700" : ""}`}>{num(r.overage_days)}</td>
                  <td className={tdNum}>{r.amount == null ? "—" : `${money(r.amount)} ${r.currency ?? ""}`}</td>
                  <td className={td}>
                    {r.is_final ? "Окончательный" : <span className="text-amber-700">Предварительный</span>}
                    {r.has_override ? <span className="ml-1 text-sky-700">· ручная дата</span> : null}
                  </td>
                  <td className={td}>
                    {r.protocol_status === "ok" ? r.protocol_number
                      : r.protocol_status === "ambiguous" ? <span className="text-red-700">несколько протоколов</span>
                      : <span className="text-red-700">нет протокола</span>}
                  </td>
                  <td className={`${td} font-mono`}>{r.loaded_waybill_number ?? <span className="text-stone-400">без отгрузки</span>}</td>
                  <td className={td}>
                    {r.deal_id ? (
                      <Link href={`/deals/${r.deal_id}`} className="text-amber-700 hover:underline">{r.deal_code}</Link>
                    ) : r.loaded_waybill_number ? <span className="text-stone-400">нет в реестре</span> : "—"}
                  </td>
                  <td className={`${td} text-red-700`}>{r.check_reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

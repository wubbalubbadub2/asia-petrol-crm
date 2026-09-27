"use client";
// Лента вагона: стоянки с расчётом и все снимки дислокации.
// Спорную дату логист правит здесь — правка хранится отдельно от
// вычисленной (rail_stay_overrides), с причиной и автором.
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useWagon, saveStayOverride, removeStayOverride } from "@/lib/hooks/use-dislocation";
import type { DemurrageRow } from "@/lib/dislocation/types";
import { useRole } from "@/lib/role-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDMY } from "@/lib/format";

type Edit = { stayKey: string; field: "arrival" | "departure"; value: string; reason: string };

const dt = (iso: string | null) =>
  iso ? `${formatDMY(iso.slice(0, 10))} ${iso.slice(11, 16)}` : "—";

export default function WagonPage() {
  const params = useParams<{ number: string }>();
  const wagon = params?.number ?? "";
  const { isWritable } = useRole();
  const { snapshots, stays, loading, reload } = useWagon(wagon);
  const [edit, setEdit] = useState<Edit | null>(null);

  async function onSave(stay: DemurrageRow) {
    if (!edit || !stay.arrival_waybill_number) return;
    if (!edit.value || !edit.reason.trim()) {
      toast.error("Укажите дату и причину");
      return;
    }
    const ok = await saveStayOverride({
      forwarderId: stay.forwarder_id,
      wagonNumber: stay.wagon_number,
      arrivalWaybillNumber: stay.arrival_waybill_number,
      field: edit.field,
      value: edit.value,
      reason: edit.reason.trim(),
    });
    if (ok) {
      setEdit(null);
      reload();
    }
  }

  async function onReset(stay: DemurrageRow, field: "arrival" | "departure") {
    if (!stay.arrival_waybill_number) return;
    const ok = await removeStayOverride({
      forwarderId: stay.forwarder_id,
      wagonNumber: stay.wagon_number,
      arrivalWaybillNumber: stay.arrival_waybill_number,
      field,
    });
    if (ok) reload();
  }

  function dateCell(stay: DemurrageRow, field: "arrival" | "departure") {
    const value = field === "arrival" ? stay.arrival_date : stay.departure_date;
    const computed = field === "arrival" ? stay.computed_arrival : stay.computed_departure;
    const reason = field === "arrival" ? stay.arrival_override_reason : stay.departure_override_reason;
    const editing = edit?.stayKey === stay.stay_key && edit.field === field;
    if (editing) {
      return (
        <div className="flex flex-wrap items-center gap-1">
          <Input type="date" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} className="h-7 w-36 text-[11px]" />
          <Input placeholder="Причина" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} className="h-7 w-44 text-[11px]" />
          <Button className="h-7 text-[11px]" onClick={() => onSave(stay)}>Сохранить</Button>
          <button className="text-[11px] text-stone-500 hover:underline" onClick={() => setEdit(null)}>отмена</button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        {value ? <span className="font-mono">{formatDMY(value)}</span>
          : field === "departure"
            ? <span className="text-stone-400">стоит, на {stay.end_date ? formatDMY(stay.end_date) : "—"}</span>
            : <span className="font-mono">—</span>}
        {reason ? (
          <span className="text-[10px] text-sky-700" title={`Вычислено: ${computed ? formatDMY(computed) : "—"}`}>
            ручная: {reason}
            {isWritable ? <button className="ml-1 text-stone-500 hover:underline" onClick={() => onReset(stay, field)}>сбросить</button> : null}
          </span>
        ) : null}
        {isWritable && stay.arrival_waybill_number && !reason ? (
          <button className="text-[10px] text-stone-400 hover:text-amber-700 hover:underline"
            onClick={() => setEdit({ stayKey: stay.stay_key, field, value: value ?? "", reason: "" })}>
            изменить
          </button>
        ) : null}
      </div>
    );
  }

  const th = "border-r px-2 py-1 text-left font-medium whitespace-nowrap";
  const td = "border-r px-2 py-1 whitespace-nowrap";

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Вагон <span className="font-mono">{wagon}</span></h1>
        <Link href="/dislocation" className="text-[12px] text-amber-700 hover:underline">← Простой вагонов</Link>
      </div>

      {loading ? <p className="text-sm text-stone-500">Загрузка…</p> : (
        <>
          <section className="grid gap-2">
            <h2 className="text-[14px] font-semibold">Стоянки</h2>
            {stays.length === 0 ? <p className="text-sm text-stone-500">Стоянок нет.</p> : (
              <div className="overflow-auto rounded border border-stone-200 bg-white">
                <table className="w-full border-collapse text-[11px]">
                  <thead className="bg-stone-100">
                    <tr className="border-b">
                      <th className={th}>Станция</th><th className={th}>Этап</th>
                      <th className={th}>Прибытие</th><th className={th}>Уход</th>
                      <th className={th}>Сутки / норма / сверх</th><th className={th}>Сумма</th>
                      <th className={th}>Накладная прибытия</th><th className={th}>Проверка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stays.map((s) => (
                      <tr key={s.stay_key} className={`border-b align-top ${s.needs_check ? "bg-red-50/40" : ""}`}>
                        <td className={td}>{s.station_name}</td>
                        <td className={td}>{s.stay_kind === "loading" ? "Погрузка" : "Выгрузка"}</td>
                        <td className={td}>{dateCell(s, "arrival")}</td>
                        <td className={td}>{dateCell(s, "departure")}</td>
                        <td className={`${td} font-mono`}>{s.total_days ?? "—"} / {s.norm_days ?? "—"} / {s.overage_days ?? "—"}</td>
                        <td className={`${td} font-mono`}>{s.amount == null ? "—" : `${s.amount} ${s.currency}`}</td>
                        <td className={`${td} font-mono`}>{s.arrival_waybill_number ?? "—"}</td>
                        <td className={`${td} text-red-700`}>{s.check_reason ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="grid gap-2">
            <h2 className="text-[14px] font-semibold">Снимки дислокации</h2>
            <div className="overflow-auto rounded border border-stone-200 bg-white">
              <table className="w-full border-collapse text-[11px]">
                <thead className="bg-stone-100">
                  <tr className="border-b">
                    <th className={th}>Снимок</th><th className={th}>Где стоит</th><th className={th}>Рейс</th>
                    <th className={th}>Накладная</th><th className={th}>Дата накл.</th><th className={th}>Операция</th>
                    <th className={th}>Время операции</th><th className={th}>Груж/Порож</th><th className={th}>Простой на ст., сут</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr key={s.id} className="border-b">
                      <td className={`${td} font-mono`}>{dt(s.snapshot_at)}</td>
                      <td className={td}>{s.current_station ?? "—"}</td>
                      <td className={td}>{s.departure_station ?? "—"} → {s.destination_station ?? "—"}</td>
                      <td className={`${td} font-mono`}>{s.waybill_number ?? "—"}</td>
                      <td className={`${td} font-mono`}>{s.waybill_date ? formatDMY(s.waybill_date) : "—"}</td>
                      <td className={td} title={s.operation_name ?? ""}>{s.operation_code ?? s.operation_name ?? "—"}</td>
                      <td className={`${td} font-mono`}>{dt(s.last_operation_at)}</td>
                      <td className={td}>{s.load_state ?? "—"}</td>
                      <td className={`${td} font-mono`}>{s.idle_at_station ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

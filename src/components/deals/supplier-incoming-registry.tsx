"use client";
// «Реестр входящих СНТ» в разделе «Поставщик» карточки сделки.
// Клиент 2026-08-12, только для KZ-сделок.
//
// Столбцы: дата, входящее СНТ, тариф и сумма ЖД поставщика, тариф и
// сумма грузоотправления. СУММЫ вводятся вручную, ТАРИФЫ считаются:
//     тариф = сумма ÷ входящее СНТ
// Обе формулы одинаковые — в ТЗ во второй была опечатка («делим на
// тариф»), пример клиента её опровергает: 1 050 863 / 123,5 = 8 509,01.
//
// Новых величин не заводим: это те же поля реестра отгрузок, просто
// показанные и правимые здесь. Строка = дата, вагоны внутри неё
// раскрываются; суммы вводятся по вагону и складываются на дату — так
// же, как в примере клиента (62,5 + 61,0 = 123,5).

import { Fragment, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeRegistry, updateRegistryEntry, type RegistryUpdate } from "@/lib/hooks/use-registry";
import { formatDMY } from "@/lib/format";

type Row = {
  id: string;
  wagon_number: string | null;
  loading_date: string | null;
  loading_volume: number | null;
  shipped_tonnage_amount: number | null;
  additional_expenses: number | null;
};

type DateGroup = {
  date: string;
  volume: number;
  railwayAmount: number;
  shipperAmount: number;
  wagons: Row[];
};

const fmtVol = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtMoney = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Тариф = сумма ÷ входящее СНТ. Пустой объём — прочерк, а не ноль. */
function tariff(amount: number, volume: number): number | null {
  if (!volume) return null;
  return amount / volume;
}

/** Правка суммы по вагону. Override не даём триггеру пересчитать введённое. */
function AmountCell({ value, rowId, field, overrideField, onSaved }: {
  value: number | null;
  rowId: string;
  field: "shipped_tonnage_amount" | "additional_expenses";
  overrideField: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState("");

  if (!editing) {
    return (
      <button
        onClick={() => { setLocal(value == null ? "" : String(value)); setEditing(true); }}
        className="w-full cursor-text rounded px-1 text-right hover:bg-amber-50"
      >
        {fmtMoney(value)}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      step="0.01"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const raw = local.trim();
        const next = raw === "" ? null : parseFloat(raw.replace(",", "."));
        if (next != null && !Number.isFinite(next)) return;
        if (next === value) return;
        void updateRegistryEntry(rowId, { [field]: next, [overrideField]: true } as RegistryUpdate)
          .then(onSaved)
          .catch(() => {});
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-24 rounded border border-amber-300 bg-amber-50/50 px-1 text-right font-mono text-[11px] focus:outline-none"
    />
  );
}

export function SupplierIncomingRegistry({ dealId }: { dealId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDate, setOpenDate] = useState<string | null>(null);

  const load = useCallback(() => {
    createClient()
      .from("shipment_registry")
      .select("id, wagon_number, loading_date, loading_volume, shipped_tonnage_amount, additional_expenses")
      .eq("deal_id", dealId)
      .not("loading_volume", "is", null)
      .order("loading_date", { ascending: true })
      .then(({ data }) => {
        setRows((data ?? []) as unknown as Row[]);
        setLoading(false);
      });
  }, [dealId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeRegistry(load), [load]);

  if (loading || rows.length === 0) return null;

  const groups: DateGroup[] = [];
  const byDate = new Map<string, DateGroup>();
  for (const r of rows) {
    const d = r.loading_date ?? "без даты";
    let g = byDate.get(d);
    if (!g) { g = { date: d, volume: 0, railwayAmount: 0, shipperAmount: 0, wagons: [] }; byDate.set(d, g); groups.push(g); }
    g.wagons.push(r);
    g.volume += r.loading_volume ?? 0;
    g.railwayAmount += r.shipped_tonnage_amount ?? 0;
    g.shipperAmount += r.additional_expenses ?? 0;
  }

  const total = groups.reduce(
    (a, g) => ({ v: a.v + g.volume, r: a.r + g.railwayAmount, s: a.s + g.shipperAmount }),
    { v: 0, r: 0, s: 0 },
  );

  const th = "py-1 pr-2 font-medium";
  const num = "py-1 pr-2 text-right font-mono tabular-nums";

  return (
    <div>
      <p className="mb-2 text-[12px] font-medium text-stone-600">Реестр входящих СНТ</p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-stone-200 text-stone-500">
            <th className={`${th} text-left`}>Дата</th>
            <th className={`${th} text-right`}>Входящее СНТ</th>
            <th className={`${th} text-right`} title="Считается: сумма ЖД ÷ входящее СНТ">ЖД тариф пост.</th>
            <th className={`${th} text-right`} title="Вводится вручную">Сумма ЖД пост.</th>
            <th className={`${th} text-right`} title="Считается: сумма грузоотправления ÷ входящее СНТ">ЖД тариф грузо-ния</th>
            <th className={`${th} text-right`} title="Вводится вручную">Сумма грузо-ния</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.date}>
              <tr
                className="cursor-pointer border-b border-stone-100 hover:bg-amber-50/20"
                onClick={() => setOpenDate(openDate === g.date ? null : g.date)}
              >
                <td className="py-1 pr-2">
                  <span className={`inline-block w-3 text-[9px] text-stone-400 transition-transform ${openDate === g.date ? "rotate-90" : ""}`}>▶</span>
                  {g.date === "без даты" ? "без даты" : formatDMY(g.date)}
                </td>
                <td className={`${num} text-amber-700`}>{fmtVol(g.volume)}</td>
                <td className={`${num} text-stone-400`}>{fmtMoney(tariff(g.railwayAmount, g.volume))}</td>
                <td className={num}>{fmtMoney(g.railwayAmount)}</td>
                <td className={`${num} text-stone-400`}>{fmtMoney(tariff(g.shipperAmount, g.volume))}</td>
                <td className={num}>{fmtMoney(g.shipperAmount)}</td>
              </tr>
              {openDate === g.date && g.wagons.map((w) => (
                <tr key={w.id} className="border-b border-stone-50 bg-stone-50/50">
                  <td className="py-0.5 pl-6 pr-2 font-mono text-[10px] text-stone-400">{w.wagon_number ?? "—"}</td>
                  <td className={`${num} text-[10px] text-amber-700`}>{fmtVol(w.loading_volume)}</td>
                  <td className={`${num} text-[10px] text-stone-300`}>
                    {fmtMoney(tariff(w.shipped_tonnage_amount ?? 0, w.loading_volume ?? 0))}
                  </td>
                  <td className={`${num} text-[10px]`}>
                    <AmountCell value={w.shipped_tonnage_amount} rowId={w.id} field="shipped_tonnage_amount"
                                overrideField="shipped_tonnage_amount_override" onSaved={load} />
                  </td>
                  <td className={`${num} text-[10px] text-stone-300`}>
                    {fmtMoney(tariff(w.additional_expenses ?? 0, w.loading_volume ?? 0))}
                  </td>
                  <td className={`${num} text-[10px]`}>
                    <AmountCell value={w.additional_expenses} rowId={w.id} field="additional_expenses"
                                overrideField="additional_expenses_override" onSaved={load} />
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
          <tr className="border-t border-stone-300 font-medium">
            <td className="py-1 pr-2 text-stone-500">Итого</td>
            <td className={`${num} text-amber-700`}>{fmtVol(total.v)}</td>
            <td className={`${num} text-stone-400`}>{fmtMoney(tariff(total.r, total.v))}</td>
            <td className={num}>{fmtMoney(total.r)}</td>
            <td className={`${num} text-stone-400`}>{fmtMoney(tariff(total.s, total.v))}</td>
            <td className={num}>{fmtMoney(total.s)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

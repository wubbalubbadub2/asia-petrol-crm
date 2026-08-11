"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeRegistry, updateRegistryEntry } from "@/lib/hooks/use-registry";
import { formatDMY } from "@/lib/format";
import { usePaymentTermsSummary, summaryKey } from "@/lib/hooks/use-payment-terms-summary";

type ShipmentRow = {
  id: string;
  wagon_number: string | null;
  shipment_volume: number | null;
  loading_volume: number | null;
  date: string | null;
  railway_tariff: number | null;
  invoice_number: string | null;
  // Плановые даты оплаты по отгрузке (00144). Заполняются вручную,
  // когда у приложения выбран отсчёт «дата вручную».
  supplier_planned_pay_date: string | null;
  buyer_planned_pay_date: string | null;
};

type DateGroup = {
  date: string;
  totalLoading: number;
  totalVolume: number;
  totalAmount: number;
  tariffFact: number | null;
  wagons: (ShipmentRow & { amount: number | null })[];
};

function fmtNum(v: number | null | undefined, d = 2) {
  // Default d=2 — operator request 2026-06-26: monetary cells (сумма,
  // тариф) round to 2 decimals. Tonnage uses fmtVol below (3 decimals).
  if (v == null) return "—";
  return v.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Tonnage — always 3 decimals (client request).
function fmtVol(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function fmtDate(d: string) {
  return formatDMY(d);
}

function calcAmount(vol: number | null, tariff: number | null): number | null {
  if (vol == null || tariff == null) return null;
  return Math.ceil(vol) * tariff;
}

// Плановая дата оплаты по отгрузке. Отгрузка здесь — это дата, а не
// вагон: у всех вагонов одной даты срок оплаты общий, поэтому правка
// раскладывается на все строки реестра этой даты.
function PlannedDateCell({ group, field, onSaved }: {
  group: DateGroup;
  field: "supplier_planned_pay_date" | "buyer_planned_pay_date";
  onSaved: () => void;
}) {
  // Показываем значение, если оно одинаково у всех вагонов даты;
  // если разошлось (правили в реестре построчно) — честно говорим об этом.
  const values = new Set(group.wagons.map((w) => w[field] ?? ""));
  const shared = values.size === 1 ? [...values][0] : null;
  const [busy, setBusy] = useState(false);

  async function commit(next: string) {
    const value = next.trim() || null;
    if (value === (shared || null)) return;
    setBusy(true);
    try {
      await Promise.all(group.wagons.map((w) => updateRegistryEntry(w.id, { [field]: value } as Parameters<typeof updateRegistryEntry>[1])));
      onSaved();
    } catch { /* toast показан внутри updateRegistryEntry */ } finally { setBusy(false); }
  }

  return (
    <input
      type="date"
      disabled={busy}
      value={shared ?? ""}
      title={shared == null ? "У вагонов этой даты стоят разные даты оплаты — ввод перезапишет все" : undefined}
      onChange={(e) => void commit(e.target.value)}
      className={`h-6 w-[110px] rounded border px-1 font-mono text-[10px] focus:outline-none focus:ring-1 focus:ring-amber-200 ${
        shared == null ? "border-amber-400 bg-amber-50" : "border-stone-300 bg-white hover:border-amber-400"
      }`}
    />
  );
}

export function DealShipments({ dealId, currencySymbol }: { dealId: string; currencySymbol: string }) {
  const sb = useRef(createClient());
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  // Ручной режим включается на приложении; здесь только узнаём, надо ли
  // показывать колонку с датой (клиент 2026-08-11).
  const { map: termsSummary } = usePaymentTermsSummary([dealId]);
  const supManual = termsSummary.get(summaryKey(dealId, "supplier"))?.has_manual_date ?? false;
  const buyManual = termsSummary.get(summaryKey(dealId, "buyer"))?.has_manual_date ?? false;

  // Stable fetcher — reused on mount AND on every invalidateRegistry()
  // notification (operator 2026-06-26: «загрузил массово с страницы
  // сделки, но в таблице "Отгрузки по датам" ничего не появилось»).
  // Root cause was no subscription here — the previous version
  // fetched once on dealId change and never refreshed.
  const reloadRows = useCallback(() => {
    sb.current
      .from("shipment_registry")
      .select("id, wagon_number, shipment_volume, loading_volume, date, railway_tariff, invoice_number, supplier_planned_pay_date, buyer_planned_pay_date")
      .eq("deal_id", dealId)
      .order("date", { ascending: true })
      .then(({ data }) => {
        // database.ts снимается с прода и колонок 00144 ещё не знает —
        // тот же приём, что в use-registry.ts. Убрать после
        // `npm run types:db`, когда миграция уедет в прод.
        setRows((data ?? []) as unknown as ShipmentRow[]);
        setLoading(false);
      });
  }, [dealId]);

  useEffect(() => { reloadRows(); }, [reloadRows]);

  // Refetch when any registry write fires the pub-sub (BulkAddDialog,
  // inline edits, bulk-add from the passport «Массово» button).
  useEffect(() => subscribeRegistry(reloadRows), [reloadRows]);

  if (loading) return null;
  if (rows.length === 0) return null;

  // Group by date, compute amounts client-side
  const groups: DateGroup[] = [];
  const dateMap = new Map<string, DateGroup>();
  for (const r of rows) {
    const d = r.date ?? "без даты";
    if (!dateMap.has(d)) {
      const g: DateGroup = { date: d, totalLoading: 0, totalVolume: 0, totalAmount: 0, tariffFact: null, wagons: [] };
      dateMap.set(d, g);
      groups.push(g);
    }
    const g = dateMap.get(d)!;
    const amount = calcAmount(r.shipment_volume, r.railway_tariff);
    g.wagons.push({ ...r, amount });
    g.totalLoading += r.loading_volume ?? 0;
    g.totalVolume += r.shipment_volume ?? 0;
    g.totalAmount += amount ?? 0;
  }
  for (const g of groups) {
    if (g.totalVolume > 0 && g.totalAmount > 0) {
      g.tariffFact = Math.round((g.totalAmount / Math.ceil(g.totalVolume)) * 100) / 100;
    }
  }

  const totalLoading = rows.reduce((s, r) => s + (r.loading_volume ?? 0), 0);
  const totalVol = rows.reduce((s, r) => s + (r.shipment_volume ?? 0), 0);
  const totalAmt = rows.reduce((s, r) => s + (calcAmount(r.shipment_volume, r.railway_tariff) ?? 0), 0);

  return (
    <div>
      <p className="text-[12px] font-medium text-stone-600 mb-2">Отгрузки по датам</p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-stone-200 text-stone-500">
            <th className="text-left py-1 pr-2 font-medium">Дата отгрузки</th>
            <th className="text-right py-1 pr-2 font-medium">Налив</th>
            <th className="text-right py-1 pr-2 font-medium">Отгружено (тонн)</th>
            <th className="text-right py-1 pr-2 font-medium">Сумма {currencySymbol}</th>
            <th className="text-right py-1 pr-2 font-medium">Тариф факт</th>
            {supManual && <th className="text-left py-1 pr-2 font-medium" title="Плановая дата оплаты поставщику. Ставится вручную, потому что у приложения выбран отсчёт «дата вручную».">Оплата пост.</th>}
            {buyManual && <th className="text-left py-1 pr-2 font-medium" title="Плановая дата оплаты покупателем. Ставится вручную, потому что у приложения выбран отсчёт «дата вручную».">Оплата покуп.</th>}
            <th className="text-right py-1 font-medium">Вагонов</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g.date}>
              <tr
                className="border-b border-stone-100 hover:bg-amber-50/20 cursor-pointer"
                onClick={() => setExpandedDate(expandedDate === g.date ? null : g.date)}
              >
                <td className="py-1 pr-2">
                  <span className={`inline-block w-3 text-[9px] text-stone-400 transition-transform ${expandedDate === g.date ? "rotate-90" : ""}`}>▶</span>
                  {fmtDate(g.date)}
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-amber-700">{g.totalLoading > 0 ? fmtVol(g.totalLoading) : "—"}</td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtVol(g.totalVolume)}</td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtNum(g.totalAmount, 2)}</td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-stone-400">{fmtNum(g.tariffFact)}</td>
                {supManual && (
                  <td className="py-1 pr-2" onClick={(e) => e.stopPropagation()}>
                    <PlannedDateCell group={g} field="supplier_planned_pay_date" onSaved={reloadRows} />
                  </td>
                )}
                {buyManual && (
                  <td className="py-1 pr-2" onClick={(e) => e.stopPropagation()}>
                    <PlannedDateCell group={g} field="buyer_planned_pay_date" onSaved={reloadRows} />
                  </td>
                )}
                <td className="py-1 text-right">
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9px] font-medium text-stone-500">{g.wagons.length}</span>
                </td>
              </tr>
              {expandedDate === g.date && g.wagons.map((w) => (
                <tr key={w.id} className="bg-stone-50/50 border-b border-stone-50">
                  <td className="py-0.5 pr-2 pl-6 text-stone-400 font-mono text-[10px]">{w.wagon_number ?? "—"}</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-[10px] text-amber-700">{fmtVol(w.loading_volume)}</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-[10px]">{fmtVol(w.shipment_volume)}</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-[10px] text-stone-400">{fmtNum(w.amount, 2)}</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-[10px] text-stone-400">{fmtNum(w.railway_tariff)}</td>
                  {supManual && <td className="py-0.5 pr-2" />}
                  {buyManual && <td className="py-0.5 pr-2" />}
                  <td className="py-0.5 text-right text-[9px] text-stone-400">{w.invoice_number ?? ""}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          <tr className="border-t border-stone-300 font-medium">
            <td className="py-1 pr-2 text-stone-500">Итого</td>
            <td className="py-1 pr-2 text-right font-mono tabular-nums text-amber-700">{totalLoading > 0 ? fmtVol(totalLoading) : "—"}</td>
            <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtVol(totalVol)}</td>
            <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtNum(totalAmt, 2)}</td>
            <td className="py-1 pr-2 text-right font-mono tabular-nums text-stone-400">
              {totalVol > 0 && totalAmt > 0 ? fmtNum(Math.round((totalAmt / Math.ceil(totalVol)) * 100) / 100) : "—"}
            </td>
            {supManual && <td className="py-1 pr-2" />}
            {buyManual && <td className="py-1 pr-2" />}
            <td className="py-1 text-right text-stone-500">{rows.length}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

import React from "react";

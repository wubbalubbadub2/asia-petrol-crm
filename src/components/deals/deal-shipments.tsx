"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

type ShipmentRow = {
  id: string;
  wagon_number: string | null;
  shipment_volume: number | null;
  loading_volume: number | null;
  date: string | null;
  railway_tariff: number | null;
  invoice_number: string | null;
};

type DateGroup = {
  date: string;
  totalLoading: number;
  totalVolume: number;
  totalAmount: number;
  tariffFact: number | null;
  wagons: (ShipmentRow & { amount: number | null })[];
};

function fmtNum(v: number | null | undefined, d = 3) {
  if (v == null) return "—";
  return v.toLocaleString("ru-RU", { maximumFractionDigits: d });
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("ru-RU");
}

function calcAmount(vol: number | null, tariff: number | null): number | null {
  if (vol == null || tariff == null) return null;
  return Math.ceil(vol) * tariff;
}

export function DealShipments({ dealId, currencySymbol }: { dealId: string; currencySymbol: string }) {
  const sb = useRef(createClient());
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  useEffect(() => {
    sb.current
      .from("shipment_registry")
      .select("id, wagon_number, shipment_volume, loading_volume, date, railway_tariff, invoice_number")
      .eq("deal_id", dealId)
      .order("date", { ascending: true })
      .then(({ data }) => {
        setRows((data ?? []) as ShipmentRow[]);
        setLoading(false);
      });
  }, [dealId]);

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
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-amber-700">{g.totalLoading > 0 ? fmtNum(g.totalLoading) : "—"}</td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtNum(g.totalVolume)}</td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtNum(g.totalAmount, 2)}</td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-stone-400">{fmtNum(g.tariffFact)}</td>
                <td className="py-1 text-right">
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9px] font-medium text-stone-500">{g.wagons.length}</span>
                </td>
              </tr>
              {expandedDate === g.date && g.wagons.map((w) => (
                <tr key={w.id} className="bg-stone-50/50 border-b border-stone-50">
                  <td className="py-0.5 pr-2 pl-6 text-stone-400 font-mono text-[10px]">{w.wagon_number ?? "—"}</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-[10px] text-amber-700">{fmtNum(w.loading_volume)}</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-[10px]">{fmtNum(w.shipment_volume)}</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-[10px] text-stone-400">{fmtNum(w.amount, 2)}</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-[10px] text-stone-400">{fmtNum(w.railway_tariff)}</td>
                  <td className="py-0.5 text-right text-[9px] text-stone-400">{w.invoice_number ?? ""}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          <tr className="border-t border-stone-300 font-medium">
            <td className="py-1 pr-2 text-stone-500">Итого</td>
            <td className="py-1 pr-2 text-right font-mono tabular-nums text-amber-700">{totalLoading > 0 ? fmtNum(totalLoading) : "—"}</td>
            <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtNum(totalVol)}</td>
            <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtNum(totalAmt, 2)}</td>
            <td className="py-1 pr-2 text-right font-mono tabular-nums text-stone-400">
              {totalVol > 0 && totalAmt > 0 ? fmtNum(Math.round((totalAmt / Math.ceil(totalVol)) * 100) / 100) : "—"}
            </td>
            <td className="py-1 text-right text-stone-500">{rows.length}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

import React from "react";

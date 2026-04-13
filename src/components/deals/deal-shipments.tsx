"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

type ShipmentRow = {
  id: string;
  wagon_number: string | null;
  shipment_volume: number | null;
  loading_volume: number | null;
  date: string | null;
  railway_tariff: number | null;
  shipped_tonnage_amount: number | null;
  invoice_number: string | null;
};

type DateGroup = {
  date: string;
  totalVolume: number;
  totalEsfAmount: number;
  tariffFact: number | null;
  wagons: ShipmentRow[];
};

function fmtNum(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("ru-RU");
}

export function DealShipments({ dealId, currencySymbol }: { dealId: string; currencySymbol: string }) {
  const sb = useRef(createClient());
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  useEffect(() => {
    sb.current
      .from("shipment_registry")
      .select("id, wagon_number, shipment_volume, loading_volume, date, railway_tariff, shipped_tonnage_amount, invoice_number")
      .eq("deal_id", dealId)
      .order("date", { ascending: true })
      .then(({ data }) => {
        setRows((data ?? []) as ShipmentRow[]);
        setLoading(false);
      });
  }, [dealId]);

  if (loading) return null;
  if (rows.length === 0) return null;

  // Group by date
  const groups: DateGroup[] = [];
  const dateMap = new Map<string, DateGroup>();
  for (const r of rows) {
    const d = r.date ?? "без даты";
    if (!dateMap.has(d)) {
      const g: DateGroup = { date: d, totalVolume: 0, totalEsfAmount: 0, tariffFact: null, wagons: [] };
      dateMap.set(d, g);
      groups.push(g);
    }
    const g = dateMap.get(d)!;
    g.wagons.push(r);
    g.totalVolume += r.shipment_volume ?? 0;
    g.totalEsfAmount += r.shipped_tonnage_amount ?? 0;
  }
  // Compute tariff fact per date group: totalEsfAmount / totalVolume
  for (const g of groups) {
    if (g.totalVolume > 0 && g.totalEsfAmount > 0) {
      g.tariffFact = Math.round((g.totalEsfAmount / g.totalVolume) * 100) / 100;
    }
  }

  const totalAll = rows.reduce((s, r) => s + (r.shipment_volume ?? 0), 0);
  const totalEsf = rows.reduce((s, r) => s + (r.shipped_tonnage_amount ?? 0), 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[14px]">Отгрузки по датам</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Date-aggregated table (Table 5 from doc) */}
        <table className="w-full text-[11px] mb-2">
          <thead>
            <tr className="border-b border-stone-200 text-stone-500">
              <th className="text-left py-1 pr-2 font-medium">Дата отгрузки</th>
              <th className="text-right py-1 pr-2 font-medium">Отгружено (тонн)</th>
              <th className="text-right py-1 pr-2 font-medium">Сумма {currencySymbol}</th>
              <th className="text-right py-1 pr-2 font-medium">Тариф факт</th>
              <th className="text-right py-1 font-medium">Вагонов</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <>
                <tr
                  key={g.date}
                  className="border-b border-stone-100 hover:bg-amber-50/20 cursor-pointer"
                  onClick={() => setExpandedDate(expandedDate === g.date ? null : g.date)}
                >
                  <td className="py-1 pr-2">
                    <span className={`inline-block w-3 text-[9px] text-stone-400 transition-transform ${expandedDate === g.date ? "rotate-90" : ""}`}>▶</span>
                    {fmtDate(g.date)}
                  </td>
                  <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtNum(g.totalVolume)}</td>
                  <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtNum(g.totalEsfAmount)}</td>
                  <td className="py-1 pr-2 text-right font-mono tabular-nums text-stone-400">{fmtNum(g.tariffFact)}</td>
                  <td className="py-1 text-right">
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9px] font-medium text-stone-500">{g.wagons.length}</span>
                  </td>
                </tr>
                {/* Expanded: individual wagons (Table 6 from doc) */}
                {expandedDate === g.date && g.wagons.map((w) => (
                  <tr key={w.id} className="bg-stone-50/50 border-b border-stone-50">
                    <td className="py-0.5 pr-2 pl-6 text-stone-400 font-mono text-[10px]">{w.wagon_number ?? "—"}</td>
                    <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-[10px]">{fmtNum(w.shipment_volume)}</td>
                    <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-[10px] text-stone-400">{fmtNum(w.shipped_tonnage_amount)}</td>
                    <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-[10px] text-stone-400">{fmtNum(w.railway_tariff)}</td>
                    <td className="py-0.5 text-right text-[9px] text-stone-400">{w.invoice_number ?? ""}</td>
                  </tr>
                ))}
              </>
            ))}
            {/* Totals */}
            <tr className="border-t border-stone-300 font-medium">
              <td className="py-1 pr-2 text-stone-500">Итого</td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtNum(totalAll)}</td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtNum(totalEsf)}</td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums text-stone-400">
                {totalAll > 0 && totalEsf > 0 ? fmtNum(Math.round((totalEsf / totalAll) * 100) / 100) : "—"}
              </td>
              <td className="py-1 text-right text-stone-500">{rows.length}</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

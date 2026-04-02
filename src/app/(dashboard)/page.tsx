"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Truck, DollarSign, ClipboardList, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Stats = {
  activeDeals: number;
  kgDeals: number;
  kzDeals: number;
  oilDeals: number;
  shipmentVolume: number;
  pendingApps: number;
  recentDeals: { id: string; deal_code: string; month: string; fuel_type: string | null; supplier: string | null }[];
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      const supabase = createClient();
      const year = new Date().getFullYear();

      const [dealsRes, kgRes, kzRes, oilRes, shipRes, appsRes, recentRes] = await Promise.all([
        supabase.from("deals").select("id", { count: "exact", head: true }).eq("is_archived", false).eq("year", year),
        supabase.from("deals").select("id", { count: "exact", head: true }).eq("deal_type", "KG").eq("year", year).eq("is_archived", false),
        supabase.from("deals").select("id", { count: "exact", head: true }).eq("deal_type", "KZ").eq("year", year).eq("is_archived", false),
        supabase.from("deals").select("id", { count: "exact", head: true }).eq("deal_type", "OIL").eq("year", year).eq("is_archived", false),
        supabase.from("shipment_registry").select("shipment_volume").gte("date", `${year}-01-01`),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("is_ordered", false),
        supabase.from("deals").select("id, deal_code, month, fuel_type:fuel_types(name), supplier:counterparties!supplier_id(short_name)").eq("is_archived", false).eq("year", year).order("created_at", { ascending: false }).limit(5),
      ]);

      const shipVolume = (shipRes.data ?? []).reduce((sum, r) => sum + (Number(r.shipment_volume) || 0), 0);

      setStats({
        activeDeals: dealsRes.count ?? 0,
        kgDeals: kgRes.count ?? 0,
        kzDeals: kzRes.count ?? 0,
        oilDeals: oilRes.count ?? 0,
        shipmentVolume: Math.round(shipVolume),
        pendingApps: appsRes.count ?? 0,
        recentDeals: (recentRes.data ?? []).map((d: Record<string, unknown>) => ({
          id: d.id as string,
          deal_code: d.deal_code as string,
          month: d.month as string,
          fuel_type: (d.fuel_type as { name: string } | null)?.name ?? null,
          supplier: (d.supplier as { short_name: string } | null)?.short_name ?? null,
        })),
      });
      setLoading(false);
    }
    loadStats();
  }, []);

  const s = stats;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Главная</h1>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/deals">
          <Card className="transition-all hover:border-amber-300 hover:shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[12px] font-medium text-muted-foreground">Активные сделки</CardTitle>
              <FileText className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono tabular-nums">{loading ? "..." : s?.activeDeals ?? 0}</div>
              <p className="text-[11px] text-muted-foreground mt-1">
                KG: {s?.kgDeals ?? 0} | KZ: {s?.kzDeals ?? 0} | OIL: {s?.oilDeals ?? 0}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/registry">
          <Card className="transition-all hover:border-amber-300 hover:shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[12px] font-medium text-muted-foreground">Отгрузки за год</CardTitle>
              <Truck className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono tabular-nums">
                {loading ? "..." : s?.shipmentVolume?.toLocaleString("ru-RU") ?? 0}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">тонн</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/quotations">
          <Card className="transition-all hover:border-amber-300 hover:shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[12px] font-medium text-muted-foreground">Котировки</CardTitle>
              <DollarSign className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono tabular-nums">16</div>
              <p className="text-[11px] text-muted-foreground mt-1">типов продуктов</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/applications">
          <Card className="transition-all hover:border-amber-300 hover:shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[12px] font-medium text-muted-foreground">Заявки</CardTitle>
              <ClipboardList className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono tabular-nums text-red-600">
                {loading ? "..." : s?.pendingApps ?? 0}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">не заявлено</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent deals */}
      {s && s.recentDeals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[14px]">Последние сделки</CardTitle>
              <Link href="/deals" className="text-[12px] text-amber-600 hover:underline flex items-center gap-1">
                Все сделки <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {s.recentDeals.map((deal) => (
                <Link
                  key={deal.id}
                  href={`/deals/${deal.id}`}
                  className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2 hover:bg-amber-50/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[13px] font-medium text-amber-700">{deal.deal_code}</span>
                    <span className="text-[12px] text-stone-500">{deal.month}</span>
                    {deal.fuel_type && (
                      <span className="text-[12px] text-stone-600">{deal.fuel_type}</span>
                    )}
                  </div>
                  <span className="text-[12px] text-stone-400">{deal.supplier ?? ""}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(!s || s.recentDeals.length === 0) && !loading && (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-[13px] text-muted-foreground">
              Начните с заполнения <Link href="/spravochnik" className="text-amber-600 hover:underline">справочника</Link>, затем создайте <Link href="/deals/new" className="text-amber-600 hover:underline">первую сделку</Link>.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

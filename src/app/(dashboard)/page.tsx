"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FileText, Truck, DollarSign, ClipboardList, ArrowRight,
  BarChart3, PieChart as PieChartIcon, TrendingUp, Filter,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";

const AMBER_COLORS = ["#D97706", "#F59E0B", "#FBBF24", "#FDE68A", "#FEF3C7", "#B45309"];
const CHART_COLORS = ["#D97706", "#2563EB", "#16A34A", "#9333EA", "#DC2626", "#06B6D4", "#F97316", "#EC4899"];

type Deal = {
  deal_type: string;
  month: string;
  fuel_type_id: string | null;
  supplier_id: string | null;
  buyer_id: string | null;
  forwarder_id: string | null;
  supplier_contracted_volume: number | null;
  buyer_contracted_volume: number | null;
  supplier_shipped_amount: number | null;
  buyer_shipped_amount: number | null;
  supplier_payment: number | null;
  buyer_payment: number | null;
  supplier_balance: number | null;
  buyer_debt: number | null;
  buyer_shipped_volume: number | null;
};

type RefMap = Record<string, string>;

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_FULL = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

function ChartTypeToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-stone-100 p-0.5">
      {[
        { key: "bar", icon: BarChart3 },
        { key: "line", icon: TrendingUp },
        { key: "pie", icon: PieChartIcon },
      ].map(({ key, icon: Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`rounded-md p-1.5 transition-all ${
            value === key ? "bg-white shadow-sm text-amber-600" : "text-stone-400 hover:text-stone-600"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

function formatNum(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

export default function DashboardPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [fuelTypes, setFuelTypes] = useState<RefMap>({});
  const [suppliers, setSuppliers] = useState<RefMap>({});
  const [buyers, setBuyers] = useState<RefMap>({});
  const [forwarders, setForwarders] = useState<RefMap>({});
  const [pendingApps, setPendingApps] = useState(0);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [dealTypeFilter, setDealTypeFilter] = useState<string>("all");

  // Chart type states
  const [monthlyChartType, setMonthlyChartType] = useState("bar");
  const [productChartType, setProductChartType] = useState("pie");
  const [financialChartType, setFinancialChartType] = useState("bar");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [dealsRes, ftRes, supRes, buyRes, fwRes, appsRes] = await Promise.all([
        supabase.from("deals").select("deal_type, month, fuel_type_id, supplier_id, buyer_id, forwarder_id, supplier_contracted_volume, buyer_contracted_volume, supplier_shipped_amount, buyer_shipped_amount, supplier_payment, buyer_payment, supplier_balance, buyer_debt, buyer_shipped_volume").eq("year", yearFilter).eq("is_archived", false),
        supabase.from("fuel_types").select("id, name"),
        supabase.from("counterparties").select("id, short_name").eq("type", "supplier"),
        supabase.from("counterparties").select("id, short_name").eq("type", "buyer"),
        supabase.from("forwarders").select("id, name"),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("is_ordered", false),
      ]);

      setDeals((dealsRes.data ?? []) as Deal[]);
      setFuelTypes(Object.fromEntries((ftRes.data ?? []).map((r: { id: string; name: string }) => [r.id, r.name])));
      setSuppliers(Object.fromEntries((supRes.data ?? []).map((r: { id: string; short_name: string }) => [r.id, r.short_name])));
      setBuyers(Object.fromEntries((buyRes.data ?? []).map((r: { id: string; short_name: string }) => [r.id, r.short_name])));
      setForwarders(Object.fromEntries((fwRes.data ?? []).map((r: { id: string; name: string }) => [r.id, r.name])));
      setPendingApps(appsRes.count ?? 0);
      setLoading(false);
    }
    load();
  }, [yearFilter]);

  const filtered = useMemo(() => {
    if (dealTypeFilter === "all") return deals;
    return deals.filter((d) => d.deal_type === dealTypeFilter);
  }, [deals, dealTypeFilter]);

  // KPI cards
  const totalDeals = filtered.length;
  const kgCount = filtered.filter((d) => d.deal_type === "KG").length;
  const kzCount = filtered.filter((d) => d.deal_type === "KZ").length;
  const totalShipped = filtered.reduce((s, d) => s + (d.buyer_shipped_volume ?? 0), 0);
  const totalReceivable = filtered.reduce((s, d) => s + Math.abs(Math.min(d.buyer_debt ?? 0, 0)), 0);
  const totalPayable = filtered.reduce((s, d) => s + Math.abs(Math.min(d.supplier_balance ?? 0, 0)), 0);

  // Monthly data
  const monthlyData = useMemo(() => {
    const map: Record<string, { contracted: number; shipped: number; paid: number }> = {};
    MONTHS_FULL.forEach((m) => { map[m] = { contracted: 0, shipped: 0, paid: 0 }; });
    filtered.forEach((d) => {
      if (d.month && map[d.month]) {
        map[d.month].contracted += d.buyer_contracted_volume ?? 0;
        map[d.month].shipped += d.buyer_shipped_volume ?? 0;
        map[d.month].paid += d.buyer_payment ?? 0;
      }
    });
    return MONTHS_FULL.map((m, i) => ({
      name: MONTHS_SHORT[i],
      contracted: Math.round(map[m].contracted),
      shipped: Math.round(map[m].shipped),
    }));
  }, [filtered]);

  // Product type data
  const productData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((d) => {
      if (d.fuel_type_id) {
        const name = fuelTypes[d.fuel_type_id] ?? "Другое";
        map[name] = (map[name] ?? 0) + (d.buyer_contracted_volume ?? 0);
      }
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filtered, fuelTypes]);

  // Financial data (contracted vs shipped vs paid)
  const financialData = useMemo(() => {
    const supplierContracted = filtered.reduce((s, d) => s + (d.supplier_contracted_volume ?? 0), 0);
    const buyerContracted = filtered.reduce((s, d) => s + (d.buyer_contracted_volume ?? 0), 0);
    const shipped = filtered.reduce((s, d) => s + (d.buyer_shipped_volume ?? 0), 0);
    const supplierPaid = filtered.reduce((s, d) => s + (d.supplier_payment ?? 0), 0);
    const buyerPaid = filtered.reduce((s, d) => s + (d.buyer_payment ?? 0), 0);
    return [
      { name: "Контракт (П)", value: Math.round(supplierContracted) },
      { name: "Контракт (К)", value: Math.round(buyerContracted) },
      { name: "Отгружено", value: Math.round(shipped) },
      { name: "Оплата пост.", value: Math.round(supplierPaid) },
      { name: "Оплата пок.", value: Math.round(buyerPaid) },
    ];
  }, [filtered]);

  // Deal type split
  const dealTypeSplit = useMemo(() => {
    const map: Record<string, number> = {};
    deals.forEach((d) => { map[d.deal_type] = (map[d.deal_type] ?? 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [deals]);

  function renderChart(data: { name: string; value?: number; contracted?: number; shipped?: number }[], type: string, dataKeys?: string[]) {
    const keys = dataKeys ?? ["value"];
    if (type === "pie") {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="value" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${formatNum(value)}`} labelLine={false}>
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => formatNum(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      );
    }
    if (type === "line") {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={formatNum} />
            <Tooltip formatter={(v) => formatNum(Number(v))} />
            {keys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={CHART_COLORS[i]} strokeWidth={2} dot={{ r: 3 }} />
            ))}
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </LineChart>
        </ResponsiveContainer>
      );
    }
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={formatNum} />
          <Tooltip formatter={(v) => formatNum(Number(v))} />
          {keys.map((k, i) => (
            <Bar key={k} dataKey={k} fill={CHART_COLORS[i]} radius={[3, 3, 0, 0]} />
          ))}
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Дашборд</h1>
          <p className="text-[12px] text-stone-500">Аналитика по сделкам и отгрузкам</p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-stone-400" />
          <Input
            type="number"
            value={yearFilter}
            onChange={(e) => setYearFilter(Number(e.target.value))}
            className="w-20 h-8 text-[12px]"
          />
          <div className="flex gap-0.5 rounded-lg bg-stone-100 p-0.5">
            {["all", "KG", "KZ", "OIL"].map((t) => (
              <button
                key={t}
                onClick={() => setDealTypeFilter(t)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                  dealTypeFilter === t
                    ? "bg-white shadow-sm text-amber-700"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                {t === "all" ? "Все" : t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/deals">
          <Card className="group transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-amber-200">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wide">Сделки</span>
                <FileText className="h-4 w-4 text-amber-500" />
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums">{loading ? "..." : totalDeals}</div>
              <p className="text-[10px] text-stone-400 mt-0.5">KG: {kgCount} | KZ: {kzCount}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/registry">
          <Card className="group transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-amber-200">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wide">Отгружено</span>
                <Truck className="h-4 w-4 text-amber-500" />
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums">{loading ? "..." : formatNum(totalShipped)}</div>
              <p className="text-[10px] text-stone-400 mt-0.5">тонн за {yearFilter}</p>
            </CardContent>
          </Card>
        </Link>
        <Card className="border-red-200/50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wide">Дебиторка</span>
              <DollarSign className="h-4 w-4 text-red-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-red-600">{loading ? "..." : formatNum(totalReceivable)}</div>
            <p className="text-[10px] text-stone-400 mt-0.5">нам должны покупатели</p>
          </CardContent>
        </Card>
        <Link href="/applications">
          <Card className="group transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-amber-200">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wide">Заявки</span>
                <ClipboardList className="h-4 w-4 text-amber-500" />
              </div>
              <div className={`text-2xl font-bold font-mono tabular-nums ${pendingApps > 0 ? "text-red-600" : ""}`}>
                {loading ? "..." : pendingApps}
              </div>
              <p className="text-[10px] text-stone-400 mt-0.5">не заявлено</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Charts Row 1: Monthly Volumes + Product Mix */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[13px]">Объемы по месяцам (тонн)</CardTitle>
              <ChartTypeToggle value={monthlyChartType} onChange={setMonthlyChartType} />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[220px] flex items-center justify-center text-stone-400 text-sm">Загрузка...</div>
            ) : (
              renderChart(monthlyData, monthlyChartType, ["contracted", "shipped"])
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[13px]">По видам ГСМ</CardTitle>
              <ChartTypeToggle value={productChartType} onChange={setProductChartType} />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[220px] flex items-center justify-center text-stone-400 text-sm">Загрузка...</div>
            ) : productData.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-stone-400 text-sm">Нет данных</div>
            ) : (
              renderChart(productData, productChartType)
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2: Financial + Deal Type Split */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[13px]">Финансы: контракт → отгрузка → оплата</CardTitle>
              <ChartTypeToggle value={financialChartType} onChange={setFinancialChartType} />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[220px] flex items-center justify-center text-stone-400 text-sm">Загрузка...</div>
            ) : (
              renderChart(financialData, financialChartType)
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px]">Распределение сделок</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[220px] flex items-center justify-center text-stone-400 text-sm">Загрузка...</div>
            ) : dealTypeSplit.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-stone-400 text-sm">Нет данных</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={dealTypeSplit} dataKey="value" cx="50%" cy="50%" outerRadius={80} innerRadius={40} label={({ name, value }) => `${name}: ${value}`}>
                    {dealTypeSplit.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick links */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-[12px] text-stone-400">
          Данные за {yearFilter} год{dealTypeFilter !== "all" ? ` | тип: ${dealTypeFilter}` : ""}
        </p>
        <Link href="/deals" className="text-[12px] text-amber-600 hover:underline flex items-center gap-1">
          Перейти к сделкам <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

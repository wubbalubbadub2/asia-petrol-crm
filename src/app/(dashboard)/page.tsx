"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FileText, Truck, ClipboardList, ArrowRight,
  BarChart3, PieChart as PieChartIcon, TrendingUp, Filter,
  Package, Wallet,
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
  currency: string | null;
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

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$", KZT: "₸", KGS: "сом", RUB: "₽",
};

function symbolFor(code: string | null | undefined): string {
  return CURRENCY_SYMBOL[code ?? "USD"] ?? "$";
}

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
        supabase.from("deals").select("deal_type, month, fuel_type_id, supplier_id, buyer_id, forwarder_id, currency, supplier_contracted_volume, buyer_contracted_volume, supplier_shipped_amount, buyer_shipped_amount, supplier_payment, buyer_payment, supplier_balance, buyer_debt, buyer_shipped_volume").eq("year", yearFilter).eq("is_archived", false),
        supabase.from("fuel_types").select("id, name"),
        supabase.from("counterparties").select("id, short_name").eq("type", "supplier"),
        supabase.from("counterparties").select("id, short_name").eq("type", "buyer"),
        supabase.from("forwarders").select("id, name"),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("is_ordered", false),
      ]);

      setDeals((dealsRes.data ?? []) as Deal[]);
      setFuelTypes(Object.fromEntries((ftRes.data ?? []).map((r: { id: string; name: string }) => [r.id, r.name])));
      setSuppliers(Object.fromEntries((supRes.data ?? []).map((r) => [r.id, r.short_name ?? ""])));
      setBuyers(Object.fromEntries((buyRes.data ?? []).map((r) => [r.id, r.short_name ?? ""])));
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

  // KPI cards — volumes (currency-neutral)
  const totalDeals = filtered.length;
  const kgCount = filtered.filter((d) => d.deal_type === "KG").length;
  const kzCount = filtered.filter((d) => d.deal_type === "KZ").length;
  const totalContractedVol = filtered.reduce((s, d) => s + (d.buyer_contracted_volume ?? 0), 0);
  const totalShipped = filtered.reduce((s, d) => s + (d.buyer_shipped_volume ?? 0), 0);
  const totalRemaining = Math.max(0, totalContractedVol - totalShipped);

  // Per-currency financial summary: payments, shipped amount, balances
  const byCurrency = useMemo(() => {
    const map: Record<string, {
      shippedAmt: number;
      supplierPaid: number;
      buyerPaid: number;
      supplierOwes: number;   // -supplier_balance when negative
      buyerOwes: number;      // -buyer_debt when negative
      dealCount: number;
    }> = {};
    filtered.forEach((d) => {
      const cur = d.currency || "USD";
      const entry = map[cur] ?? (map[cur] = {
        shippedAmt: 0, supplierPaid: 0, buyerPaid: 0,
        supplierOwes: 0, buyerOwes: 0, dealCount: 0,
      });
      entry.dealCount += 1;
      entry.shippedAmt += d.buyer_shipped_amount ?? 0;
      entry.supplierPaid += d.supplier_payment ?? 0;
      entry.buyerPaid += d.buyer_payment ?? 0;
      if ((d.supplier_balance ?? 0) < 0) entry.supplierOwes += Math.abs(d.supplier_balance ?? 0);
      if ((d.buyer_debt ?? 0) < 0) entry.buyerOwes += Math.abs(d.buyer_debt ?? 0);
    });
    return map;
  }, [filtered]);

  const currencyRows = Object.entries(byCurrency).sort((a, b) => b[1].dealCount - a[1].dealCount);

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

      {/* KPI Cards — volumes and counts */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
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
        <Link href="/deals">
          <Card className="group transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-amber-200">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wide">Остаток к отгрузке</span>
                <Package className="h-4 w-4 text-amber-500" />
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums">{loading ? "..." : formatNum(totalRemaining)}</div>
              <p className="text-[10px] text-stone-400 mt-0.5">тонн ({formatNum(totalContractedVol)} законтрактовано)</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/deals">
          <Card className="group transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-amber-200">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wide">Сделок</span>
                <FileText className="h-4 w-4 text-amber-500" />
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums">{loading ? "..." : totalDeals}</div>
              <p className="text-[10px] text-stone-400 mt-0.5">KG: {kgCount} | KZ: {kzCount}</p>
            </CardContent>
          </Card>
        </Link>
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

      {/* Per-currency financial summary — the "общая картина" the client asked for.
          Each row breaks payments, shipped amounts, and saldo by deal currency
          so mixed-currency books aren't silently collapsed into one wrong number. */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[14px] flex items-center gap-2">
              <Wallet className="h-3.5 w-3.5 text-amber-500" />
              Финансы по валютам
            </CardTitle>
            <span className="text-[10px] text-stone-400">
              {loading ? "" : currencyRows.length > 0 ? `${currencyRows.length} валют` : ""}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="py-4 text-center text-[12px] text-stone-400">Загрузка...</div>
          ) : currencyRows.length === 0 ? (
            <div className="py-4 text-center text-[12px] text-stone-400">Нет данных за {yearFilter}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-stone-400 border-b border-stone-200">
                    <th className="text-left px-2 py-1.5 font-medium">Валюта</th>
                    <th className="text-right px-2 py-1.5 font-medium">Сделок</th>
                    <th className="text-right px-2 py-1.5 font-medium">Отгружено (сумма)</th>
                    <th className="text-right px-2 py-1.5 font-medium">Оплата покупателей</th>
                    <th className="text-right px-2 py-1.5 font-medium">Оплата поставщикам</th>
                    <th className="text-right px-2 py-1.5 font-medium">Покупатели должны</th>
                    <th className="text-right px-2 py-1.5 font-medium">Мы должны поставщ.</th>
                  </tr>
                </thead>
                <tbody>
                  {currencyRows.map(([cur, e]) => (
                    <tr key={cur} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-2 py-1.5 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-mono text-stone-700">{cur}</span>
                          <span className="text-stone-400">{symbolFor(cur)}</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-stone-500">{e.dealCount}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatNum(e.shippedAmt)}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-green-700">{formatNum(e.buyerPaid)}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-amber-700">{formatNum(e.supplierPaid)}</td>
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${e.buyerOwes > 0 ? "text-red-600 font-semibold" : "text-stone-400"}`}>
                        {e.buyerOwes > 0 ? formatNum(e.buyerOwes) : "—"}
                      </td>
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${e.supplierOwes > 0 ? "text-red-600 font-semibold" : "text-stone-400"}`}>
                        {e.supplierOwes > 0 ? formatNum(e.supplierOwes) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

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

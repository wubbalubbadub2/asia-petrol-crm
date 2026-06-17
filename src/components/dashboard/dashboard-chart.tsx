"use client";

/**
 * DashboardChart — recharts wrapper isolated so the chart library
 * (~110 KB gzip) is split into its own chunk and only downloaded on
 * the dashboard root page. /deals, /registry and the rest never pay
 * for it.
 *
 * Import this component via `next/dynamic` to defer the recharts
 * payload past first paint of the page chrome.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";

const CHART_COLORS = ["#D97706", "#2563EB", "#16A34A", "#9333EA", "#DC2626", "#06B6D4", "#F97316", "#EC4899"];

function formatNum(v: number | string | null | undefined): string {
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

export type DashboardChartProps = {
  data: { name: string; value?: number; contracted?: number; shipped?: number }[];
  type: "pie" | "line" | "bar";
  dataKeys?: string[];
};

export function DashboardChart({ data, type, dataKeys }: DashboardChartProps) {
  const keys = dataKeys ?? ["value"];
  if (type === "pie") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${formatNum(value as number)}`} labelLine={false}>
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

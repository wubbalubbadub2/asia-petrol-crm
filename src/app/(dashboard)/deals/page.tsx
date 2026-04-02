"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Plus, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDeals, type Deal } from "@/lib/hooks/use-deals";
import { DEAL_TYPE_CURRENCY } from "@/lib/constants/deal-types";
import { MONTHS_RU } from "@/lib/constants/months-ru";

const tabs = [
  { key: "list", label: "Все сделки" },
  { key: "kg", label: "Паспорт KG" },
  { key: "kz", label: "Паспорт KZ" },
] as const;

function DealTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    KG: "bg-blue-50 text-blue-700 border-blue-200",
    KZ: "bg-green-50 text-green-700 border-green-200",
    OIL: "bg-purple-50 text-purple-700 border-purple-200",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium border ${colors[type] ?? "bg-stone-50 text-stone-600"}`}>
      {type}
    </span>
  );
}

function FuelBadge({ name, color }: { name?: string; color?: string }) {
  if (!name) return <span className="text-stone-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color ?? "#6B7280" }} />
      {name}
    </span>
  );
}

function formatNum(val: number | null | undefined): string {
  if (val == null || val === 0) return "";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export default function DealsPage() {
  const [activeTab, setActiveTab] = useState<"list" | "kg" | "kz">("list");
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [search, setSearch] = useState("");

  const dealTypeFilter = activeTab === "kg" ? "KG" : activeTab === "kz" ? "KZ" : undefined;
  const { data: deals, loading } = useDeals({
    dealType: dealTypeFilter,
    year: yearFilter,
    isArchived: false,
  });

  const filtered = useMemo(() => {
    if (!search) return deals;
    const q = search.toLowerCase();
    return deals.filter((d) =>
      d.deal_code?.toLowerCase().includes(q) ||
      d.supplier?.short_name?.toLowerCase().includes(q) ||
      d.supplier?.full_name?.toLowerCase().includes(q) ||
      d.buyer?.short_name?.toLowerCase().includes(q) ||
      d.buyer?.full_name?.toLowerCase().includes(q) ||
      d.fuel_type?.name?.toLowerCase().includes(q)
    );
  }, [deals, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Сделки</h1>
        <Link href="/deals/new">
          <Button size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Новая сделка
          </Button>
        </Link>
      </div>

      <div className="flex gap-1 border-b border-stone-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-amber-500 text-amber-700"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-stone-400" />
          <span className="text-[12px] text-stone-500">Год:</span>
          <Input
            type="number"
            value={yearFilter}
            onChange={(e) => setYearFilter(Number(e.target.value))}
            className="w-20 h-7 text-[12px]"
          />
        </div>
        <Input
          placeholder="Поиск по коду, поставщику, покупателю..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-7 text-[12px]"
        />
        <span className="text-[11px] text-stone-400 ml-auto">
          {filtered.length} сделок
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-muted-foreground py-4">Загрузка...</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
          <p className="text-sm text-stone-500">Нет сделок за {yearFilter} год</p>
          <Link href="/deals/new" className="mt-2 inline-block">
            <Button size="sm" variant="outline" className="mt-2">
              <Plus className="mr-1 h-3.5 w-3.5" />
              Создать первую сделку
            </Button>
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50">
                <TableHead className="w-[90px] text-[11px]">№ сделки</TableHead>
                <TableHead className="text-[11px]">Тип</TableHead>
                <TableHead className="text-[11px]">Месяц</TableHead>
                <TableHead className="text-[11px]">Завод</TableHead>
                <TableHead className="text-[11px]">ГСМ</TableHead>
                <TableHead className="text-[11px]">Поставщик</TableHead>
                <TableHead className="text-[11px]">Покупатель</TableHead>
                <TableHead className="text-right text-[11px]">Объем (П)</TableHead>
                <TableHead className="text-right text-[11px]">Объем (К)</TableHead>
                <TableHead className="text-right text-[11px]">Отгружено</TableHead>
                <TableHead className="text-[11px]">Менеджер</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((deal) => (
                <TableRow key={deal.id} className="hover:bg-amber-50/30">
                  <TableCell className="font-mono text-[12px] font-medium text-amber-700">
                    <Link href={`/deals/${deal.id}`} className="hover:underline">
                      {deal.deal_code}
                    </Link>
                  </TableCell>
                  <TableCell><DealTypeBadge type={deal.deal_type} /></TableCell>
                  <TableCell className="text-[12px] text-stone-600">{deal.month}</TableCell>
                  <TableCell className="text-[12px] text-stone-600">{deal.factory?.name ?? "—"}</TableCell>
                  <TableCell>
                    <FuelBadge name={deal.fuel_type?.name} color={deal.fuel_type?.color} />
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-700 max-w-[140px] truncate">
                    {deal.supplier?.short_name ?? deal.supplier?.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-700 max-w-[140px] truncate">
                    {deal.buyer?.short_name ?? deal.buyer?.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums">
                    {formatNum(deal.supplier_contracted_volume)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums">
                    {formatNum(deal.buyer_contracted_volume)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums">
                    {formatNum(deal.buyer_shipped_volume)}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-500">
                    {deal.supplier_manager?.full_name ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

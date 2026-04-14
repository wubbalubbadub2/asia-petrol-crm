"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Plus, Filter, Trash2 } from "lucide-react";
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
import { PassportTable } from "@/components/deals/passport-table";
import { useRole } from "@/lib/hooks/use-role";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

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
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

export default function DealsPage() {
  // Persist tab in URL hash so refresh keeps the tab
  const [activeTab, setActiveTabState] = useState<"list" | "kg" | "kz">(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.replace("#", "");
      if (hash === "kg" || hash === "kz") return hash;
    }
    return "list";
  });
  function setActiveTab(tab: "list" | "kg" | "kz") {
    setActiveTabState(tab);
    window.location.hash = tab === "list" ? "" : tab;
  }
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [search, setSearch] = useState("");
  const { isAdmin } = useRole();

  async function handleDelete(deal: Deal) {
    if (!confirm(`Удалить сделку ${deal.deal_code}?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    if (error) { toast.error(`Ошибка удаления: ${error.message}`); return; }
    toast.success(`Сделка ${deal.deal_code} удалена`);
    reload();
  }

  const dealTypeFilter = activeTab === "kg" ? "KG" : activeTab === "kz" ? "KZ" : undefined;
  const { data: deals, loading, reload } = useDeals({
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

      {/* Passport views — all tabs use PassportTable */}
      {(activeTab === "kg" || activeTab === "kz" || activeTab === "list") && (
        <PassportTable
          deals={filtered}
          loading={loading}
          onDataChanged={reload}
          dealType={activeTab === "kg" ? "KG" : activeTab === "kz" ? "KZ" : "ALL"}
        />
      )}

      {/* Old list view removed — all tabs use PassportTable now */}
    </div>
  );
}

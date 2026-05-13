"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { Plus, Filter, Trash2, X, Download, Loader2 } from "lucide-react";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
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
  const [supplierFilter, setSupplierFilter] = useState("");
  const [buyerFilter, setBuyerFilter] = useState("");
  const [factoryFilter, setFactoryFilter] = useState("");
  const [fuelTypeFilter, setFuelTypeFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [forwarderFilter, setForwarderFilter] = useState("");
  const [applicationFilter, setApplicationFilter] = useState("");
  const [refs, setRefs] = useState<{
    suppliers: { id: string; label: string }[];
    buyers: { id: string; label: string }[];
    factories: { id: string; label: string }[];
    fuelTypes: { id: string; label: string }[];
    forwarders: { id: string; label: string }[];
  }>({ suppliers: [], buyers: [], factories: [], fuelTypes: [], forwarders: [] });
  const sbRef = useRef(createClient());
  const { isAdmin } = useRole();

  // Load reference lists once for filter dropdowns
  useEffect(() => {
    const sb = sbRef.current;
    Promise.all([
      sb.from("counterparties").select("id, short_name, full_name").eq("type", "supplier").eq("is_active", true).order("full_name"),
      sb.from("counterparties").select("id, short_name, full_name").eq("type", "buyer").eq("is_active", true).order("full_name"),
      sb.from("factories").select("id, name").eq("is_active", true).order("name"),
      sb.from("fuel_types").select("id, name").eq("is_active", true).order("sort_order"),
      sb.from("forwarders").select("id, name").eq("is_active", true).order("name"),
    ]).then(([s, b, f, ft, fw]) => {
      setRefs({
        suppliers: (s.data ?? []).map((r) => ({ id: r.id, label: r.short_name || r.full_name })),
        buyers: (b.data ?? []).map((r) => ({ id: r.id, label: r.short_name || r.full_name })),
        factories: (f.data ?? []).map((r) => ({ id: r.id, label: r.name })),
        fuelTypes: (ft.data ?? []).map((r) => ({ id: r.id, label: r.name })),
        forwarders: (fw.data ?? []).map((r) => ({ id: r.id, label: r.name })),
      });
    });
  }, []);

  // Excel export — dynamic-imports exceljs so it stays out of the
  // initial bundle. Always exports the *currently filtered* rows so
  // the file matches what's on screen.
  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const { exportPassportToExcel } = await import("@/lib/exports/passport-excel");
      await exportPassportToExcel(filtered, {
        dealType: activeTab === "kg" ? "KG" : activeTab === "kz" ? "KZ" : "ALL",
        year: yearFilter,
      });
      toast.success("Файл готов");
    } catch (e) {
      toast.error(`Не удалось экспортировать: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

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

  // «Приложение» dropdown options — distinct contract numbers across
  // both supplier and buyer sides of the loaded deals. Per the product
  // owner, the «договор» column in the passport IS the «приложение»
  // they want to filter by (each contract / annex). Empty string +
  // null are excluded so the dropdown only lists real values.
  const contractOpts = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) {
      if (d.supplier_contract) set.add(d.supplier_contract);
      if (d.buyer_contract) set.add(d.buyer_contract);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [deals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deals.filter((d) => {
      if (supplierFilter && d.supplier_id !== supplierFilter) return false;
      if (buyerFilter && d.buyer_id !== buyerFilter) return false;
      if (factoryFilter && d.factory_id !== factoryFilter) return false;
      if (fuelTypeFilter && d.fuel_type_id !== fuelTypeFilter) return false;
      if (monthFilter && d.month !== monthFilter) return false;
      if (forwarderFilter && d.forwarder_id !== forwarderFilter) return false;
      if (applicationFilter && d.supplier_contract !== applicationFilter && d.buyer_contract !== applicationFilter) return false;
      if (!q) return true;
      return (
        d.deal_code?.toLowerCase().includes(q) ||
        d.supplier?.short_name?.toLowerCase().includes(q) ||
        d.supplier?.full_name?.toLowerCase().includes(q) ||
        d.buyer?.short_name?.toLowerCase().includes(q) ||
        d.buyer?.full_name?.toLowerCase().includes(q) ||
        d.fuel_type?.name?.toLowerCase().includes(q) ||
        d.forwarder?.name?.toLowerCase().includes(q) ||
        false
      );
    });
  }, [deals, search, supplierFilter, buyerFilter, factoryFilter, fuelTypeFilter, monthFilter, forwarderFilter, applicationFilter]);

  const activeFilterCount =
    (supplierFilter ? 1 : 0) + (buyerFilter ? 1 : 0) + (factoryFilter ? 1 : 0) +
    (fuelTypeFilter ? 1 : 0) + (monthFilter ? 1 : 0) + (forwarderFilter ? 1 : 0) +
    (applicationFilter ? 1 : 0);

  function clearAllFilters() {
    setSupplierFilter(""); setBuyerFilter(""); setFactoryFilter("");
    setFuelTypeFilter(""); setMonthFilter(""); setForwarderFilter("");
    setApplicationFilter("");
    setSearch("");
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Top section: title + tabs + filters. NOT sticky — the table
          below has its own internal scroll viewport with a sticky
          <thead>, so this block stays naturally above and never gets
          covered. */}
      <div className="flex-shrink-0 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Сделки</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting || filtered.length === 0} title="Экспорт текущей выборки в Excel">
            {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            Excel
          </Button>
          <Link href="/deals/new">
            <Button size="sm">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Новая сделка
            </Button>
          </Link>
        </div>
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

      {/* Filters — year + search on first row, dropdown filters on second */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
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
            placeholder="Поиск по коду, контрагенту, экспедитору..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-7 text-[12px]"
          />
          {activeFilterCount > 0 && (
            <Button size="sm" variant="ghost" onClick={clearAllFilters} className="h-7 text-[11px] text-stone-500 hover:text-red-600">
              <X className="h-3 w-3 mr-0.5" />
              Сбросить фильтры ({activeFilterCount})
            </Button>
          )}
          <span className="text-[11px] text-stone-400 ml-auto">
            {filtered.length} {filtered.length === 1 ? "сделка" : "сделок"}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-7 gap-2">
          <SearchableSelect
            value={supplierFilter} onChange={setSupplierFilter}
            options={refs.suppliers.map((r) => ({ value: r.id, label: r.label }))}
            placeholder="Все поставщики" searchPlaceholder="Поиск поставщика…"
          />
          <SearchableSelect
            value={buyerFilter} onChange={setBuyerFilter}
            options={refs.buyers.map((r) => ({ value: r.id, label: r.label }))}
            placeholder="Все покупатели" searchPlaceholder="Поиск покупателя…"
          />
          <SearchableSelect
            value={factoryFilter} onChange={setFactoryFilter}
            options={refs.factories.map((r) => ({ value: r.id, label: r.label }))}
            placeholder="Все заводы" searchPlaceholder="Поиск завода…"
          />
          <SearchableSelect
            value={fuelTypeFilter} onChange={setFuelTypeFilter}
            options={refs.fuelTypes.map((r) => ({ value: r.id, label: r.label }))}
            placeholder="Все ГСМ" searchPlaceholder="Поиск ГСМ…"
          />
          <SearchableSelect
            value={monthFilter} onChange={setMonthFilter}
            options={MONTHS_RU.map((m) => ({ value: m, label: m }))}
            placeholder="Все месяцы" searchPlaceholder="Поиск месяца…"
          />
          <SearchableSelect
            value={forwarderFilter} onChange={setForwarderFilter}
            options={refs.forwarders.map((r) => ({ value: r.id, label: r.label }))}
            placeholder="Все экспедиторы" searchPlaceholder="Поиск экспедитора…"
          />
          <SearchableSelect
            value={applicationFilter} onChange={setApplicationFilter}
            options={contractOpts.map((c) => ({ value: c, label: c }))}
            placeholder="Все приложения" searchPlaceholder="Поиск договора…"
          />
        </div>
      </div>
      </div>

      {/* Passport views — all tabs use PassportTable. The wrapping
          flex-1 min-h-0 lets the table take all remaining height; its
          internal max-h + overflow gives <thead> a real scroll
          container to stick to. */}
      <div className="flex-1 min-h-0">
        {(activeTab === "kg" || activeTab === "kz" || activeTab === "list") && (
          <PassportTable
            deals={filtered}
            loading={loading}
            onDataChanged={reload}
            dealType={activeTab === "kg" ? "KG" : activeTab === "kz" ? "KZ" : "ALL"}
          />
        )}
      </div>
    </div>
  );
}

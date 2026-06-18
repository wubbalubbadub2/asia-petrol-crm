"use client";

import { useState, useMemo, useDeferredValue, useTransition } from "react";
import Link from "next/link";
import { Plus, Filter, X, Download, Loader2 } from "lucide-react";
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
import { useGlobalRefs } from "@/lib/refs";
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
  // Wrap the tab flip in startTransition so React treats the table
  // re-render as a non-urgent update and exposes `isPending` — we feed
  // that into PassportTable as `loading` for the few frames the new
  // render is rendering, giving operators the «click → skeleton flash
  // → new data» rhythm they asked for (2026-06-18 complaint #1: «table
  // does not change immediately… should immediately show skeleton»).
  const [isTabPending, startTabTransition] = useTransition();
  function setActiveTab(tab: "list" | "kg" | "kz") {
    // URL hash is a synchronous side effect — do it outside the
    // transition so the browser history reflects the click instantly.
    window.location.hash = tab === "list" ? "" : tab;
    startTabTransition(() => {
      setActiveTabState(tab);
    });
  }
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [buyerFilter, setBuyerFilter] = useState("");
  const [factoryFilter, setFactoryFilter] = useState("");
  const [fuelTypeFilter, setFuelTypeFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [forwarderFilter, setForwarderFilter] = useState("");
  // companyGroupFilter applies to the «Группа комп.» trading CHAIN
  // (deal_company_groups table — the colspan=2 cell in the passport),
  // NOT the deal-level deals.logistics_company_group_id FK. A deal
  // matches if ANY of its deal_company_groups rows has this id. See
  // useDeals → DealFilters.companyGroupId.
  const [companyGroupFilter, setCompanyGroupFilter] = useState("");
  // Position-specific variants of the chain filter: «Группа 1»
  // matches deal_company_groups.position = 1, «Группа 2» = position 2.
  // Independent of (and AND-combined with) the any-position filter
  // above. See useDeals → DealFilters.companyGroupPos1Id/Pos2Id.
  const [companyGroupPos1, setCompanyGroupPos1] = useState("");
  const [companyGroupPos2, setCompanyGroupPos2] = useState("");
  const [applicationFilter, setApplicationFilter] = useState("");

  // Lag every filter value handed to useDeals so dropdown clicks feel
  // instant — the visible <SearchableSelect> updates synchronously, but
  // the network refetch (a new JSON.stringify cache key) only fires on
  // the next deferred-render pass. Without this, every dropdown change
  // blocks the UI thread on a ~150 KB JSON fetch + row reconciliation.
  // search already had this — extended to all filters per perf agent
  // audit (2026-06-18).
  const deferredSearch = useDeferredValue(search);
  const deferredSupplier = useDeferredValue(supplierFilter);
  const deferredBuyer = useDeferredValue(buyerFilter);
  const deferredFactory = useDeferredValue(factoryFilter);
  const deferredFuelType = useDeferredValue(fuelTypeFilter);
  const deferredMonth = useDeferredValue(monthFilter);
  const deferredForwarder = useDeferredValue(forwarderFilter);
  const deferredCompanyGroup = useDeferredValue(companyGroupFilter);
  const deferredCompanyGroupPos1 = useDeferredValue(companyGroupPos1);
  const deferredCompanyGroupPos2 = useDeferredValue(companyGroupPos2);
  const deferredApplication = useDeferredValue(applicationFilter);
  const deferredYear = useDeferredValue(yearFilter);
  // isFiltering is true while any filter input is ahead of its deferred
  // shadow — i.e. the user just changed a filter and the network fetch
  // for the new combo hasn't arrived yet. Drives the «Сбросить фильтры»
  // amber pulse so the operator gets visual feedback that filtering is
  // in progress (vs. nothing happening because the dropdown is broken).
  const isFiltering =
    search !== deferredSearch ||
    supplierFilter !== deferredSupplier ||
    buyerFilter !== deferredBuyer ||
    factoryFilter !== deferredFactory ||
    fuelTypeFilter !== deferredFuelType ||
    monthFilter !== deferredMonth ||
    forwarderFilter !== deferredForwarder ||
    companyGroupFilter !== deferredCompanyGroup ||
    companyGroupPos1 !== deferredCompanyGroupPos1 ||
    companyGroupPos2 !== deferredCompanyGroupPos2 ||
    applicationFilter !== deferredApplication ||
    yearFilter !== deferredYear;
  // Filter dropdowns read from the shared refs cache so a navigation
  // back to /deals doesn't re-fire the 5 counterparty/factory/fuel/
  // forwarder queries every time. Cache is warmed in the dashboard
  // layout the moment the user lands inside the app.
  const { refs: globalRefs } = useGlobalRefs();
  const refs = useMemo(() => ({
    suppliers: globalRefs.suppliers.map((c) => ({ id: c.id, label: c.short_name || c.full_name })),
    buyers: globalRefs.buyers.map((c) => ({ id: c.id, label: c.short_name || c.full_name })),
    factories: globalRefs.factories.map((r) => ({ id: r.id, label: r.name })),
    fuelTypes: globalRefs.fuelTypes.map((r) => ({ id: r.id, label: r.name })),
    forwarders: globalRefs.forwarders.map((r) => ({ id: r.id, label: r.name })),
    companyGroups: globalRefs.companyGroups.map((r) => ({ id: r.id, label: r.name })),
  }), [globalRefs]);
  const { isAdmin } = useRole();

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

  // ARCHITECTURE (2026-06-18 — operator complaint «фильтр 2-3 секунды»):
  // useDeals only round-trips year/archive. All other axes — tab,
  // supplier, buyer, factory, fuel, month, forwarder, company-group,
  // application, search — are applied client-side via the filteredDeals
  // useMemo below. For 500-ish rows a .filter() pass is <5 ms; that
  // beats a 1.5–2 s PostgREST refetch by three orders of magnitude.
  // The deferred values still drive the FILTERED list (so SearchableSelect
  // inputs feel snappy and the heavy memo runs on the next React pass),
  // but no network call is involved.
  const { data: deals, loading, reload } = useDeals({
    year: deferredYear,
    isArchived: false,
  });

  // Label maps — same lookup tables PassportTable builds, mirrored here
  // so the search box can match against the joined name (supplier /
  // buyer / forwarder / factory / fuel) without a per-deal sub-lookup
  // on every keystroke. Reads from the warmed refs cache so this is
  // O(refs) once per refs change, then O(1) per deal during filtering.
  const labelMaps = useMemo(() => {
    const supplier = new Map<string, string>();
    for (const c of globalRefs.suppliers) supplier.set(c.id, (c.short_name || c.full_name || "").toLowerCase());
    const buyer = new Map<string, string>();
    for (const c of globalRefs.buyers) buyer.set(c.id, (c.short_name || c.full_name || "").toLowerCase());
    const forwarder = new Map<string, string>();
    for (const r of globalRefs.forwarders) forwarder.set(r.id, (r.name || "").toLowerCase());
    const factory = new Map<string, string>();
    for (const r of globalRefs.factories) factory.set(r.id, (r.name || "").toLowerCase());
    const fuelType = new Map<string, string>();
    for (const r of globalRefs.fuelTypes) fuelType.set(r.id, (r.name || "").toLowerCase());
    return { supplier, buyer, forwarder, factory, fuelType };
  }, [globalRefs]);

  // Client-side filter pass. Every predicate is a pure read off the
  // already-loaded `deals` array — no network, no state churn. Runs in
  // a useMemo on the DEFERRED filter values so typing in the search
  // box (or rapidly clicking SearchableSelect items) doesn't block the
  // input thread.
  const filtered = useMemo(() => {
    if (deals.length === 0) return deals;
    const dt = dealTypeFilter;
    const sup = deferredSupplier;
    const buy = deferredBuyer;
    const fac = deferredFactory;
    const fuel = deferredFuelType;
    const mon = deferredMonth;
    const fwd = deferredForwarder;
    const cg = deferredCompanyGroup;
    const cg1 = deferredCompanyGroupPos1;
    const cg2 = deferredCompanyGroupPos2;
    const app = deferredApplication;
    const q = deferredSearch.trim().toLowerCase();

    return deals.filter((d) => {
      if (dt && d.deal_type !== dt) return false;
      if (sup && d.supplier_id !== sup) return false;
      if (buy && d.buyer_id !== buy) return false;
      if (fac && d.factory_id !== fac) return false;
      if (fuel && d.fuel_type_id !== fuel) return false;
      if (mon && d.month !== mon) return false;
      if (fwd && d.forwarder_id !== fwd) return false;
      if (cg) {
        const rows = d.deal_company_groups ?? [];
        if (!rows.some((r) => r.company_group_id === cg)) return false;
      }
      if (cg1) {
        const rows = d.deal_company_groups ?? [];
        if (!rows.some((r) => r.position === 1 && r.company_group_id === cg1)) return false;
      }
      if (cg2) {
        const rows = d.deal_company_groups ?? [];
        if (!rows.some((r) => r.position === 2 && r.company_group_id === cg2)) return false;
      }
      if (app && d.supplier_contract !== app && d.buyer_contract !== app) return false;
      if (q) {
        // Substring search across deal code + joined names. We
        // lowercase the haystack pieces lazily via the labelMaps,
        // which were pre-lowercased above. `q` is already lowercase.
        const code = d.deal_code.toLowerCase();
        if (code.includes(q)) return true;
        const sLbl = d.supplier_id ? labelMaps.supplier.get(d.supplier_id) : undefined;
        if (sLbl && sLbl.includes(q)) return true;
        const bLbl = d.buyer_id ? labelMaps.buyer.get(d.buyer_id) : undefined;
        if (bLbl && bLbl.includes(q)) return true;
        const fLbl = d.forwarder_id ? labelMaps.forwarder.get(d.forwarder_id) : undefined;
        if (fLbl && fLbl.includes(q)) return true;
        const facLbl = d.factory_id ? labelMaps.factory.get(d.factory_id) : undefined;
        if (facLbl && facLbl.includes(q)) return true;
        const fuLbl = d.fuel_type_id ? labelMaps.fuelType.get(d.fuel_type_id) : undefined;
        if (fuLbl && fuLbl.includes(q)) return true;
        return false;
      }
      return true;
    });
  }, [
    deals, dealTypeFilter,
    deferredSupplier, deferredBuyer, deferredFactory, deferredFuelType,
    deferredMonth, deferredForwarder, deferredCompanyGroup,
    deferredCompanyGroupPos1, deferredCompanyGroupPos2,
    deferredApplication, deferredSearch, labelMaps,
  ]);

  // «Приложение» dropdown options — distinct contract numbers across
  // the full year's deal set (no longer narrowed by server-side filters
  // since those are gone). Operator picks the application label, the
  // client-side filter does the rest.
  const contractOpts = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) {
      if (d.supplier_contract) set.add(d.supplier_contract);
      if (d.buyer_contract) set.add(d.buyer_contract);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [deals]);

  // Visible-count for the «N сделок» badge. With the architecture
  // change `totalCount` from useDeals now reflects the cached YEAR
  // (everything for the year) — what the operator actually wants in
  // the badge is the filtered count. Cheap to derive.
  const totalCount = filtered.length;

  const activeFilterCount =
    (supplierFilter ? 1 : 0) + (buyerFilter ? 1 : 0) + (factoryFilter ? 1 : 0) +
    (fuelTypeFilter ? 1 : 0) + (monthFilter ? 1 : 0) + (forwarderFilter ? 1 : 0) +
    (companyGroupFilter ? 1 : 0) +
    (companyGroupPos1 ? 1 : 0) + (companyGroupPos2 ? 1 : 0) +
    (applicationFilter ? 1 : 0);

  function clearAllFilters() {
    setSupplierFilter(""); setBuyerFilter(""); setFactoryFilter("");
    setFuelTypeFilter(""); setMonthFilter(""); setForwarderFilter("");
    setCompanyGroupFilter("");
    setCompanyGroupPos1(""); setCompanyGroupPos2("");
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
            <Button
              size="sm"
              variant="ghost"
              onClick={clearAllFilters}
              // Amber pulse while a filter change is in-flight (the
              // visible dropdown moved ahead of its deferred shadow).
              // Operators said «фильтр очень долго фильтрует» — this
              // gives them feedback that the query IS running.
              className={`h-7 text-[11px] hover:text-red-600 transition-colors ${
                isFiltering
                  ? "text-amber-700 bg-amber-50 animate-pulse"
                  : "text-stone-500"
              }`}
            >
              <X className="h-3 w-3 mr-0.5" />
              Сбросить фильтры ({activeFilterCount})
            </Button>
          )}
          <span className="text-[11px] text-stone-400 ml-auto inline-flex items-center gap-1.5">
            {isFiltering && <Loader2 className="h-3 w-3 animate-spin text-amber-600" />}
            {totalCount} {totalCount === 1 ? "сделка" : totalCount % 10 >= 2 && totalCount % 10 <= 4 && (totalCount % 100 < 10 || totalCount % 100 >= 20) ? "сделки" : "сделок"}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-2">
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
            value={companyGroupFilter} onChange={setCompanyGroupFilter}
            options={refs.companyGroups.map((r) => ({ value: r.id, label: r.label }))}
            placeholder="Все группы комп." searchPlaceholder="Поиск группы…"
          />
          <SearchableSelect
            value={companyGroupPos1} onChange={setCompanyGroupPos1}
            options={refs.companyGroups.map((r) => ({ value: r.id, label: r.label }))}
            placeholder="Группа 1" searchPlaceholder="Поиск группы 1…"
          />
          <SearchableSelect
            value={companyGroupPos2} onChange={setCompanyGroupPos2}
            options={refs.companyGroups.map((r) => ({ value: r.id, label: r.label }))}
            placeholder="Группа 2" searchPlaceholder="Поиск группы 2…"
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
            // OR in `isTabPending` so the table flashes its skeleton
            // chrome the moment the operator clicks a tab — addresses
            // 2026-06-18 complaint #1 («когда нажимаю Паспорт KG / KZ,
            // таблица не меняется сразу и показывает список сделок»).
            // Without this the new tab's filtered set would commit
            // synchronously and the operator would see no «click»
            // feedback at all.
            loading={loading || isTabPending}
            onDataChanged={reload}
            dealType={activeTab === "kg" ? "KG" : activeTab === "kz" ? "KZ" : "ALL"}
          />
        )}
      </div>

    </div>
  );
}

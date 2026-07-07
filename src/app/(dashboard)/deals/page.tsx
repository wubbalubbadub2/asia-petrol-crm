"use client";

import { useState, useMemo, useDeferredValue } from "react";
import Link from "next/link";
import { useQueryState, parseAsInteger, parseAsStringEnum, parseAsArrayOf, parseAsString } from "nuqs";
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
import { useDeals, type Deal, invalidateDeal, invalidateAllDealsLists } from "@/lib/hooks/use-deals";
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

// Dead code (no callers found 2026-07-07). Kept as canonical money
// helper for future use — 2 decimals per client canon.
function formatNum(val: number | null | undefined): string {
  if (val == null || val === 0) return "";
  return val.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DealsPage() {
  // All filter + tab state lives in the URL via nuqs so that:
  //   1. Navigating /deals → /registry → /deals restores the operator's
  //      filter selections (mounting a fresh useState would wipe them —
  //      operator complaint 2026-06-18 #1: «возвращаюсь в сделки —
  //      фильтры сбрасываются»).
  //   2. URLs become shareable: /deals?supplierFilter=…&activeTab=kg.
  // nuqs defaults to history: "replace" so filter changes don't pollute
  // the back stack. Each filter has a string default of "" to keep the
  // existing SearchableSelect contract («"" means no filter»).
  // throttleMs: 0 on every URL-state — operator 2026-06-25 hit a race
  // where filter → workspace-tab switch → return showed stale filter.
  // Default nuqs throttle is 50ms (Chrome) / 120-320ms (Safari); within
  // that window window.location.search is the pre-change URL, so the
  // workspace-tab capture stored the OLD filter. Flushing on every set
  // closes the race.
  const NUQS_INSTANT = { throttleMs: 0 } as const;
  const [activeTab, setActiveTabState] = useQueryState(
    "activeTab",
    { ...parseAsStringEnum<"list" | "kg" | "kz">(["list", "kg", "kz"]).withDefault("list"), ...NUQS_INSTANT },
  );
  // Tab clicks must feel URGENT. Previously this was wrapped in
  // React.startTransition, which (combined with the heavy initial
  // /deals hydration — 50-col table + refs cache) starved the
  // transition so the first 1-2 clicks visually did nothing
  // (operator complaint 2026-06-18 #2: «нужно несколько раз кликать»).
  // We now flip activeTab synchronously and drive PassportTable's
  // skeleton flash via a plain boolean cleared on the next frame.
  const [isTabSwitching, setIsTabSwitching] = useState(false);
  function setActiveTab(tab: "list" | "kg" | "kz") {
    setIsTabSwitching(true);
    setActiveTabState(tab);
    // One animation frame is enough for PassportTable to show its
    // skeleton chrome and feel responsive — the actual filter pass is
    // <5 ms for ~500 deals so the data is ready by then.
    setTimeout(() => setIsTabSwitching(false), 16);
  }
  const [yearFilter, setYearFilter] = useQueryState(
    "yearFilter",
    { ...parseAsInteger.withDefault(new Date().getFullYear()), ...NUQS_INSTANT },
  );
  const [search, setSearch] = useQueryState("search", { defaultValue: "", ...NUQS_INSTANT });
  // 2026-06-22 — every dropdown filter is now MULTI-select (Excel-style:
  // OR within a filter, AND between filters). Operator complaint:
  // «нельзя когда фильтр ставишь выбирать несколько вариантов сразу?»
  // Empty array == no filter. parseAsArrayOf serializes to the URL as
  // ?supplierFilter=uuid1,uuid2 and omits the param when [].
  const multi = { ...parseAsArrayOf(parseAsString).withDefault([]), ...NUQS_INSTANT };
  const [supplierFilter, setSupplierFilter] = useQueryState("supplierFilter", multi);
  const [buyerFilter, setBuyerFilter] = useQueryState("buyerFilter", multi);
  const [factoryFilter, setFactoryFilter] = useQueryState("factoryFilter", multi);
  const [fuelTypeFilter, setFuelTypeFilter] = useQueryState("fuelTypeFilter", multi);
  const [monthFilter, setMonthFilter] = useQueryState("monthFilter", multi);
  const [forwarderFilter, setForwarderFilter] = useQueryState("forwarderFilter", multi);
  // companyGroupFilter applies to the «Группа комп.» trading CHAIN
  // (deal_company_groups table — the colspan=2 cell in the passport),
  // NOT the deal-level deals.logistics_company_group_id FK. A deal
  // matches if ANY of its deal_company_groups rows has this id. See
  // useDeals → DealFilters.companyGroupId.
  const [companyGroupFilter, setCompanyGroupFilter] = useQueryState("companyGroupFilter", multi);
  // Position-specific variants of the chain filter: «Группа 1»
  // matches deal_company_groups.position = 1, «Группа 2» = position 2.
  // Independent of (and AND-combined with) the any-position filter
  // above. See useDeals → DealFilters.companyGroupPos1Id/Pos2Id.
  const [companyGroupPos1, setCompanyGroupPos1] = useQueryState("companyGroupPos1", multi);
  const [companyGroupPos2, setCompanyGroupPos2] = useQueryState("companyGroupPos2", multi);
  const [applicationFilter, setApplicationFilter] = useQueryState("applicationFilter", multi);

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
  //
  // For array filters we can't use reference equality (`!==`) — clicking
  // a checkbox creates a new array even when the operator immediately
  // reverts. Compare by serialised content instead. Cheap: ~10 short
  // joins per render.
  const arrEq = (a: string[], b: string[]) =>
    a === b || (a.length === b.length && a.every((v, i) => v === b[i]));
  const isFiltering =
    search !== deferredSearch ||
    !arrEq(supplierFilter, deferredSupplier) ||
    !arrEq(buyerFilter, deferredBuyer) ||
    !arrEq(factoryFilter, deferredFactory) ||
    !arrEq(fuelTypeFilter, deferredFuelType) ||
    !arrEq(monthFilter, deferredMonth) ||
    !arrEq(forwarderFilter, deferredForwarder) ||
    !arrEq(companyGroupFilter, deferredCompanyGroup) ||
    !arrEq(companyGroupPos1, deferredCompanyGroupPos1) ||
    !arrEq(companyGroupPos2, deferredCompanyGroupPos2) ||
    !arrEq(applicationFilter, deferredApplication) ||
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
    // Drop the per-id snapshot — the next /deals/[id] visit would
    // otherwise paint the just-deleted row from cache before catching
    // its missing-FK 404. invalidateDeal also notifies every mounted
    // useDeals subscriber so the row disappears from the passport list
    // immediately.
    invalidateDeal(deal.id);
    invalidateAllDealsLists();
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

  // Per-deal predicate factory. Each filter is keyed by a short name so
  // the narrowed-options memo below can build «every predicate EXCEPT
  // F» in O(n × predicates). For 800 deals × 10 filters that's ~80k
  // checks/render — well under the 5 ms budget on M-class hardware.
  //
  // Each predicate returns true if the deal PASSES that filter. Empty
  // arrays short-circuit to true (no filter applied).
  const predicates = useMemo(() => {
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
    return {
      dealType: (d: Deal) => !dealTypeFilter || d.deal_type === dealTypeFilter,
      supplier: (d: Deal) => sup.length === 0 || (d.supplier_id != null && sup.includes(d.supplier_id)),
      buyer: (d: Deal) => buy.length === 0 || (d.buyer_id != null && buy.includes(d.buyer_id)),
      factory: (d: Deal) => fac.length === 0 || (d.factory_id != null && fac.includes(d.factory_id)),
      fuelType: (d: Deal) => fuel.length === 0 || (d.fuel_type_id != null && fuel.includes(d.fuel_type_id)),
      month: (d: Deal) => mon.length === 0 || (d.month != null && mon.includes(d.month)),
      forwarder: (d: Deal) => fwd.length === 0 || (d.forwarder_id != null && fwd.includes(d.forwarder_id)),
      companyGroup: (d: Deal) => {
        if (cg.length === 0) return true;
        const rows = d.deal_company_groups ?? [];
        return rows.some((r) => r.company_group_id != null && cg.includes(r.company_group_id));
      },
      companyGroupPos1: (d: Deal) => {
        if (cg1.length === 0) return true;
        const rows = d.deal_company_groups ?? [];
        return rows.some((r) => r.position === 1 && r.company_group_id != null && cg1.includes(r.company_group_id));
      },
      companyGroupPos2: (d: Deal) => {
        if (cg2.length === 0) return true;
        const rows = d.deal_company_groups ?? [];
        return rows.some((r) => r.position === 2 && r.company_group_id != null && cg2.includes(r.company_group_id));
      },
      application: (d: Deal) => {
        if (app.length === 0) return true;
        const a = d.supplier_contract;
        const b = d.buyer_contract;
        return (a != null && app.includes(a)) || (b != null && app.includes(b));
      },
      search: (d: Deal) => {
        if (!q) return true;
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
      },
    };
  }, [
    dealTypeFilter,
    deferredSupplier, deferredBuyer, deferredFactory, deferredFuelType,
    deferredMonth, deferredForwarder, deferredCompanyGroup,
    deferredCompanyGroupPos1, deferredCompanyGroupPos2,
    deferredApplication, deferredSearch, labelMaps,
  ]);

  // Client-side filter pass. All predicates AND-combined.
  const filtered = useMemo(() => {
    if (deals.length === 0) return deals;
    const ps = Object.values(predicates);
    return deals.filter((d) => {
      for (const p of ps) if (!p(d)) return false;
      return true;
    });
  }, [deals, predicates]);

  // Feature A (2026-06-22) — DEPENDENT dropdown options. Each filter F's
  // options narrow to only values present in deals matching ALL OTHER
  // active filters (Excel auto-filter cascade). Operator complaint:
  // «при фильтрации завода, гсм, хотела выбрать № допа, он дает все
  // допы, а надо которые относятся к данному поставщику».
  //
  // Algorithm: for every filter key F, walk `deals` once with every
  // predicate EXCEPT F applied, collect the distinct values for F's
  // field. Build all sets in a single pass for efficiency. The deal-
  // type tab predicate is always applied (it's not a dropdown). The
  // free-text search is also kept (operator already typed it).
  //
  // If the operator's current selection disappears from a narrowed set
  // we DO NOT auto-clear — we just keep the value (filter still applies,
  // possibly to zero deals). Operator can hit «Сбросить фильтры».
  const narrowed = useMemo(() => {
    const allowedSuppliers = new Set<string>();
    const allowedBuyers = new Set<string>();
    const allowedFactories = new Set<string>();
    const allowedFuelTypes = new Set<string>();
    const allowedMonths = new Set<string>();
    const allowedForwarders = new Set<string>();
    const allowedCompanyGroups = new Set<string>();
    const allowedCompanyGroupsPos1 = new Set<string>();
    const allowedCompanyGroupsPos2 = new Set<string>();
    const allowedApplications = new Set<string>();

    // For perf: pre-extract the predicate values once.
    const {
      supplier: pSupplier,
      buyer: pBuyer,
      factory: pFactory,
      fuelType: pFuel,
      month: pMonth,
      forwarder: pForwarder,
      companyGroup: pCg,
      companyGroupPos1: pCg1,
      companyGroupPos2: pCg2,
      application: pApp,
      dealType: pDealType,
      search: pSearch,
    } = predicates;

    for (const d of deals) {
      // dealType + search always apply (they aren't dropdowns).
      if (!pDealType(d)) continue;
      if (!pSearch(d)) continue;

      const okSup = pSupplier(d);
      const okBuy = pBuyer(d);
      const okFac = pFactory(d);
      const okFuel = pFuel(d);
      const okMon = pMonth(d);
      const okFwd = pForwarder(d);
      const okCg = pCg(d);
      const okCg1 = pCg1(d);
      const okCg2 = pCg2(d);
      const okApp = pApp(d);

      // For each dropdown F, the deal contributes to F's option set
      // iff every OTHER dropdown predicate passes.
      const allButSupplier = okBuy && okFac && okFuel && okMon && okFwd && okCg && okCg1 && okCg2 && okApp;
      const allButBuyer = okSup && okFac && okFuel && okMon && okFwd && okCg && okCg1 && okCg2 && okApp;
      const allButFactory = okSup && okBuy && okFuel && okMon && okFwd && okCg && okCg1 && okCg2 && okApp;
      const allButFuel = okSup && okBuy && okFac && okMon && okFwd && okCg && okCg1 && okCg2 && okApp;
      const allButMonth = okSup && okBuy && okFac && okFuel && okFwd && okCg && okCg1 && okCg2 && okApp;
      const allButForwarder = okSup && okBuy && okFac && okFuel && okMon && okCg && okCg1 && okCg2 && okApp;
      const allButCg = okSup && okBuy && okFac && okFuel && okMon && okFwd && okCg1 && okCg2 && okApp;
      const allButCg1 = okSup && okBuy && okFac && okFuel && okMon && okFwd && okCg && okCg2 && okApp;
      const allButCg2 = okSup && okBuy && okFac && okFuel && okMon && okFwd && okCg && okCg1 && okApp;
      const allButApp = okSup && okBuy && okFac && okFuel && okMon && okFwd && okCg && okCg1 && okCg2;

      if (allButSupplier && d.supplier_id) allowedSuppliers.add(d.supplier_id);
      if (allButBuyer && d.buyer_id) allowedBuyers.add(d.buyer_id);
      if (allButFactory && d.factory_id) allowedFactories.add(d.factory_id);
      if (allButFuel && d.fuel_type_id) allowedFuelTypes.add(d.fuel_type_id);
      if (allButMonth && d.month) allowedMonths.add(d.month);
      if (allButForwarder && d.forwarder_id) allowedForwarders.add(d.forwarder_id);

      // Company-group sets — pull from deal_company_groups rows that
      // would have matched the position-specific predicate.
      if (allButCg) {
        for (const r of d.deal_company_groups ?? []) {
          if (r.company_group_id) allowedCompanyGroups.add(r.company_group_id);
        }
      }
      if (allButCg1) {
        for (const r of d.deal_company_groups ?? []) {
          if (r.position === 1 && r.company_group_id) allowedCompanyGroupsPos1.add(r.company_group_id);
        }
      }
      if (allButCg2) {
        for (const r of d.deal_company_groups ?? []) {
          if (r.position === 2 && r.company_group_id) allowedCompanyGroupsPos2.add(r.company_group_id);
        }
      }
      if (allButApp) {
        // Side-aware narrowing: when the operator has filtered by ONE
        // side only (supplier OR buyer), the «приложение» dropdown
        // should surface contract numbers from that SAME side. Mixing
        // in the other side's contracts produced ghost options that
        // could never match the filter — operator complaint
        // 2026-06-22: «фильтруем покупателя должны выходить
        // приложения только покупателя».
        const supplierFiltered = deferredSupplier.length > 0;
        const buyerFiltered = deferredBuyer.length > 0;
        const includeSupplier = !buyerFiltered || supplierFiltered;
        const includeBuyer = !supplierFiltered || buyerFiltered;
        if (includeSupplier && d.supplier_contract) allowedApplications.add(d.supplier_contract);
        if (includeBuyer && d.buyer_contract) allowedApplications.add(d.buyer_contract);
      }
    }

    return {
      suppliers: allowedSuppliers,
      buyers: allowedBuyers,
      factories: allowedFactories,
      fuelTypes: allowedFuelTypes,
      months: allowedMonths,
      forwarders: allowedForwarders,
      companyGroups: allowedCompanyGroups,
      companyGroupsPos1: allowedCompanyGroupsPos1,
      companyGroupsPos2: allowedCompanyGroupsPos2,
      applications: allowedApplications,
    };
  }, [deals, predicates, deferredSupplier, deferredBuyer]);

  // Option lists handed to each SearchableSelect — narrowed by the
  // cascade above, plus a fallback that includes the currently-selected
  // values so the operator's pick never silently vanishes from the
  // popover (they may want to UNCHECK it).
  const filterOpts = useMemo(() => {
    const fkOpts = (
      refList: { id: string; label: string }[],
      allowed: Set<string>,
      selected: string[],
    ) => {
      const keep = new Set(allowed);
      for (const s of selected) keep.add(s);
      return refList.filter((r) => keep.has(r.id)).map((r) => ({ value: r.id, label: r.label }));
    };
    const strOpts = (allowed: Set<string>, selected: string[], all?: string[]) => {
      const keep = new Set(allowed);
      for (const s of selected) keep.add(s);
      // For month dropdown we want to preserve the canonical ordering
      // (Jan..Dec) — `all` carries the source order.
      if (all) return all.filter((v) => keep.has(v)).map((v) => ({ value: v, label: v }));
      return [...keep].sort((a, b) => a.localeCompare(b, "ru")).map((v) => ({ value: v, label: v }));
    };
    return {
      supplier: fkOpts(refs.suppliers, narrowed.suppliers, deferredSupplier),
      buyer: fkOpts(refs.buyers, narrowed.buyers, deferredBuyer),
      factory: fkOpts(refs.factories, narrowed.factories, deferredFactory),
      fuelType: fkOpts(refs.fuelTypes, narrowed.fuelTypes, deferredFuelType),
      forwarder: fkOpts(refs.forwarders, narrowed.forwarders, deferredForwarder),
      companyGroup: fkOpts(refs.companyGroups, narrowed.companyGroups, deferredCompanyGroup),
      companyGroupPos1: fkOpts(refs.companyGroups, narrowed.companyGroupsPos1, deferredCompanyGroupPos1),
      companyGroupPos2: fkOpts(refs.companyGroups, narrowed.companyGroupsPos2, deferredCompanyGroupPos2),
      month: strOpts(narrowed.months, deferredMonth, [...MONTHS_RU]),
      application: strOpts(narrowed.applications, deferredApplication),
    };
  }, [
    refs, narrowed,
    deferredSupplier, deferredBuyer, deferredFactory, deferredFuelType,
    deferredMonth, deferredForwarder, deferredCompanyGroup,
    deferredCompanyGroupPos1, deferredCompanyGroupPos2, deferredApplication,
  ]);

  // Visible-count for the «N сделок» badge. With the architecture
  // change `totalCount` from useDeals now reflects the cached YEAR
  // (everything for the year) — what the operator actually wants in
  // the badge is the filtered count. Cheap to derive.
  const totalCount = filtered.length;

  // A filter «counts» as active iff it has at least one selected value.
  // The badge in «Сбросить фильтры (N)» reflects the number of axes
  // narrowing the result, not the total number of selected values
  // (operator picking 3 suppliers is still one axis of filtering).
  const activeFilterCount =
    (supplierFilter.length > 0 ? 1 : 0) +
    (buyerFilter.length > 0 ? 1 : 0) +
    (factoryFilter.length > 0 ? 1 : 0) +
    (fuelTypeFilter.length > 0 ? 1 : 0) +
    (monthFilter.length > 0 ? 1 : 0) +
    (forwarderFilter.length > 0 ? 1 : 0) +
    (companyGroupFilter.length > 0 ? 1 : 0) +
    (companyGroupPos1.length > 0 ? 1 : 0) +
    (companyGroupPos2.length > 0 ? 1 : 0) +
    (applicationFilter.length > 0 ? 1 : 0);

  function clearAllFilters() {
    setSupplierFilter([]); setBuyerFilter([]); setFactoryFilter([]);
    setFuelTypeFilter([]); setMonthFilter([]); setForwarderFilter([]);
    setCompanyGroupFilter([]);
    setCompanyGroupPos1([]); setCompanyGroupPos2([]);
    setApplicationFilter([]);
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
        {tabs.map((tab) => {
          // Colour lives on the tab regardless of active state so
          // operators can tell KG / KZ apart even when a different
          // one is selected. Client 2026-07-03: «когда выбрана
          // вкладка снизу добавим линию» → active state gets a 4-px
          // bright amber underline sitting on top of the 2-px stone
          // divider. Amber matches the «Все сделки» / brand accent
          // used elsewhere on the deal passport, so all three tabs
          // read as «selected» via the same visual signal.
          const isActive = activeTab === tab.key;
          const bg =
            tab.key === "kg"
              ? isActive
                ? "bg-emerald-800 text-white font-semibold"
                : "bg-emerald-700 text-emerald-50 hover:bg-emerald-800"
              : tab.key === "kz"
              ? isActive
                ? "bg-blue-800 text-white font-semibold"
                : "bg-blue-700 text-blue-50 hover:bg-blue-800"
              : isActive
              ? "text-amber-700"
              : "text-stone-500 hover:text-stone-700";
          const underline = isActive
            ? "border-b-4 border-amber-500"
            : "border-b-2 border-transparent";
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-[13px] font-medium ${bg} ${underline}`}
            >
              {tab.label}
            </button>
          );
        })}
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
          {/* All dropdowns are MULTI-select + DEPENDENT (2026-06-22).
              Options come from filterOpts, which already narrowed each
              list to values present in the deals matching every OTHER
              active filter — Excel auto-filter cascade. */}
          <SearchableSelect
            multi value={supplierFilter} onChange={setSupplierFilter}
            options={filterOpts.supplier}
            placeholder="Все поставщики" searchPlaceholder="Поиск поставщика…"
          />
          <SearchableSelect
            multi value={buyerFilter} onChange={setBuyerFilter}
            options={filterOpts.buyer}
            placeholder="Все покупатели" searchPlaceholder="Поиск покупателя…"
          />
          <SearchableSelect
            multi value={factoryFilter} onChange={setFactoryFilter}
            options={filterOpts.factory}
            placeholder="Все заводы" searchPlaceholder="Поиск завода…"
          />
          <SearchableSelect
            multi value={fuelTypeFilter} onChange={setFuelTypeFilter}
            options={filterOpts.fuelType}
            placeholder="Все ГСМ" searchPlaceholder="Поиск ГСМ…"
          />
          <SearchableSelect
            multi value={monthFilter} onChange={setMonthFilter}
            options={filterOpts.month}
            placeholder="Все месяцы" searchPlaceholder="Поиск месяца…"
          />
          <SearchableSelect
            multi value={forwarderFilter} onChange={setForwarderFilter}
            options={filterOpts.forwarder}
            placeholder="Все экспедиторы" searchPlaceholder="Поиск экспедитора…"
          />
          <SearchableSelect
            multi value={companyGroupFilter} onChange={setCompanyGroupFilter}
            options={filterOpts.companyGroup}
            placeholder="Все группы комп." searchPlaceholder="Поиск группы…"
          />
          <SearchableSelect
            multi value={companyGroupPos1} onChange={setCompanyGroupPos1}
            options={filterOpts.companyGroupPos1}
            placeholder="Группа 1" searchPlaceholder="Поиск группы 1…"
          />
          <SearchableSelect
            multi value={companyGroupPos2} onChange={setCompanyGroupPos2}
            options={filterOpts.companyGroupPos2}
            placeholder="Группа 2" searchPlaceholder="Поиск группы 2…"
          />
          <SearchableSelect
            multi value={applicationFilter} onChange={setApplicationFilter}
            options={filterOpts.application}
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
            // OR in `isTabSwitching` so the table flashes its skeleton
            // chrome the moment the operator clicks a tab — addresses
            // 2026-06-18 complaint #1 («когда нажимаю Паспорт KG / KZ,
            // таблица не меняется сразу и показывает список сделок»).
            // Without this the new tab's filtered set would commit
            // synchronously and the operator would see no «click»
            // feedback at all.
            loading={loading || isTabSwitching}
            onDataChanged={reload}
            dealType={activeTab === "kg" ? "KG" : activeTab === "kz" ? "KZ" : "ALL"}
          />
        )}
      </div>

    </div>
  );
}

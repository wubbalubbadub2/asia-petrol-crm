// src/components/reports/passport-filters.tsx
//
// ОСОЗНАННАЯ КОПИЯ механики фильтров из src/app/(dashboard)/deals/page.tsx
// (решение №3 спеки отчёта «Сбор по валюте», Task 5). Клиент требует,
// чтобы фильтрация в отчёте была «один в один как в паспорте» — мультивыбор
// по 10 осям + поиск + сужение опций (Excel auto-filter cascade). Мы
// сознательно НЕ выносим это в общий модуль, импортируемый из /deals —
// /deals/page.tsx не трогаем ни строкой, чтобы не рисковать регрессией
// самой важной страницы приложения. Вместо этого — копия логики в отдельном
// хуке для страницы отчёта.
//
// Отличие от источника: URL-параметры фильтров используют префикс `r`
// (rSupplierFilter, rBuyerFilter, …) — если паспорт и отчёт открыты в
// соседних вкладках браузера, они не должны перетирать фильтры друг друга
// через общий query-string.
//
// dealType передаётся параметром хука (а не читается из активной вкладки
// /deals) — на странице отчёта нет вкладок KG/KZ/list, вызывающий код сам
// решает, за какую сторону считать сбор.
"use client";

import { useMemo, useDeferredValue } from "react";
import { useQueryState, parseAsArrayOf, parseAsString } from "nuqs";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { type Deal } from "@/lib/hooks/use-deals";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { useGlobalRefs } from "@/lib/refs";

// throttleMs: 0 — см. комментарий у NUQS_INSTANT в deals/page.tsx: без
// этого при быстром переключении фильтр → смена вкладки могла бы поймать
// ещё не сброшенный (throttled) URL и увидеть устаревшее значение.
const NUQS_INSTANT = { throttleMs: 0 } as const;

export function usePassportFilters(
  deals: Deal[],
  dealType: "KG" | "KZ" | null,
): { filtered: Deal[]; activeFilterCount: number; clearAll: () => void; bar: React.ReactNode } {
  const [search, setSearch] = useQueryState("rSearch", { defaultValue: "", ...NUQS_INSTANT });
  // 2026-06-22 — каждый выпадающий фильтр — МУЛЬТИ-выбор (Excel-style: OR
  // внутри фильтра, AND между фильтрами). Пустой массив == фильтр не
  // применён. parseAsArrayOf сериализует в URL как ?rSupplierFilter=uuid1,uuid2
  // и не пишет параметр при [].
  const multi = { ...parseAsArrayOf(parseAsString).withDefault([]), ...NUQS_INSTANT };
  const [supplierFilter, setSupplierFilter] = useQueryState("rSupplierFilter", multi);
  const [buyerFilter, setBuyerFilter] = useQueryState("rBuyerFilter", multi);
  const [factoryFilter, setFactoryFilter] = useQueryState("rFactoryFilter", multi);
  const [fuelTypeFilter, setFuelTypeFilter] = useQueryState("rFuelTypeFilter", multi);
  const [monthFilter, setMonthFilter] = useQueryState("rMonthFilter", multi);
  const [forwarderFilter, setForwarderFilter] = useQueryState("rForwarderFilter", multi);
  // companyGroupFilter применяется к ЦЕПОЧКЕ «Группа комп.»
  // (deal_company_groups, колспан=2 ячейка в паспорте), а НЕ к FK на
  // уровне сделки deals.logistics_company_group_id. Сделка подходит, если
  // ХОТЯ БЫ ОДНА строка deal_company_groups имеет этот id.
  const [companyGroupFilter, setCompanyGroupFilter] = useQueryState("rCompanyGroupFilter", multi);
  // Позиционные варианты фильтра цепочки: «Группа 1» — position = 1,
  // «Группа 2» — position = 2. Независимы от (и AND-комбинируются с)
  // фильтром «любая позиция» выше.
  const [companyGroupPos1, setCompanyGroupPos1] = useQueryState("rCompanyGroupPos1", multi);
  const [companyGroupPos2, setCompanyGroupPos2] = useQueryState("rCompanyGroupPos2", multi);
  // «Группа 3» — position 3 (сделки с тремя группами в цепочке, 2026-07-23).
  const [companyGroupPos3, setCompanyGroupPos3] = useQueryState("rCompanyGroupPos3", multi);
  const [applicationFilter, setApplicationFilter] = useQueryState("rApplicationFilter", multi);

  // Лагаем каждое значение фильтра, чтобы клики по дропдаунам ощущались
  // мгновенно — видимый <SearchableSelect> обновляется синхронно, а тяжёлый
  // memo пересчёта фильтрованного списка идёт на следующем deferred-проходе.
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
  const deferredCompanyGroupPos3 = useDeferredValue(companyGroupPos3);
  const deferredApplication = useDeferredValue(applicationFilter);

  // Дропдауны фильтров читают из общего кэша refs (тот же, что и /deals),
  // чтобы не гонять повторные запросы поставщиков/заводов/ГСМ/экспедиторов.
  const { refs: globalRefs } = useGlobalRefs();
  const refs = useMemo(() => ({
    suppliers: globalRefs.suppliers.map((c) => ({ id: c.id, label: c.short_name || c.full_name })),
    buyers: globalRefs.buyers.map((c) => ({ id: c.id, label: c.short_name || c.full_name })),
    factories: globalRefs.factories.map((r) => ({ id: r.id, label: r.name })),
    fuelTypes: globalRefs.fuelTypes.map((r) => ({ id: r.id, label: r.name })),
    forwarders: globalRefs.forwarders.map((r) => ({ id: r.id, label: r.name })),
    companyGroups: globalRefs.companyGroups.map((r) => ({ id: r.id, label: r.name })),
  }), [globalRefs]);

  // Label maps — те же таблицы соответствий, что строит PassportTable,
  // продублированы здесь, чтобы строка поиска могла матчить по
  // присоединённому имени (поставщик / покупатель / экспедитор / завод /
  // ГСМ) без под-поиска на каждую сделку при каждом нажатии клавиши.
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

  // Предикаты на сделку. Каждый фильтр именован коротким ключом, чтобы
  // блок сужения опций ниже мог построить «все предикаты КРОМЕ F».
  // Каждый предикат возвращает true, если сделка ПРОХОДИТ этот фильтр.
  // Пустые массивы == фильтр не применён (короткое замыкание в true).
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
    const cg3 = deferredCompanyGroupPos3;
    const app = deferredApplication;
    const q = deferredSearch.trim().toLowerCase();
    return {
      dealType: (d: Deal) => !dealType || d.deal_type === dealType,
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
      companyGroupPos3: (d: Deal) => {
        if (cg3.length === 0) return true;
        const rows = d.deal_company_groups ?? [];
        return rows.some((r) => r.position === 3 && r.company_group_id != null && cg3.includes(r.company_group_id));
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
    dealType,
    deferredSupplier, deferredBuyer, deferredFactory, deferredFuelType,
    deferredMonth, deferredForwarder, deferredCompanyGroup,
    deferredCompanyGroupPos1, deferredCompanyGroupPos2, deferredCompanyGroupPos3,
    deferredApplication, deferredSearch, labelMaps,
  ]);

  // Клиентский проход фильтрации. Все предикаты объединены через AND.
  const filtered = useMemo(() => {
    if (deals.length === 0) return deals;
    const ps = Object.values(predicates);
    return deals.filter((d) => {
      for (const p of ps) if (!p(d)) return false;
      return true;
    });
  }, [deals, predicates]);

  // Зависимые опции дропдаунов (Excel auto-filter cascade). Опции каждого
  // фильтра F сужаются до значений, присутствующих в сделках, проходящих
  // ВСЕ ОСТАЛЬНЫЕ активные фильтры. Алгоритм: для каждого ключа F проходим
  // deals один раз с каждым предикатом КРОМЕ F, собирая различающиеся
  // значения поля F. dealType и search применяются всегда (это не
  // дропдауны).
  //
  // Если текущий выбор оператора исчезает из суженного набора — мы НЕ
  // сбрасываем автоматически, просто оставляем значение (фильтр всё ещё
  // применяется, возможно к нулю сделок). Оператор может нажать «Сбросить
  // фильтры».
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
    const allowedCompanyGroupsPos3 = new Set<string>();
    const allowedApplications = new Set<string>();

    // Для перфа: заранее вытаскиваем нужные предикаты один раз.
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
      companyGroupPos3: pCg3,
      application: pApp,
      dealType: pDealType,
      search: pSearch,
    } = predicates;

    for (const d of deals) {
      // dealType + search применяются всегда (это не дропдауны).
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
      const okCg3 = pCg3(d);
      const okApp = pApp(d);

      // Для каждого дропдауна F сделка попадает в набор опций F, если
      // проходят ВСЕ ОСТАЛЬНЫЕ предикаты дропдаунов.
      const allButSupplier = okBuy && okFac && okFuel && okMon && okFwd && okCg && okCg1 && okCg2 && okCg3 && okApp;
      const allButBuyer = okSup && okFac && okFuel && okMon && okFwd && okCg && okCg1 && okCg2 && okCg3 && okApp;
      const allButFactory = okSup && okBuy && okFuel && okMon && okFwd && okCg && okCg1 && okCg2 && okCg3 && okApp;
      const allButFuel = okSup && okBuy && okFac && okMon && okFwd && okCg && okCg1 && okCg2 && okCg3 && okApp;
      const allButMonth = okSup && okBuy && okFac && okFuel && okFwd && okCg && okCg1 && okCg2 && okCg3 && okApp;
      const allButForwarder = okSup && okBuy && okFac && okFuel && okMon && okCg && okCg1 && okCg2 && okCg3 && okApp;
      const allButCg = okSup && okBuy && okFac && okFuel && okMon && okFwd && okCg1 && okCg2 && okCg3 && okApp;
      const allButCg1 = okSup && okBuy && okFac && okFuel && okMon && okFwd && okCg && okCg2 && okCg3 && okApp;
      const allButCg2 = okSup && okBuy && okFac && okFuel && okMon && okFwd && okCg && okCg1 && okCg3 && okApp;
      const allButCg3 = okSup && okBuy && okFac && okFuel && okMon && okFwd && okCg && okCg1 && okCg2 && okApp;
      const allButApp = okSup && okBuy && okFac && okFuel && okMon && okFwd && okCg && okCg1 && okCg2 && okCg3;

      if (allButSupplier && d.supplier_id) allowedSuppliers.add(d.supplier_id);
      if (allButBuyer && d.buyer_id) allowedBuyers.add(d.buyer_id);
      if (allButFactory && d.factory_id) allowedFactories.add(d.factory_id);
      if (allButFuel && d.fuel_type_id) allowedFuelTypes.add(d.fuel_type_id);
      if (allButMonth && d.month) allowedMonths.add(d.month);
      if (allButForwarder && d.forwarder_id) allowedForwarders.add(d.forwarder_id);

      // Наборы группы компаний — берём из строк deal_company_groups,
      // которые прошли бы позиционный предикат.
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
      if (allButCg3) {
        for (const r of d.deal_company_groups ?? []) {
          if (r.position === 3 && r.company_group_id) allowedCompanyGroupsPos3.add(r.company_group_id);
        }
      }
      if (allButApp) {
        // Side-aware сужение: если оператор отфильтровал ТОЛЬКО ОДНУ
        // сторону (поставщика ИЛИ покупателя), дропдаун «приложение»
        // должен показывать номера договоров с ТОЙ ЖЕ стороны.
        // Подмешивание другой стороны давало «призрачные» опции,
        // которые никогда не могли совпасть с фильтром.
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
      companyGroupsPos3: allowedCompanyGroupsPos3,
      applications: allowedApplications,
    };
  }, [deals, predicates, deferredSupplier, deferredBuyer]);

  // Списки опций для каждого SearchableSelect — сужены каскадом выше, плюс
  // fallback, который включает текущие выбранные значения, чтобы выбор
  // оператора не пропадал молча из попапа (он может захотеть его СНЯТЬ).
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
      // Для дропдауна месяцев сохраняем канонический порядок (янв..дек) —
      // `all` несёт порядок источника.
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
      companyGroupPos3: fkOpts(refs.companyGroups, narrowed.companyGroupsPos3, deferredCompanyGroupPos3),
      month: strOpts(narrowed.months, deferredMonth, [...MONTHS_RU]),
      application: strOpts(narrowed.applications, deferredApplication),
    };
  }, [
    refs, narrowed,
    deferredSupplier, deferredBuyer, deferredFactory, deferredFuelType,
    deferredMonth, deferredForwarder, deferredCompanyGroup,
    deferredCompanyGroupPos1, deferredCompanyGroupPos2, deferredCompanyGroupPos3, deferredApplication,
  ]);

  // Фильтр «считается» активным, если у него есть хотя бы одно выбранное
  // значение. Счётчик в «Сбросить фильтры (N)» отражает количество осей,
  // сужающих результат, а не суммарное число выбранных значений.
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
    (companyGroupPos3.length > 0 ? 1 : 0) +
    (applicationFilter.length > 0 ? 1 : 0);

  function clearAll() {
    setSupplierFilter([]); setBuyerFilter([]); setFactoryFilter([]);
    setFuelTypeFilter([]); setMonthFilter([]); setForwarderFilter([]);
    setCompanyGroupFilter([]);
    setCompanyGroupPos1([]); setCompanyGroupPos2([]); setCompanyGroupPos3([]);
    setApplicationFilter([]);
    setSearch("");
  }

  const bar = (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-stone-400" />
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
            onClick={clearAll}
            className="h-7 text-[11px] hover:text-red-600 transition-colors text-stone-500"
          >
            <X className="h-3 w-3 mr-0.5" />
            Сбросить фильтры ({activeFilterCount})
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-11 gap-2">
        {/* Все дропдауны — МУЛЬТИ-выбор + ЗАВИСИМЫЕ. Опции идут из
            filterOpts, который уже сузил каждый список до значений,
            присутствующих в сделках, проходящих ВСЕ ОСТАЛЬНЫЕ активные
            фильтры — Excel auto-filter cascade. */}
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
          multi value={companyGroupPos3} onChange={setCompanyGroupPos3}
          options={filterOpts.companyGroupPos3}
          placeholder="Группа 3" searchPlaceholder="Поиск группы 3…"
        />
        <SearchableSelect
          multi value={applicationFilter} onChange={setApplicationFilter}
          options={filterOpts.application}
          placeholder="Все приложения" searchPlaceholder="Поиск договора…"
        />
      </div>
    </div>
  );

  return { filtered, activeFilterCount, clearAll, bar };
}

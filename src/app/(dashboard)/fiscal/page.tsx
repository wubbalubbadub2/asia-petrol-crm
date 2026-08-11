"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { parseAsArrayOf, parseAsString, useQueryState } from "nuqs";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { FiscalFiltersBar } from "@/components/fiscal/fiscal-filters";
import { FiscalTable } from "@/components/fiscal/fiscal-table";
import { FiscalCardList } from "@/components/mobile/fiscal-card-list";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import {
  DEFAULT_FISCAL_TAB,
  FISCAL_TABS,
  fiscalTab,
  type FiscalTabKey,
} from "@/lib/fiscal/constants";
import {
  currencyTotals,
  filterFiscalRows,
  EMPTY_FISCAL_FILTERS,
  type FiscalFilters,
} from "@/lib/fiscal/filter";
import {
  useFiscalCounterparties,
  useFiscalDocuments,
  useFiscalParties,
  useFiscalTabCounts,
} from "@/lib/hooks/use-fiscal-documents";

/**
 * Реестр фискальных документов: СНТ и ЭСФ из 1С.
 *
 * Фильтры стоят НАД вкладками и действуют на все три: их состояние
 * лежит в адресе, поэтому переключение вкладки его не сбрасывает, а
 * ссылка на отфильтрованный журнал шарится и переживает перезагрузку.
 *
 * Вкладки разведены по `direction_code`, а не по роли нашей стороны, —
 * клиент сверяет экран с журналом 1С, где импортная СНТ лежит в журнале
 * продаж. По умолчанию видны только актуальные позиции (не замещённые
 * исправлением и не гашеные); переключатель показывает всю цепочку.
 */
export default function FiscalPage() {
  const isMobile = useIsMobile();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [tabRaw, setTabRaw] = useQueryState("tab", { defaultValue: DEFAULT_FISCAL_TAB });
  const tab = fiscalTab(tabRaw).key;
  // Значение по умолчанию в адрес не пишем — ссылка остаётся чистой.
  const setTab = (next: FiscalTabKey) =>
    void setTabRaw(next === DEFAULT_FISCAL_TAB ? null : next);

  const [chainRaw, setChainRaw] = useQueryState("chain");
  const showChain = chainRaw === "1";

  const [query, setQuery] = useQueryState("q", { defaultValue: "" });
  const [suppliers, setSuppliers] = useQueryState("sup", parseAsArrayOf(parseAsString).withDefault([]));
  const [recipients, setRecipients] = useQueryState("rec", parseAsArrayOf(parseAsString).withDefault([]));
  const [dateFrom, setDateFrom] = useQueryState("from", { defaultValue: "" });
  const [dateTo, setDateTo] = useQueryState("to", { defaultValue: "" });

  const filters: FiscalFilters = useMemo(
    () => ({ ...EMPTY_FISCAL_FILTERS, query, suppliers, recipients, dateFrom, dateTo }),
    [query, suppliers, recipients, dateFrom, dateTo],
  );

  const onFilterChange = (next: Partial<FiscalFilters>) => {
    if (next.query !== undefined) void setQuery(next.query || null);
    if (next.suppliers !== undefined) void setSuppliers(next.suppliers.length ? next.suppliers : null);
    if (next.recipients !== undefined) void setRecipients(next.recipients.length ? next.recipients : null);
    if (next.dateFrom !== undefined) void setDateFrom(next.dateFrom || null);
    if (next.dateTo !== undefined) void setDateTo(next.dateTo || null);
  };

  const { rows, loading, error } = useFiscalDocuments(tab, showChain);
  const { counts } = useFiscalTabCounts();
  const { byId } = useFiscalCounterparties();
  const { suppliers: supplierOptions, recipients: recipientOptions } = useFiscalParties();

  const canonicalNameById = useMemo(
    () => new Map([...byId].map(([id, c]) => [id, c.canonical_name])),
    [byId],
  );

  // Поиск отложенный: набор в 4626 строк должен оставаться отзывчивым.
  const deferredFilters = useDeferredValue(filters);
  const visible = useMemo(
    () => filterFiscalRows(rows, deferredFilters, canonicalNameById),
    [rows, deferredFilters, canonicalNameById],
  );
  const totals = useMemo(() => currencyTotals(visible), [visible]);

  const current = counts[tab];
  const hidden = current.total - current.actual;

  const filtersBar = (
    <FiscalFiltersBar
      filters={filters}
      onChange={onFilterChange}
      suppliers={supplierOptions}
      recipients={recipientOptions}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3">
        <h1 className="mb-2 text-xl font-bold text-stone-900">СНТ и ЭСФ</h1>
      </div>

      {/* Фильтры НАД вкладками: действуют на все три */}
      {!isMobile && filtersBar}

      {isMobile && (
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Фильтры</SheetTitle>
            </SheetHeader>
            {filtersBar}
          </SheetContent>
        </Sheet>
      )}

      {/* Вкладки */}
      <div className="flex items-center gap-0 border-b border-stone-200 px-4">
        {FISCAL_TABS.map((t) => {
          const isActive = t.key === tab;
          const c = counts[t.key];
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-4 py-2 text-[13px] transition-colors ${
                isActive
                  ? "border-amber-500 font-semibold text-stone-900"
                  : "border-transparent text-stone-500 hover:text-stone-800"
              }`}
            >
              {t.label}
              <span className="ml-2 font-mono text-[11px] tabular-nums text-stone-400">
                {showChain ? c.total : c.actual}
              </span>
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2 py-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-stone-600">
            <Switch checked={showChain} onCheckedChange={(v) => void setChainRaw(v ? "1" : null)} />
            Показать всю цепочку
          </label>
          {!showChain && hidden > 0 && (
            <span className="text-[11px] text-stone-400">скрыто {hidden}</span>
          )}
          {isMobile && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => setFiltersOpen(true)}>
              <Filter className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="px-4 py-6 text-[13px] text-red-600">
            Не удалось загрузить реестр: {error}
          </div>
        ) : isMobile ? (
          <FiscalCardList rows={visible} canonicalNameById={canonicalNameById} />
        ) : (
          <FiscalTable
            rows={visible}
            canonicalNameById={canonicalNameById}
            totals={totals}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}

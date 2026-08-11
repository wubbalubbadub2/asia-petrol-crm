"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { activeFilterCount, type FiscalFilters } from "@/lib/fiscal/filter";
import type { FiscalParty } from "@/lib/hooks/use-fiscal-documents";

/**
 * Фильтры реестра. Живут НАД вкладками и действуют на все три: состояние
 * лежит в адресе, поэтому переключение вкладки его не сбрасывает.
 *
 * Поставщик и получатель — это поля 13/14 и 22/23 бланка. Значение
 * фильтра — БИН, подпись — наименование: один и тот же контрагент
 * приезжает из 1С под разными написаниями, и группировать по тексту
 * нельзя.
 *
 * Каждый фильтр обёрнут в контейнер фиксированной ширины: у триггера
 * SearchableSelect в стилях зашит w-full, и без обёртки он растягивается
 * на всю строку.
 */
export function FiscalFiltersBar({
  filters,
  onChange,
  suppliers,
  recipients,
}: {
  filters: FiscalFilters;
  onChange: (next: Partial<FiscalFilters>) => void;
  suppliers: FiscalParty[];
  recipients: FiscalParty[];
}) {
  const count = activeFilterCount(filters);
  const opts = (list: FiscalParty[]) =>
    list.map((p) => ({ value: p.identifier, label: `${p.name} · ${p.doc_count}` }));

  return (
    <div className="flex flex-wrap items-end gap-2 px-4 pb-2">
      <div className="w-[240px]">
        <Label className="text-[10px] text-stone-500">Поиск</Label>
        <Input
          value={filters.query}
          onChange={(e) => onChange({ query: e.target.value })}
          placeholder="Номер, госномер, БИН"
          className="h-8 text-[12px]"
        />
      </div>

      <div className="w-[130px]">
        <Label className="text-[10px] text-stone-500">Дата с</Label>
        <Input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onChange({ dateFrom: e.target.value })}
          className="h-8 text-[12px]"
        />
      </div>
      <div className="w-[130px]">
        <Label className="text-[10px] text-stone-500">Дата по</Label>
        <Input
          type="date"
          value={filters.dateTo}
          onChange={(e) => onChange({ dateTo: e.target.value })}
          className="h-8 text-[12px]"
        />
      </div>

      <div className="w-[280px]">
        <Label className="text-[10px] text-stone-500">Наименование поставщика</Label>
        <SearchableSelect
          multi
          options={opts(suppliers)}
          value={filters.suppliers}
          onChange={(next) => onChange({ suppliers: next })}
          placeholder="Все"
          searchPlaceholder="Наименование или БИН"
          triggerClassName="h-8 text-[12px]"
        />
      </div>

      <div className="w-[280px]">
        <Label className="text-[10px] text-stone-500">Наименование получателя</Label>
        <SearchableSelect
          multi
          options={opts(recipients)}
          value={filters.recipients}
          onChange={(next) => onChange({ recipients: next })}
          placeholder="Все"
          searchPlaceholder="Наименование или БИН"
          triggerClassName="h-8 text-[12px]"
        />
      </div>

      {count > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-[12px]"
          onClick={() =>
            onChange({ query: "", suppliers: [], recipients: [], dateFrom: "", dateTo: "" })
          }
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Сбросить ({count})
        </Button>
      )}
    </div>
  );
}

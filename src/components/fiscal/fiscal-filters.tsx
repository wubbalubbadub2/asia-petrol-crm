"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CURRENCIES } from "@/lib/constants/currencies";
import {
  COUNTERPARTY_NONE,
  OPERATION_KINDS,
  OPERATION_KIND_NONE,
} from "@/lib/fiscal/constants";
import { activeFilterCount, type FiscalFilters } from "@/lib/fiscal/filter";
import type { FiscalCounterparty } from "@/lib/hooks/use-fiscal-documents";

type FacetOption = { value: string; label: string; count: number };

/**
 * Фильтры реестра.
 *
 * Значения перечислений — коды, подписи — синонимы. Списки состояний и
 * типов собираются из загруженной вкладки, а виды операции заданы
 * константой: «Ввоз» обязан присутствовать даже при нулевом счётчике,
 * иначе восемь импортных СНТ нельзя было бы даже попытаться найти,
 * пока обработку 1С не поправят.
 */
export function FiscalFiltersBar({
  filters,
  onChange,
  stateOptions,
  typeOptions,
  counterparties,
  hasNonResident,
  operationCounts,
}: {
  filters: FiscalFilters;
  onChange: (next: Partial<FiscalFilters>) => void;
  stateOptions: FacetOption[];
  typeOptions: FacetOption[];
  counterparties: FiscalCounterparty[];
  hasNonResident: boolean;
  operationCounts: Map<string, number>;
}) {
  const count = activeFilterCount(filters);

  const cpOptions = [
    ...counterparties.map((c) => ({
      value: c.counterparty_identifier,
      // Число написаний показываем прямо в списке: оператору полезно
      // знать, что за одним пунктом скрыты разные тексты в документах.
      label:
        c.name_variants > 1
          ? `${c.canonical_name} · ${c.doc_count} док · ${c.name_variants} напис.`
          : `${c.canonical_name} · ${c.doc_count} док`,
    })),
    ...(hasNonResident
      ? [{ value: COUNTERPARTY_NONE, label: "Нерезиденты (без БИН)" }]
      : []),
  ];

  const opOptions = [
    ...OPERATION_KINDS.map((o) => ({
      value: o.code,
      label: `${o.label} · ${operationCounts.get(o.code) ?? 0}`,
    })),
    {
      value: OPERATION_KIND_NONE,
      label: `Без вида операции · ${operationCounts.get(OPERATION_KIND_NONE) ?? 0}`,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-3 py-2">
      <Input
        value={filters.query}
        onChange={(e) => onChange({ query: e.target.value })}
        placeholder="Номер, госномер, контрагент, БИН"
        className="h-8 w-[260px] text-[12px]"
      />

      <SearchableSelect
        multi
        options={stateOptions.map((o) => ({ value: o.value, label: `${o.label} · ${o.count}` }))}
        value={filters.stateCodes}
        onChange={(next) => onChange({ stateCodes: next })}
        placeholder="Состояние"
        triggerClassName="h-8 text-[12px]"
      />

      <SearchableSelect
        multi
        options={typeOptions.map((o) => ({ value: o.value, label: `${o.label} · ${o.count}` }))}
        value={filters.docTypeCodes}
        onChange={(next) => onChange({ docTypeCodes: next })}
        placeholder="Тип"
        triggerClassName="h-8 text-[12px]"
      />

      <SearchableSelect
        multi
        options={opOptions}
        value={filters.operationKindCodes}
        onChange={(next) => onChange({ operationKindCodes: next })}
        placeholder="Вид операции"
        triggerClassName="h-8 text-[12px]"
      />

      <SearchableSelect
        multi
        options={cpOptions}
        value={filters.counterparties}
        onChange={(next) => onChange({ counterparties: next })}
        placeholder="Контрагент"
        searchPlaceholder="Имя или БИН"
        triggerClassName="h-8 text-[12px]"
      />

      <SearchableSelect
        multi
        options={CURRENCIES.map((c) => ({ value: c.value, label: c.label }))}
        value={filters.currencies}
        onChange={(next) => onChange({ currencies: next })}
        placeholder="Валюта"
        triggerClassName="h-8 text-[12px]"
      />

      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onChange({ dateFrom: e.target.value })}
          className="h-8 w-[130px] text-[12px]"
          title="Дата регистрации с"
        />
        <span className="text-[11px] text-stone-400">—</span>
        <Input
          type="date"
          value={filters.dateTo}
          onChange={(e) => onChange({ dateTo: e.target.value })}
          className="h-8 w-[130px] text-[12px]"
          title="Дата регистрации по"
        />
      </div>

      {count > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-[12px]"
          onClick={() =>
            onChange({
              query: "",
              stateCodes: [],
              docTypeCodes: [],
              operationKindCodes: [],
              counterparties: [],
              currencies: [],
              dateFrom: "",
              dateTo: "",
            })
          }
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Сбросить ({count})
        </Button>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type SelectOption = { value: string; label: string };

type CommonProps = {
  options: SelectOption[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  triggerClassName?: string;
};

type SingleProps = CommonProps & {
  multi?: false;
  value: string;
  onChange: (next: string) => void;
};

type MultiProps = CommonProps & {
  multi: true;
  value: string[];
  onChange: (next: string[]) => void;
  /**
   * Optional label suffix for the trigger when 2+ values are selected.
   * Defaults to «Выбрано N». Pass a function for custom rendering.
   */
  multiSummary?: (count: number) => string;
  clearLabel?: string;
};

/**
 * Dropdown with a built-in search input. Filtering is fuzzy via cmdk.
 *
 * Two modes (discriminated by the `multi` prop, keeps the type system
 * honest about value/onChange shape):
 *
 *   1. Single (default): value: string, onChange(next: string)
 *      — clicking the same option toggles it off; X icon clears.
 *
 *   2. Multi (`multi`): value: string[], onChange(next: string[])
 *      — each row has a checkbox; trigger summarizes the selection;
 *        bottom row offers «Очистить». Empty array == no filter.
 *
 * The trigger button mimics the look of the native <select> filters
 * elsewhere on /deals so the row of filters stays visually uniform.
 */
export function SearchableSelect(props: SingleProps | MultiProps) {
  const {
    options,
    placeholder,
    searchPlaceholder = "Поиск…",
    emptyMessage = "Ничего не найдено",
    className,
    triggerClassName,
  } = props;
  const [open, setOpen] = useState(false);

  // --- selection helpers (collapse the two modes onto one shape) -----
  const isMulti = props.multi === true;
  const selectedSet = new Set<string>(
    isMulti ? props.value : props.value ? [props.value] : [],
  );
  const selectedCount = selectedSet.size;

  let triggerLabel: string;
  if (selectedCount === 0) {
    triggerLabel = placeholder;
  } else if (selectedCount === 1) {
    const onlyValue = [...selectedSet][0];
    triggerLabel = options.find((o) => o.value === onlyValue)?.label ?? placeholder;
  } else {
    const fn = isMulti ? props.multiSummary : undefined;
    triggerLabel = fn ? fn(selectedCount) : `Выбрано ${selectedCount}`;
  }

  function clearAll() {
    if (isMulti) props.onChange([]);
    else props.onChange("");
  }

  function toggle(optionValue: string) {
    if (isMulti) {
      const next = new Set(props.value);
      if (next.has(optionValue)) next.delete(optionValue);
      else next.add(optionValue);
      props.onChange([...next]);
      // Stay open in multi mode — operator may want to pick several.
    } else {
      props.onChange(optionValue === props.value ? "" : optionValue);
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "h-7 rounded-md border border-stone-200 bg-white px-2 text-[11px] focus:border-amber-400 focus:outline-none cursor-pointer flex items-center justify-between gap-1 text-left w-full",
          selectedCount > 0 ? "text-stone-800" : "text-stone-500",
          triggerClassName,
        )}
      >
        <span className="truncate flex-1">{triggerLabel}</span>
        {selectedCount > 0 ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              clearAll();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                clearAll();
              }
            }}
            className="text-stone-400 hover:text-red-500 shrink-0"
            title="Сбросить"
          >
            <X className="h-3 w-3" />
          </span>
        ) : (
          <ChevronDown className="h-3 w-3 text-stone-400 shrink-0" />
        )}
      </PopoverTrigger>
      <PopoverContent
        className={cn("p-0 w-[260px]", className)}
        align="start"
        sideOffset={4}
      >
        <Command
          shouldFilter
          // CommandItem.value below is `${label} ${uuid}` to keep cmdk's
          // keys unique even when labels collide. The downside is that
          // cmdk's default fuzzy filter matches against the UUID too —
          // typing "113" matched almost every option because random
          // UUIDs contain a '1','1','3' subsequence somewhere. Match
          // only against the label portion (everything before the last
          // space) so the search behaves like an honest substring.
          filter={(itemValue, search) => {
            const needle = search.trim().toLowerCase();
            if (!needle) return 1;
            const lastSpace = itemValue.lastIndexOf(" ");
            const label = (lastSpace > 0 ? itemValue.slice(0, lastSpace) : itemValue).toLowerCase();
            return label.includes(needle) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} className="text-[12px]" />
          <CommandList className="max-h-[280px]">
            <CommandEmpty className="text-[12px] py-3 text-center text-stone-400">
              {emptyMessage}
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const checked = selectedSet.has(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.value}`}
                    onSelect={() => toggle(o.value)}
                    className="text-[12px]"
                  >
                    {isMulti ? (
                      // Visual checkbox — keeps the popover layout aligned
                      // with the single-mode Check icon to the left.
                      <span
                        aria-hidden
                        className={cn(
                          "h-3 w-3 rounded border flex items-center justify-center",
                          checked
                            ? "bg-amber-500 border-amber-500 text-white"
                            : "border-stone-300 bg-white",
                        )}
                      >
                        {checked && <Check className="h-2.5 w-2.5" />}
                      </span>
                    ) : (
                      <Check
                        className={cn(
                          "h-3 w-3",
                          checked ? "opacity-100" : "opacity-0",
                        )}
                      />
                    )}
                    <span className="truncate">{o.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {isMulti && selectedCount > 0 && (
              <div className="border-t border-stone-200 px-2 py-1.5 flex items-center justify-between text-[11px] text-stone-500">
                <span>Выбрано: {selectedCount}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearAll();
                  }}
                  className="text-stone-500 hover:text-red-600 inline-flex items-center gap-1"
                >
                  <X className="h-3 w-3" />
                  {props.clearLabel ?? "Очистить"}
                </button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

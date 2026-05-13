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

/**
 * Dropdown with a built-in search input. Filtering is fuzzy via cmdk.
 *
 * The trigger button mimics the look of the native <select> filters
 * elsewhere on /deals so the row of filters stays visually uniform.
 * When no value is selected the placeholder shows; when a value is
 * selected the matching option label shows + a clear (X) button.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = "Поиск…",
  emptyMessage = "Ничего не найдено",
  className,
  triggerClassName,
}: {
  value: string;
  onChange: (next: string) => void;
  options: SelectOption[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "h-7 rounded-md border border-stone-200 bg-white px-2 text-[11px] focus:border-amber-400 focus:outline-none cursor-pointer flex items-center justify-between gap-1 text-left w-full",
          value ? "text-stone-800" : "text-stone-500",
          triggerClassName,
        )}
      >
        <span className="truncate flex-1">
          {selectedLabel ?? placeholder}
        </span>
        {value ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onChange("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                onChange("");
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
        <Command shouldFilter>
          <CommandInput placeholder={searchPlaceholder} className="text-[12px]" />
          <CommandList className="max-h-[280px]">
            <CommandEmpty className="text-[12px] py-3 text-center text-stone-400">
              {emptyMessage}
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  onSelect={() => {
                    onChange(o.value === value ? "" : o.value);
                    setOpen(false);
                  }}
                  className="text-[12px]"
                >
                  <Check
                    className={cn(
                      "h-3 w-3",
                      o.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

"use client";

/**
 * Horizontal workspace tab strip rendered at the top of the
 * dashboard's main content area. Shows every open tab, the active
 * one is highlighted, click switches, the X button closes.
 *
 * Middle-click on a tab also closes (browser convention). The «+»
 * button opens the deals list in a new tab — the most common entry
 * point.
 */

import { useTabs, type Tab } from "@/lib/contexts/tabs-context";
import { cn } from "@/lib/utils";
import {
  X,
  Plus,
  LayoutDashboard,
  BookOpen,
  TrendingUp,
  FileText,
  ClipboardList,
  Truck,
  Calculator,
  DollarSign,
  AlertTriangle,
  Upload,
  Archive,
  Settings,
  type LucideIcon,
} from "lucide-react";

// Icon lookup — names match the `displayName` on each lucide
// component, which is also what we store in Tab.iconKey.
const ICON_BY_KEY: Record<string, LucideIcon> = {
  LayoutDashboard,
  BookOpen,
  TrendingUp,
  FileText,
  ClipboardList,
  Truck,
  Calculator,
  DollarSign,
  AlertTriangle,
  Upload,
  Archive,
  Settings,
};

function TabPill({
  tab,
  isActive,
  onSelect,
  onClose,
}: {
  tab: Tab;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const Icon = ICON_BY_KEY[tab.iconKey] ?? FileText;
  return (
    <div
      role="tab"
      aria-selected={isActive}
      onClick={onSelect}
      onAuxClick={(e) => {
        // Middle-click closes — matches browser tab UX.
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      className={cn(
        "group/tab flex items-center gap-2 px-3 h-8 min-w-[90px] max-w-[200px] border-r border-stone-200 cursor-pointer select-none transition-colors text-[12px]",
        isActive
          ? "bg-white text-stone-900 font-medium"
          : "bg-stone-100 text-stone-600 hover:bg-stone-50 hover:text-stone-800",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-amber-600" : "text-stone-500")} />
      <span className="truncate flex-1" title={tab.title}>
        {tab.title}
      </span>
      <button
        type="button"
        aria-label="Закрыть вкладку"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          "shrink-0 h-4 w-4 rounded flex items-center justify-center",
          isActive
            ? "hover:bg-stone-200 text-stone-500 hover:text-stone-700"
            : "opacity-0 group-hover/tab:opacity-100 hover:bg-stone-200 text-stone-400 hover:text-stone-600",
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function TabBar() {
  const { tabs, activeId, switchTab, closeTab, openTab } = useTabs();

  // Only render once we have at least one tab — TabsProvider
  // guarantees this on real pages but it can be empty during the
  // very first paint of a fallback context.
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-stretch bg-stone-100 border-b border-stone-300 h-8 overflow-x-auto">
      {tabs.map((tab) => (
        <TabPill
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeId}
          onSelect={() => switchTab(tab.id)}
          onClose={() => closeTab(tab.id)}
        />
      ))}
      <button
        type="button"
        aria-label="Новая вкладка"
        onClick={() => openTab("/deals")}
        className="shrink-0 flex items-center justify-center w-8 hover:bg-stone-200 text-stone-500 hover:text-stone-800"
        title="Новая вкладка (Сделки)"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

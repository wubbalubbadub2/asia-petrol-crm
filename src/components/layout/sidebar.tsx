"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Fuel, PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItems, type NavItem } from "@/lib/constants/nav-items";
import { useRole } from "@/lib/hooks/use-role";
import { useTabs } from "@/lib/contexts/tabs-context";

/**
 * Inner child of <Link>. `useLinkStatus()` returns the pending state
 * for THIS Link instance — Next.js sets it the moment the user
 * clicks, before the destination route's chunk has finished
 * downloading. We render an «armed» visual state (slightly brighter
 * bg + pulsing dot) so the operator sees that the click landed,
 * even if the route takes a second to mount. Without this, dense
 * dashboard pages can feel like the click did nothing.
 *
 * Hook contract (Next 15.3+): MUST be in a descendant component of
 * <Link>, not on Link itself.
 */
function NavLinkBody({
  Icon,
  label,
  isActive,
  collapsed,
}: {
  Icon: LucideIcon;
  label: string;
  isActive: boolean;
  collapsed: boolean;
}) {
  const { pending } = useLinkStatus();

  return (
    <span
      // overflow-hidden + whitespace-nowrap on labels — without this,
      // labels would wrap during the width transition the moment the
      // sidebar passes through narrow intermediate widths («Реестр
      // отгрузки» visibly broke into 2 lines mid-expand).
      className={cn(
        "group/body flex items-center rounded-lg text-[13px] font-medium transition-all duration-200 overflow-hidden",
        collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
        pending
          ? "bg-amber-500/25 text-amber-300"
          : isActive
            ? "bg-amber-500/15 text-amber-400"
            : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
      )}
    >
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-colors",
          pending || isActive
            ? "text-amber-400"
            : "text-slate-500 group-hover/body:text-slate-300",
        )}
      />
      {!collapsed && <span className="whitespace-nowrap">{label}</span>}
      {!collapsed && (pending ? (
        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 animate-pulse" />
      ) : isActive ? (
        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
      ) : null)}
    </span>
  );
}

function NavLink({
  item,
  pathname,
  onNavigate,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
  collapsed: boolean;
}) {
  const isActive =
    pathname === item.href ||
    (item.href !== "/" && pathname.startsWith(item.href));

  const { openTab } = useTabs();

  // Sidebar nav opens/activates the singleton workspace tab for
  // this section. Ctrl/Cmd-click opens it in the background — used
  // to set up multiple contexts in one go.
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      openTab(item.href, { background: true });
      onNavigate?.();
      return;
    }
    e.preventDefault();
    openTab(item.href);
    onNavigate?.();
  };

  return (
    <Link
      href={item.href}
      onClick={handleClick}
      className="block"
      // Native title — base-ui Tooltip doesn't compose cleanly with
      // <Link>'s render contract, and the operator just needs to know
      // the label on hover. Title is universal and zero-cost.
      title={collapsed ? item.label : undefined}
    >
      <NavLinkBody Icon={item.icon} label={item.label} isActive={isActive} collapsed={collapsed} />
    </Link>
  );
}

export function Sidebar({
  onNavigate,
  collapsed = false,
  onToggle,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
} = {}) {
  const pathname = usePathname();
  const { isAdmin } = useRole();

  const filteredItems = navItems.filter(
    (item) => !item.adminOnly || isAdmin
  );

  return (
    <>
      <aside
        className={cn(
          "flex h-screen flex-col bg-gradient-to-b from-slate-900 to-slate-950 border-r border-slate-800/50 transition-[width] duration-200",
          collapsed ? "w-[56px]" : "w-[240px]",
        )}
      >
        {/* Header — logo + title (expanded only) + toggle button.
            Toggle stays in the SAME vertical position in both states
            (top of the sidebar, right side of the header strip when
            expanded, centered when collapsed). Logo+title disappear
            in collapsed mode to make room for the toggle. */}
        <div className={cn(
          "flex h-14 items-center border-b border-slate-800/50 overflow-hidden",
          collapsed ? "justify-center px-2" : "gap-3 px-5",
        )}>
          {!collapsed && (
            <>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg shadow-amber-500/20">
                <Fuel className="h-4 w-4 text-white" />
              </div>
              <span
                className="flex-1 text-[15px] font-bold text-white tracking-tight whitespace-nowrap"
                style={{ fontFamily: "'Satoshi', 'DM Sans', sans-serif" }}
              >
                Singularity Trading
              </span>
            </>
          )}
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
              title={collapsed ? "Развернуть (⌘/Ctrl+B)" : "Свернуть (⌘/Ctrl+B)"}
              className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/5 hover:text-slate-200 transition-colors"
            >
              {collapsed
                ? <PanelLeftOpen className="h-4 w-4" />
                : <PanelLeftClose className="h-4 w-4" />}
            </button>
          )}
        </div>

        {/* Navigation */}
        <div className={cn("flex-1 overflow-y-auto py-4 space-y-1", collapsed ? "px-1.5" : "px-3")}>
          {!collapsed && (
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              Навигация
            </p>
          )}
          {filteredItems.slice(0, 4).map((item) => (
            <NavLink key={item.href + item.label} item={item} pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} />
          ))}

          <div className="my-3 border-t border-slate-800/50" />
          {!collapsed && (
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              Операции
            </p>
          )}
          {filteredItems.filter((i) => !i.adminOnly).slice(4).map((item) => (
            <NavLink key={item.href + item.label} item={item} pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} />
          ))}
        </div>

        {/* Footer — version line only (toggle lives in the header
            so the click target stays in one vertical spot regardless
            of collapsed state). Hidden when collapsed to avoid extra
            chrome at narrow widths. */}
        {!collapsed && (
          <div className="border-t border-slate-800/50 px-5 py-3">
            <p className="text-[10px] text-slate-600">v0.1.0</p>
          </div>
        )}
      </aside>
    </>
  );
}

"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Fuel, type LucideIcon } from "lucide-react";
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
}: {
  Icon: LucideIcon;
  label: string;
  isActive: boolean;
}) {
  const { pending } = useLinkStatus();

  return (
    <span
      className={cn(
        "group/body flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200",
        // Pending overrides active styling so the «armed» feedback
        // is unmistakable on the currently-active link too.
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
      <span>{label}</span>
      {pending ? (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
      ) : isActive ? (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />
      ) : null}
    </span>
  );
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
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
    <Link href={item.href} onClick={handleClick} className="block">
      <NavLinkBody Icon={item.icon} label={item.label} isActive={isActive} />
    </Link>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  const { isAdmin } = useRole();

  const filteredItems = navItems.filter(
    (item) => !item.adminOnly || isAdmin
  );

  return (
    <aside className="flex h-screen w-[240px] flex-col bg-gradient-to-b from-slate-900 to-slate-950 border-r border-slate-800/50">
      {/* Logo */}
      <div className="flex h-14 items-center gap-3 px-5 border-b border-slate-800/50">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg shadow-amber-500/20">
          <Fuel className="h-4 w-4 text-white" />
        </div>
        <div>
          <span
            className="text-[15px] font-bold text-white tracking-tight"
            style={{ fontFamily: "'Satoshi', 'DM Sans', sans-serif" }}
          >
            Singularity Trading
          </span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          Навигация
        </p>
        {filteredItems.slice(0, 4).map((item) => (
          <NavLink key={item.href + item.label} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}

        <div className="my-3 border-t border-slate-800/50" />
        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          Операции
        </p>
        {filteredItems.filter((i) => !i.adminOnly).slice(4).map((item) => (
          <NavLink key={item.href + item.label} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-800/50 px-5 py-3">
        <p className="text-[10px] text-slate-600">v0.1.0</p>
      </div>
    </aside>
  );
}

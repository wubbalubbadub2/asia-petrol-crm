"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Fuel } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItems, type NavItem } from "@/lib/constants/nav-items";
import { useRole } from "@/lib/hooks/use-role";

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive =
    pathname === item.href ||
    (item.href !== "/" && pathname.startsWith(item.href));
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200",
        isActive
          ? "bg-amber-500/15 text-amber-400"
          : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
      )}
    >
      <Icon className={cn(
        "h-[18px] w-[18px] shrink-0 transition-colors",
        isActive ? "text-amber-400" : "text-slate-500 group-hover:text-slate-300"
      )} />
      <span>{item.label}</span>
      {isActive && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />
      )}
    </Link>
  );
}

export function Sidebar() {
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
            Asia Petrol
          </span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          Навигация
        </p>
        {filteredItems.slice(0, 4).map((item) => (
          <NavLink key={item.href + item.label} item={item} pathname={pathname} />
        ))}

        <div className="my-3 border-t border-slate-800/50" />
        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          Операции
        </p>
        {filteredItems.slice(4, 10).map((item) => (
          <NavLink key={item.href + item.label} item={item} pathname={pathname} />
        ))}

        {filteredItems.length > 10 && (
          <>
            <div className="my-3 border-t border-slate-800/50" />
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              Система
            </p>
            {filteredItems.slice(10).map((item) => (
              <NavLink key={item.href + item.label} item={item} pathname={pathname} />
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-800/50 px-5 py-3">
        <p className="text-[10px] text-slate-600">v0.1.0</p>
      </div>
    </aside>
  );
}

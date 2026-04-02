"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Fuel } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItems, type NavItem } from "@/lib/constants/nav-items";
import { useRole } from "@/lib/hooks/use-role";
import { ScrollArea } from "@/components/ui/scroll-area";

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const [open, setOpen] = useState(
    item.children?.some((c) => pathname.startsWith(c.href)) ?? false
  );
  const isActive =
    pathname === item.href ||
    item.children?.some((c) => pathname === c.href);
  const Icon = item.icon;

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            "flex w-full items-center gap-2 rounded px-3 py-1.5 text-[13px] font-medium transition-colors",
            isActive
              ? "bg-[#334155] text-white"
              : "text-slate-400 hover:bg-[#334155] hover:text-slate-200"
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>
        {open && (
          <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-600 pl-3">
            {item.children.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  "block rounded px-3 py-1 text-[12px] transition-colors",
                  pathname === child.href
                    ? "bg-[#334155] font-medium text-amber-400"
                    : "text-slate-400 hover:bg-[#334155] hover:text-slate-200"
                )}
              >
                {child.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2 rounded px-3 py-1.5 text-[13px] font-medium transition-colors",
        isActive
          ? "bg-[#334155] text-white"
          : "text-slate-400 hover:bg-[#334155] hover:text-slate-200"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {item.label}
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
    <aside className="flex h-screen w-60 flex-col bg-[#1E293B]">
      <div className="flex h-12 items-center gap-2 border-b border-slate-700 px-4">
        <Fuel className="h-5 w-5 text-amber-500" />
        <span className="text-[15px] font-bold text-white" style={{ fontFamily: "'Satoshi', 'DM Sans', sans-serif" }}>
          Asia Petrol
        </span>
      </div>
      <ScrollArea className="flex-1 px-2 py-3">
        <nav className="space-y-0.5">
          {filteredItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
      </ScrollArea>
    </aside>
  );
}

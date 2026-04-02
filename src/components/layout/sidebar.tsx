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
  const isActive =
    pathname === item.href ||
    (item.href !== "/" && pathname.startsWith(item.href)) ||
    item.children?.some((c) => pathname.startsWith(c.href));
  const [open, setOpen] = useState(isActive && !!item.children);
  const Icon = item.icon;

  if (item.children) {
    return (
      <div>
        <div className="flex items-center">
          <Link
            href={item.href}
            className={cn(
              "flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all",
              isActive
                ? "bg-amber-50 text-amber-900"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            )}
          >
            <Icon className={cn("h-4 w-4", isActive ? "text-amber-600" : "text-stone-400")} />
            <span className="flex-1">{item.label}</span>
          </Link>
          <button
            onClick={() => setOpen(!open)}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 mr-1"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")} />
          </button>
        </div>
        {open && (
          <div className="ml-6 mt-0.5 space-y-0.5 border-l border-stone-200 pl-2.5">
            {item.children.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  "block rounded-md px-2.5 py-1.5 text-[12px] transition-all",
                  pathname === child.href
                    ? "bg-amber-50 font-medium text-amber-800"
                    : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
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
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all",
        isActive
          ? "bg-amber-50 text-amber-900"
          : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      )}
    >
      <Icon className={cn("h-4 w-4", isActive ? "text-amber-600" : "text-stone-400")} />
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
    <aside className="flex h-screen w-[220px] flex-col border-r border-stone-200 bg-white">
      <div className="flex h-12 items-center gap-2.5 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500">
          <Fuel className="h-4 w-4 text-white" />
        </div>
        <span
          className="text-[15px] font-bold text-stone-900"
          style={{ fontFamily: "'Satoshi', 'DM Sans', sans-serif" }}
        >
          Asia Petrol
        </span>
      </div>
      <ScrollArea className="flex-1 px-2.5 py-2">
        <nav className="space-y-0.5">
          {filteredItems.map((item) => (
            <NavLink key={item.href + item.label} item={item} pathname={pathname} />
          ))}
        </nav>
      </ScrollArea>
      <div className="border-t border-stone-200 px-4 py-2.5">
        <p className="text-[10px] text-stone-400">Asia Petrol CRM v0.1</p>
      </div>
    </aside>
  );
}

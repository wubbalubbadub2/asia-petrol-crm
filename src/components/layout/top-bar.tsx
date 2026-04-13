"use client";

import { useRouter } from "next/navigation";
import { LogOut, ChevronDown, Bell, Archive, Settings, Menu } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/hooks/use-role";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function TopBar({ onMenuClick }: { onMenuClick?: () => void } = {}) {
  const { profile } = useRole();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const roleLabels: Record<string, string> = {
    admin: "Админ",
    manager: "Менеджер",
    logistics: "Логист",
    accounting: "Бухгалтерия",
    readonly: "Просмотр",
  };

  const roleColors: Record<string, string> = {
    admin: "bg-amber-100 text-amber-700",
    manager: "bg-blue-100 text-blue-700",
    logistics: "bg-green-100 text-green-700",
    accounting: "bg-purple-100 text-purple-700",
    readonly: "bg-stone-100 text-stone-600",
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-stone-200/80 bg-white/80 backdrop-blur-sm px-3 sm:px-6">
      <button onClick={onMenuClick} className="lg:hidden p-2 -ml-1 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors">
        <Menu className="h-5 w-5" />
      </button>
      <div className="hidden lg:block" />
      <div className="flex items-center gap-4">
        {/* Notification bell placeholder */}
        <button className="relative p-2 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors">
          <Bell className="h-[18px] w-[18px]" />
        </button>

        {profile && (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2.5 rounded-xl border border-stone-200 px-3 py-1.5 hover:bg-stone-50 transition-all">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-[11px] font-bold text-white shadow-sm">
                {profile.full_name?.charAt(0)?.toUpperCase() ?? "U"}
              </div>
              <div className="text-left">
                <p className="text-[12px] font-medium text-stone-800 leading-tight">{profile.full_name}</p>
                <span className={`inline-block rounded px-1 py-0 text-[9px] font-semibold uppercase tracking-wide ${roleColors[profile.role] ?? "bg-stone-100 text-stone-500"}`}>
                  {roleLabels[profile.role] ?? profile.role}
                </span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {profile.role === "admin" && (
                <>
                  <DropdownMenuItem onClick={() => router.push("/archive")}>
                    <Archive className="mr-2 h-3.5 w-3.5" />
                    Архив
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push("/settings")}>
                    <Settings className="mr-2 h-3.5 w-3.5" />
                    Настройки
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-3.5 w-3.5" />
                Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

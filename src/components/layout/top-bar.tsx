"use client";

import { useRouter } from "next/navigation";
import { LogOut, User, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/hooks/use-role";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function TopBar() {
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

  return (
    <header className="flex h-12 items-center justify-end border-b border-stone-200 bg-white px-5">
      {profile && (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-stone-600 hover:bg-stone-50 transition-colors">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-[10px] font-semibold text-amber-700">
              {profile.full_name?.charAt(0)?.toUpperCase() ?? "U"}
            </div>
            <span className="font-medium text-stone-700">{profile.full_name}</span>
            <span className="text-[11px] text-stone-400">{roleLabels[profile.role]}</span>
            <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}

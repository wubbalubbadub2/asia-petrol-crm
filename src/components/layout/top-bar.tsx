"use client";

import { useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";
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
    admin: "Администратор",
    manager: "Менеджер",
    logistics: "Логист",
    accounting: "Бухгалтерия",
    readonly: "Просмотр",
  };

  return (
    <header className="flex h-11 items-center justify-between border-b border-stone-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-3">
        {profile && (
          <>
            <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              {roleLabels[profile.role] ?? profile.role}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[13px] text-stone-600 hover:bg-stone-100"
              >
                <User className="h-3.5 w-3.5" />
                {profile.full_name}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-3.5 w-3.5" />
                  Выйти
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </header>
  );
}

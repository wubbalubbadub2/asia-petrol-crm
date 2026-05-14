import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { UsersManager } from "./users-manager";

type UserRole = "admin" | "manager" | "logistics" | "accounting" | "readonly";

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (me?.role !== "admin") {
    return (
      <div className="space-y-4">
        <Link href="/settings" className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-700">
          <ArrowLeft className="h-3 w-3" /> Настройки
        </Link>
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <ShieldAlert className="h-5 w-5 text-red-500" />
            <span className="text-sm">
              Управление пользователями доступно только администратору.
            </span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const admin = createAdminClient();

  const [{ data: profiles }, { data: listed }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, role, is_active")
      .order("full_name", { ascending: true }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const emailById = new Map<string, string | null>();
  for (const u of listed?.users ?? []) emailById.set(u.id, u.email ?? null);

  const rows = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    role: p.role as UserRole,
    is_active: p.is_active ?? true,
    email: emailById.get(p.id) ?? null,
  }));

  return (
    <div className="space-y-4">
      <Link href="/settings" className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-700">
        <ArrowLeft className="h-3 w-3" /> Настройки
      </Link>
      <UsersManager initialRows={rows} />
    </div>
  );
}

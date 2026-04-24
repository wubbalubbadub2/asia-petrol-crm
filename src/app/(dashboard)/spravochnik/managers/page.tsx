import { Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { UsersManager } from "@/app/(dashboard)/settings/users/users-manager";

type UserRole = "admin" | "manager" | "logistics" | "accounting" | "readonly";

export default async function ManagersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: me } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = me?.role === "admin";

  const admin = createAdminClient();
  const [{ data: profiles }, listed] = await Promise.all([
    admin.from("profiles").select("id, full_name, role, is_active").order("full_name", { ascending: true }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const emailById = new Map<string, string | null>();
  for (const u of listed.data?.users ?? []) emailById.set(u.id, u.email ?? null);

  const rows = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    role: p.role as UserRole,
    is_active: p.is_active ?? true,
    email: emailById.get(p.id) ?? null,
  }));

  return (
    <div className="space-y-4">
      {!isAdmin && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Добавление и редактирование менеджеров доступно только администратору.
          </span>
        </div>
      )}
      <UsersManager initialRows={rows} readOnly={!isAdmin} title="Менеджеры" />
    </div>
  );
}

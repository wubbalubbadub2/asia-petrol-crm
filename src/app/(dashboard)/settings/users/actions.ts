"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type UserRole = "admin" | "manager" | "logistics" | "accounting" | "readonly";

type Result = { ok: true } | { ok: false; error: string };

async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Не авторизовано" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { ok: false, error: "Доступ только у администратора" };
  return { ok: true };
}

export async function createUserAction(input: {
  email: string;
  password: string;
  full_name: string;
  role: UserRole;
}): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const email = input.email.trim().toLowerCase();
  const full_name = input.full_name.trim();
  if (!email || !full_name || !input.password) {
    return { ok: false, error: "Email, имя и пароль обязательны" };
  }
  if (input.password.length < 6) {
    return { ok: false, error: "Пароль минимум 6 символов" };
  }

  const admin = createAdminClient();

  // Create auth user. handle_new_user trigger (migration 00001) auto-creates
  // the profile row from user_metadata.
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name, role: input.role },
  });
  if (authErr || !created.user) {
    return { ok: false, error: authErr?.message ?? "Не удалось создать пользователя" };
  }

  // The trigger reads user_metadata.role, but if a future metadata schema
  // drifts we still want the profile row to match. Upsert defensively.
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert({ id: created.user.id, full_name, role: input.role, is_active: true });
  if (profileErr) {
    // Roll the auth user back so the admin can retry cleanly.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: profileErr.message };
  }

  revalidatePath("/settings/users");
  return { ok: true };
}

export async function updateUserAction(input: {
  id: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
}): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      full_name: input.full_name.trim(),
      role: input.role,
      is_active: input.is_active,
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/users");
  return { ok: true };
}

export async function resetPasswordAction(input: {
  id: string;
  password: string;
}): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (input.password.length < 6) {
    return { ok: false, error: "Пароль минимум 6 символов" };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(input.id, {
    password: input.password,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteUserAction(input: { id: string }): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const admin = createAdminClient();
  // auth.users ON DELETE CASCADE removes the profile row (see migration 00001).
  const { error } = await admin.auth.admin.deleteUser(input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/users");
  return { ok: true };
}

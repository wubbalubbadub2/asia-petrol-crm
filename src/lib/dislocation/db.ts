/**
 * Клиент Supabase для таблиц 00174. `database.ts` генерируется из прода и
 * о таблицах rail_* узнает только после `npm run types:db`, поэтому здесь
 * нетипизированный клиент — тот же приём, что в transport-requests/[id].
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export function railDb(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

/** Сообщение PostgREST/Postgres → текст для тоста. */
export function dbErrorMessage(error: { message?: string; code?: string } | null): string {
  if (!error) return "";
  if (error.code === "23505") return error.message?.startsWith("Файл уже загружен")
    ? error.message
    : "Такая запись уже есть";
  if (error.code === "42501") return "Недостаточно прав";
  return error.message ?? "Ошибка базы";
}

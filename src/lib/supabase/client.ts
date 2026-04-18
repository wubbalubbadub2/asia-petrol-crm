import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env var ${name}. Copy .env.example to .env.local and fill in ` +
      `NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.`,
    );
  }
  return v;
}

const SUPABASE_URL = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";

// Static property access is required so Next.js inlines the values into
// the browser bundle at build time. A dynamic lookup like process.env[name]
// does NOT get inlined and will be undefined at runtime in the client.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing Supabase env vars. Copy .env.example to .env.local and fill in " +
    "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  );
}

export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}

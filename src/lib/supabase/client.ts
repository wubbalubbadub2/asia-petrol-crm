import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://oteysqqohcgnwpsxmyjg.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90ZXlzcXFvaGNnbndwc3hteWpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTQyNjgsImV4cCI6MjA4ODEzMDI2OH0.sjodhktQUHiozb5Rcq37GlGK-7TlnWbhkhA-PZXWeCo";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

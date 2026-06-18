import { type NextRequest } from "next/server";

// Edge-runtime keepalive ping. Vercel cron hits this every minute;
// the route turns around and does a 49-byte SELECT 1 against
// PostgREST so the Supabase pooler + schema cache stay warm. Without
// this, the first query after a 5-minute idle hits a 1.5 s cold-start
// penalty on top of normal latency.
//
// Per-minute cron requires Vercel Pro tier — on Hobby the cron only
// fires once a day and will NOT keep things warm. Fallback: the
// dashboard layout fires the same ping every 4 minutes from the
// browser while an operator is logged in (src/app/(dashboard)/layout.tsx).
//
// The route is intentionally unauthenticated. Worst case a stranger
// costs us one round-trip to Supabase reading a single deal id; the
// risk is negligible and avoids env-var coupling.
export const runtime = "edge";

export async function GET(_request: NextRequest) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const start = Date.now();
  const res = await fetch(`${SB_URL}/rest/v1/deals?select=id&limit=1`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` },
    cache: "no-store",
  });
  const elapsed = Date.now() - start;
  return new Response(JSON.stringify({ ok: res.ok, elapsed }), {
    headers: { "content-type": "application/json" },
  });
}

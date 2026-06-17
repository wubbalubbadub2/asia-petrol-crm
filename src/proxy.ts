import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Server-side optimistic auth check (Next.js 16 "proxy" = middleware).
// Refreshes the Supabase session cookie and redirects unauthenticated users
// to /login before any HTML is served. RLS remains the authoritative
// authorization layer; this is defense in depth.
//
// PERF: skip RSC prefetch traffic. Every <Link> + router.prefetch fires an
// RSC fetch (typically `/<route>?_rsc=...`). Gating each one on a
// Supabase auth round-trip turns a single click into seconds of waiting
// while N background prefetches finish. RSC prefetches don't render —
// they only hydrate the client cache — and the subsequent document /
// real RSC navigation still hits the proxy for the authoritative check.
export async function proxy(request: NextRequest) {
  if (isRscRequest(request)) {
    return NextResponse.next();
  }
  return await updateSession(request);
}

function isRscRequest(request: NextRequest): boolean {
  // Next.js strips FLIGHT_HEADERS (`rsc`, `next-router-state-tree`,
  // `next-router-prefetch`) from the proxy request unless
  // `skipProxyUrlNormalize` is set, but the `_rsc` query parameter
  // always survives. Check both for robustness across configs.
  if (request.nextUrl.searchParams.has("_rsc")) {
    return true;
  }
  const h = request.headers;
  if (h.get("rsc") === "1") return true;
  if (h.get("next-router-prefetch") === "1") return true;
  if (h.has("next-router-state-tree")) return true;
  if (h.get("purpose") === "prefetch") return true;
  return false;
}

export const config = {
  matcher: [
    // Skip static assets, image optimisation, and RSC data paths.
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

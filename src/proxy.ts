import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Server-side optimistic auth check (Next.js 16 "proxy" = middleware).
// Refreshes the Supabase session cookie and redirects unauthenticated users
// to /login before any HTML is served. RLS remains the authoritative
// authorization layer; this is defense in depth.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Skip static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

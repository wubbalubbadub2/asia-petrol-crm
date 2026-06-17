import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Edge middleware — runs in `fra1` (vercel.json) for every matching
 * route. Refreshes the Supabase auth session via cookies and redirects
 * unauthenticated users to /login BEFORE the dashboard bundle ever
 * downloads.
 *
 * Why this matters (audit 2026-06-17): previously AuthGuard ran the
 * `supabase.auth.getUser()` round-trip on the client inside a
 * useEffect after the 970 KB dashboard bundle hydrated. So the user
 * paid for: bundle download → hydrate → auth call → THEN data fetch.
 * Now the auth check is done at the edge before HTML even ships;
 * AuthGuard becomes a no-op for authed sessions (just renders
 * children) and the data fetch can race with hydration instead of
 * waiting for it.
 *
 * The matcher excludes the static asset paths Next.js serves under
 * /_next plus a handful of file extensions so the middleware doesn't
 * run on every image/css/font request.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Match all routes except:
    //  - /_next/static  (compiled assets)
    //  - /_next/image   (next/image optimizer)
    //  - /favicon.ico, common image extensions
    //  - /api routes that handle their own auth
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};

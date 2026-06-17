import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database";

// If the cached session has at least this many seconds left we trust it
// without round-tripping to Supabase Auth. Supabase's @supabase/ssr
// auto-refreshes well before expiry on the client, so this is just an
// optimistic skip for the common "user is logged in, token is fresh" case.
const SESSION_SKEW_SECONDS = 60;

export async function updateSession(request: NextRequest) {
  const isLoginPath = request.nextUrl.pathname.startsWith("/login");
  const isAuthCallbackPath = request.nextUrl.pathname.startsWith("/auth");

  // -- Fast path -----------------------------------------------------------
  // Avoid the supabase.auth.getUser() network round-trip (300-800ms cold,
  // 150-400ms warm from EU edge) when we can locally verify the session
  // cookie's expiry. We can't redirect /login -> / from the fast path
  // (that would require trusting only the cookie's presence as proof of
  // auth, which is fine for routing but worth the auth check on /login
  // itself), so we still fall through to the slow path for those routes.
  if (!isLoginPath && !isAuthCallbackPath) {
    const expiresAt = readSessionExpiry(request);
    if (expiresAt !== null) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (expiresAt - nowSeconds > SESSION_SKEW_SECONDS) {
        // Cookie is comfortably valid — pass through, no Supabase call.
        return NextResponse.next({ request });
      }
    }
  }

  // -- Slow path: cookie missing, expired, or near expiry, or auth route --
  let supabaseResponse = NextResponse.next({ request });

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing Supabase env vars in middleware");
  }

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users to login
  if (!user && !isLoginPath && !isAuthCallbackPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login
  if (user && isLoginPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

// ---------------------------------------------------------------------------
// Cookie fast-path helpers
// ---------------------------------------------------------------------------

/**
 * Reads the Supabase session cookie (name pattern `sb-<project-ref>-auth-token`,
 * optionally chunked as `.0`, `.1`, ...) and returns the session's `expires_at`
 * (epoch seconds) without doing any network IO. Returns null when no cookie is
 * present or it can't be parsed — caller should then fall through to
 * `supabase.auth.getUser()`.
 */
function readSessionExpiry(request: NextRequest): number | null {
  const raw = readAuthCookie(request);
  if (!raw) return null;

  const decoded = decodeCookieValue(raw);
  if (!decoded) return null;

  // The cookie holds the full Supabase session as JSON. `expires_at` is
  // the authoritative expiry (matches the access_token JWT's `exp` claim).
  try {
    const session = JSON.parse(decoded) as { expires_at?: unknown; access_token?: unknown };
    if (typeof session.expires_at === "number" && Number.isFinite(session.expires_at)) {
      return session.expires_at;
    }
    // Fallback: decode the access_token JWT's middle segment if expires_at
    // is missing for some reason (shouldn't happen, but cheap to support).
    if (typeof session.access_token === "string") {
      return readJwtExp(session.access_token);
    }
  } catch {
    // Cookie is malformed — let the slow path handle it.
  }
  return null;
}

function readAuthCookie(request: NextRequest): string | null {
  // The cookie name is `sb-<project-ref>-auth-token` and it may be chunked
  // into `<name>.0`, `<name>.1`, ... for large sessions. We don't know the
  // project ref at runtime without parsing env vars, so match by suffix.
  const all = request.cookies.getAll();
  const base = all.find(
    (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
  );
  if (base) return base.value;

  // Chunked: collect `sb-...-auth-token.0`, `.1`, ... in order.
  const chunks = all
    .filter(
      (c) =>
        c.name.startsWith("sb-") && /-auth-token\.\d+$/.test(c.name)
    )
    .sort((a, b) => {
      const aIdx = Number(a.name.split(".").pop());
      const bIdx = Number(b.name.split(".").pop());
      return aIdx - bIdx;
    });
  if (chunks.length === 0) return null;
  return chunks.map((c) => c.value).join("");
}

function decodeCookieValue(value: string): string | null {
  // @supabase/ssr stores either raw JSON or `base64-<base64url>`.
  if (value.startsWith("base64-")) {
    try {
      return base64UrlDecode(value.slice("base64-".length));
    } catch {
      return null;
    }
  }
  return value;
}

function readJwtExp(jwt: string): number | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp
      : null;
  } catch {
    return null;
  }
}

function base64UrlDecode(input: string): string {
  // Convert base64url to base64, pad, then atob. Vercel edge has atob().
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  // atob returns a Latin-1 string; decode as UTF-8 to handle non-ASCII.
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

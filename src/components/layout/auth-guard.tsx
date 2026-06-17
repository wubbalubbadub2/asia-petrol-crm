"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * AuthGuard — server-side auth now lives in src/middleware.ts at the
 * edge. By the time any client component mounts we are guaranteed to
 * be authenticated (or already redirected). This component used to
 * block the entire dashboard tree on `supabase.auth.getUser()` in a
 * useEffect — that was a 300–700 ms serial wait BEFORE useDeals'
 * effect even fired. Now it does nothing visible; the only thing it
 * still does is subscribe to onAuthStateChange so a SIGNED_OUT event
 * (from another tab or session expiry) bounces the user to /login.
 *
 * No spinner, no checked-flag gate — children render immediately and
 * useDeals' effect runs on the very next tick.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    const { data: { subscription } } = supabaseRef.current.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT" || !session) {
          router.replace("/login");
        }
      },
    );
    return () => subscription.unsubscribe();
  }, [router]);

  return <>{children}</>;
}

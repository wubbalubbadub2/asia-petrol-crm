"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    supabaseRef.current.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setAuthenticated(true);
      } else {
        router.replace("/login");
      }
      setChecked(true);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabaseRef.current.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT" || !session) {
          setAuthenticated(false);
          router.replace("/login");
        } else {
          setAuthenticated(true);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [router]);

  if (!checked) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (!authenticated) return null;

  return <>{children}</>;
}

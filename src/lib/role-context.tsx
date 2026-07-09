"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type UserRole = "admin" | "manager" | "logistics" | "accounting" | "readonly" | "finance" | "trader";

export type Profile = {
  id: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
};

export type RoleContextValue = {
  profile: Profile | null;
  loading: boolean;
  isWritable: boolean;
  isAdmin: boolean;
};

// `null` sentinel means «no provider in the tree» — `useRoleFromContext`
// uses this to fall back to a solo fetch so call sites that live outside
// the dashboard layout (e.g. /login) keep working.
export const RoleContext = createContext<RoleContextValue | null>(null);

function deriveFlags(profile: Profile | null) {
  // Клиент 2026-07-09: писать могут ТОЛЬКО admin/manager/logistics.
  // Финансист / бухгалтер / трейдер / readonly — только просмотр +
  // выгрузка Excel.
  const isWritable =
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    profile?.role === "logistics";
  const isAdmin = profile?.role === "admin";
  return { isWritable, isAdmin };
}

// Module-level cache: the auth round-trip + profile select only run
// once per browser session even if RoleProvider unmounts/remounts
// (e.g. on dashboard layout remount during HMR).
let cachedProfile: Profile | null = null;
let cachedLoaded = false;
let inflight: Promise<Profile | null> | null = null;

async function fetchProfileOnce(): Promise<Profile | null> {
  if (cachedLoaded) return cachedProfile;
  if (inflight) return inflight;

  inflight = (async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      cachedProfile = null;
      cachedLoaded = true;
      return null;
    }

    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, role, is_active")
      .eq("id", user.id)
      .single();

    cachedProfile = (data as Profile | null) ?? null;
    cachedLoaded = true;
    return cachedProfile;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

// Shared hook used by both the provider and the solo-fallback path.
// Keeps the fetch logic in one place.
function useRoleFetch(): RoleContextValue {
  const [profile, setProfile] = useState<Profile | null>(cachedProfile);
  const [loading, setLoading] = useState(!cachedLoaded);

  useEffect(() => {
    let cancelled = false;
    if (cachedLoaded) {
      setProfile(cachedProfile);
      setLoading(false);
      return;
    }
    fetchProfileOnce().then((p) => {
      if (cancelled) return;
      setProfile(p);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { isWritable, isAdmin } = deriveFlags(profile);
  return { profile, loading, isWritable, isAdmin };
}

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const value = useRoleFetch();
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  // Hook order must stay consistent across renders. Always run the
  // solo fetcher hook, but ignore its output when a provider is
  // present.
  const solo = useRoleFetch();
  return ctx ?? solo;
}

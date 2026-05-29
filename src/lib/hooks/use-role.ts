"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type UserRole = "admin" | "manager" | "logistics" | "accounting" | "readonly" | "finance" | "trader";

type Profile = {
  id: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
};

export function useRole() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, role, is_active")
        .eq("id", user.id)
        .single();

      if (data) {
        setProfile(data as Profile);
      }
      setLoading(false);
    }

    loadProfile();
  }, []);

  // Trader and accounting are read-only — they only view and export Excel
  // (client decision, migration 00083).
  const isWritable =
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    profile?.role === "logistics" ||
    profile?.role === "finance";

  const isAdmin = profile?.role === "admin";

  return { profile, loading, isWritable, isAdmin };
}

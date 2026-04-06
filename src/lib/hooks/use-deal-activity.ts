"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export type ActivityMessage = {
  id: string;
  deal_id: string | null;
  application_id?: string | null;
  user_id: string | null;
  type: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user?: { full_name: string; role: string } | null;
};

export function useDealActivity(dealId: string) {
  const [messages, setMessages] = useState<ActivityMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<ReturnType<typeof supabaseRef.current.channel> | null>(null);

  // Load existing messages
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabaseRef.current
      .from("deal_activity")
      .select("*, user:profiles(full_name, role)")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true });

    if (error) {
      toast.error(`Ошибка загрузки активности: ${error.message}`);
    } else {
      setMessages((data ?? []) as ActivityMessage[]);
    }
    setLoading(false);
  }, [dealId]);

  // Subscribe to realtime
  useEffect(() => {
    load();

    const channel = supabaseRef.current
      .channel(`deal-activity-${dealId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "deal_activity",
          filter: `deal_id=eq.${dealId}`,
        },
        async (payload) => {
          // Fetch the full record with user join
          const { data } = await supabaseRef.current
            .from("deal_activity")
            .select("*, user:profiles(full_name, role)")
            .eq("id", payload.new.id)
            .single();

          if (data) {
            setMessages((prev) => {
              // Avoid duplicates (optimistic + realtime)
              if (prev.some((m) => m.id === data.id)) return prev;
              return [...prev, data as ActivityMessage];
            });
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabaseRef.current.removeChannel(channel);
    };
  }, [dealId, load]);

  // Send a comment
  async function sendMessage(content: string) {
    if (!content.trim()) return;

    const { data: { user } } = await supabaseRef.current.auth.getUser();
    if (!user) { toast.error("Не авторизован"); return; }

    // Optimistic insert
    const tempId = crypto.randomUUID();
    const optimistic: ActivityMessage = {
      id: tempId,
      deal_id: dealId,
      user_id: user.id,
      type: "comment",
      content: content.trim(),
      metadata: null,
      created_at: new Date().toISOString(),
      user: null, // Will be enriched by realtime
    };
    setMessages((prev) => [...prev, optimistic]);

    // Persist
    const { data, error } = await supabaseRef.current
      .from("deal_activity")
      .insert({
        deal_id: dealId,
        user_id: user.id,
        type: "comment",
        content: content.trim(),
      })
      .select("*, user:profiles(full_name, role)")
      .single();

    if (error) {
      toast.error(`Ошибка: ${error.message}`);
      // Remove optimistic
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } else if (data) {
      // Replace optimistic with real
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? (data as ActivityMessage) : m))
      );
    }
  }

  return { messages, loading, sendMessage, reload: load };
}

// Same hook but for applications
export function useApplicationActivity(applicationId: string) {
  const [messages, setMessages] = useState<ActivityMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabaseRef.current
      .from("deal_activity")
      .select("*, user:profiles(full_name, role)")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true });
    if (error) toast.error(`Ошибка: ${error.message}`);
    else setMessages((data ?? []) as ActivityMessage[]);
    setLoading(false);
  }, [applicationId]);

  useEffect(() => {
    load();
    const channel = supabaseRef.current
      .channel(`app-activity-${applicationId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "deal_activity",
        filter: `application_id=eq.${applicationId}`,
      }, async (payload) => {
        const { data } = await supabaseRef.current.from("deal_activity")
          .select("*, user:profiles(full_name, role)").eq("id", payload.new.id).single();
        if (data) setMessages((prev) => prev.some((m) => m.id === data.id) ? prev : [...prev, data as ActivityMessage]);
      }).subscribe();
    return () => { supabaseRef.current.removeChannel(channel); };
  }, [applicationId, load]);

  async function sendMessage(content: string) {
    if (!content.trim()) return;
    const { data: { user } } = await supabaseRef.current.auth.getUser();
    if (!user) return;
    const tempId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: tempId, deal_id: null, application_id: applicationId, user_id: user.id, type: "comment", content: content.trim(), metadata: null, created_at: new Date().toISOString(), user: null }]);
    const { data, error } = await supabaseRef.current.from("deal_activity")
      .insert({ application_id: applicationId, user_id: user.id, type: "comment", content: content.trim() })
      .select("*, user:profiles(full_name, role)").single();
    if (error) { toast.error(`Ошибка: ${error.message}`); setMessages((prev) => prev.filter((m) => m.id !== tempId)); }
    else if (data) setMessages((prev) => prev.map((m) => m.id === tempId ? data as ActivityMessage : m));
  }

  return { messages, loading, sendMessage };
}

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

// Generic CRUD hook used by simple spravochnik pages.
// Table name is a runtime string so the strict Database<Table> narrowing
// doesn't help us here — cast to `any` at the builder boundary only.
// Callers are responsible for passing a correctly-typed T.
export function useSupabaseTable<T extends { id?: string }>(
  tableName: string,
  orderBy: string = "created_at",
  selectQuery: string = "*"
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = () => supabaseRef.current as any;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sb()
      .from(tableName)
      .select(selectQuery)
      .order(orderBy, { ascending: true });

    if (error) {
      toast.error(`Ошибка загрузки: ${error.message}`);
    } else {
      setData((data ?? []) as T[]);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName, orderBy, selectQuery]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(values: Partial<T>, isEdit: boolean) {
    if (isEdit && values.id) {
      const { error } = await sb()
        .from(tableName)
        .update(values)
        .eq("id", values.id);

      if (error) {
        toast.error(`Ошибка сохранения: ${error.message}`);
        throw error;
      }
      toast.success("Сохранено");
    } else {
      const { id: _id, ...insertValues } = values as Record<string, unknown>;
      void _id;
      const { error } = await sb().from(tableName).insert(insertValues);

      if (error) {
        toast.error(`Ошибка добавления: ${error.message}`);
        throw error;
      }
      toast.success("Добавлено");
    }
    await load();
  }

  async function remove(item: T) {
    if (!item.id) return;
    const { error } = await sb()
      .from(tableName)
      .delete()
      .eq("id", item.id);

    if (error) {
      toast.error(`Ошибка удаления: ${error.message}`);
      throw error;
    }
    toast.success("Удалено");
    await load();
  }

  return { data, loading, save, remove, reload: load };
}

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export function useSupabaseTable<T extends { id?: string }>(
  tableName: string,
  orderBy: string = "created_at",
  selectQuery: string = "*"
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabaseRef.current
      .from(tableName)
      .select(selectQuery)
      .order(orderBy, { ascending: true });

    if (error) {
      toast.error(`Ошибка загрузки: ${error.message}`);
    } else {
      setData((data ?? []) as unknown as T[]);
    }
    setLoading(false);
  }, [tableName, orderBy]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(values: Partial<T>, isEdit: boolean) {
    if (isEdit && values.id) {
      const { error } = await supabaseRef.current
        .from(tableName)
        .update(values)
        .eq("id", values.id);

      if (error) {
        toast.error(`Ошибка сохранения: ${error.message}`);
        throw error;
      }
      toast.success("Сохранено");
    } else {
      const { id: _, ...insertValues } = values as Record<string, unknown>;
      const { error } = await supabaseRef.current.from(tableName).insert(insertValues);

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
    const { error } = await supabaseRef.current
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

"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export function useSupabaseTable<T extends { id?: string }>(
  tableName: string,
  orderBy: string = "created_at"
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .order(orderBy, { ascending: true });

    if (error) {
      toast.error(`Ошибка загрузки: ${error.message}`);
    } else {
      setData((data ?? []) as T[]);
    }
    setLoading(false);
  }, [tableName, orderBy, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(values: Partial<T>, isEdit: boolean) {
    if (isEdit && values.id) {
      const { error } = await supabase
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
      const { error } = await supabase.from(tableName).insert(insertValues);

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
    const { error } = await supabase
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

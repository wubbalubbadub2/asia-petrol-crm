"use client";

// Личные настройки интерфейса per-user (migration 00121, клиент
// 2026-07-17: скрытие/закрепление столбцов «по своему ID»).
// key-value JSONB в user_prefs; RLS пускает только владельца.
//
// Оптимистичный паттерн проекта: значение меняется локально сразу,
// upsert уходит в фоне (debounce 600 мс — операторы щёлкают чекбоксы
// сериями), ошибка — toast без отката (настройка не бизнес-данные,
// потеря синка не критична и исправится следующим сохранением).

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

// database.ts (генерённые типы) ещё не знает user_prefs (00121) — тот же
// stale-types случай, что у round_volume в use-registry. Узкий
// структурный интерфейс вместо any, чтобы не отключать линт.
type PrefsQuery = {
  select: (cols: string) => {
    eq: (k: string, v: string) => {
      eq: (k: string, v: string) => {
        maybeSingle: () => Promise<{ data: { value?: unknown } | null }>;
      };
    };
  };
  upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
};
function prefsTable(sb: ReturnType<typeof createClient>): PrefsQuery {
  return (sb as unknown as { from: (t: string) => PrefsQuery }).from("user_prefs");
}

// Кэш на сессию вкладки: key → value. Повторный mount (переключение
// вкладок workspace) не перечитывает БД.
const prefCache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

async function loadPref(key: string): Promise<unknown> {
  if (prefCache.has(key)) return prefCache.get(key);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const sb = createClient();
    const { data: userData } = await sb.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return undefined;
    const { data } = await prefsTable(sb)
      .select("value")
      .eq("user_id", uid)
      .eq("key", key)
      .maybeSingle();
    const v = data?.value;
    prefCache.set(key, v);
    return v;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function useUserPref<T>(key: string, defaultValue: T): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(() =>
    prefCache.has(key) ? ((prefCache.get(key) as T) ?? defaultValue) : defaultValue,
  );
  const [loaded, setLoaded] = useState(prefCache.has(key));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    loadPref(key).then((v) => {
      if (!alive) return;
      if (v !== undefined) setValue(v as T);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [key]);

  function set(next: T) {
    setValue(next);
    prefCache.set(key, next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const sb = createClient();
      const { data: userData } = await sb.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return;
      const { error } = await prefsTable(sb)
        .upsert({ user_id: uid, key, value: next }, { onConflict: "user_id,key" });
      if (error) toast.error(`Настройки: ${error.message}`);
    }, 600);
  }

  return [value, set, loaded];
}

"use client";

/**
 * Workspace tabs — a browser-tab-style multi-context system that
 * lets one operator keep several deals, the registry, and the
 * deals list open simultaneously and switch between them without
 * losing scroll / filter state.
 *
 * Mental model:
 * - One tab == one URL (with optional query string).
 * - Tab identity is the pathname *without* the query, so filter
 *   changes inside «/deals» don't spawn duplicate tabs.
 * - «section» tabs are singletons (one «/deals», one «/registry», …)
 *   matched by nav-items.ts.
 * - «entity» tabs are per-id (each «/deals/{uuid}» is its own tab,
 *   so the operator can open multiple deals side-by-side).
 * - The active tab's path is always === the current URL: any
 *   in-page navigation simply updates the active tab in place.
 *
 * Persistence: the open tab list + active id are stored in
 * localStorage so a refresh restores the workspace. Stale entries
 * for deleted entities are tolerated (clicking them just navigates
 * and the destination page shows «не найдена»).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { navItems } from "@/lib/constants/nav-items";

const STORAGE_KEY = "asia-petrol-tabs-v1";
const MAX_TABS = 20;

export type TabKind = "section" | "entity";

export type Tab = {
  /** Pathname without query — stable identity for the tab. */
  id: string;
  /** Full path including query string — what router.push fires. */
  path: string;
  /** Display label, may update after the destination page loads. */
  title: string;
  /** Icon key looked up at render time (icons aren't serializable). */
  iconKey: string;
  /** Singleton (section) or per-id (entity). */
  kind: TabKind;
};

type TabsContextValue = {
  tabs: Tab[];
  activeId: string | null;
  /**
   * Open or switch to a tab for `path`.
   * - `background: true` keeps the current active tab active
   *   (Ctrl/Cmd-click / middle-click behavior).
   * - `title` overrides the auto-derived title.
   */
  openTab: (
    path: string,
    opts?: { background?: boolean; title?: string }
  ) => void;
  /** Close the tab with id. The adjacent tab becomes active. */
  closeTab: (id: string) => void;
  /** Switch to a tab and navigate to its path. */
  switchTab: (id: string) => void;
  /** Rename a tab (used by detail pages once they know the entity title). */
  setTabTitle: (id: string, title: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function pathToId(path: string): string {
  return path.split("?")[0] || "/";
}

function inferTabMeta(path: string): { title: string; iconKey: string; kind: TabKind } {
  const id = pathToId(path);
  // Special case: «/» is the dashboard home.
  if (id === "/") {
    return { title: "Главная", iconKey: "LayoutDashboard", kind: "section" };
  }
  // Exact match against nav-items = singleton section tab.
  const exact = navItems.find((n) => n.href === id);
  if (exact) {
    return { title: exact.label, iconKey: exact.icon.displayName ?? "FileText", kind: "section" };
  }
  // Deeper path under a nav root = entity tab. We pick the parent
  // nav item for the icon but use a placeholder title; the detail
  // page is expected to call setTabTitle once it has the entity's
  // own label (e.g. «KZ/26/123»).
  const parent = navItems.find((n) => n.href !== "/" && id.startsWith(n.href + "/"));
  if (parent) {
    const lastSegment = id.split("/").pop() ?? "";
    const placeholder = parent.label === "Сделки" ? "Сделка" : parent.label;
    return {
      title: lastSegment === "new" ? `Новая ${placeholder.toLowerCase()}` : placeholder,
      iconKey: parent.icon.displayName ?? "FileText",
      kind: "entity",
    };
  }
  return { title: id, iconKey: "FileText", kind: "section" };
}

function loadFromStorage(): { tabs: Tab[]; activeId: string | null } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.tabs)) return null;
    return { tabs: parsed.tabs, activeId: parsed.activeId ?? null };
  } catch {
    return null;
  }
}

function saveToStorage(state: { tabs: Tab[]; activeId: string | null }) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — ignore */
  }
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const currentPath = useMemo(() => {
    const qs = search?.toString() ?? "";
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, search]);

  // Initial state: try storage, ensure the currently visible URL
  // is represented as a tab and is active.
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const stored = loadFromStorage();
    const initial = stored?.tabs ?? [];
    const currentId = pathToId(currentPath);
    if (!initial.some((t) => t.id === currentId)) {
      const meta = inferTabMeta(currentPath);
      initial.push({
        id: currentId,
        path: currentPath,
        title: meta.title,
        iconKey: meta.iconKey,
        kind: meta.kind,
      });
    }
    return initial;
  });
  const [activeId, setActiveId] = useState<string | null>(() => pathToId(currentPath));

  // Persist on every change. No debounce — writes are small and
  // localStorage is synchronous, so the overhead is negligible.
  useEffect(() => {
    saveToStorage({ tabs, activeId });
  }, [tabs, activeId]);

  // Whenever the URL changes (sidebar nav, in-page router.push,
  // browser back/forward), keep the tab model in sync. If the new
  // path matches an existing tab, just activate it; otherwise
  // replace the currently-active tab's path with the new one (this
  // is the «navigating inside a tab» case — same tab, new URL).
  const lastSyncedPathRef = useRef<string>(currentPath);
  useEffect(() => {
    if (lastSyncedPathRef.current === currentPath) return;
    lastSyncedPathRef.current = currentPath;
    const newId = pathToId(currentPath);

    setTabs((prev) => {
      const existing = prev.find((t) => t.id === newId);
      if (existing) {
        // Refresh its path (query string may have changed) but
        // keep title/icon as-is.
        if (existing.path !== currentPath) {
          return prev.map((t) => (t.id === newId ? { ...t, path: currentPath } : t));
        }
        return prev;
      }
      // No matching tab: the active tab navigated to a new URL.
      // Replace its id+path+title with the new destination.
      const activeIdx = prev.findIndex((t) => t.id === activeId);
      if (activeIdx === -1) {
        // No active tab (cold case) — push a fresh one.
        const meta = inferTabMeta(currentPath);
        return [...prev, { id: newId, path: currentPath, title: meta.title, iconKey: meta.iconKey, kind: meta.kind }];
      }
      const meta = inferTabMeta(currentPath);
      const next = [...prev];
      next[activeIdx] = { id: newId, path: currentPath, title: meta.title, iconKey: meta.iconKey, kind: meta.kind };
      return next;
    });
    setActiveId(newId);
  }, [currentPath, activeId]);

  const openTab = useCallback<TabsContextValue["openTab"]>(
    (path, opts) => {
      const id = pathToId(path);
      const background = opts?.background === true;

      setTabs((prev) => {
        const existing = prev.find((t) => t.id === id);
        if (existing) {
          // Already open — just update its query/path.
          if (existing.path !== path) {
            return prev.map((t) => (t.id === id ? { ...t, path, title: opts?.title ?? t.title } : t));
          }
          if (opts?.title && opts.title !== existing.title) {
            return prev.map((t) => (t.id === id ? { ...t, title: opts.title! } : t));
          }
          return prev;
        }
        if (prev.length >= MAX_TABS) {
          // Don't silently exceed — drop the oldest non-active.
          const oldest = prev.find((t) => t.id !== activeId);
          const trimmed = oldest ? prev.filter((t) => t.id !== oldest.id) : prev.slice(1);
          const meta = inferTabMeta(path);
          return [
            ...trimmed,
            { id, path, title: opts?.title ?? meta.title, iconKey: meta.iconKey, kind: meta.kind },
          ];
        }
        const meta = inferTabMeta(path);
        return [
          ...prev,
          { id, path, title: opts?.title ?? meta.title, iconKey: meta.iconKey, kind: meta.kind },
        ];
      });

      if (!background) {
        setActiveId(id);
        // Defer navigation so React commits the new tab state first
        // (otherwise the URL-sync effect fires against stale tabs and
        // can double-replace the just-opened tab).
        if (path !== currentPath) {
          lastSyncedPathRef.current = path;
          router.push(path);
        }
      }
    },
    [activeId, currentPath, router]
  );

  const closeTab = useCallback<TabsContextValue["closeTab"]>(
    (id) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev; // always keep at least one
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.id !== id);

        // If closing the active tab, jump to the neighbor.
        if (id === activeId) {
          const neighbor = next[idx] ?? next[idx - 1] ?? next[0];
          if (neighbor) {
            setActiveId(neighbor.id);
            if (neighbor.path !== currentPath) {
              lastSyncedPathRef.current = neighbor.path;
              router.push(neighbor.path);
            }
          }
        }
        return next;
      });
    },
    [activeId, currentPath, router]
  );

  const switchTab = useCallback<TabsContextValue["switchTab"]>(
    (id) => {
      const target = tabs.find((t) => t.id === id);
      if (!target) return;
      setActiveId(id);
      if (target.path !== currentPath) {
        lastSyncedPathRef.current = target.path;
        router.push(target.path);
      }
    },
    [tabs, currentPath, router]
  );

  const setTabTitle = useCallback<TabsContextValue["setTabTitle"]>((id, title) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  const value = useMemo<TabsContextValue>(
    () => ({ tabs, activeId, openTab, closeTab, switchTab, setTabTitle }),
    [tabs, activeId, openTab, closeTab, switchTab, setTabTitle]
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    // Tolerant fallback so components outside the provider (e.g.
    // login page) don't crash. The mutators are no-ops.
    return {
      tabs: [],
      activeId: null,
      openTab: () => {},
      closeTab: () => {},
      switchTab: () => {},
      setTabTitle: () => {},
    };
  }
  return ctx;
}

/**
 * Used by detail pages to set the tab title once they know the
 * entity's display name (e.g. «Сделка KZ/26/123»). Pass the
 * current pathname-id from the page.
 */
export function useSetTabTitle(id: string | null, title: string | null | undefined) {
  const { setTabTitle } = useTabs();
  useEffect(() => {
    if (!id || !title) return;
    setTabTitle(id, title);
  }, [id, title, setTabTitle]);
}

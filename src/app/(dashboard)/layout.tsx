"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { TabBar } from "@/components/layout/tab-bar";
import { AuthGuard } from "@/components/layout/auth-guard";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { getGlobalRefs } from "@/lib/refs";
import { RoleProvider } from "@/lib/role-context";
import { TabsProvider } from "@/lib/contexts/tabs-context";

const SIDEBAR_COLLAPSED_KEY = "asia-petrol-sidebar-collapsed-v1";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Sidebar collapse — operator request 2026-06-25: «можно скрыть/раскрыть
  // левое меню? чтобы при работе было больше мест». Persisted in
  // localStorage so the preference survives reload. Cmd/Ctrl+B toggles
  // (matches VS Code muscle memory).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
        setSidebarCollapsed(true);
      }
    } catch { /* private mode — ignore */ }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch { /* ignore */ }
  }, [sidebarCollapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        // Ignore when typing in an input/textarea/contenteditable —
        // these are common editor shortcuts the operator hits while
        // editing cells; collapsing the sidebar mid-keystroke would
        // be jarring.
        const tag = (e.target as HTMLElement | null)?.tagName;
        const editable = (e.target as HTMLElement | null)?.isContentEditable;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || editable) return;
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const router = useRouter();

  // Warm the refs cache the moment the dashboard chrome paints — by
  // the time the operator clicks any sidebar link, refs are already
  // streaming. Refs are cheap (a handful of small SELECTs in parallel)
  // so they don't compete with whatever the destination page fetches.
  //
  // ALSO prefetch the route bundles themselves. <Link prefetch> only
  // fires on hover and was the cause of the «click → URL waits 3s →
  // page waits 4s» symptom: Next.js was downloading each route's
  // client chunk after the click. router.prefetch() forces it now,
  // before the user even hovers.
  //
  // NOTE: prefetchDeals() was REMOVED here (2026-06-18). It monopolized
  // the Supabase REST connection pool for 2-3s on every dashboard route
  // mount, which made /applications, /spravochnik and /dt-kt cold loads
  // 15-22s instead of 2-3s — those routes were stuck behind the deals
  // prefetch holding all the connections. The deals page now warms its
  // own cache on mount via useDeals; the prefetch was only an
  // optimization for the «click /deals from sidebar» path and the
  // overall cost-vs-benefit was strongly negative.
  useEffect(() => {
    void getGlobalRefs();
    router.prefetch("/deals");
    router.prefetch("/registry");
    router.prefetch("/applications");
    router.prefetch("/quotations");
    router.prefetch("/dt-kt");
    router.prefetch("/tariffs");

    // Client-side fallback for the Supabase keepalive. The Vercel
    // cron at /api/keepalive only fires per-minute on Pro tier; on
    // Hobby it's daily and won't keep the PostgREST pool warm. While
    // an operator is on the dashboard, this interval pings the same
    // route every 4 minutes (under the ~5 min idle timeout) so the
    // first query after a coffee break doesn't pay the 1.5 s cold-
    // start penalty.
    const keepalive = setInterval(() => {
      void fetch("/api/keepalive", { cache: "no-store" }).catch(() => {});
    }, 240_000);

    return () => {
      clearInterval(keepalive);
    };
  }, [router]);

  return (
    <AuthGuard>
      <RoleProvider>
        <TabsProvider>
          <div className="flex h-screen overflow-hidden">
            {/* Desktop sidebar */}
            <div className="hidden lg:block">
              <Sidebar
                collapsed={sidebarCollapsed}
                onToggle={() => setSidebarCollapsed((c) => !c)}
              />
            </div>

            {/* Mobile sidebar (sheet drawer) */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetContent side="left" className="w-[260px] p-0 bg-slate-900 border-r-0">
                <Sidebar onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>

            <div className="flex flex-1 flex-col overflow-hidden">
              <TopBar onMenuClick={() => setMobileOpen(true)} />
              {/* Workspace tabs — show open contexts above the main
                  scroll surface so switching between deals doesn't
                  fight the page's own scroll. */}
              <TabBar />
              <main className="flex-1 overflow-auto bg-stone-50/50 p-3 sm:p-4 lg:p-6">
                {children}
              </main>
            </div>
          </div>
        </TabsProvider>
      </RoleProvider>
    </AuthGuard>
  );
}

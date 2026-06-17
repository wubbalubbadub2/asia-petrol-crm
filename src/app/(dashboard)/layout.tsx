"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { AuthGuard } from "@/components/layout/auth-guard";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { getGlobalRefs } from "@/lib/refs";
import { prefetchDeals } from "@/lib/hooks/use-deals";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const router = useRouter();

  // Warm both caches the moment the dashboard chrome paints — while
  // the operator is still on the dashboard, refs + the default deals
  // query (current year, no other filters — the most-likely landing)
  // are already streaming. By the time they click «Сделки» in the
  // sidebar, the data is in dealsCache and useDeals paints
  // synchronously.
  //
  // ALSO prefetch the route bundles themselves. <Link prefetch> only
  // fires on hover and was the cause of the «click → URL waits 3s →
  // page waits 4s» symptom: Next.js was downloading each route's
  // client chunk after the click. router.prefetch() forces it now,
  // before the user even hovers.
  useEffect(() => {
    void getGlobalRefs();
    void prefetchDeals({
      year: new Date().getFullYear(),
      isArchived: false,
    });
    router.prefetch("/deals");
    router.prefetch("/registry");
    router.prefetch("/applications");
    router.prefetch("/quotations");
    router.prefetch("/dt-kt");
    router.prefetch("/tariffs");
  }, [router]);

  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden">
        {/* Desktop sidebar */}
        <div className="hidden lg:block">
          <Sidebar />
        </div>

        {/* Mobile sidebar (sheet drawer) */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-[260px] p-0 bg-slate-900 border-r-0">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar onMenuClick={() => setMobileOpen(true)} />
          <main className="flex-1 overflow-auto bg-stone-50/50 p-3 sm:p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}

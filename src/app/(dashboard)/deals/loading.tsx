/**
 * Skeleton-shell that Next.js paints THE INSTANT the user clicks
 * «Сделки» in the sidebar — before the route's client chunk
 * finishes downloading. Replaces the «click → empty page for 3s →
 * loader» symptom with «click → chrome appears immediately → real
 * content fades in».
 *
 * Server component (no "use client") so it ships as HTML in the
 * RSC payload, costing the user zero JS to render.
 */

export default function DealsLoading() {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <div className="h-7 w-24 rounded-md bg-stone-100 animate-pulse" />
          <div className="flex items-center gap-2">
            <div className="h-8 w-20 rounded-md bg-stone-100 animate-pulse" />
            <div className="h-8 w-32 rounded-md bg-stone-100 animate-pulse" />
          </div>
        </div>
        <div className="flex gap-1 border-b border-stone-200">
          {["Все сделки", "Паспорт KG", "Паспорт KZ"].map((t) => (
            <div key={t} className="px-4 py-2 text-[13px] text-stone-400">{t}</div>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-stone-100 animate-pulse" />
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 rounded-md border border-stone-200 bg-white p-3 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-6 rounded-sm bg-stone-50 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

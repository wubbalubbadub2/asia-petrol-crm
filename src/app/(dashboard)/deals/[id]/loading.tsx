/**
 * Skeleton for /deals/[id]. Same idea — instant chrome paint while
 * the heavy detail-page chunk (980 lines + many client deps) loads.
 */

export default function DealDetailLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-md bg-stone-100 animate-pulse" />
        <div className="h-7 w-24 rounded-md bg-stone-100 animate-pulse" />
        <div className="h-5 w-32 rounded-md bg-stone-100 animate-pulse" />
        <div className="ml-auto h-8 w-24 rounded-md bg-stone-100 animate-pulse" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-md border border-stone-200 bg-white p-3 space-y-2">
            <div className="h-5 w-32 rounded-sm bg-stone-100 animate-pulse" />
            {Array.from({ length: 6 }).map((_, j) => (
              <div key={j} className="space-y-1">
                <div className="h-3 w-20 rounded-sm bg-stone-50 animate-pulse" />
                <div className="h-5 w-full rounded-sm bg-stone-50 animate-pulse" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Same instant-skeleton pattern as the /deals loading boundary.
 * Server component — no JS cost, paints immediately on route
 * transition while the registry chunk downloads.
 */

export default function RegistryLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-7 w-44 rounded-md bg-stone-100 animate-pulse" />
        <div className="flex gap-2">
          <div className="h-8 w-24 rounded-md bg-stone-100 animate-pulse" />
          <div className="h-8 w-24 rounded-md bg-stone-100 animate-pulse" />
        </div>
      </div>
      <div className="flex gap-1 border-b border-stone-200">
        {["KG (Экспорт)", "KZ (Внутренний)"].map((t) => (
          <div key={t} className="px-4 py-2 text-[13px] text-stone-400">{t}</div>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-9 rounded-md bg-stone-100 animate-pulse" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-stone-50 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

/**
 * Shared route-skeleton paint. Next.js renders this from `loading.tsx`
 * boundaries the MOMENT the user clicks a sidebar link, before the
 * target page's client chunk finishes downloading. Replaces the
 * «click → empty viewport for 1-3 s → content» symptom with
 * «click → chrome appears instantly → real content fades in».
 *
 * Server component (no "use client") so each loading.tsx ships as
 * pure HTML in the RSC payload, costing the user zero JS to render.
 *
 * Variants match the four shapes used across the dashboard:
 *   - "table"   list-heavy operator screens (Сделки, Реестр, Тарифы…)
 *   - "form"    create/edit views (Сделки → Новая)
 *   - "list"    settings & spravochnik landings (cards/rows)
 *   - "default" import/dashboard utility screens
 *
 * Style guide matches the original /deals & /registry loaders:
 * stone-100 fills, animate-pulse, rounded-md, no shadows, no JS.
 */

type Variant = "table" | "form" | "list" | "default";

export interface PageSkeletonProps {
  variant?: Variant;
}

function Header() {
  return (
    <div className="flex items-center justify-between">
      <div className="h-7 w-44 rounded-md bg-stone-100 animate-pulse" />
      <div className="flex items-center gap-2">
        <div className="h-8 w-24 rounded-md bg-stone-100 animate-pulse" />
        <div className="h-8 w-28 rounded-md bg-stone-100 animate-pulse" />
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-shrink-0 space-y-3">
        <Header />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-stone-100 animate-pulse" />
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 rounded-md border border-stone-200 bg-white p-3 space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-6 rounded-sm bg-stone-50 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-md bg-stone-100 animate-pulse" />
        <div className="h-7 w-56 rounded-md bg-stone-100 animate-pulse" />
        <div className="ml-auto h-8 w-28 rounded-md bg-stone-100 animate-pulse" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-stone-200 bg-white p-4 space-y-3"
          >
            <div className="h-5 w-40 rounded-sm bg-stone-100 animate-pulse" />
            {Array.from({ length: 6 }).map((_, j) => (
              <div key={j} className="space-y-1">
                <div className="h-3 w-24 rounded-sm bg-stone-50 animate-pulse" />
                <div className="h-8 w-full rounded-sm bg-stone-50 animate-pulse" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4">
      <Header />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-stone-200 bg-white p-4 space-y-2"
          >
            <div className="h-5 w-32 rounded-sm bg-stone-100 animate-pulse" />
            <div className="h-3 w-full rounded-sm bg-stone-50 animate-pulse" />
            <div className="h-3 w-3/4 rounded-sm bg-stone-50 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

function DefaultSkeleton() {
  return (
    <div className="space-y-4">
      <Header />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-stone-200 bg-white p-4 space-y-2"
          >
            <div className="h-3 w-20 rounded-sm bg-stone-50 animate-pulse" />
            <div className="h-7 w-28 rounded-md bg-stone-100 animate-pulse" />
          </div>
        ))}
      </div>
      <div className="rounded-md border border-stone-200 bg-white p-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-6 rounded-sm bg-stone-50 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton({ variant = "default" }: PageSkeletonProps) {
  switch (variant) {
    case "table":
      return <TableSkeleton />;
    case "form":
      return <FormSkeleton />;
    case "list":
      return <ListSkeleton />;
    default:
      return <DefaultSkeleton />;
  }
}

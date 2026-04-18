# Asia Petrol CRM — Architecture

A single-page operational CRM replacing a multi-sheet Excel workbook used by a Kazakhstan-based petroleum trading company. Deals span KG (export) and KZ (domestic) pipelines with per-month pricing, railway tariff lookups, registry of wagon shipments, payments in multiple currencies, and company-chain margin tracking.

## Stack at a glance

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 · shadcn/ui (Base-UI primitives) |
| Client data | Custom hooks on top of `@supabase/supabase-js` via `@supabase/ssr` |
| Backend | Supabase (Postgres + Auth + Realtime + Storage) |
| Hosting | Vercel (frontend) + Supabase Cloud (DB) |
| Excel / parsing | `xlsx` (read), `exceljs` (write), in-house paste parser for bulk wagons |
| Charts | `recharts` · Tables: `@tanstack/react-table` · Virtualization: `@tanstack/react-virtual` |
| Forms | `react-hook-form` + `zod` (create flows); inline edit uses ad-hoc `useState` |

Auth is Supabase email/password. Row-level security (RLS) is the primary authorization mechanism — the frontend talks directly to Postgres, so RLS is the firewall.

---

## Repository layout

```
asia-petrol-crm/
├── src/
│   ├── app/                         Next.js App Router
│   │   ├── (auth)/login/            Public login route
│   │   ├── (dashboard)/             Gated routes — all share a layout + AuthGuard
│   │   │   ├── page.tsx             Home dashboard (charts, KPIs)
│   │   │   ├── deals/               Passport table, detail page, new deal
│   │   │   ├── applications/        Buyer orders
│   │   │   ├── registry/            Shipment registry (Реестр)
│   │   │   ├── dt-kt/               DT-KT logistics balances
│   │   │   ├── tariffs/             Railway tariff table
│   │   │   ├── quotations/          Daily oil quotations + Свод КОТ
│   │   │   ├── spravochnik/         Reference data (companies, stations…)
│   │   │   ├── surcharges/
│   │   │   ├── archive/
│   │   │   ├── import/              Excel / SNT / ESF import
│   │   │   └── settings/            Users
│   │   ├── api/                     Small API routes (deals, quotations, import, export)
│   │   ├── globals.css
│   │   └── layout.tsx               Root HTML + toasts + toploader
│   │
│   ├── components/
│   │   ├── ui/                      shadcn primitives (button, dialog, input…)
│   │   ├── layout/                  sidebar, top-bar, auth-guard
│   │   ├── deals/                   passport-table, deal-company-chain,
│   │   │                            deal-trigger-prices, deal-payments,
│   │   │                            deal-shipments, deal-activity-feed
│   │   ├── applications/
│   │   ├── registry/                bulk-add-dialog
│   │   ├── quotations/              quotation-summary, price-calculator
│   │   ├── import/                  excel-upload
│   │   ├── data-table/              generic virtualized table wrapper
│   │   └── shared/                  activity-feed, crud-table (reference spravochnik)
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts            createBrowserClient (used by most pages)
│   │   │   ├── server.ts            createServerClient (API routes / SSR helpers)
│   │   │   └── middleware.ts        cookie refresh
│   │   ├── hooks/                   One per domain: use-deals, use-registry, use-quotations,
│   │   │                            use-applications, use-deal-trigger-prices, use-deal-activity,
│   │   │                            use-references, use-role
│   │   ├── calculations/
│   │   │   └── price-formation.ts   Trigger / fixed / average-month price formulas
│   │   ├── parsers/
│   │   │   ├── bulk-wagons.ts       Paste-a-block-of-wagons parser
│   │   │   └── snt-parser.ts        1C SNT Excel parser (fixed-cell layout)
│   │   ├── constants/               currencies, deal-types, months-ru, nav-items,
│   │   │                            quotation-columns (per-product column configs)
│   │   ├── types/
│   │   └── utils.ts
│   │
│   ├── i18n/
│   ├── __tests__/                   vitest suites (price-formation, etc.)
│   └── proxy.ts                     Edge middleware — currently a pass-through;
│                                    auth check runs client-side (AuthGuard) for snappier nav
│
├── supabase/
│   └── migrations/                  34 numbered SQL files (full history, no squash)
│
├── public/
├── DESIGN.md                        Typography, colors, spacing — read before visual changes
├── AGENTS.md                        Build/agent conventions
├── CLAUDE.md                        Project memory hooks
├── README.md
└── package.json
```

---

## Backend (Supabase)

### Database schema — top-level groups

All 34 migrations live under `supabase/migrations/`. Numbered sequentially; none have been squashed. Pattern:

```
00001_reference_tables.sql          — counterparties, company_groups, factories,
                                      forwarders, stations, fuel_types, regions,
                                      profiles + enums
00002_quotations.sql                — quotation_product_types, quotations (daily),
                                      quotation_monthly_averages
00003_deals.sql                     — deals (~60 columns), deal_sequences,
                                      deal_company_groups (chain)
00004_applications.sql              — applications + application_deals
00005_shipment_registry.sql         — shipment_registry (per-wagon rows)
00006_dt_kt_tariffs.sql             — tariffs, dt_kt_logistics
00007_surcharges.sql                — surcharges (40+ cols with claim workflow)
00008_documents_attachments.sql     — snt_documents, esf_documents, deal_attachments
00009_archive.sql                   — archive_years
00010_rls_policies.sql              — RLS on everything + helper fns
00011_functions.sql                 — refresh_deal_shipment_totals, lookup_tariff,
                                      compute_dt_kt_balance, refresh_quotation_averages
00012+                              — seed data, incremental alterations
```

From 00014 onwards the migrations are incremental evolutions driven by client feedback. Notable ones:

| # | What it adds |
|---|---|
| 00014 | `deals.currency` (per-deal) |
| 00015 | `dt_kt_payments` table (per-payment rows under a DT-KT record) |
| 00016 | `deal_activity` + realtime chat trigger on payments |
| 00019 | `deal_payments` (per-payment rows under a deal) |
| 00021 | `BEFORE INSERT/UPDATE` trigger on deals → auto-compute `supplier_contracted_amount`, `buyer_contracted_amount`, `supplier_balance`, `buyer_debt`, `buyer_remaining`, `preliminary_amount` |
| 00023 | `deal_shipment_prices` — per-month / per-shipment pricing rows (supports trigger, fixed, average_month) |
| 00027 / 00030 / 00031 | Rollup triggers: registry sums → deals, pricing sums → deals, registry volume × tariff auto-compute |
| 00033 | `shipment_registry.currency` (per-shipment override) |
| 00034 | `deal_payments.currency` + `dt_kt_payments.currency` (per-payment override) |

### Domain model

```
┌──────────────┐        ┌────────────────┐
│ counterparties│        │ company_groups │
│ (supplier/buyer)        └────────────────┘
└───────┬──────┘                 │
        │                        │ 1..6
        │                ┌───────▼──────────┐
        │                │ deal_company_    │
        │                │ groups (chain)   │
        │                └───────┬──────────┘
        │                        │
┌───────▼──────────────────────▼───────────┐
│                deals (core)              │
│ • identity: deal_type (KG/KZ) + number   │
│ • 2 sides: supplier, buyer               │
│ • pricing conditions: trigger/fixed/     │
│   average_month/manual                   │
│ • currency (USD/KZT/KGS/RUB)             │
│ • logistics: forwarder, tariff, volumes  │
│ • auto-computed derived fields           │
└───┬───────────┬───────────────┬──────────┘
    │           │               │
    │           │               │ per-month/per-shipment
    │           │               ▼
    │           │    ┌──────────────────────┐
    │           │    │ deal_shipment_prices │
    │           │    │ (Triггер / Фикс /    │
    │           │    │  Средний месяц rows) │
    │           │    └──────────────────────┘
    │           │               │
    │           │               │ rollup trigger (00030)
    │           │               └──► deals.supplier_shipped_amount,
    │           │                     buyer_shipped_amount
    │           ▼
    │   ┌───────────────┐
    │   │ deal_payments │ (per-payment; multi-currency)
    │   └───────────────┘
    │
    ▼
┌───────────────────┐
│ shipment_registry │ (per-wagon rows)
│ • 20+ columns     │
│ • per-row currency│
│ • BEFORE trigger  │
│   auto-computes   │
│   shipped_tonnage │
│   _amount         │
└────┬──────────────┘
     │
     │ rollup trigger (00011/00027)
     └─► deals.actual_shipped_volume, invoice_amount
```

Reference: `forwarders`, `tariffs` (railway tariff by station pair + forwarder + fuel + month + year), `quotations` (daily oil prices per `quotation_product_types`), `quotation_monthly_averages` (pre-aggregated).

### Auto-computation strategy

Heavy use of **Postgres triggers** to keep derived fields truthful. Three patterns:

1. **BEFORE-row computation** — fields computed from other fields of the same row.
   - `deals` → `supplier_contracted_amount = supplier_contracted_volume × supplier_price`, `balance = shipped − payment`, etc. (00021)
   - `shipment_registry` → `shipped_tonnage_amount = CEIL(volume) × tariff` (00031)
   - `deals.deal_code` → built from type/number/year (00003)

2. **AFTER-write rollup** — one table's changes propagate aggregates to another.
   - `shipment_registry` AFTER INSERT/UPDATE/DELETE → `deals.invoice_amount` / `actual_shipped_volume` (00011/00027)
   - `deal_shipment_prices` AFTER … → `deals.supplier_shipped_amount` / `buyer_shipped_amount` (00030)
   - `deal_payments` AFTER … → `deals.supplier_payment` / `buyer_payment` (00028)

3. **Activity feed** — `deal_payments` AFTER INSERT emits a row into `deal_activity` (00016). The client subscribes to `deal_activity` via Supabase Realtime (`postgres_changes`) for the chat feed.

Reason for the trigger-heavy design: the frontend does a single optimistic update of one field; the DB guarantees all dependent totals stay consistent even if other clients edit in parallel. No client logic is authoritative for money.

### RLS model

Defined in `00010_rls_policies.sql`:

- `is_writable_role()` — true if `profiles.role IN ('admin','manager','logistics')`.
- `is_admin()` — admin only.
- For every table: authenticated users can SELECT; writable roles can INSERT/UPDATE; only admins can DELETE.
- Follow-up migrations that add new tables (00015, 00019, 00023, etc.) replicate the same four-policy block per table.

Since the frontend uses the anon key directly and RLS runs at the database level, dropping auth bypasses nothing — every query filters by `auth.uid()`.

### Supabase clients

Three in `src/lib/supabase/`:

- **`client.ts`** — `createBrowserClient` (SSR package). Used by essentially every page and hook via `useRef(createClient())` so the instance survives re-renders.
- **`server.ts`** — `createServerClient` reading Next.js cookies. Used by API routes and the occasional RSC.
- **`middleware.ts`** — helpers for token refresh. Invoked by `proxy.ts` (currently a no-op pass-through).

`src/proxy.ts` (Next's edge middleware) used to enforce auth but was simplified to a pass-through for performance; auth is enforced client-side by `<AuthGuard>` inside the `(dashboard)` layout.

### Storage

Supabase Storage bucket holds `deal_attachments` files (contracts, SNT PDFs, invoices). Attachments table stores the path + category; client uploads/downloads via the SDK.

### API routes (`src/app/api/`)

Small — most data flow goes direct to Supabase. These endpoints cover server-only actions:

- `export/` — generate Excel exports server-side with `exceljs`.
- `import/` — handle multipart uploads that need parsing before insert.
- `deals/`, `quotations/` — narrow server helpers (e.g. batched refresh of monthly averages).

Everything else is client-side writes against RLS-protected tables.

---

## Frontend

### Routing

Next.js 16 App Router. Two route groups:

- **`(auth)`** — public, only `/login`.
- **`(dashboard)`** — has a shared `layout.tsx` that mounts:
  - `<AuthGuard>` — checks Supabase session client-side; redirects to `/login` otherwise.
  - Sidebar (desktop) / hamburger sheet (mobile).
  - Top bar with profile menu and global search.
  - `<Toaster>` for toast notifications (sonner) and `nextjs-toploader` for nav progress.

Dashboard pages are mostly client-only (`"use client"`) so we can use Supabase Realtime and optimistic inline edits without a round-trip.

### State & data fetching

Not using TanStack Query or SWR. Each domain has a custom hook in `src/lib/hooks/`:

```
use-deals.ts           useDeals / useDeal / updateDeal / createDeal
use-registry.ts        useRegistry / createRegistryEntry / updateRegistryEntry / bulkInsertRegistry
use-quotations.ts      useQuotations
use-applications.ts    useApplications / createApplication / updateApplication / toggleOrdered
use-deal-trigger-prices.ts  useDealTriggerPrices + insert/update/remove + fetchTriggerQuotationAvg
use-deal-activity.ts   useDealActivity / useApplicationActivity (realtime subscription)
use-references.ts      useSupabaseTable<T> — generic hook used by spravochnik pages
use-role.ts            returns current user's role
```

Shape of a typical hook:

```ts
export function useRegistry(type: "KG" | "KZ") {
  const [data, setData] = useState<ShipmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const load = useCallback(async () => { … }, [supabase, type]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load };
}
```

Mutations are plain async helpers (not hooks) so they can be called from anywhere and always `reload()` the relevant hook afterwards.

### Inline-edit pattern

The CRM is Excel-first in spirit. Most list pages replace read-only cells with click-to-edit inputs. Five small components recur:

| Component | Purpose | Location |
|---|---|---|
| `EC` | Editable text cell | inline in `registry/page.tsx` |
| `EN` | Editable number cell | inline |
| `ED` | Editable date cell | inline |
| `EM` | Month dropdown cell | inline |
| `ES` | Reference-select cell (factory/supplier/etc.) | inline |

Pattern:
1. Default view = `<button>` showing formatted value.
2. Click → swap to `<input>` / `<select>` with `autoFocus`.
3. `onBlur` → diff against old value, call `updateX(id, { field: newValue })`, then the hook reloads.
4. Optimistic display: a `useRef` stores the pending value between `onBlur` and the next data reload, so the UI doesn't flicker back to the old value.

The deal detail page uses slightly richer versions (`Field` + `EditableSelect`) that live at the top of `deals/[id]/page.tsx`.

### Optimistic UX & realtime

- **Optimistic write**: `updateDeal(id, { field: value })` writes to Supabase and the hook reloads. The `pendingVal` ref in each cell prevents a round-trip flash.
- **Realtime**: `useDealActivity` subscribes to `postgres_changes` on `deal_activity` for live chat + system messages when payments change. The passport table does **not** subscribe — it reloads on mount and after user mutations, which is cheap enough given page sizes.

### Forms — create flows

Create-new flows use `react-hook-form` + `zod` schemas only where validation is non-trivial (deal creation). Simpler dialogs (add tariff, add DT-KT, add registry entry) use plain `useState` — keeping the code predictable.

### Tables

Two flavors:
- **Inline-editable custom tables** (registry, tariffs, DT-KT, passport) — manual `<table>` markup because we need sticky columns, virtualization, and mixed cell types.
- **`CrudTable<T>`** (`components/shared/crud-table.tsx`) — generic table built on `@tanstack/react-table` with a built-in edit dialog. Used by all spravochnik pages (stations, factories, fuel types, etc.) where the shape is uniform.

### Key cross-cutting components

- **`passport-table.tsx`** — the 30+ column "паспорт сделок" table. Sections: Сделка | Поставщик | Группы | Покупатель | Логистика. Inline-editable cells for volumes, prices, payments.
- **`deal-company-chain.tsx`** — horizontal chain `Поставщик → Группы → Покупатель / Экспедитор = Маржа`. Edit mode adds/removes/reorders groups; margin computed client-side.
- **`deal-trigger-prices.tsx`** — per-month pricing rows for trigger / fixed / average_month modes. Each row inline-editable; derived `calculated_price` + `amount` recompute via `applyRowPatch`.
- **`deal-payments.tsx`** — payment list with per-payment currency; multi-currency totals ("1 200 000 ₸ + 5 000 $").
- **`bulk-add-dialog.tsx`** — paste a block of wagons (one per line, tab-separated for volume/date). Parser in `src/lib/parsers/bulk-wagons.ts` handles Excel paste, comma decimals, Russian date formats, and header-row auto-skip. Preview table shows per-row errors before commit.

### Constants & helpers

`src/lib/constants/`:

- `currencies.ts` — `CURRENCIES` array + `currencySymbol(code)` helper. Consumed by deals, shipments, payments, DT-KT.
- `months-ru.ts` — Russian month names in order.
- `deal-types.ts`, `nav-items.ts`.
- `quotation-columns.ts` — 16 per-product column layouts for the quotations grid (matches the source Excel).

### Styling

- Tailwind v4 with `@apply` usage kept minimal.
- Base-UI primitives via `shadcn` (base-ui flavor) for dialogs, popovers, tooltips, tables.
- `DESIGN.md` is the source of truth for colors/typography/spacing. Amber is the primary brand color (`stone` for text, `amber` for accents/focus rings).

### Build / test

- `npm run dev` — Next.js dev server.
- `npm run build` — production build. 30+ routes prerender as static; dashboard is client-rendered.
- `npm run test` — vitest; suites live in `src/__tests__/` (price formation has the main coverage).

---

## Data flow (end-to-end example — adding a shipment)

1. User clicks **Добавить отгрузку** on a deal group in `/registry`.
2. Inline row renders with fields pre-filled from the deal (fuel type, stations, tariff via `lookup_tariff`).
3. User types wagon number + volume, presses ✓.
4. `createRegistryEntry()` in `use-registry.ts` inserts into `shipment_registry`.
5. DB triggers fire:
   - `compute_registry_amount` (00031) sets `shipped_tonnage_amount`.
   - `refresh_deal_shipment_totals` (00027) updates `deals.invoice_amount` + `actual_shipped_volume`.
6. Hook's `reload()` re-fetches; the group totals and the deal detail page (if open) reflect the new numbers.

For a mass paste:

1. **Массово** button → `BulkAddDialog` opens with group context pre-filled.
2. User pastes wagons. `parseBulkWagons()` builds a preview with per-row error flags.
3. Submit → `bulkInsertRegistry(rows)` — single Supabase call inserting up to 500 rows.
4. Same DB triggers apply to each inserted row; one `reload()` at the end.

---

## Conventions summary

- One hook per domain; mutations are bare async helpers.
- **Trigger-first** for anything derived from other columns; avoid parallel JS logic.
- Optimistic inline-edit via `useRef(pendingVal)`, not global state.
- Migrations append-only with clear numeric order; no squashes.
- Realtime only where chat/notifications matter; reloads everywhere else.
- RLS is the authz boundary — never rely on the UI to hide things.
- Shared constants in `src/lib/constants/`; domain-specific helpers live alongside their hook.

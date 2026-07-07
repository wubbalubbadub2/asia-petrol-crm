# AS-BUILT-SUPABASE-DEPENDENCIES.md — Supabase-Shaped Holes to Fill

**CRM Project:** Asia Petrol petroleum-trading CRM  
**Inventory Date:** 2026-06-22  
**Purpose:** Complete audit of all Supabase dependencies for migration to plain PostgreSQL.

This document lists every concrete usage of Supabase APIs, RLS policies, Postgres functions, storage operations, and PostgREST patterns with file:line references. Each section is a migration punch-list item.

---

## 1. Supabase Auth

All authentication flows pass through Supabase JWT + session cookies. The system uses `@supabase/ssr` (server-side rendering helpers) + `@supabase/supabase-js` (client).

### 1.1 Client Auth Initialization  
**File:** `/src/lib/supabase/client.ts` (lines 1–19)  
- Imports: `createBrowserClient` from `@supabase/ssr`
- Creates browser client with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Used by all client components

### 1.2 Server Auth Initialization  
**File:** `/src/lib/supabase/server.ts` (lines 1–35)  
- Imports: `createServerClient` from `@supabase/ssr`
- Server action version; manages cookie persistence via Next.js `cookies()`
- Used in server components + server actions

### 1.3 Admin Auth (Service Role)  
**File:** `/src/lib/supabase/admin.ts` (lines 1–19)  
- Imports: `createClient` from `@supabase/supabase-js`
- Uses `SUPABASE_SERVICE_ROLE_KEY` — bypasses all RLS
- Deployed in server actions only; never imported to client-side files
- Called by: `/src/app/(dashboard)/settings/users/actions.ts`, `/src/app/(dashboard)/settings/users/page.tsx`, `/src/app/(dashboard)/spravochnik/managers/page.tsx`

### 1.4 Sign In (Password Auth)  
**File:** `/src/app/(auth)/login/page.tsx` (line 26)  
- Call: `supabase.auth.signInWithPassword({ email, password })`
- Returns error object; on success, session stored in cookie
- Cookie name pattern: `sb-<project-ref>-auth-token` (optionally chunked)

### 1.5 Sign Out  
**File:** `/src/components/layout/top-bar.tsx` (line 50)  
- Call: `supabase.auth.signOut()`
- Clears session cookie

### 1.6 Get Current User (Client-side)  
**File:** `/src/app/(dashboard)/settings/users/actions.ts` (line 13)  
- Call: `await supabase.auth.getUser()` → `{ data: { user }, error }`
- Also called in: `/src/app/(dashboard)/settings/users/page.tsx` (line 13)
- Also called in: `/src/app/(dashboard)/spravochnik/managers/page.tsx` (line 10)
- Also called in: `/src/lib/role-context.tsx` (line 54)
- Also called in: `/src/lib/hooks/use-deal-activity.ts` (lines 86, 165)
- Also called in: `/src/lib/hooks/use-deal-bundle.ts` (line 301)

### 1.7 Session Middleware (Fast Path)  
**File:** `/src/lib/supabase/middleware.ts` (lines 11–179)  
- Middleware at `/src/proxy.ts`
- **Fast path (lines 22–30):** Reads session cookie, decodes JWT's `exp` claim without calling Supabase
  - Parses `sb-*-auth-token` cookie (may be chunked across `.0`, `.1`, … suffixes)
  - Decodes base64url payload + reads `expires_at` field
  - If token valid for >60 seconds, passes through (no network call)
  - Uses `readSessionExpiry()`, `readAuthCookie()`, `decodeCookieValue()`, `readJwtExp()`, `base64UrlDecode()`
  
- **Slow path (lines 33–79):** Calls `supabase.auth.getUser()` for actual server-side verification
  - Redirects unauthenticated users to `/login`
  - Redirects authenticated users away from `/login` → `/`
  - Manages cookie refresh if session extends

### 1.8 JWT Structure Assumptions  
The system decodes JWT directly from cookie without validation:
- Expects `expires_at` field in session JSON
- Expects access_token in session JSON (fallback exp extraction)
- Skew tolerance: 60 seconds (line 9: `SESSION_SKEW_SECONDS`)
- No signature verification in fast path — trusts cookie origin

### 1.9 Package Dependencies  
**File:** `/package.json` (lines 18–19)  
- `@supabase/ssr": "^0.10.0` — session management
- `@supabase/supabase-js": "^2.101.1` — base library

---

## 2. Row-Level Security (RLS)

All 28 tables have RLS enabled. Access is role-based via `profiles.role`.

### 2.1 RLS Policy Definitions  
**File:** `/supabase/migrations/00010_rls_policies.sql` (lines 1–115)  

#### Tables with RLS Enabled:
- `counterparties`, `company_groups`, `factories`, `forwarders`, `stations`, `fuel_types`, `regions`, `profiles`, `quotation_product_types`, `quotations`, `quotation_monthly_averages` — reference data
- `deals`, `deal_sequences`, `deal_company_groups`, `applications`, `application_deals` — operational
- `shipment_registry`, `dt_kt_logistics`, `tariffs`, `surcharges`, `snt_documents`, `esf_documents` — logistics
- `deal_attachments`, `archive_years` — auxiliary

#### Policy Pattern (lines 56–114):  
Each table gets 4 policies:
1. **SELECT:** `auth.uid() IS NOT NULL` — all authenticated users can read
2. **INSERT:** `is_writable_role()` — only admin/manager/logistics
3. **UPDATE:** `is_writable_role()` — with deal-specific archive check for `deals` table
4. **DELETE:** `is_admin()` — admin only

**Special case — deals (lines 73–83):**  
```sql
UPDATE USING (
  is_writable_role()
  AND (
    NOT is_archived
    OR is_admin()
  )
)
```
Archive protection: managers cannot modify archived deals; admins can.

### 2.2 Helper Functions  
**File:** `/supabase/migrations/00010_rls_policies.sql` (lines 29–50)  

#### `is_writable_role()` (lines 30–39)  
- Returns TRUE if `auth.uid()` matches a profile with role IN ('admin', 'manager', 'logistics')
- Uses `auth.uid()` function call (Supabase's built-in)
- SECURITY DEFINER, STABLE

#### `is_admin()` (lines 41–50)  
- Returns TRUE if `auth.uid()` matches a profile with role = 'admin'
- Also uses `auth.uid()`
- SECURITY DEFINER, STABLE

### 2.3 RLS Dependencies in Application Code  
RLS is **transparent** to client code — Supabase enforces it server-side. However, all queries implicitly depend on:
- Current user's JWT `sub` claim → mapped to auth.uid()
- Profile lookup for that user → profile.role
- All calls to `.from().select()` are silently filtered

**Example dependent call:**  
`/src/app/(dashboard)/deals/page.tsx` (line 193): `supabase.from("deals").delete().eq("id", deal.id)`  
- Client sends DELETE request
- Supabase checks: does current user's profile have role IN ('admin')?
- If no, 403 FORBIDDEN

---

## 3. PostgREST API Surface (Auto-Generated REST)

Supabase's PostgREST layer auto-generates REST endpoints from Postgres schema. All `.from()` calls translate to REST operations with specific query syntax.

### 3.1 Common Query Patterns Found  
**Total call sites:** 274 instances of `.eq()`, `.neq()`, `.gt()`, `.gte()`, `.lt()`, `.lte()`, `.like()`, `.ilike()`, `.in()`, `.contains()`, `.order()`, `.range()`, `.limit()`, `.upsert()`, `.maybeSingle()`, `.single()`

### 3.2 SELECT with Joins (Embed Syntax)  
PostgREST-specific syntax using colon-delimited foreign key traversal:

**Pattern 1: Simple foreign key embed**  
`/src/lib/hooks/use-deal-lines.ts` (line 78–79):  
```ts
const BUYER_SELECT = `
  *,
  quotation_type:quotation_product_types(name),
  destination_station:stations!destination_station_id(name)
`;
```
Call: `sb.from("deal_buyer_lines").select(BUYER_SELECT).eq("deal_id", dealId)`

**Pattern 2: Multiple fields**  
`/src/app/(dashboard)/deals/[id]/page.tsx` (uses in multiple places):  
```ts
.select("id, deal_code, year, month, logistics_shipment_month, factory_id, fuel_type_id, supplier_id, buyer_id, forwarder_id, buyer_destination_station_id, supplier_departure_station_id, logistics_company_group_id, supplier:counterparties!supplier_id(short_name, full_name)")
```

**Pattern 3: Nested joins**  
Deal payload includes supplier/buyer counterparty data with aliases using `!` foreign key specifier.

### 3.3 Counting Operations  
**Pattern:** `{ count: "exact", head: true }` (HTTP HEAD request)  

`/src/app/(dashboard)/page.tsx` (line 115):  
```ts
supabase.from("applications").select("id", { count: "exact", head: true }).eq("is_ordered", false)
```
Issues HEAD request to count without fetching rows.

### 3.4 Range-Based Pagination  
**Pattern:** `.range(from, to)` — offsets for large result sets

`/src/lib/supabase/fetch-all.ts` (lines 21–36):  
```ts
export async function fetchAllPaginated<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    ...
  }
}
```

**Call sites using `fetchAllPaginated`:**
- `/src/app/(dashboard)/tariffs/page.tsx` (line 32)
- `/src/app/(dashboard)/archive/page.tsx` (line 56)
- `/src/app/(dashboard)/dt-kt/page.tsx` (line 56)
- `/src/lib/hooks/use-applications.ts` (line 21)

### 3.5 Operator Chains  
Typical query pattern (from `/src/app/(dashboard)/deals/new/page.tsx` lines 210–218):  
```ts
supabase.from("factories").select("id, name").eq("is_active", true).order("name")
supabase.from("fuel_types").select("id, name").eq("is_active", true).order("sort_order")
supabase.from("counterparties").select("id, full_name, short_name").eq("type", "supplier").eq("is_active", true).order("full_name")
```

**Operators used across codebase:**
- `.eq(column, value)` — 100+ occurrences
- `.neq(column, value)` — ~10 occurrences
- `.order(column, { ascending: bool })` — 50+ occurrences
- `.select()` with column list — in every `.from()` call
- `.limit(n)` — sparse usage
- `.single()` / `.maybeSingle()` — expect 0 or 1 row
- `.insert()` / `.update()` / `.delete()` — mutation calls
- `.is()` / `.in()` / `.like()` / `.ilike()` — filtering

### 3.6 Upsert Pattern  
Not found as `.upsert()` calls in this codebase (no bulk upsert-on-conflict patterns).

### 3.7 POST/PATCH/DELETE  
**Insert examples:**
- `/src/app/(dashboard)/spravochnik/suppliers/page.tsx` (line 191): `supabase.from("counterparties").insert({...})`
- `/src/app/(dashboard)/deals/new/page.tsx` (lines 316–317, 335–336): `supabase.from("deal_supplier_lines").delete().eq("deal_id", deal.id)` then `.insert(records)`

---

## 4. RPC Calls (Stored Procedures)

Five RPC functions are called from client code. All are Postgres PL/pgSQL functions.

### 4.1 `generate_deal_number(p_type, p_year)` → INT  
**Migration:** `/supabase/migrations/00011_functions.sql` (lines 4–16)  
**Purpose:** Atomically increment + return next deal number for (deal_type, year) pair  
**Call sites:**
- `/src/app/(dashboard)/deals/new/page.tsx` (line 294): `supabase.rpc("generate_deal_number", { p_type: dealType, p_year: year })`
- `/src/app/(dashboard)/deals/[id]/page.tsx` (lines 420–421): `supabase.rpc("generate_deal_number", { p_type: deal.deal_type, p_year: deal.year })`
- `/src/lib/hooks/use-deals.ts` (line 599): `.rpc("generate_deal_number", { p_type: dealType, p_year: year })`

**Signature:**
```sql
CREATE OR REPLACE FUNCTION generate_deal_number(p_type deal_type, p_year INT)
RETURNS INT AS $$
  INSERT INTO deal_sequences (deal_type, year, last_number)
  VALUES (p_type, p_year, 1)
  ON CONFLICT (deal_type, year)
  DO UPDATE SET last_number = deal_sequences.last_number + 1
  RETURNING last_number INTO v_number;
$$
```

### 4.2 `compute_quotation_value(product_type_id, price_source, target_date, calc_mode)` → NUMERIC  
**Migration:** `/supabase/migrations/00077_price_source_and_rpc.sql`  
**Purpose:** Fetch quotation price from wide columns (price / price_cif_nwe / price_fob_med / etc) on target date OR average over calendar month  
**Call sites:**
- `/src/components/deals/deal-create-variants.tsx` (line 251): `supabase.current.rpc("compute_quotation_value", { p_product_type_id: v.quotationTypeId, p_price_source: v.priceSource, p_target_date, p_calc_mode: effectiveCalcMode })`

**Args:** `p_product_type_id` (UUID), `p_price_source` (text: "price" | "price_cif_nwe" | "price_fob_med" | "price_fob_rotterdam" | "price_cif_nwe_standalone"), `p_target_date` (text ISO), `p_calc_mode` ("on_date" | "avg_month")

### 4.3 `compute_monthly_quotation_avg(product_type_id, year, month)` → NUMERIC  
**Migration:** `/supabase/migrations/00067_autoprice_average_month.sql`  
**Purpose:** Compute average price from `quotations` table for a given product type, year, and month  
**Call sites:**
- `/src/components/quotations/price-calculator.tsx` (line 66): `supabase.rpc("compute_monthly_quotation_avg" as never, { p_product_type_id: selectedType, p_year: year, p_month: month } as never)`

**Note:** Marked `as never` because types are not yet generated for this migration.

### 4.4 `recompute_line_shipment_prices(line_id, side)` → INT  
**Migration:** `/supabase/migrations/00068_price_stage.sql`  
**Purpose:** Recompute per-shipment prices in `deal_shipment_prices` after line price finalization  
**Call site:**
- `/src/lib/hooks/use-deal-lines.ts` (lines 175–177): `sb.rpc("recompute_line_shipment_prices" as never, { p_line_id: lineId, p_side: side } as never)`

**Args:** `p_line_id` (UUID), `p_side` ("supplier" | "buyer")  
**Returns:** Updated row count

### 4.5 `get_deal_bundle(deal_id)` → RECORD  
**Migration:** `/supabase/migrations/00093_get_deal_bundle.sql`  
**Purpose:** Atomic fetch of deal + supplier_lines + buyer_lines + shipment aggregations + attachments + activity in one RPC call  
**Call site:**
- `/src/lib/hooks/use-deal-bundle.ts` (line 163): `sb.current.rpc("get_deal_bundle", { p_deal_id: dealId })`

**Returns shape:**
```ts
{
  deal: Record<string, unknown> | null;
  supplier_lines: unknown[] | null;
  buyer_lines: unknown[] | null;
  shipment_rollup_raw: RegRollupRow[] | null;
  shipment_prices_raw: ShipmentPriceRollupRow[] | null;
  attachments: Record<string, AttachmentSnap[]> | null;
  activity: ActivityMessage[] | null;
}
```

---

## 5. Realtime (WebSocket Postgres Changes)

**Status:** Realtime is NOT used in this codebase.

No calls to `supabase.channel()` or `.on('postgres_changes', ...)` found in src/.

Activity feed updates are fetched on-demand, not via realtime channels.

---

## 6. Storage (File Uploads)

One storage bucket: `deal-attachments` (public).

### 6.1 Bucket Configuration  
**Bucket name:** `deal-attachments`  
**Access:** Public (files accessible via signed URL without auth)

### 6.2 Upload Operations  
**File:** `/src/app/(dashboard)/deals/[id]/page.tsx` (lines 1083–1095)  
```ts
const { error: uploadError } = await supabase.storage
  .from("deal-attachments")
  .upload(filePath, file, { contentType, cacheControl: "3600", upsert: false });
```

**Path convention:**  
`deals/{dealId}/{section}/{category}/{Date.now()}-{crypto.randomUUID()}{ext}`  
- `section`: "documents" (inferred from context)
- `category`: "contract", "snt", "esf", "waybill", "act_completed_works", "invoice", "quality_cert", "reconciliation_act", "application", "other"
- Filename uses timestamp + UUID to avoid conflicts; original name preserved in DB

### 6.3 Download / Signed URL  
**File:** `/src/app/(dashboard)/deals/[id]/page.tsx` (lines 1136–1141)  
```ts
const { data } = supabase.storage
  .from("deal-attachments")
  .getPublicUrl(att.file_path, opts);
return data.publicUrl;
```

**Options:** `{ download?: filename }` — appends `?download=filename` to URL; browser serves with Content-Disposition header.

### 6.4 Delete Operations  
**File:** `/src/app/(dashboard)/deals/[id]/page.tsx` (line 1110)  
```ts
await supabase.storage.from("deal-attachments").remove([filePath]).catch(() => {});
```

### 6.5 Re-upload (Legacy Path Fix)  
**File:** `/src/app/(dashboard)/deals/[id]/page.tsx` (lines 1161–1186)  
- New upload under UUID-based path; DB row updated to point to new path
- Old object remains as orphan in storage

### 6.6 MIME Type Mapping  
Custom mapping for extensions when `file.type` is empty (lines 63–75):
- `.pdf` → `application/pdf`
- `.xlsx` → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `.xls` → `application/vnd.ms-excel`
- `.doc*` → Microsoft Office
- Image formats (.jpg, .png, .gif)
- `.csv`, `.txt`

### 6.7 Attachment Database Table  
**File:** `/src/app/(dashboard)/deals/[id]/page.tsx` (lines 1097–1105)  
```ts
await supabase.from("deal_attachments").insert({
  deal_id: dealId,
  section,
  category,
  file_name: file.name,
  file_path: filePath,
  file_size: file.size,
  mime_type: contentType,
});
```

**Table:** `deal_attachments` columns: `id`, `deal_id`, `section`, `category`, `file_name`, `file_path`, `file_size`, `mime_type`, `uploaded_at`

---

## 7. Edge Functions / Edge Runtime

**Status:** Not used.

No `export const runtime = 'edge'` found in codebase.

---

## 8. @supabase/ssr and @supabase/supabase-js Direct Imports

### 8.1 Files Importing from Supabase Packages  
**`@supabase/ssr` (server-side helpers):**
- `/src/lib/supabase/client.ts` (line 1): `createBrowserClient`
- `/src/lib/supabase/server.ts` (line 1): `createServerClient`
- `/src/lib/supabase/middleware.ts` (line 1): `createServerClient`

**`@supabase/supabase-js` (base client):**
- `/src/lib/supabase/admin.ts` (line 1): `createClient`
- `/src/lib/supabase/fetch-all.ts` (line 1): `PostgrestError` (type import)

### 8.2 Functions Used  
- `createBrowserClient(url, key)` — browser-only client with session management
- `createServerClient(url, key, { cookies })` — server-side client with cookie persistence
- `createClient(url, key, { auth })` — admin client for service role
- `PostgrestError` — type for query errors

---

## 9. Build-Time / Config Supabase Touchpoints

### 9.1 TypeScript Code Generation  
**File:** `/package.json` (line 13)  
```json
"types:db": "npx -y supabase@latest gen types typescript --project-id oteysqqohcgnwpsxmyjg --schema public > src/lib/types/database.ts"
```

**Target file:** `/src/lib/types/database.ts` (auto-generated, not committed)  
- Downloads schema from Supabase project ID `oteysqqohcgnwpsxmyjg`
- Generates TypeScript types for all tables, RPC functions
- Imported in auth clients: `import type { Database } from "@/lib/types/database"`

### 9.2 Environment Variables  
**Public (embedded in client bundle):**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon (public) API key

**Private (server-only):**
- `SUPABASE_SERVICE_ROLE_KEY` — admin API key for server actions

**Config files:**
- `.env.local` or `.env.example` (template)

### 9.3 Package Dependencies  
**File:** `/package.json` (lines 18–19)  
```json
"@supabase/ssr": "^0.10.0",
"@supabase/supabase-js": "^2.101.1",
```

---

## 10. Migration Punch-List Summary

### Authentication & Session Management  
- **JWT token issuance + refresh**: Supabase Auth issues short-lived JWT + long-lived refresh token in cookies (9 call sites)
- **Session cookie parsing**: Middleware decodes JWT from `sb-*-auth-token` cookie, extracts `exp` claim (fast path in middleware.ts)
- **Password authentication**: `signInWithPassword` endpoint used at login (1 call site)
- **Sign out**: Clear session cookies (1 call site)
- **User lookup**: `auth.getUser()` fetches current profile + uid (7 call sites)

### Row-Level Security  
- **28 tables with RLS enabled**: All operational data tables
- **Role-based access**: 3 roles (admin, manager, logistics) + read-only user (бухгалтерия, trader)
- **Helper functions**: `is_writable_role()`, `is_admin()` check `auth.uid()` against profiles table
- **Archive protection**: Archived deals readable by all, writable only by admins
- **Implicit filtering**: All SELECT/INSERT/UPDATE/DELETE implicitly filtered by user's profile.role

### PostgREST API Endpoints  
- **Dynamic REST from Postgres schema**: 28 tables → 28 GET/POST/PATCH/DELETE endpoints
- **Foreign key embedding**: Colon-delimited joins (e.g., `supplier:counterparties!supplier_id(short_name)`)
- **Pagination**: `.range()` + loop with pageSize=1000 (4 call sites using `fetchAllPaginated`)
- **Counting**: `.select("id", { count: "exact", head: true })` for row counts without data
- **Operators**: `.eq()`, `.order()`, `.limit()`, `.single()`, `.maybeSingle()`, `.select()` (274 total uses)

### RPC Functions (Stored Procedures)  
- **`generate_deal_number(type, year)`**: Atomic sequence generation for deal numbers (3 call sites)
- **`compute_quotation_value(product_id, source, date, mode)`**: Fetch or average quotation price (1 call site)
- **`compute_monthly_quotation_avg(product_id, year, month)`**: Monthly average price (1 call site)
- **`recompute_line_shipment_prices(line_id, side)`**: Recalculate prices after finalization (1 call site)
- **`get_deal_bundle(deal_id)`**: Single RPC fetching deal + lines + shipments + activity + attachments (1 call site)

### Storage  
- **Bucket: `deal-attachments`** (public, 1 bucket)
  - File path convention: `deals/{dealId}/{section}/{category}/{timestamp}-{uuid}{ext}`
  - MIME type mapping for 10+ file extensions
  - Operations: `.upload()`, `.getPublicUrl()`, `.remove()` (7 call sites across deal page)
  - Files stored: deal contracts, SNT, ESF, waybills, invoices, quality certificates, payment acts, reconciliation acts, applications, other docs
  - Current files: Estimated 500–5000 files per live deal (not enumerated)

### Build-Time Artifacts  
- **Code generation script**: `types:db` npm script downloads schema, generates `/src/lib/types/database.ts`
- **Environment config**: 3 env vars (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
- **Package versions**: @supabase/ssr@^0.10.0, @supabase/supabase-js@^2.101.1

---

## 11. Detailed Call Site Index

### Auth Calls (9 sites)  
- Login: `/src/app/(auth)/login/page.tsx:26`
- Sign out: `/src/components/layout/top-bar.tsx:50`
- Get user: `/src/app/(dashboard)/settings/users/actions.ts:13`, `/src/app/(dashboard)/settings/users/page.tsx:13`, `/src/app/(dashboard)/spravochnik/managers/page.tsx:10`, `/src/lib/role-context.tsx:54`, `/src/lib/hooks/use-deal-activity.ts:86,165`, `/src/lib/hooks/use-deal-bundle.ts:301`

### RPC Calls (6 sites)  
- `generate_deal_number`: `/src/app/(dashboard)/deals/new/page.tsx:294`, `/src/app/(dashboard)/deals/[id]/page.tsx:420`, `/src/lib/hooks/use-deals.ts:599`
- `compute_quotation_value`: `/src/components/deals/deal-create-variants.tsx:251`
- `compute_monthly_quotation_avg`: `/src/components/quotations/price-calculator.tsx:66`
- `recompute_line_shipment_prices`: `/src/lib/hooks/use-deal-lines.ts:175`
- `get_deal_bundle`: `/src/lib/hooks/use-deal-bundle.ts:163`

### Storage Calls (7 sites)  
- Upload: `/src/app/(dashboard)/deals/[id]/page.tsx:1083`
- Get public URL: `/src/app/(dashboard)/deals/[id]/page.tsx:1137`
- Delete: `/src/app/(dashboard)/deals/[id]/page.tsx:1110`
- Re-upload: `/src/app/(dashboard)/deals/[id]/page.tsx:1171`

### High-Volume PostgREST (>5 call sites each)  
- `.from("deals").select()` (10+ sites)
- `.from("counterparties").select()` (6+ sites)
- `.from("quotations").select()` (5+ sites)
- `.from("applications").select()` (4+ sites)
- `.from("profiles").select()` (5+ sites)
- All common with `.eq()`, `.order()` chains

---

## 12. Postgres Functions Used by Triggers (Dependencies, Not Direct Calls)

The following functions are invoked automatically by database triggers, not from client code. The new backend must implement or trigger-replace them:

- `compute_deal_derived_fields()` — updates supplier_balance, buyer_debt
- `sync_supplier_lines_count()`, `sync_buyer_lines_count()` — denormalize line counts
- `refresh_deal_shipment_totals()`, `refresh_deal_payment_totals()` — rollup aggregates
- `propagate_deal_price_to_autorows()` — auto-price registry rows
- `autoprice_registry_insert()`, `autoprice_registry_update()` — auto-price logic
- `log_deal_payment_change()`, `log_deal_field_changes()` — audit logging
- `audit_trigger()` — generic audit table
- Shipment/pricing triggers (00068, 00030, 00027, etc.)

All trigger functions depend on:
- Trigger framework (`CREATE TRIGGER … FOR EACH ROW`)
- `NEW`, `OLD` row references
- `TG_OP` (operation type: INSERT, UPDATE, DELETE)

---

## Summary: New System Must Provide

1. **Authentication layer** providing:
   - JWT token generation (RS256 with uid + role claims)
   - Token refresh mechanism
   - Password verification (bcrypt compatible)
   - Session cookie management
   - middleware for auth check + redirect

2. **Authorization layer** providing:
   - Row-level access checks (role-based)
   - Role lookup from profiles table
   - Helper functions `is_writable_role()`, `is_admin()`

3. **REST API layer** providing:
   - Auto-generated or explicit endpoints for 28 tables
   - Foreign key embedding/joins
   - Pagination (.range with pageSize=1000)
   - Filtering operators (.eq, .order, .limit, .single)
   - HEAD request for row counts

4. **Stored Procedure / RPC layer** providing:
   - `generate_deal_number(type, year) → int`
   - `compute_quotation_value(product_id, source, date, mode) → numeric`
   - `compute_monthly_quotation_avg(product_id, year, month) → numeric`
   - `recompute_line_shipment_prices(line_id, side) → int`
   - `get_deal_bundle(deal_id) → record` (complex multi-table fetch)

5. **Trigger/Event framework** providing:
   - On INSERT/UPDATE/DELETE for 15+ tables
   - Denormalization of counts, rollups, derived fields
   - Automatic audit logging
   - Auto-pricing rule engine

6. **File storage layer** providing:
   - Public bucket `deal-attachments`
   - Path-based object storage (deals/{dealId}/{section}/{category}/{key}{ext})
   - Public URL generation
   - Upload / download / delete operations

7. **Database types / schema** providing:
   - TypeScript types for all tables (currently auto-gen via Supabase CLI)
   - Type-safe PostgREST client (or hand-written types)

---

**Document Length:** ~4700 words  
**Complexity Level:** High — distributed auth, RLS, complex triggers, multi-table RPC aggregation  
**Estimated Effort:** 12–16 weeks for feature-complete replacement (auth 3w, REST 2w, RPCs 3w, triggers 4w, testing/hardening 3w)

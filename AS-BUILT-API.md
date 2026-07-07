# AS-BUILT-API.md — Frontend Data Access Surface

## Overview

This document specifies the exact data-access surface of the petroleum trading CRM frontend. The new backend must implement precisely these queries, mutations, RPCs, storage operations, and subscriptions to maintain API compatibility.

Architecture: Single-RPC bundles (migration 00093) have consolidated many reads into rolled-up endpoints (`get_deal_bundle`). Pagination uses the 1000-row PostgREST batch + parallel fetch pattern. Module-level caches (stale-while-revalidate, 60s TTL) deduplicate in-flight requests and seed per-ID caches. Global refs cache (5min TTL) pre-warms reference data on dashboard load.

---

## Feature: Authentication

**Routes & Operations:**

1. **Login** (`src/app/(auth)/login/page.tsx:26`)
   - RPC/Mutation: `supabase.auth.signInWithPassword({ email, password })`
   - Returns: `{ error? }`

2. **Get Current User** (multiple locations)
   - Query: `supabase.auth.getUser()`
   - Returns: `{ data: { user: { id, email, ... } } }`
   - Called in: middleware.ts:63, settings/users/page.tsx:13, spravochnik/managers/page.tsx:10, role-context.tsx:54, deal-bundle.tsx:300
   - Used for permission checks and current-user context

3. **Sign Out** (`src/components/layout/top-bar.tsx:50`)
   - Mutation: `supabase.auth.signOut()`

---

## Feature: Deals List (Passport View)

**Query Path:** `/deals` → `src/lib/hooks/use-deals.ts:414-452` (fetchDealsList)

**Projection:** `LIST_SELECT` (lines 277-297)
```
SELECT
  id, deal_type, deal_number, year, deal_code, quarter, month,
  factory_id, fuel_type_id, sulfur_percent,
  supplier_id, supplier_contract, supplier_delivery_basis,
  supplier_contracted_volume, supplier_contracted_amount, supplier_price,
  supplier_shipped_amount, supplier_shipped_volume,
  supplier_payment, supplier_payment_date, supplier_balance,
  supplier_currency, supplier_manager_id,
  buyer_id, buyer_contract, buyer_delivery_basis,
  buyer_contracted_volume, buyer_contracted_amount, buyer_price,
  buyer_ordered_volume, buyer_shipped_volume, buyer_shipped_amount,
  buyer_payment, buyer_payment_date, buyer_debt,
  buyer_currency, buyer_manager_id, trader_id,
  buyer_destination_station_id, supplier_departure_station_id,
  forwarder_id, logistics_company_group_id, logistics_shipment_month,
  preliminary_tonnage, preliminary_amount, planned_tariff, actual_tariff,
  actual_shipped_volume, invoice_amount, invoice_volume,
  logistics_currency, currency, is_archived, is_draft, created_at,
  supplier_lines_count, buyer_lines_count,
  deal_company_groups(id, position, company_group_id, price, price_kind)
FROM deals
WHERE is_draft = false AND year = ? AND is_archived = ?
ORDER BY deal_number ASC
LIMIT 1000, 1000, 1000... (parallel pages)
```

**Filters (server-axis):** `year`, `isArchived` (client-only: dealType, month, supplier, buyer, factory, fuel, forwarder, company_groups, search)

**Joins Dropped:** FK joins for factory/fuel_type/supplier/buyer/forwarder/supplier_manager/logistics_company_group resolved from global refs cache (lines 255-276 explain why).

**Pagination:** HEAD count + parallel range(0,999), range(1000,1999), etc. in `fetchDealsList`.

**Cache:** Module-level `dealsCache` keyed by `{ year, isArchived }`, 60s TTL. Pre-seeding per-deal `dealByIdCache`.

**Shipments Lazy-Load:** `fetchDealShipments(dealId)` (lines 131-154)
```
SELECT id, wagon_number, waybill_number, loading_volume, shipment_volume, date
FROM shipment_registry
WHERE deal_id = ?
```
In-flight promise cached; dropped on failure so retry works.

**Payments Lazy-Load:** `fetchDealPayments(dealId, side)` (lines 177-211)
```
SELECT id, payment_date, amount, currency, description, payment_type
FROM deal_payments
WHERE deal_id = ? AND side = (supplier|buyer)
ORDER BY payment_date ASC
```

**Lines Export:** `fetchDealLinesForExport(dealIds[])` (lines 228-253)
```
SELECT id, deal_id, is_default, price, price_stage, preliminary_price, preliminary_quotation
FROM deal_supplier_lines WHERE deal_id IN (...)
UNION
SELECT id, deal_id, is_default, price, price_stage, preliminary_price, preliminary_quotation
FROM deal_buyer_lines WHERE deal_id IN (...)
```

---

## Feature: Deal Detail

**Query Path:** `/deals/[id]` → `src/lib/hooks/use-deal-bundle.ts:141-202`

**RPC:** `get_deal_bundle(p_deal_id: uuid)` (lines 158-163)
```
Returns: {
  deal: Record (full DEAL_SELECT projection with all joins),
  supplier_lines: DealSupplierLine[] (with quotation_type, departure_station joins),
  buyer_lines: DealBuyerLine[] (with quotation_type, destination_station joins),
  shipment_rollup_raw: { supplier_line_id?, buyer_line_id?, shipment_volume?, loading_volume? }[],
  shipment_prices_raw: { side, amount, shipment_registry: { supplier_line_id?, buyer_line_id? } }[],
  attachments: Record<category, AttachmentSnap[]>,
  activity: ActivityMessage[]
}
```

**Projection Detail (DEAL_SELECT from use-deals.ts:302-318):**
```
SELECT
  *,
  factory:factories(name),
  fuel_type:fuel_types(name, color),
  supplier:counterparties!supplier_id(full_name, short_name),
  buyer:counterparties!buyer_id(full_name, short_name),
  forwarder:forwarders(name),
  supplier_manager:profiles!supplier_manager_id(full_name),
  buyer_manager:profiles!buyer_manager_id(full_name),
  trader:profiles!trader_id(full_name),
  buyer_destination_station:stations!buyer_destination_station_id(name),
  supplier_departure_station:stations!supplier_departure_station_id(name),
  logistics_company_group:company_groups!logistics_company_group_id(name),
  deal_company_groups(...full set with company_group:company_groups(name)),
  supplier_lines:deal_supplier_lines(id),
  buyer_lines:deal_buyer_lines(id)
```

**Cache:** Module-level `bundleCache` keyed by dealId, 60s TTL.

**Mutations:**

1. **Update Deal Field** (many cells on page.tsx)
   - Mutation: `supabase.from("deals").update({ [field]: value }).eq("id", dealId)`

2. **Change Deal Number** (deals/[id]/page.tsx:420)
   - RPC: `supabase.rpc("change_deal_number", { p_deal_id, p_new_number })`

3. **Attachment Upload** (deals/[id]/page.tsx:1083-1110)
   - Storage: `supabase.storage.from("deal-attachments").upload(filePath, file)`
   - DB Insert: `supabase.from("deal_attachments").insert({ deal_id, category, file_name, file_path, file_size, uploaded_at })`

4. **Attachment Delete** (deals/[id]/page.tsx:1122)
   - DB Delete: `supabase.from("deal_attachments").delete().eq("id", attId)`
   - Storage Remove: `supabase.storage.from("deal-attachments").remove([filePath])`

5. **Attachment Download** (deals/[id]/page.tsx:1137)
   - Storage URL: `supabase.storage.from("deal-attachments").getPublicUrl(filePath)`

6. **Attachment Edit** (deals/[id]/page.tsx:1171-1175)
   - Storage Upload: `supabase.storage.from("deal-attachments").upload(newPath, file)`
   - DB Update: `supabase.from("deal_attachments").update({ category, file_name, file_path }).eq("id", attId)`

**Realtime Activity:**

- Channel subscription: `supabase.channel('deal-activity-{dealId}').on("postgres_changes", { event: "INSERT", schema: "public", table: "deal_activity", filter: 'deal_id=eq.{dealId}' })` (use-deal-bundle.tsx:266-294)
- Fetch on INSERT: `supabase.from("deal_activity").select("*, user:profiles(full_name, role)").eq("id", payload.new.id).single()`
- Insert message: `supabase.from("deal_activity").insert({ deal_id, user_id, type: "comment", content }).select(...).single()` (lines 319-328)

---

## Feature: Deal Creation & Lines

**Query Path:** `/deals/new` → `src/app/(dashboard)/deals/new/page.tsx`

**Reference Fetches** (lines 210-217):
```
SELECT id, name FROM factories WHERE is_active = true ORDER BY name
SELECT id, name FROM fuel_types WHERE is_active = true ORDER BY sort_order
SELECT id, full_name, short_name FROM counterparties WHERE type = 'supplier' AND is_active = true ORDER BY full_name
SELECT id, full_name, short_name FROM counterparties WHERE type = 'buyer' AND is_active = true ORDER BY full_name
SELECT id, name FROM forwarders WHERE is_active = true ORDER BY name
SELECT id, name FROM company_groups WHERE is_active = true ORDER BY name
SELECT id, name FROM stations WHERE is_active = true ORDER BY name
SELECT id, full_name FROM profiles WHERE is_active = true ORDER BY full_name
SELECT id, name FROM quotation_product_types WHERE is_active = true ORDER BY sort_order
```

**Tariff Lookup** (line 181):
```
SELECT planned_tariff FROM tariffs
WHERE departure_station_id = ? AND forwarder_id = ? AND month = ? AND year = ?
LIMIT 1
```

**Mutations:**

1. **Generate Deal Number** (page.tsx:294)
   - RPC: `supabase.rpc("generate_deal_number", { p_type: "KG"|"KZ"|"OIL", p_year: 2026 })` → number

2. **Create Deal** (use-deals.ts:591-623)
   - RPC: `supabase.rpc("generate_deal_number", { p_type, p_year })` → dealNumber
   - Insert: `supabase.from("deals").insert({ ...values, deal_number }).select().single()`

3. **Delete Draft Deal** (page.tsx:794)
   - Delete: `supabase.from("deals").delete().eq("id", draftDealId)`

4. **Insert Supplier Lines** (page.tsx:316-317)
   - Insert: `supabase.from("deal_supplier_lines").insert([{ deal_id, position, is_default, ... }, ...])`

5. **Insert Buyer Lines** (page.tsx:335-336)
   - Insert: `supabase.from("deal_buyer_lines").insert([{ deal_id, position, is_default, ... }, ...])`

6. **Insert Deal Payments** (page.tsx:361)
   - Insert: `supabase.from("deal_payments").insert({ deal_id, side: "supplier"|"buyer", payment_date, amount, ... })`

7. **Insert Company Groups** (page.tsx:388)
   - Insert: `supabase.from("deal_company_groups").insert([{ deal_id, company_group_id, position, price, price_kind, ... }, ...])`

**Supplier Line Operations** (use-deal-lines.ts):

- **Update Line** (line 154-158): `supabase.from("deal_supplier_lines").update(patch).eq("id", lineId)`
- **Add Line** (line 186-193): `supabase.from("deal_supplier_lines").insert({ deal_id, position, is_default: false }).select("id").single()`
- **Delete Line**: `supabase.from("deal_supplier_lines").delete().eq("id", lineId)`
- **Recompute Prices** (line 170-184): `supabase.rpc("recompute_line_shipment_prices", { p_line_id, p_side: "supplier"|"buyer" })` → number (rows affected)

Buyer line operations mirror supplier exactly (lines 126-151, 160-164, 196-203).

---

## Feature: Deal Deletion

**Query Path:** `/deals` (passport table action) — `src/app/(dashboard)/deals/page.tsx:193`

**Mutation:** `DELETE FROM deals WHERE id = ?`

---

## Feature: Registry (Shipment Records)

**Query Path:** `/registry` and `/registry/kg` / `/registry/kz` → `src/lib/hooks/use-registry.ts:87-154`

**Projection:** `REG_SELECT` (lines 66-79)
```
SELECT
  id, registry_type, row_number, quarter, month, date,
  waybill_number, wagon_number, shipment_volume, loading_volume,
  destination_station_id, departure_station_id,
  fuel_type_id, deal_id, factory_id, supplier_id, forwarder_id,
  buyer_id, company_group_id,
  shipment_month, additional_month,
  railway_tariff, rounded_tonnage_from_forwarder,
  shipped_tonnage_amount, shipped_tonnage_amount_override,
  rounded_volume_override, round_volume,
  supplier_appendix, buyer_appendix,
  invoice_number, comment, currency, created_at,
  deal:deals(deal_code, currency, year, month)
FROM shipment_registry
WHERE registry_type = 'KG'|'KZ'
ORDER BY date DESC, created_at DESC
```

**Pagination:** HEAD count exact, then parallel pages via `range(0,999), range(1000,1999)`, etc. (lines 110-132).

**Cache:** Module-level `registryCache` keyed by type ("KG"|"KZ"), 60s TTL.

**Mutations:**

1. **Create Registry Entry** (use-registry.ts:175-189): `supabase.from("shipment_registry").insert(values).select().single()`
2. **Update Registry Entry** (use-registry.ts:191-202): `supabase.from("shipment_registry").update(values).eq("id", entryId)`
3. **Bulk Insert Registry** (use-registry.ts:204-217): `supabase.from("shipment_registry").insert(records).select()`

---

## Feature: Quotations (Daily & Summary)

**Query Path:** `/quotations` → `src/lib/hooks/use-quotations.ts`

**Product Types** (lines 39-59):
```
SELECT * FROM quotation_product_types
WHERE is_active = true
ORDER BY sort_order ASC
```

**Daily Quotations** (lines 61-135):
```
SELECT * FROM quotations
WHERE date >= ? AND date < ?  -- month bounds
ORDER BY date ASC
```

**Upsert Quotation** (lines 87-132):
- If exists: `UPDATE quotations SET [field] = value WHERE id = ?`
- If not: `INSERT INTO quotations (product_type_id, date, [field]) VALUES (...) RETURNING *`

**Monthly Averages** (lines 137-157):
```
SELECT * FROM quotation_monthly_averages
WHERE year = ?
ORDER BY month ASC
```
(Currently dead — table is empty in prod.)

**Mutations:**

1. **Add Product Type** (quotations/page.tsx:113): `supabase.from("quotation_product_types").insert({ name, sub_name, basis, sort_order: 100 })`

**Price Calculator RPC** (src/components/quotations/price-calculator.tsx:66): `supabase.rpc("compute_quotation_value", { p_quotation_type_id, p_quotation_price, ... })`

---

## Feature: Applications

**Query Path:** `/applications` → `src/lib/hooks/use-applications.ts:45-77`

**Projection:** `APP_SELECT` (lines 33-38)
```
SELECT
  *,
  fuel_type:fuel_types(name, color),
  destination_station:stations!destination_station_id(name),
  assigned_manager:profiles!assigned_manager_id(full_name)
FROM applications
ORDER BY date DESC
```

**Pagination:** `fetchAllPaginated` with range(0,999), range(1000,1999), etc.
**Cache:** Module-level `appsCache`, 60s TTL.

**Mutations:**

1. **Create Application** (use-applications.ts:79-93): `supabase.from("applications").insert(values).select().single()`
2. **Update Application** (use-applications.ts:95-103): `supabase.from("applications").update(values).eq("id", appId)`
3. **Toggle Ordered** (use-applications.ts:105-117): `supabase.from("applications").update({ is_ordered: !currentValue }).eq("id", appId)`

---

## Feature: Surcharges & Tariffs

**Tariffs** (`/tariffs` page):
- Loads tariffs on demand via `fetchAllPaginated`
- Table: `tariffs`
- Fields: destination_station_id, departure_station_id, forwarder_id, fuel_type_id, month, year, planned_tariff, factory_id, norm_days

**Surcharges** (`/surcharges` page):
- Similar pattern; table: `surcharges`
- Fields: deal_passport_number, reason, amount, period, issued_by_name, issued_to_name, approval_status, claimed_amount, paid_amount

---

## Feature: DT-KT (Forwarder Logistics Ledger)

**Query Path:** `/dt-kt` → `src/app/(dashboard)/dt-kt/page.tsx`

Loads inline or via similar fetchAllPaginated pattern. Aggregates from `dt_kt_logistics`, `dt_kt_payments`, and `shipment_registry`.

---

## Feature: Spravochnik (Reference Data)

**Buyers** (`/spravochnik/buyers`):
- Table: `counterparties` WHERE type = 'buyer'
- Insert: `supabase.from("counterparties").insert({ type: "buyer", full_name, short_name, is_active, ... })`

**Suppliers** (`/spravochnik/suppliers`):
- Table: `counterparties` WHERE type = 'supplier'
- Insert: `supabase.from("counterparties").insert({ type: "supplier", full_name, short_name, is_active, ... })`

**Managers** (`/spravochnik/managers`):
- Table: `profiles`
- Permission check: `supabase.auth.getUser()` then `supabase.from("profiles").select("role").eq("id", user.id).single()` (managers/page.tsx:13)

**Consignees, Stations, Factories, Forwarders, Fuel Types, Company Groups:**
- All follow same pattern: SELECT WHERE is_active = true
- Resolved via global refs cache on page load (refs.ts)

---

## Feature: Import (SNT / ESF / Registry)

**Query Path:** `/import`, `/import/snt`, `/import/registry`, `/import/esf` → `src/app/(dashboard)/import/page.tsx`

**Mutations:**

1. **Import SNT Documents** (import/page.tsx:174): `supabase.from("snt_documents").insert(docs)`
2. **Import ESF Documents** (import/page.tsx:175): `supabase.from("esf_documents").insert(docs)`
3. **Bulk Insert Registry** (import path → bulkInsertRegistry): `supabase.from("shipment_registry").insert(records)`

---

## Feature: Dashboard Home

**Query Path:** `/` → `src/app/(dashboard)/page.tsx:106-127`

**Queries (all in parallel via Promise.all):**

1. **Deals Summary** (line 110):
   - `SELECT deal_type, month, fuel_type_id, supplier_id, buyer_id, forwarder_id, currency, supplier_contracted_volume, buyer_contracted_volume, supplier_shipped_amount, buyer_shipped_amount, supplier_payment, buyer_payment, supplier_balance, buyer_debt, buyer_shipped_volume FROM deals WHERE year = ? AND is_archived = false`

2. **Fuel Types** (line 111): `SELECT id, name FROM fuel_types`
3. **Suppliers** (line 112): `SELECT id, short_name FROM counterparties WHERE type = 'supplier'`
4. **Buyers** (line 113): `SELECT id, short_name FROM counterparties WHERE type = 'buyer'`
5. **Forwarders** (line 114): `SELECT id, name FROM forwarders`
6. **Pending Applications Count** (line 115): `SELECT id FROM applications WHERE is_ordered = false` with `count: "exact", head: true`

---

## Feature: Settings / Users Management

**Query Path:** `/settings/users` → `src/app/(dashboard)/settings/users/page.tsx`

**Auth Check** (line 13): `supabase.auth.getUser()`

**User CRUD:** Via Supabase Auth Admin API (server actions: createUser, updateUser, resetPassword, deleteUser). Frontend displays + manages profile roles via `profiles` table.

---

## Feature: Archive

**Query Path:** `/archive` → `src/app/(dashboard)/archive/page.tsx:54-56`

**Archive Years:** `SELECT * FROM archive_years ORDER BY year DESC`

**Archive Status Check:** `SELECT year, is_archived FROM deals LIMIT ? OFFSET ?`

---

## Feature: Exports

**Passport Excel** (`src/lib/exports/passport-excel.ts`): Calls `fetchDealLinesForExport(dealIds[])` to bulk-fetch variant line prices.

**Quotations Excel** (`src/lib/exports/quotations-excel.ts`): Reads from in-memory quotations array (no separate fetch).

---

## Global Refs Cache

**Location:** `src/lib/refs.ts:55-124`

**Warm Path (Initial Load):**
- Suppliers: `SELECT id, short_name, full_name FROM counterparties WHERE type = 'supplier' AND is_active = true ORDER BY full_name`
- Buyers: `SELECT id, short_name, full_name FROM counterparties WHERE type = 'buyer' AND is_active = true ORDER BY full_name`
- Forwarders: `SELECT id, name FROM forwarders WHERE is_active = true ORDER BY name`
- Managers (Profiles): `SELECT id, full_name FROM profiles WHERE is_active = true ORDER BY full_name`
- Stations: `SELECT id, name FROM stations WHERE is_active = true ORDER BY name`
- Company Groups: `SELECT id, name FROM company_groups WHERE is_active = true ORDER BY name`
- Factories: `SELECT id, name FROM factories WHERE is_active = true ORDER BY name`
- Fuel Types: `SELECT id, name, color FROM fuel_types WHERE is_active = true ORDER BY sort_order`

**Lazy Path (Background):**
- Quotation Types: `SELECT id, name FROM quotation_product_types WHERE is_active = true ORDER BY sort_order`
- Consignees: `SELECT id, name FROM consignees WHERE is_active = true ORDER BY name`

**Warm-Up:** Called from dashboard layout on auth resolve. **TTL:** 5 minutes (300s).

---

## Pagination & Batching Patterns

1. **List Views (Deals, Registry, Applications):**
   - HEAD query with `count: "exact", head: true` to learn total count
   - Parallel `range(0, 999), range(1000, 1999), ...` batches via Promise.all
   - All batches streamed into single array; only flip loading=false once

2. **Inline Filtering:**
   - Year, isArchived (server-axis) passed to query; cache key from these only
   - Deal type, month, supplier, buyer, factory, fuel, forwarder, company group (client-axis) applied in-memory via useMemo().filter()

3. **Promise Dedup:**
   - Shared in-flight promises keyed by cache key (`dealsCache.promise`, `registryCache.promise`, etc.)
   - Two concurrent `useDeals` hooks await the same promise instead of double-firing

---

## Cache Layers

### Module-Level Caches (All in src/lib/hooks/):

1. **dealByIdCache** (use-deals.ts:399): `Map<dealId, { data: Deal; ts }>`, 60s TTL.
2. **dealsCache** (use-deals.ts:395): `Map<cacheKey, DealsCacheEntry>`, 60s TTL. Cache key: `{ year, isArchived }`.
3. **shipmentsCache** (use-deals.ts:130): `Map<dealId, Promise<ShipmentSnap[]>>`, no TTL (per-session).
4. **paymentsCache** (use-deals.ts:176): `Map<dealId:side, Promise<PaymentSnap[]>>`, no TTL.
5. **bundleCache** (use-deal-bundle.ts:92): `Map<dealId, { data: DealBundle; ts }>`, 60s TTL.
6. **supplierLinesCache / buyerLinesCache** (use-deal-lines.ts:90-91): `Map<dealId, { data: Line[]; ts }>`, 60s TTL.
7. **registryCache** (use-registry.ts:84): `Map<type, { data: ShipmentRecord[]; ts }>`, 60s TTL.
8. **appsCache** (use-applications.ts:42): `{ data: Application[]; ts }`, 60s TTL.

### Refs Cache (src/lib/refs.ts:52-123):

- Type: `CacheState { promise, data, ts }`
- TTL: 5 minutes (300s)
- Warm-up: Dashboard layout fires `getGlobalRefs()` on mount

### Storage Access Patterns:

- **getPublicUrl**: Synchronous; no network
- **upload**: Multipart form with file stream
- **remove**: Delete-by-key; handles missing files gracefully

---

## Master Tables-by-Feature Matrix

| Feature | deals | deal_supplier_lines | deal_buyer_lines | shipment_registry | applications | quotations | tariffs | surcharges | profiles | counterparties | forwarders | stations | factories | fuel_types | company_groups | quotation_product_types | deal_payments | deal_company_groups | deal_attachments | deal_activity |
|---------|-------|---------------------|------------------|-------------------|--------------|-----------|---------|-----------|----------|----------------|-----------|----------|-----------|------------|-----------------|----------------------|---------------|---------------------|------------------|-----------------|
| Deals List | R | - | - | - | - | - | - | - | - | - | - | - | - | - | R (count) | - | - | - | - | - |
| Deal Detail | RW | R | R | - | - | - | - | - | - | - | - | - | - | - | - | - | R | RW | RW | R |
| Deal Create | W | W | W | - | - | - | R | - | - | R | R | R | R | R | W | R | W | W | - | - |
| Deal Lines | - | RW | RW | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| Registry | - | - | - | RW | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| Quotations | - | - | - | - | - | RW | - | - | - | - | - | - | - | - | - | RW | - | - | - | - |
| Applications | - | - | - | - | RW | - | - | - | - | - | - | R | - | R | - | - | - | - | - | - |
| Tariffs | - | - | - | - | - | - | RW | - | - | - | R | R | R | R | - | - | - | - | - | - |
| Surcharges | - | - | - | - | - | - | - | RW | - | - | - | - | - | - | - | - | - | - | - | - |
| Spravochnik | - | - | - | - | - | - | - | - | RW | RW | RW | RW | RW | RW | RW | RW | - | - | - | - |
| Dashboard | R | - | - | - | R (count) | - | - | - | - | R | R | - | - | R | - | - | - | - | - | - |
| Archive | R | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |

**Legend:** R = read only, W = write only, RW = read+write, R (count) = count(*), - = not accessed

---

## Projection Optimization Summary

**Dropped Joins to Global Refs Cache:**

The frontend aggressively dropped single-row FK joins from bulk-fetch queries and replaced them with in-memory lookups against the refs cache:

- Deals list (LIST_SELECT): Dropped factory, fuel_type, supplier, buyer, forwarder, supplier_manager, logistics_company_group (lines 255-276 in use-deals.ts)
- Registry (REG_SELECT): Dropped destination_station, departure_station, fuel_type, factory, forwarder, company_group, supplier, buyer (lines 50-57 in use-registry.ts)
- Tariffs page: Dropped all FK joins; resolves names from refs on render

**Performance Impact:** ~8 sub-selects × N rows removed from wire payload per list view. Typical 500-deal list went from 1.28 MB to 250 KB (migration 00092 audit).

**Denormalized Counts:** `supplier_lines_count`, `buyer_lines_count` now live as columns on `deals` table, maintained by AFTER triggers (migration 00092).

---

## Authentication & Session

- **Supabase Auth:** Session stored in cookie (secure, httpOnly, set by middleware)
- **Middleware Check** (src/lib/supabase/middleware.ts): Parses JWT from request cookies to avoid 300–800ms `supabase.auth.getUser()` round-trip on every route
- **Keepalive Ping** (src/app/api/keepalive/route.ts): Edge function (HEAD SELECT to keep PostgREST pooler warm)

---

## RPCs Summary

| RPC Name | Arguments | Returns | Called From |
|----------|-----------|---------|-------------|
| `generate_deal_number` | p_type: "KG"\|"KZ"\|"OIL", p_year: int | number | deals/new, deals/[id] |
| `get_deal_bundle` | p_deal_id: uuid | BundleRpcShape | deals/[id] (useDealBundle) |
| `recompute_line_shipment_prices` | p_line_id: uuid, p_side: "supplier"\|"buyer" | number | deal-lines-editor |
| `change_deal_number` | p_deal_id: uuid, p_new_number: int | void | deals/[id] detail page |
| `compute_quotation_value` | p_quotation_type_id, p_quotation_price, p_target_date, p_calc_mode | number | price-calculator |

---

## Realtime Subscriptions

1. **Deal Activity** (use-deal-bundle.ts:264-294)
   - Channel: `deal-activity-{dealId}`
   - Event: `postgres_changes` INSERT on `deal_activity` table
   - Filter: `deal_id=eq.{dealId}`
   - Action: Append new message to activity feed; deduplicate by id

2. **Application Activity** (use-deal-activity.ts variant)
   - Channel: `app-activity-{applicationId}`
   - Filter: `application_id=eq.{applicationId}`

---

## Storage Buckets

- **deal-attachments:** File upload/download for deal documents
  - Multipart: file stream with Content-Type detection fallback (MIME_BY_EXT)
  - Public URL via getPublicUrl

---

This spec defines every query, mutation, RPC, and cache pattern the new backend must satisfy. The frontend relies on exact column projections, ordering semantics, and cache TTLs to maintain performance; deviations will cause visible lag or incorrect aggregates in the UI.

# AS-BUILT-AUTH.md — Authentication & Access Control

**Petroleum-trading CRM** — Supabase RLS + Next.js middleware + role-based UI gating. This document exhaustively documents the authentication layer, session management, RLS policies, role definitions, and application-layer access checks as implemented in the codebase.

## 1. Authentication

### Login Flow

**Step 1: Login Page Render** (`src/app/(auth)/login/page.tsx`)
- User navigates to `/login` or proxy redirects after session expiry
- Form displays email + password inputs with sign-in button
- State: `email`, `password`, `error`, `loading`
- Success/error UX: toast-style error message if `supabase.auth.signInWithPassword()` fails; generic "Неверный email или пароль" (incorrect credentials message) on error

**Step 2: Credential Submission**
- Client calls `supabase.auth.signInWithPassword({ email, password })`
- Supabase Auth validates against `auth.users` table and returns JWT if valid
- Error response: `setError("Неверный email или пароль")`, `setLoading(false)` (line 32)

**Step 3: Success Redirect**
- JWT written to `sb-<project-ref>-auth-token` cookie (secure, httpOnly, SameSite)
- `router.push("/")` navigates to dashboard
- `router.refresh()` triggers new RSC render to fetch profile + check auth state

**Step 4: Middleware Auth Gate** (`src/proxy.ts` + `src/lib/supabase/middleware.ts`)
- Every request (except `/login`, `/auth`, `/api/keepalive`, and RSC prefetches) passes through `proxy()` → `updateSession()`
- If unauthenticated & not `/login` → redirect to `/login` (line 69)
- If authenticated & on `/login` → redirect to `/` (line 76)
- **Fast-path optimization**: If request is not `/login` or `/auth` route, middleware reads the session cookie locally and compares `expires_at` (epoch seconds) to current time + 60-second skew buffer. If valid, skip `supabase.auth.getUser()` network round-trip and return immediately (line 26-28).

### Session Storage

- **Cookie name**: `sb-<project-ref>-auth-token` (e.g., `sb-oteysqqohcgnwpsxmyjg-auth-token`)
- **Chunking**: If session JSON exceeds ~4KB, split into `<name>.0`, `<name>.1`, ... chunks (handled in `readAuthCookie()`, lines 123-140)
- **Encoding**: either raw JSON or `base64-<base64url>` (detected by prefix in `decodeCookieValue()`, lines 143-153)
- **Contents**: Full Supabase session object with `access_token` (JWT), `refresh_token`, `expires_at` (epoch seconds), `user` object
- **Expiry behavior**: Supabase client auto-refreshes on SSR via `@supabase/ssr`. Refresh happens well before JWT `exp` claim. Middleware's 60-second skew (`SESSION_SKEW_SECONDS = 60`, line 9) is defensive safety margin.

### Fast-Path JWT Optimization Rules

**Location**: `src/lib/supabase/middleware.ts`, lines 22-31

**Conditions**:
1. Request is NOT `/login` or `/auth/*` path
2. Request is NOT an RSC prefetch (checked via `_rsc` query param, `rsc: 1` header, etc.)

**Decoding**:
- Read `sb-...-auth-token` cookie (or reconstruct from chunks)
- Decode from `base64-...` if present
- Parse JSON, extract `expires_at` field (authoritative)
- Fallback: if `expires_at` missing, decode JWT access_token's middle segment (base64url) and extract `exp` claim (lines 155-166)

**Decision**: If `expiresAt - nowSeconds > 60`, cookie is fresh enough → skip slow path, return immediately. Otherwise, call `supabase.auth.getUser()` and refresh session.

### Password Reset Flow

**Admin-only operation**. `src/app/(dashboard)/settings/users/actions.ts`, `resetPasswordAction()` (lines 95-111):
- Server action (`"use server"`)
- `requireAdmin()` guard enforces only admin can call (line 99)
- `admin.auth.admin.updateUserById(id, { password })` sets new password directly
- Password length enforced: minimum 6 characters (line 101)
- Admin must know user's ID to reset; no email-based self-service flow exists

### User Creation Flow

**Admin-only operation**. `src/app/(dashboard)/settings/users/actions.ts`, `createUserAction()` (lines 24-69):
1. `requireAdmin()` guard (line 30)
2. Validate inputs: email trimmed + lowercased, full_name, password length ≥ 6 (lines 33-40)
3. Call `admin.auth.admin.createUser()` with:
   - `email`, `password`
   - `email_confirm: true` (auto-confirm email)
   - `user_metadata: { full_name, role: input.role }` (stored in Supabase Auth's `raw_user_meta_data` JSONB field)
4. Trigger `handle_new_user()` fires AFTER INSERT on `auth.users` (migration 00001, lines 98-114):
   - Reads `raw_user_meta_data->>'full_name'` and `->>'role'`, creates `profiles` row
   - If metadata fields absent, falls back to `email` for full_name, `'readonly'` for role
5. Defensive upsert of profiles row in action (line 59) to ensure consistency
6. If profile insert fails, roll back auth user via `deleteUser()` (line 63)
7. Cache invalidated via `revalidatePath("/settings/users")` (line 67)

---

## 2. User Identity Model

### Profiles Table Schema

**Table**: `profiles` (`src/lib/types/database.ts` + migration 00001)
- `id` (UUID, PK, FK to `auth.users(id)` ON DELETE CASCADE)
- `full_name` (TEXT, NOT NULL) — user's display name
- `role` (user_role enum, NOT NULL, DEFAULT 'readonly')
- `region_id` (UUID, FK to `regions(id)`, nullable)
- `is_active` (BOOLEAN, DEFAULT true)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ) — auto-updated by trigger

### Role Origin

Role originates in `auth.users.raw_user_meta_data.role` (created during signup by admin via `user_metadata` JSON). The `handle_new_user()` trigger (migration 00001, lines 98-114) reads:
```sql
COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'readonly')
```
This casts the string value to the `user_role` enum type. If missing or invalid, defaults to `'readonly'`.

### Handle New User Trigger

**Trigger**: `on_auth_user_created` on `auth.users`
**Function**: `handle_new_user()` (migration 00001, SECURITY DEFINER)
**Action**: AFTER INSERT
**Logic**:
```sql
INSERT INTO profiles (id, full_name, role)
VALUES (
  NEW.id,
  COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
  COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'readonly')
);
```

### Profile Fields Used by App

**Client**: `useRole()` hook (`src/lib/role-context.tsx`, line 64-66) fetches:
```typescript
.select("id, full_name, role, is_active")
```

**Usage**:
- `id`: matched against `auth.uid()` to confirm identity
- `full_name`: displayed in top bar avatar + user list
- `role`: drives `isWritable` and `isAdmin` flags (lines 27-36)
- `is_active`: not checked in UI; used to soft-disable accounts (admin can set to false without deleting)

---

## 3. Roles Enum — Values & Enforcement

**Enum definition**: migration 00001, line 6
**Recent expansion**: migration 00082 (adds 'finance', 'trader'), migration 00083 (downgrades 'trader' read-only)

### Role Values

| Role | Introduced | Intended Purpose | RLS Enforcement | Client isWritable | Notes |
|------|------------|------------------|-----------------|------------------|-------|
| `admin` | 00001 | Full system access | `is_admin()` → SELECT roles in ['admin'] | YES | Only role that can DELETE; can update archived deals |
| `manager` | 00001 | Deal management | `is_writable_role()` includes | YES | INSERT/UPDATE all data; used for commercial managers |
| `logistics` | 00001 | Shipment/tariff entry | `is_writable_role()` includes | YES | INSERT/UPDATE shipment + tariff tables |
| `accounting` | 00001 | Read-only viewing | NOT in `is_writable_role()` | NO | Can SELECT; RLS denies INSERT/UPDATE/DELETE |
| `readonly` | 00001 | Audit/viewing only | NOT in `is_writable_role()` | NO | Can SELECT; RLS denies INSERT/UPDATE/DELETE |
| `finance` | 00082 | Financial control | `is_writable_role()` includes | YES | Added as writable role; for payment/deal edit |
| `trader` | 00082 → 00083 | Deal brokerage (BUT DOWNGRADED) | NOT in `is_writable_role()` (post-00083) | NO | Initially writable (00082), rolled back to read-only (00083); can only view & export |

### The Trader Contradiction (00083)

**Migration 00082** added `trader` and `finance` roles, both writable.

**Migration 00083** ("Roll back trader from writable roles") downgrades trader:
```sql
-- Comment: Client decision (29.05.2026):
-- «Трейдеры и Бухгалтеры — только смотреть и выгружать Excel-файлы.
-- Паспорта и котировки. Остальне — менять, вводить данные — им не нужно».

RETURN EXISTS (
  SELECT 1 FROM profiles
  WHERE id = auth.uid()
  AND role IN ('admin', 'manager', 'logistics', 'finance')
);
```

**Enforcement mismatch**:
- RLS policy `is_writable_role()` now excludes trader → RLS will deny INSERT/UPDATE on deals, shipments, etc.
- Client-side `deriveFlags()` (role-context.tsx line 30-34) ALSO excludes trader → UI buttons/forms disabled
- **Flag**: Enum value stays in database (for backward compat with existing trader users), but both RLS + UI gates prevent write operations
- **Design**: Traders can SELECT all deals/quotations/shipment registry but cannot modify—essentially audit/export mode

---

## 4. Application-Layer Access Checks

### Sidebar Navigation (`src/components/layout/sidebar.tsx`)

| File:Line | Condition | Gates |
|-----------|-----------|-------|
| sidebar.tsx:104-108 | `isAdmin` from `useRole()` | Filters `navItems` to only show `adminOnly: true` items if user is admin |
| nav-items.ts:80 | `adminOnly: true` on archive + settings | Archive, Settings links hidden for non-admin |

### Top Bar Dropdown (`src/components/layout/top-bar.tsx`)

| File:Line | Condition | Gates |
|-----------|-----------|-------|
| top-bar.tsx:97 | `profile.role === "admin"` | Archive + Settings menu items only shown to admin |

### Archive Page (`src/app/(dashboard)/archive/page.tsx`)

| File:Line | Condition | Gates |
|-----------|-----------|-------|
| archive/page.tsx:37 | `{ isAdmin } = useRole()` | Loads role state |
| archive/page.tsx:80 | `if (!isAdmin) { toast.error(...); return; }` | Archive action button disabled |
| archive/page.tsx:109 | `{isAdmin && (...)}` | Render archive year input + button form only if admin |

### Users Page (`src/app/(dashboard)/settings/users/page.tsx`)

| File:Line | Condition | Gates |
|-----------|-----------|-------|
| users/page.tsx:13-14 | `redirect("/login")` if not authenticated | SSR double-checks |
| users/page.tsx:18-20 | `me?.role !== "admin"` | 403-style card "only admin" shown; no user list fetched |
| users/page.tsx:40-48 | `createAdminClient()` used | Admin bypasses RLS to list all users |

### Deals Detail Page (`src/app/(dashboard)/deals/[id]/page.tsx`)

| File:Line | Condition | Gates |
|-----------|-----------|-------|
| deals/[id]/page.tsx:354 | `{ isAdmin, isWritable } = useRole()` | Loads flags |
| deals/[id]/page.tsx:655, 674, 945 | `{isWritable && (...)}` | Add buttons shown only if writable |
| Cells marked `editable: true` | `disabled={!isWritable \|\| !col.editable}` | Read-only cells for non-writable users |

### Quotations Page (`src/app/(dashboard)/quotations/page.tsx`)

| File:Line | Condition | Gates |
|-----------|-----------|-------|
| quotations/page.tsx:139, 572 | `{ isWritable } = useRole()` | Loads flag |
| quotations/page.tsx:307, 579 | `{isWritable && (...)}` | "Add quotation" button shown only if writable |
| quotations/page.tsx:484, 497 | `disabled={!isWritable \|\| !col.editable}` | Cells disabled for non-writable users |

### Server Actions (`src/app/(dashboard)/settings/users/actions.ts`)

- `createUserAction()` line 30: `requireAdmin()` guard at start
- `updateUserAction()` line 77: `requireAdmin()` guard
- `resetPasswordAction()` line 99: `requireAdmin()` guard
- `deleteUserAction()` line 114: `requireAdmin()` guard

**Enforcement**: Non-admin calling any action gets `{ ok: false, error: "Доступ только у администратора" }`.

---

## 5. RLS Policies — Exhaustive

### Standard RLS Template

**Most tables** follow this pattern (migration 00010, lines 56-71):

```sql
CREATE POLICY "auth_select_<table>" ON <table>
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_<table>" ON <table>
  FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_<table>" ON <table>
  FOR UPDATE USING (is_writable_role());
CREATE POLICY "admin_delete_<table>" ON <table>
  FOR DELETE USING (is_admin());
```

**Applies to** (00010 lines 60-70):
- `counterparties`, `company_groups`, `factories`, `forwarders`
- `stations`, `fuel_types`, `regions`, `profiles`
- `quotation_product_types`, `quotations`, `quotation_monthly_averages`
- `deal_sequences`, `archive_years`

**Applies to** (00010 lines 90-97):
- `deal_company_groups`, `application_deals`, `deal_attachments`

**Applies to** (00010 lines 105-113):
- `applications`, `shipment_registry`, `dt_kt_logistics`
- `tariffs`, `surcharges`, `snt_documents`, `esf_documents`

### Deviations from Standard Template

#### Deals Table (Special Archive Guard)

**Migration 00010, lines 74-82**:

```sql
CREATE POLICY "auth_select_deals" ON deals FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_deals" ON deals FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_deals" ON deals FOR UPDATE USING (
  is_writable_role()
  AND (
    NOT is_archived
    OR is_admin()
  )
);
CREATE POLICY "admin_delete_deals" ON deals FOR DELETE USING (is_admin());
```

**Deviation**: UPDATE policy adds archive protection.
- Regular writable users (manager, logistics, finance) cannot UPDATE archived deals (`is_archived = true`)
- Only admin can UPDATE archived deals

#### Pricing Lines (Deal Supplier/Buyer Lines)

**Migration 00053**: Standard template.

#### Deal Shipment Prices

**Migration 00023**: Standard template.

#### Deal Payments

**Migration 00019**: Standard template.

#### Deal Activity Feed

**Migration 00016**:

```sql
CREATE POLICY "auth_select_deal_activity" ON deal_activity FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_deal_activity" ON deal_activity FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "admin_delete_deal_activity" ON deal_activity FOR DELETE USING (is_admin());
```

**Note**: No UPDATE policy — activity is append-only.

#### Audit Log (Special: Read-Only, No Writes Allowed)

**Migration 00036**:

```sql
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_audit_log" ON audit_log FOR SELECT USING (auth.uid() IS NOT NULL);
-- No INSERT/UPDATE/DELETE policies → those are denied by default.
```

**Deviation**:
- Only SELECT policy; no INSERT/UPDATE/DELETE policies created
- Default deny for write operations
- Write capability exclusively via `audit_trigger()` function (SECURITY DEFINER), which runs as Postgres itself and bypasses RLS

### RLS Functions Referenced

#### `is_admin()`

**Definition**: migration 00010, lines 41-49

```sql
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
```

#### `is_writable_role()`

**Definition**: migration 00010, lines 30-39

```sql
CREATE OR REPLACE FUNCTION is_writable_role()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager', 'logistics')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
```

**Redefinition 1**: migration 00082, lines 17-26
```sql
-- Adds 'finance' and 'trader' to writable roles
AND role IN ('admin', 'manager', 'logistics', 'finance', 'trader')
```

**Redefinition 2**: migration 00083, lines 11-20
```sql
-- Downgrades 'trader' back to read-only; keeps 'finance'
AND role IN ('admin', 'manager', 'logistics', 'finance')
```

### RLS Summary Patterns

| Pattern | Tables | Comment |
|---------|--------|---------|
| Standard (S+W+A) | Most reference + operational | SELECT all authenticated; INSERT/UPDATE writable roles; DELETE admin-only |
| Deals + Children | deals, deal_company_groups, application_deals | Same as standard, but deals UPDATE adds archive guard |
| Pricing Lines | deal_supplier_lines, deal_buyer_lines | Standard; no special logic |
| Deal Activity | deal_activity | Standard but no UPDATE (append-only) |
| Audit Log | audit_log | SELECT only; no write policies; only trigger can insert |

---

## 6. Service-Role Usage (Admin Client Bypass)

### Admin Client Setup

**File**: `src/lib/supabase/admin.ts`

```typescript
export function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY...");
  }
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

**Key Property**: Uses `SUPABASE_SERVICE_ROLE_KEY` (secret key) which has role `service_role` in Supabase Auth. This role bypasses ALL RLS policies.

**Security Model**: Admin client only instantiated within server actions / server-only files (never imported into `"use client"` components).

### Service-Role Usage Locations

| File:Line | Operation | What It Bypasses |
|-----------|-----------|-----------------|
| settings/users/page.tsx:40-48 | `admin.from("profiles").select(...)` + `admin.auth.admin.listUsers()` | RLS on profiles; auth.users read |
| settings/users/actions.ts:46-51 | `admin.auth.admin.createUser()` with user_metadata | Auth-only operation |
| settings/users/actions.ts:58-60 | `admin.from("profiles").upsert(...)` | RLS on profiles |
| settings/users/actions.ts:81-88 | `admin.from("profiles").update(...)` | RLS on profiles |
| settings/users/actions.ts:106-107 | `admin.auth.admin.updateUserById()` | Auth-only password reset |
| settings/users/actions.ts:119 | `admin.auth.admin.deleteUser()` | Auth-only user deletion; cascades to profile |

**Pattern**: Admin client used ONLY inside `requireAdmin()` guarded server actions. No admin client operations in middleware or client code.

**Audit gap**: Operations performed with the service-role key bypass RLS and **leave `auth.uid()` as NULL in the audit_log**. Compliance posture for "who did what" relies on key custody, not technical traceability.

---

## 7. Permission Matrix

| Role | Deals (R/W/D) | Quotations (R/W/D) | Shipment Registry (R/W/D) | Payments (R/W/D) | Reference Data (R/W/D) | Archive (R/W/D) | Settings (R/W/D) |
|------|---------------|-------------------|------------------------|-----------------|----------------------|-----------------|------------------|
| admin | R/W/D | R/W/D | R/W/D | R/W/D | R/W/D | R/W/D | R/W/D |
| manager | R/W/— | R/W/— | R/W/— | R/W/— | R/W/— | —/—/— | —/—/— |
| logistics | R/W/— | R/W/— | R/W/— | R/W/— | R/W/— | —/—/— | —/—/— |
| finance | R/W/— | R/W/— | R/W/— | R/W/— | R/W/— | —/—/— | —/—/— |
| trader | R/—/— | R/—/— | R/—/— | R/—/— | R/—/— | —/—/— | —/—/— |
| accounting | R/—/— | R/—/— | R/—/— | R/—/— | R/—/— | —/—/— | —/—/— |
| readonly | R/—/— | R/—/— | R/—/— | R/—/— | R/—/— | —/—/— | —/—/— |

**Legend**:
- R = SELECT allowed
- W = INSERT + UPDATE allowed
- D = DELETE allowed
- — = Operation denied by RLS
- Writable roles (manager, logistics, finance) cannot UPDATE archived deals (RLS archive guard)
- Admin only: can UPDATE archived deals, DELETE any row, access Archive + Settings pages
- All authenticated users: can SELECT all tables

---

## 8. Inconsistencies & Flags

### Flag 1: Trader Role Limbo

**Issue**: The `trader` enum value remains in the database and can be assigned to users (via users-manager.tsx dropdown), but is functionally read-only as of migration 00083.

**Status**: Not a bug; intentional. Migration 00083 comment explains client decision (29.05.2026).

### Flag 2: is_active Field Not Enforced

**Issue**: Profiles have `is_active` column (default true), but no RLS policy checks it.

**Current behavior**: Inactive user can still log in and operate. Setting `is_active = false` is admin UX only; no backend enforcement.

### Flag 3: Archived Deals Can't Be Updated by Managers

**Issue**: Deal archived → manager/logistics gets RLS error on UPDATE. No UI feedback; error bubbles as Supabase error.

### Flag 4: Audit Log Trigger Runs as SECURITY DEFINER

**Issue**: `audit_trigger()` function in migration 00036 runs with elevated privileges (SECURITY DEFINER), bypassing RLS.

**Consequence**: Trigger can INSERT to audit_log even if user wouldn't normally have INSERT permission. By design—audit should always record changes.

---

## Summary

This CRM implements a **two-layer access control model**:

1. **RLS (Row-Level Security)** in Supabase: The authoritative gate. Every table has policies; all writes gated by `is_writable_role()` and `is_admin()` functions. Trader role is read-only as of 00083.

2. **Application-layer UI gating**: Client-side role checks (isAdmin, isWritable) disable buttons, forms, and links. Not a security boundary—RLS is. But improves UX by hiding unavailable operations.

3. **Middleware fast-path**: Session cookie's `expires_at` decoded locally; if valid with 60-second buffer, skip Supabase auth round-trip. Otherwise, call `auth.getUser()` and refresh.

4. **Admin bypass**: Service-role key used only in server actions guarded by `requireAdmin()`. Never exposed to client.

5. **Archive protection**: Only admin can update archived deals; regular writable roles get RLS error.

6. **Password reset + user CRUD**: Admin-only operations via server actions + admin client.

The system is **secure by default** (deny-first RLS) with **clear role hierarchy**: admin > {manager, logistics, finance} > {trader, accounting, readonly}.

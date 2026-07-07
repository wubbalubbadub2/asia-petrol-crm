# Asia Petrol CRM — Reverse-Engineered Specification

This document inventories what the existing Asia Petrol / Singularity Trading CRM does and the data it manages. It is written for a reader who has never seen this codebase and intends to design a successor system from scratch and migrate the data.

All non-obvious claims cite either a migration file (`00xxx_*.sql`) or a source file path. "(inferred)" marks low-confidence interpretation; "(contradiction)" marks places where two code paths disagree.

---

## 1. System Overview

**Purpose.** Asia Petrol CRM (branded internally as "Singularity Trading") is the operational backbone for a petroleum-trading desk. It replaces a multi-tab, ~86-column Excel workflow that the trading desk had previously used to manage deal passports, daily quotation reference prices, shipment registries, logistics settlements, applications (заявки) from buyers, tariffs, surcharges/overages, and audit-grade payment tracking. It is a single-tenant internal CRM, not customer-facing.

**Users.** All users are Russian-speaking Kazakhstan-based staff of one trading company: traders/managers, logistics, accounting/finance, and administrators. Power-users spend full workdays in the tool. There is no public sign-up; user accounts are provisioned only by admins (`src/app/(dashboard)/settings/users/actions.ts:24-69`).

**Core jobs.**

1. *Deal passport management*: a "deal" represents one trading transaction with a supplier side, an optional chain of up to six intermediary company groups, a buyer side, and logistics. Each side carries volumes, contracted amounts, prices, currencies, payment running-sums, manager assignments, and 90+ scalar fields. See `supabase/migrations/00003_deals.sql`.
2. *Shipment registry*: incoming actual shipments (waybills, wagons, tonnages) are recorded against deals to track fulfillment, with auto-pricing rows generated per shipment (`autoprice_registry_insert`, `supabase/migrations/00037_registry_autoprice.sql`).
3. *Quotations*: daily reference prices (CIF NWE, FOB MED, FOB Rotterdam, etc.) per product type, mirroring 16 Excel sheets in `files/Котировки/*.xlsx`. Deals can derive prices from these via a "price source" pointer.
4. *Logistics settlement (ДТ-КТ)*: forwarder-by-company-group ledger with opening balance, payments, fines, overages, OGEM fee, net saldo.
5. *Applications (заявки)*: buyer purchase orders imported from PDF/email; M:N-allocated to deals.
6. *Reference data (справочник)*: counterparties, fuel types, stations, forwarders, factories, company groups, consignees, staff.
7. *Tariffs*: railway rates per route/forwarder/product/month.
8. *Surcharges*: penalty/overage claims with bidirectional re-invoicing.
9. *Excel import/export*: both ingest of shipments / SNT / ESF documents and styled .xlsx exports of deal passports and quotation sheets.

**Operating mode.** The app is deployed to Vercel against a single Supabase Postgres project (`tender-scout`, host `oteysqqohcgnwpsxmyjg.supabase.co`). Reference data is loaded into the browser as a long-lived global cache; tables use aggressive virtualization and per-column funnel filters. Activity feeds and chat are realtime via Supabase Realtime channels.

---

## 2. Actors & Permissions

### 2.1 Roles

A Postgres enum `user_role` (`00001_reference_tables.sql:6`) holds the canonical list. Roles are added incrementally:

| Role | Introduced | Notes |
|---|---|---|
| `admin` | 00001 | Full read/write/delete; only role that can manage users, archive deals, edit archived deals |
| `manager` | 00001 | Read/write on operational tables; cannot delete parent records |
| `logistics` | 00001 | Same write surface as manager |
| `accounting` | 00001 | Read-only |
| `readonly` | 00001 | Read-only |
| `finance` | 00082_user_roles_finance_trader.sql | Writable per `is_writable_role()` |
| `trader` | 00082 | Added writable; then **downgraded** to read-only by `00083_trader_readonly.sql` |

**Role source.** A user's role lives in `profiles.role`, which is auto-inserted by the `handle_new_user()` trigger when a new `auth.users` row is created (`00001_reference_tables.sql:98-114`), reading `raw_user_meta_data->>'role'` set by the admin-create-user flow.

### 2.2 Two enforcement layers

**Database (RLS, `00010_rls_policies.sql`):**
- Base pattern on every reference / operational / deal-child table: SELECT for any authenticated user; INSERT/UPDATE if `is_writable_role()`; DELETE if `is_admin()`.
- `is_writable_role()` after 00082/00083 returns true for `admin | manager | finance | trader` (note: 00083's trader downgrade is **partial** — the function still includes trader, the application-side flag does not — see contradictions).
- `is_admin()` returns true only for `role = 'admin'`.
- The `deals` table has an extra UPDATE clause: `is_writable_role() AND (NOT is_archived OR is_admin())` — non-admins cannot mutate archived deals (`00010_rls_policies.sql:76-81`).
- `audit_log` has **no INSERT/UPDATE/DELETE policy**; only the SECURITY DEFINER `audit_trigger` writes. SELECT is open to authenticated users.
- `00066` grants writable roles DELETE on deal *child* tables (lines, payments, attachments, prices) — i.e. managers can delete a payment line but not the parent deal.

**Application (UI flags, `src/lib/role-context.tsx`):**
- `isWritable` is derived from a hardcoded set — observed as `admin | manager | logistics | finance`. The code does NOT include `trader` or `accounting`. *(contradiction with RLS, which includes trader.)*
- `isAdmin` is `role === 'admin'`.
- Nav items `Archive` and `Settings` are admin-only (`src/lib/constants/nav-items.ts:80,86`; filtered by `src/components/layout/sidebar.tsx:88-90`).
- Pages like quotations and deal forms wrap edit controls in `isWritable` checks.

### 2.3 Per-module permission matrix (as enforced)

| Module | Read | Edit | Delete |
|---|---|---|---|
| Reference data (counterparties, fuel_types, stations, etc.) | all auth | writable | admin |
| Deals (parent) | all auth | writable, but archived deals admin-only | admin |
| Deal children (lines, payments, attachments, shipment prices) | all auth | writable | writable (per 00066) |
| Applications, application_deals | all auth | writable | admin |
| Shipment registry | all auth | writable | admin |
| Tariffs | all auth | writable | admin |
| Surcharges | all auth | writable | admin |
| DT-KT logistics + payments | all auth | writable | admin |
| SNT/ESF documents | all auth | writable | admin |
| Quotations + product types + monthly averages | all auth | writable | admin |
| Activity feed (`deal_activity`) | all auth | writable INSERT | admin |
| Audit log | all auth (SELECT) | (none) | (none) |
| User profiles | all auth | only via admin-only server actions | admin |

### 2.4 Audit/activity

Two distinct mechanisms:

- **`deal_activity`** (`00016_deal_activity_feed.sql`): user-facing chat/timeline feed. Types: `comment | system | status_change | payment | shipment | attachment`. Auto-populated by triggers:
  - `log_deal_payment_change` (00016, refined 00087): logs supplier_payment/buyer_payment deltas with currency metadata.
  - `log_deal_field_changes` (00088): logs ~20 deal field changes (volumes, prices, quotations, discounts, dates, FKs including counterparty/factory/fuel/forwarder/managers/trader, archive flag) with human-readable FK labels. **Skips drafts** — does nothing while `is_draft = true`, to avoid a flood of "NULL → X" rows on the new-deal form (`00088:27`).
- **`audit_log`** (`00036_audit_log.sql`): immutable JSONB before/after snapshots plus a `changed_fields` array (excluding `updated_at` bumps). Audits `deals, deal_payments, deal_shipment_prices, shipment_registry, dt_kt_logistics, dt_kt_payments`. Reference data is intentionally NOT audited (00036:70). Writes via SECURITY DEFINER so writes happen even on RLS failure path.

### 2.5 Sessions, login, password reset

- Login is `email + password` only via `supabase.auth.signInWithPassword()` (`src/app/(auth)/login/page.tsx:26`). On error displays "Неверный email или пароль". No self-serve password reset UI — only admins can reset via `admin.auth.admin.updateUserById()` (`src/app/(dashboard)/settings/users/actions.ts:106`).
- Session is a Supabase JWT cookie. Middleware (`src/lib/supabase/middleware.ts:11-79`) uses an "optimistic fast-path": if the cookie's `exp` is more than 60s away it skips calling `auth.getUser()`. Otherwise calls Supabase to verify.
- Routes `/login` and `/auth/**` are exempt. Authenticated users hitting `/login` are redirected to `/`.
- New-user creation requires admin (`requireAdmin()` guard before `admin.auth.admin.createUser({email_confirm: true, ...})` at line 49). Password min length 6 enforced application-side only.
- There is **no hardcoded admin bypass email**; all admin access goes through `profiles.role`.

---

## 3. Core Entities & Data Dictionary

The DB is in one schema (`public`) plus Supabase's managed schemas (`auth`, `storage`). Approximately 45 tables. Every operational table has `created_at`, `updated_at` (default `now()`, maintained by `update_updated_at()` trigger) unless noted. Standard enum-style `is_active BOOLEAN DEFAULT true` for soft-delete is on every reference table. All tables have RLS enabled.

### 3.1 Reference data (Справочник)

**`counterparties`** — suppliers and buyers in one table.
- `id` UUID PK
- `type` TEXT NOT NULL CHECK IN (`'supplier'`, `'buyer'`)
- `full_name` TEXT NOT NULL
- `short_name` TEXT
- `bin_iin` TEXT (Kazakhstan tax ID)
- `legal_address` TEXT
- `is_active` BOOLEAN DEFAULT true

**`company_groups`** — intermediary trading entities (up to 6 in a deal chain).
- `id` UUID PK
- `name` TEXT NOT NULL UNIQUE
- `full_name`, `short_name`, `legal_address` TEXT (added 00032)
- `bin_iin` TEXT
- `is_active` BOOLEAN DEFAULT true

**`factories`** — production/supply points (заводы).
- `id` UUID PK
- `name` TEXT NOT NULL UNIQUE, `code` TEXT, `is_active`

**`forwarders`** — railway/logistics operators.
- `id` UUID PK
- `name` TEXT NOT NULL UNIQUE, `bin_iin` TEXT, `is_active`

**`consignees`** — railway consignees (often distinct from buyers) — added `00090`.
- `id`, `name` NOT NULL UNIQUE, `bin_iin`, `is_active`

**`stations`** — railway stations.
- `id` UUID PK
- `name` TEXT NOT NULL
- `code` TEXT
- `type` TEXT NOT NULL CHECK IN (`'departure'`, `'destination'`, `'both'`)
- `is_active`

**`fuel_types`** — product categories.
- `id`, `name` NOT NULL, `sulfur_percent` TEXT, `color` TEXT DEFAULT `'#6B7280'`, `sort_order` INT DEFAULT 0, `is_active`

**`regions`** — geographic regions used to scope managers.
- `id`, `name` NOT NULL UNIQUE

**`profiles`** — extends `auth.users` with the CRM role.
- `id` UUID PK REFERENCES `auth.users(id)` ON DELETE CASCADE
- `full_name` TEXT NOT NULL
- `role` `user_role` NOT NULL DEFAULT `'readonly'`
- `region_id` UUID REFERENCES `regions(id)`
- `is_active`
- Trigger `on_auth_user_created` auto-creates a profile from `raw_user_meta_data`.

### 3.2 Quotations

**`quotation_product_types`** — daily-price product variants (one per Excel quotation sheet).
- `id`, `fuel_type_id` FK, `name`, `sub_name`, `basis`, `is_active`, `sort_order`.

**`quotations`** — one row per (product_type, date).
- `id`, `product_type_id` FK NOT NULL, `date` DATE NOT NULL
- `price` DECIMAL(12,4) — the "Среднее" formula result
- `price_cif_nwe` DECIMAL(12,4)
- `price_fob_med` DECIMAL(12,4)
- `price_fob_rotterdam` DECIMAL(12,4)
- `price_cif_nwe_standalone` DECIMAL(12,4) — added `00029`, **no longer rendered or written in the daily entry UI**, kept for historical `price_source` references
- `comment` TEXT, `created_by` FK
- UNIQUE(`product_type_id`, `date`); indexes on `date` and `product_type_id`.

**`quotation_monthly_averages`** — caches per-product month-aggregate values.
- `id`, `product_type_id` FK, `year` INT, `month` INT
- `avg_price`, `avg_fob_med`, `avg_fob_rotterdam`, `avg_cif_nwe`, `avg_combined` DECIMAL(12,4)
- UNIQUE(`product_type_id`, `year`, `month`)
- **No auto-refresh trigger** — table is stale until manually refreshed; live consumers recompute from `quotations` instead (flagged at `src/components/quotations/quotation-summary.tsx:45-47`). `avg_combined` is defined but **never populated anywhere**.

### 3.3 Deals (Паспорт сделок)

**`deal_sequences`** — per-(type, year) counter.
- `id`, `deal_type`, `year`, `last_number` INT, UNIQUE(`deal_type`, `year`).

**`deals`** — central entity, ~90 columns. Grouped by area:

*Identity / period:* `deal_type` (`'KG' | 'KZ' | 'OIL'`), `deal_number` INT, `year` INT, `deal_code` TEXT (auto: e.g. `KZ/26/123`, format updated in `00039`), `quarter`, `month` (Russian month name). UNIQUE(`deal_type, deal_number, year`).

*Refs:* `factory_id`, `fuel_type_id`, `sulfur_percent`, `supplier_id`, `buyer_id`, `forwarder_id`, `logistics_company_group_id`, `supplier_departure_station_id`, `buyer_destination_station_id`, `supplier_manager_id`, `buyer_manager_id`, `trader_id`, `created_by` — all FK to the relevant table.

*Supplier scalars (legacy, mirrored from default supplier_line):* `supplier_contract`, `supplier_contracted_volume`, `supplier_contracted_amount` (computed), `supplier_delivery_basis`, `supplier_quotation`, `supplier_quotation_comment`, `supplier_discount`, `supplier_price`, `supplier_price_condition` (`price_condition` enum), `supplier_shipped_amount` (computed), `supplier_shipped_volume` (computed, added 00044), `supplier_payment` (computed), `supplier_payment_date` TEXT, `supplier_balance` (computed), `supplier_currency` TEXT NOT NULL DEFAULT 'USD' (added 00043).

*Buyer scalars:* the same shape mirrored, plus `buyer_ordered_volume`, `buyer_remaining` (computed), `buyer_ship_date` TEXT, `buyer_debt` (computed; sign flipped in 00060), `buyer_multi_deal_payments` TEXT, `buyer_snt_written` TEXT, `buyer_currency` TEXT NOT NULL DEFAULT 'USD'.

*Logistics:* `planned_tariff`, `preliminary_tonnage`, `preliminary_amount` (computed), `actual_tariff`, `actual_shipped_volume`, `invoice_volume`, `invoice_amount`, `logistics_notes`, `logistics_currency` TEXT NOT NULL DEFAULT 'USD', `railway_in_price` BOOLEAN DEFAULT false (`00018`), `trigger_basis` (`'shipment_date' | 'border_crossing_date'`, default `'shipment_date'`, added 00023), `logistics_shipment_month` TEXT (00069, overrides month for tariff lookup).

*Surcharges:* `surcharge_amount`, `surcharge_reinvoiced_to` TEXT.

*Lifecycle:* `is_archived` BOOLEAN DEFAULT false, `archived_at` TIMESTAMPTZ, `is_draft` BOOLEAN NOT NULL DEFAULT false (00020; backfilled & NOT-NULL'd in 00091).

*Denormalized counts:* `supplier_lines_count`, `buyer_lines_count` INT (00092), maintained by triggers.

*Legacy mirror:* `currency` TEXT DEFAULT 'USD' (00014) — kept in sync with `supplier_currency` for backward compatibility with old read paths.

Indexes: `idx_deals_type`, `idx_deals_year`, `idx_deals_month`, `idx_deals_supplier`, `idx_deals_buyer`, `idx_deals_archived`, plus partial compound `(deal_type, year, deal_number) WHERE is_archived=false AND is_draft=false` (00091).

**`deal_company_groups`** — chain positions 1–6 per deal.
- `id`, `deal_id` FK ON DELETE CASCADE, `company_group_id` FK
- `position` INT NOT NULL CHECK BETWEEN 1 AND 6
- `price` DECIMAL(14,4), `contract_ref` TEXT
- `currency` TEXT (00070, NULL inherits from `supplier_currency`)
- `price_kind` (`'preliminary' | 'final'`, default `'preliminary'`, added 00084)
- `quotation`, `quotation_comment`, `discount` (00089)
- UNIQUE(`deal_id`, `position`).

**`deal_supplier_lines`** / **`deal_buyer_lines`** — multi-variant pricing per side, mirrored shape.
- `id`, `deal_id` FK ON DELETE CASCADE, `position` INT DEFAULT 1, `is_default` BOOL DEFAULT false (partial UNIQUE: one default per deal per side)
- `price_condition`, `quotation_type_id` FK, `quotation`, `quotation_comment`, `discount`, `price`
- `price_source` TEXT CHECK IN (`'price'`, `'price_cif_nwe'`, `'price_fob_med'`, `'price_fob_rotterdam'`, `'price_cif_nwe_standalone'`) — nullable (00077, "NULL = legacy fallback")
- `fx_rate`, `preliminary_fx_rate` NUMERIC(14,6) (00071, for `manual_formula` mode)
- `price_stage` TEXT NOT NULL DEFAULT `'preliminary'` CHECK IN (`'preliminary'`, `'final'`) (00068)
- `preliminary_quotation`, `preliminary_price`, `preliminary_set_at` (snapshot fields when moving to `final`)
- `selected_month` TEXT (00068, overrides which month to average in `average_month` mode)
- `delivery_basis`, `departure_station_id` (supplier) / `destination_station_id` (buyer)
- `appendix` TEXT (00072 — "Приложение №1" etc.)
- `trigger_basis`, `trigger_days` INT (00064, per-line override of deal-level trigger config)
- `calc_mode` (added 00079; NULL = legacy)

### 3.4 Shipment & pricing

**`shipment_registry`** — physical shipment events.
- `id`, `registry_type` (= deal_type) NOT NULL, `row_number` INT
- `quarter`, `month`, `shipment_month` (00069 override)
- `date` DATE, `waybill_number`, `wagon_number`
- `shipment_volume` DECIMAL(14,6) (отгрузка)
- `loading_volume` DECIMAL(14,6) (налив)
- `rounded_tonnage_from_forwarder` DECIMAL(14,4) (00050)
- `shipped_tonnage_amount` DECIMAL(14,4) = CEIL(`shipment_volume`) × `railway_tariff` unless overridden
- `shipped_tonnage_amount_override` BOOLEAN DEFAULT false (00050)
- `rounded_volume_override`, `round_volume` (toggle for CEIL rounding, 00061/00086)
- FKs: `destination_station_id`, `departure_station_id`, `deal_id`, `supplier_id`, `buyer_id`, `factory_id`, `forwarder_id`, `fuel_type_id`, `company_group_id`, `supplier_line_id` (00054), `buyer_line_id` (00054)
- `railway_tariff`, `currency` (00033, NULL inherits from deal), `price_source` (00077)
- `supplier_appendix`, `buyer_appendix` (00072)
- `invoice_number`, `comment`
- Indexes on `deal_id`, `date`, `registry_type`, `forwarder_id`, `supplier_line_id`, `buyer_line_id`.

**`deal_shipment_prices`** — per-shipment per-side priced row (auto-spawned by trigger).
- `id`, `deal_id` FK ON DELETE CASCADE, `side` CHECK IN (`'supplier'`, `'buyer'`)
- `shipment_registry_id` (inferred FK; created by autoprice trigger)
- `shipment_date`, `border_crossing_date`, `trigger_start_date` DATE
- `trigger_days` INT NOT NULL DEFAULT 35, `trigger_basis` NOT NULL DEFAULT `'shipment_date'`
- `quotation_product_type_id` FK
- `quotation_avg`, `discount` DEFAULT 0, `calculated_price` DECIMAL(14,4)
- `volume` DECIMAL(14,6), `amount` DECIMAL(14,4), `notes` TEXT, `created_by`.

### 3.5 Payments

**`deal_payments`** — per-payment entries.
- `id`, `deal_id` FK ON DELETE CASCADE
- `side` CHECK IN (`'supplier'`, `'buyer'`)
- `amount` DECIMAL(14,4) NOT NULL, `payment_date` DATE NOT NULL, `description` TEXT
- `currency` TEXT (00033, NULL = inherit side currency from deal)
- `payment_type` TEXT NOT NULL DEFAULT `'payment'` CHECK IN (`'payment'`, `'refund'`, `'offset'`) (00051/00062)
- `created_by`.

**`dt_kt_logistics`** — forwarder × company_group × year ledger.
- `id`, `forwarder_id` FK, `company_group_id` FK, `year` INT
- `opening_balance`, `payment`, `refund`, `fines`, `surcharge_preliminary`, `ogem` DECIMAL(14,4) DEFAULT 0
- UNIQUE(`forwarder_id`, `company_group_id`, `year`).

**`dt_kt_payments`** — individual payments on the DT-KT ledger.
- `id`, `dt_kt_id` FK ON DELETE CASCADE, `forwarder_id`, `company_group_id` (denormalized)
- `payment_date` DATE, `amount` DECIMAL(14,4), `description`, `currency` (00034), `created_by`.

### 3.6 Tariffs & surcharges

**`tariffs`** — railway rates.
- `id`, `destination_station_id`, `departure_station_id`, `forwarder_id`, `fuel_type_id`, `factory_id` (all FK)
- `month` TEXT NOT NULL, `year` INT NOT NULL
- `planned_tariff` DECIMAL(10,4), `norm_days` INT
- UNIQUE(`destination_station_id`, `departure_station_id`, `forwarder_id`, `fuel_type_id`, `month`, `year`)

**`surcharges`** — overage/penalty claims.
- `id`, `deal_id` FK (deprecated in UI; the form uses `deal_passport_number` text instead)
- `reason` TEXT NOT NULL, `amount`, `period`, `surcharge_code`
- Route fingerprint: `departure_station_id`, `destination_station_id`, `supplier_contract`, `buyer_contract`, `fuel_type_id`, `shipped_volume`
- Claim block: `claim_number`, `deal_passport_number`, `issued_by_name`, `issued_to_name`, `issue_date`, `claimed_amount`, `accepted_amount`, `approval_status` TEXT (free-text "Рассмотрено"/"на рассмотрении"), `paid_amount`, `payment_date`, `remaining_debt`, `comment`
- Re-invoicing block: `reinvoice_code`, `reinvoiced_to`, `reinvoice_letter`, `reinvoiced_from`, `reinvoice_date`, `reinvoice_amount`, `reinvoice_accepted_amount`, `reinvoice_response_date`, `reinvoice_acceptance_status`, `reinvoice_paid_amount`, `reinvoice_payment_date`, `reinvoice_remaining_debt`, `reinvoice_comment`.
- Almost the entire re-invoicing block and several claim fields are **vestigial in the UI** — the AddSurchargeDialog only writes ~7 columns.

### 3.7 Applications

**`applications`** — buyer purchase orders.
- `id`, `application_number`, `date` DATE NOT NULL
- Product: `fuel_type_id`, `product_name`, `tonnage`
- Delivery: `destination_station_id`, `station_code`, `siding`
- Consignee: `consignee_name`, `consignee_bin`, `consignee_code_4`, `consignee_code_12`, `consignee_legal_address`, `consignee_postal_address`
- Parties: `consignor`, `carrier`, `wagon_operator`, `tariff_payer`
- SNT metadata: `buyer_name_for_snt`, `buyer_bin_for_snt`, `delivery_address_for_snt`, `tax_authority_code`, `virtual_warehouse_id`, `virtual_warehouse_name`
- Status: `is_ordered` BOOLEAN DEFAULT false
- Assignment: `assigned_manager_id`, `assigned_by`
- Source: `pdf_file_path`, `source_email`.

**`application_deals`** — M:N.
- `id`, `application_id` FK ON DELETE CASCADE, `deal_id` FK ON DELETE CASCADE
- `allocated_volume` DECIMAL(14,4)
- UNIQUE(`application_id`, `deal_id`).

### 3.8 Documents & attachments

**`snt_documents`** — товарно-транспортные накладные from 1C.
- `id`, `deal_id` FK, `snt_number`, `registration_number`, `shipment_date`, `registration_datetime`
- Supplier+receiver BIN/name, `goods_description`, `quantity`, `unit`, `price_per_unit`, `total_amount`
- `source_file_path`, `imported_at`, `imported_by`, `raw_data` JSONB.

**`esf_documents`** — электронные счета-фактуры from 1C.
- Same shape as SNT plus `account_system_number`, `issue_date`, `turnover_date`, `total_without_tax`, `tax_amount`, `total_with_tax`.

**`deal_attachments`** — user-uploaded files.
- `id`, `deal_id` FK ON DELETE CASCADE
- `category` CHECK IN (`'application'`, `'contract'`, `'appendix'`, `'snt'`, `'esf'`, `'waybill'`, `'act_completed_works'`, `'invoice'`, `'quality_cert'`, `'reconciliation_act'`, `'other'`)
- `section` (00042: `'supplier' | 'buyer' | 'logistics' | 'other'`; nullable for legacy)
- `file_name`, `file_path`, `file_size` INT, `mime_type`, `uploaded_by`, `uploaded_at`.

### 3.9 Activity & audit

**`deal_activity`** — chat + system feed; type CHECK IN (`'comment'`, `'system'`, `'status_change'`, `'payment'`, `'shipment'`, `'attachment'`).

**`audit_log`** — immutable mutation log; `table_name`, `row_id`, `op` IN (`'INSERT'`, `'UPDATE'`, `'DELETE'`), `user_id`, `changed_at`, `old_row`, `new_row` JSONB, `changed_fields` TEXT[].

**`archive_years`** — admin-locked years.
- `id`, `year` INT UNIQUE, `archived_at`, `archived_by`, `is_locked` BOOLEAN DEFAULT true.

### 3.10 Canonical enum values

- `deal_type`: `'KG' | 'KZ' | 'OIL'`
- `user_role`: `'admin' | 'manager' | 'logistics' | 'accounting' | 'readonly' | 'finance' | 'trader'`
- `price_condition`: `'fixed' | 'average_month' | 'trigger' | 'manual' | 'manual_formula' | 'manual_in_formula' | 'avg_to_date'` (the last is legacy, retained but no longer wired)
- `trigger_basis`: `'shipment_date' | 'border_crossing_date'`
- `counterparties.type`: `'supplier' | 'buyer'`
- `stations.type`: `'departure' | 'destination' | 'both'`
- `deal_payments.payment_type`: `'payment' | 'refund' | 'offset'`
- `deal_attachments.category`: see 3.8
- `deal_activity.type`: see 3.9
- `audit_log.op`: see 3.9
- `price_source` (on lines and shipment_registry): `'price' | 'price_cif_nwe' | 'price_fob_med' | 'price_fob_rotterdam' | 'price_cif_nwe_standalone'` (last is historical-only)
- `price_stage`: `'preliminary' | 'final'`
- `price_kind` on `deal_company_groups`: `'preliminary' | 'final'`.

---

## 4. Business Rules & Logic

### 4.1 Deal identity

- **R-DEAL-1.** `deal_code` is auto-formatted on insert/update by `compute_deal_code()` trigger as `<deal_type>/<YY>/<NNN>` (00003, format updated in 00039). E.g. `KZ/26/123`.
- **R-DEAL-2.** Deal numbers are issued by `generate_deal_number(p_type, p_year)` via the `deal_sequences.last_number` counter, separately for each `(deal_type, year)`. Numbers do not roll over years.
- **R-DEAL-3.** New deals are created with `is_draft=true` (`src/app/(dashboard)/deals/new/page.tsx:38`). Drafts are **not visible in the deal list** because `LIST_SELECT` filters `is_draft=false` (`src/lib/hooks/use-deals.ts:425`).
- **R-DEAL-4.** Activity logging on `deals` field changes is suppressed while `is_draft=true` (`00088:27`).
- **R-DEAL-5.** Per-`deal_type` default currencies: KG → USD, KZ → KZT, OIL → USD (`src/lib/constants/deal-types.ts:10-14`), applied at deal creation.

### 4.2 Derived deal fields

The `compute_deal_derived_fields()` BEFORE INSERT/UPDATE trigger (`00021`) maintains:

- **R-DERIVED-1.** `supplier_contracted_amount = supplier_contracted_volume × supplier_price`
- **R-DERIVED-2.** `buyer_contracted_amount = buyer_contracted_volume × buyer_price`
- **R-DERIVED-3.** `supplier_balance = supplier_shipped_amount − supplier_payment`
- **R-DERIVED-4.** `buyer_debt`: originally `shipped_amount − payment`; **flipped to `payment − shipped_amount`** by `00060_flip_buyer_debt.sql` (existing rows backfilled).
- **R-DERIVED-5.** `buyer_remaining = buyer_contracted_volume − buyer_ordered_volume`.
- **R-DERIVED-6.** `preliminary_amount = planned_tariff × preliminary_tonnage`.

### 4.3 Currency rules

- **R-CUR-1.** Each deal carries `supplier_currency`, `buyer_currency`, `logistics_currency` (`00043`, NOT NULL DEFAULT `'USD'`), plus the legacy mirror `currency`.
- **R-CUR-2.** New-deal form mirrors the selected `currency` into all three per-side fields (`src/app/(dashboard)/deals/new/page.tsx`) so cross-currency deals start consistent.
- **R-CUR-3.** Payment rollups (`refresh_deal_payment_totals`) only sum a `deal_payments` row into `supplier_payment` / `buyer_payment` if its `currency` matches the deal's per-side currency (or is NULL, which inherits). Mismatched-currency payments are silently excluded from the scalar rollup.
- **R-CUR-4.** Currency override hierarchy: per-row (`deal_payments.currency`, `shipment_registry.currency`, `deal_company_groups.currency`) → per-side on deal → legacy `deals.currency`.

### 4.4 Lines vs scalars (Phase 1.5 dual-write model)

- **R-LINE-1.** Each deal MUST have **exactly one default** `deal_supplier_line` and one default `deal_buyer_line`. The constraint is enforced by partial UNIQUE indexes (`WHERE is_default = true`).
- **R-LINE-2.** On deal insert, `seed_default_supplier_line()` and `seed_default_buyer_line()` AFTER INSERT triggers (`00053`) copy the deal's scalar fields into a `position=1, is_default=true` line.
- **R-LINE-3.** When a line marked `is_default=true` is updated, `sync_deal_from_default_*_line` mirrors `price_condition, quotation, discount, price, delivery_basis, station_id` back to the deal's scalar columns (`00053`).
- **R-LINE-4.** When the deal's scalar columns are updated directly, `sync_default_*_line_from_deal` (`00055`) syncs the change back into the default line. A flag `_skip_sync_on_update` prevents ping-pong between the two directions.
- **R-LINE-5.** `supplier_lines_count` / `buyer_lines_count` are denormalized on `deals` (`00092`) and maintained by `sync_*_lines_count` triggers on insert/update/delete of the line tables.

### 4.5 Payments

- **R-PMT-1.** Each `deal_payments` row carries a `side` (`'supplier' | 'buyer'`) and a `payment_type`.
- **R-PMT-2.** Rollup `refresh_deal_payment_totals(p_deal_id)` re-aggregates after every insert/update/delete on `deal_payments`. For each side it sums payments where `currency` matches that side's currency (or is NULL).
- **R-PMT-3.** `payment_type='refund'` and `payment_type='offset'` are subtracted in the rollup. Operator can also enter a negative `amount` directly; that is preserved on purpose (`00051` comment).
- **R-PMT-4.** `payment_type='offset'` (перезачёт) is a cross-settlement that reduces the reported payment. `payment_type='refund'` is an actual cash return. Both rollup the same way (subtract) (`00062`).

### 4.6 Shipment registry & auto-pricing

- **R-SHIP-1.** Each `shipment_registry` row is computed `shipped_tonnage_amount = CEIL(shipment_volume) × railway_tariff` by `compute_registry_amount()` BEFORE trigger (`00031`). If `shipped_tonnage_amount_override = true` (00050), the manual value is preserved. If `rounded_volume_override = true` the CEIL is skipped (00061/00086).
- **R-SHIP-2.** After insert, `autoprice_registry_insert` (`00037`, refined in 00045/46/54/59/67/68/71) auto-creates up to two `deal_shipment_prices` rows (one supplier, one buyer) tied via `shipment_registry_id`. Each side's `price_condition` selects the formula:
  - `'fixed'` / `'manual'`: copy the line's `price`.
  - `'average_month'` + `price_stage='final'`: call `compute_monthly_quotation_avg(product_type, year, month)`.
  - `'manual_formula'`: read `fx_rate` (00071).
  - `'trigger'`: **TODO** — `00068` notes the trigger flow is not yet wired; falls back to `line.price`.
- **R-SHIP-3.** `autoprice_registry_update` mirrors volume/date changes to the linked priced rows but **does not touch price** — users correct prices independently (`00037` + `00046` self-healing INSERT if the matching row is missing).
- **R-SHIP-4.** `pin_registry_line_on_insert` (`00059`) auto-pins both `supplier_line_id` and `buyer_line_id` to the deal's default lines, while distinguishing "loading" (налив) and "shipment" (отгрузка) flows.
- **R-SHIP-5.** `reassign_registry_line_on_station_change` (`00057`) — when departure/destination station on a registry row changes, re-points the line FK to the matching line for that station, then `reprice_registry_on_line_change` re-fires pricing.
- **R-SHIP-6.** `refresh_deal_shipment_totals(p_deal_id)` (00027/00044) aggregates `shipment_registry` rows into `deal.buyer_shipped_volume`, `deal.buyer_shipped_amount`, `deal.supplier_shipped_amount`, `deal.supplier_shipped_volume` after every registry change.
- **R-SHIP-7.** `propagate_deal_price_to_autorows()` (00045) — when the deal-level `supplier_price` / `buyer_price` changes, propagates to `deal_shipment_prices` rows that have `line_id IS NULL` (legacy). Touches only volume × price = amount; preserves user corrections on `calculated_price`.
- **R-SHIP-8.** `propagate_buyer_line_price_to_autorows()` / `propagate_supplier_line_price_to_autorows()` (00056) — same propagation but per-line for multi-variant deals.

### 4.7 Price stage (preliminary → final)

- **R-STAGE-1.** Each `deal_*_line` has `price_stage` defaulting to `'preliminary'`. UI flag controls when it flips to `'final'`.
- **R-STAGE-2.** `snapshot_preliminary_on_finalize` BEFORE trigger (00068) snapshots current `quotation` and `price` into `preliminary_quotation` / `preliminary_price` and stamps `preliminary_set_at` when stage transitions `preliminary → final`.
- **R-STAGE-3.** Frontend can call `recompute_line_shipment_prices(p_line_id, p_side)` RPC to refire pricing for all shipments under that line after the flip (00068).

### 4.8 Quotations & price sourcing

- **R-Q-1.** Each `quotation_product_type` is mapped to one of 7 column presets in `getColumnsForProduct()` (`src/lib/constants/quotation-columns.ts`):
  - Full (3 bases + formula + comment): ГАЗОЙЛЬ 0,1%, МАЗУТ 1,0% Fuel oil, МАЗУТ 3,5%, НАФТА, Jet, default.
  - Cargo-Barge: ВГО 0,5-0,6%, ВГО 2%.
  - Single FOB Rotterdam: Eurobob; МАЗУТ 0,5% Marine Fuel (label override "FOB Rotterdam barge").
  - Single FOB Rotterdam with sulphur tag: МАЗУТ 1,0% FOB Rotterdam (label "FOB Rotterdam 1,0%"), МАЗУТ 3,5% FOB Rotterdam.
  - Single FOB NWE: МАЗУТ 1,0% FOB NWE, МАЗУТ 3,5% FOB NWE.
  - Single FOB MED: Prem Unl 10 ppm.
  - CIF + FOB MED, no formula: ULSD 10 ppm.
  - BRENT (мин/макс/сред): BRENT DTD (Platts).
- **R-Q-2.** The "Среднее" formula column for Full and Cargo-Barge is `avg(price_cif_nwe, price_fob_rotterdam)`; for BRENT it is `avg(price_fob_med, price_fob_rotterdam)`; minimum 2 non-null sources required.
- **R-Q-3.** Daily entry UI shows only days that already have data + user-added days; falls back to all weekdays if the month is empty.
- **R-Q-4.** Numbers display 3 decimals with Russian comma separator (`896,500`), `useGrouping: false`.
- **R-Q-5.** `price_source` on a line/registry row picks which wide column to read from `quotations`. `compute_quotation_value` RPC (`00077` / `00079`) does dynamic-SQL lookup with two `calc_mode`s: `on_date` and `avg_month`.
- **R-Q-6.** `compute_monthly_quotation_avg(product_type, year, month)` (`00067`) coalesces first-non-null across (`price`, `price_cif_nwe`, `price_fob_rotterdam`, `price_fob_med`) and averages over a calendar month.
- **R-Q-7.** `resolve_shipment_year_month(shipment_date, shipment_month, deal_id)` (`00067`) resolves which (year, month) to look up: explicit `shipment_month` wins, else derived from `shipment_date`, else from deal `year`/`month`.
- **R-Q-8.** "Свод КОТ" summary view (Свод КОТ tab): products × months matrix with three sub-columns per month (Ср / Фикс / Тр) plus a Year column. `Фикс` reads the quotation on a configurable fixed day (default 15). `Тр` averages over a configurable window (default 35 days) from month start (window can spill across month boundary). `Ср` is monthly average via coalesce-first-non-null.
- **R-Q-9.** The `quotation_monthly_averages` cache table is never used by live consumers — recomputation is always done on demand.
- **R-Q-10.** `price_cif_nwe_standalone` column on `quotations` exists in DB and Excel-export SELECT but is **not in the daily-entry column config**; only historical `price_source='price_cif_nwe_standalone'` deals read it.

### 4.9 Tariffs

- **R-TAR-1.** Tariffs are uniquely keyed `(destination_station, departure_station, forwarder, fuel_type, month, year)`.
- **R-TAR-2.** AddTariff validates `planned_tariff`, `month`, `year` are required; FKs optional.
- **R-TAR-3.** `lookup_tariff(forwarder_id, company_group_id, year)` (00011) does year-fallback (current year → previous → …) when an exact-year match is missing.

### 4.10 DT-KT logistics

- **R-DTKT-1.** Saldo formula (per `src/app/(dashboard)/dt-kt/page.tsx:92-94`): `saldo = opening_balance + payment − shipped_amount − fines − surcharge_preliminary − ogem − refund`. Color-coded red if negative.
- **R-DTKT-2.** `shipped_amount` is computed live by grouping `shipment_registry.shipped_tonnage_amount` per `(forwarder_id, company_group_id)` for the given year; not stored on the DT-KT row.

### 4.11 Applications

- **R-APP-1.** AddApplication requires `date` only; everything else optional.
- **R-APP-2.** `is_ordered` flag toggles per row.
- **R-APP-3.** Linking application → deal goes through the `application_deals` M:N with optional `allocated_volume`.
- **R-APP-4.** Search is case-insensitive substring across `application_number, product_name, consignee_name, fuel_type.name`.

### 4.12 Activity logging

- **R-ACT-1.** `log_deal_payment_change` logs `supplier_payment` / `buyer_payment` deltas with currency metadata on UPDATE (`00016` + `00087`).
- **R-ACT-2.** `log_deal_field_changes` logs ~20 deal fields on UPDATE: volumes, prices, quotations, discounts, dates, FKs (supplier/buyer/factory/fuel/forwarder/managers/trader), `is_archived`. Each entry includes a human-readable label for FK columns (`00088`).
- **R-ACT-3.** Both triggers skip writes when `is_draft=true`.
- **R-ACT-4.** `audit_log` excludes `updated_at` bumps from `changed_fields`.

### 4.13 Archive locking

- **R-ARC-1.** Deals can be flipped to `is_archived=true`; RLS prevents non-admins from updating archived deals.
- **R-ARC-2.** `archive_years` table tracks year-level locks (`is_locked` defaulting true). Implementation of the lock check is not visible — appears to be a UI/process flag (inferred).

### 4.14 Excel import volume routing

- **R-IMP-1.** When importing shipment registry data with a single quantity column, the operator toggles whether it routes to `shipment_volume` or `loading_volume`. Explicit "налив" / "отгрузка" columns in the file override the toggle (`src/app/(dashboard)/import/page.tsx:128-133`).

### 4.15 Other

- **R-MISC-1.** `compute_dt_kt_balance(forwarder, group, year)` aggregates `dt_kt_payments` by currency for logistics reconciliation (00011).
- **R-MISC-2.** Margin display in `DealCompanyChain`: `buyer_price − supplier_price − forwarder_tariff` only when all three sides share a currency; otherwise hidden.
- **R-MISC-3.** Group currency on `deal_company_groups`: uses own `currency` if set, else falls back to `supplier_currency`.
- **R-MISC-4.** Drafts created on the new-deal page are not cleaned up on browser close — `beforeunload` only warns; abandoned drafts may accumulate.

---

## 5. Workflows & State Machines

The CRM does not use a discrete deal-status enum. The lifecycle is implicit via two boolean flags plus per-line stage flag.

### 5.1 Deal lifecycle

States, expressed as `(is_draft, is_archived)`:

```
            (create)
                │
                ▼
       ┌─── DRAFT ─────┐         is_draft = true
       │ (invisible in │         created_by = current user
       │  list view)   │
       └──────┬────────┘
              │ Save (Manager+)
              ▼
       ┌─── ACTIVE ────┐         is_draft = false, is_archived = false
       │  full edit    │         activity logging starts here
       └──┬─────────┬──┘
   Archive│         │Unarchive
   (Admin)│         │(Admin)
          ▼         │
       ┌─── ARCHIVED ──┐         is_archived = true, archived_at = now()
       │ admin-only    │
       │ updates       │
       └───────────────┘
```

There is no "Completed" state — fulfillment is implied by `buyer_shipped_volume = buyer_contracted_volume` and `buyer_payment = buyer_contracted_amount`, but nothing closes the deal automatically.

### 5.2 Line price stage

Each `deal_supplier_line` and `deal_buyer_line` has its own state:

```
┌─ preliminary (default) ─┐ ──── flip to 'final' ────▶ ┌─ final ──┐
│ price editable          │                            │ price    │
│                         │ snapshot_preliminary_on_   │ frozen as│
│                         │ finalize trigger snapshots │ prelim_* │
│                         │ current quotation/price    │          │
└─────────────────────────┘                            └──────────┘
       ▲                                                     │
       └──── (manually flip back; preliminary fields stay) ──┘
```

After flipping to `final`, the operator can call `recompute_line_shipment_prices(line_id, side)` to refire all per-shipment pricing under the line.

### 5.3 Company group position price kind

`deal_company_groups.price_kind` flips `'preliminary'` → `'final'` (added 00084). No automated transition; pure UI control.

### 5.4 Payment row type

`deal_payments.payment_type` is `'payment'` (default) and can be set per row to `'refund'` or `'offset'`. There is no transition logic — type is chosen at insert and is editable.

### 5.5 Application

`applications.is_ordered` is a single boolean toggle. There is no multi-step workflow; the UI displays "заявлено" or "не заявлено".

### 5.6 Surcharge claim

Implicit two-phase workflow expressed via field presence (no enum):

```
issued    →  (claim_number, issue_date, claimed_amount filled)
accepted  →  (accepted_amount filled, approval_status = "Рассмотрено")
paid      →  (paid_amount + payment_date filled; remaining_debt updated)
─────────────────────────────────────────────────────────
re-invoice →  (reinvoice_code, reinvoice_date, reinvoice_amount filled)
re-accept  →  (reinvoice_accepted_amount, reinvoice_response_date filled)
re-paid    →  (reinvoice_paid_amount, reinvoice_payment_date filled)
```

In practice the operator's form only writes the first block — the re-invoicing fields appear unwired in the UI.

### 5.7 Year archive

`archive_years.is_locked` is `true` by default once created. No unlock flow is visible.

---

## 6. Integrations & External Dependencies

### 6.1 Supabase

- **Auth.** Email/password only. JWT cookie sessions. Admin-only user provisioning via service-role client (`SUPABASE_SERVICE_ROLE_KEY`); the service-role client bypasses RLS so its operations leave `auth.uid()` as NULL in the audit trail.
- **PostgREST.** All CRUD goes through PostgREST. Reference-data list queries drop FK joins and resolve names client-side from a session-long global refs cache (`useGlobalRefs`) for performance.
- **Realtime.** Postgres-changes subscriptions on:
  - `deal_activity` (per-deal-id channels) — drives the deal chat / timeline panel.
  - `application_activity` (per-application-id channels) — drives the application chat modal.
- **Storage.** Single bucket `deal-attachments`. Paths `{deal_id}/{section}/{timestamp}_{filename}`. RLS policies were added later (`00065`); a cleanup migration removes dangling rows.
- **Keepalive.** Edge route `/api/keepalive` pings PostgREST every ~4 minutes to keep the connection pool warm (this was throttled / removed in response to compute-pool exhaustion).

### 6.2 Excel I/O

- **Export.** `src/lib/exports/passport-excel.ts` produces styled deal-passport sheets via exceljs (colour bands per side, frozen headers, thousands grouping, total row). `src/lib/exports/quotations-excel.ts` exports per-month quotation worksheets with title row + header + zebra data rows + Среднее footer block + autofilter on the header.
- **Import.** `src/app/(dashboard)/import/page.tsx` handles three flows:
  - **Registry** import: maps columns (квартал, месяц, дата, № накладной, № вагонов, объем отгрузки, месяц отгрузки, Ж/Д тариф, № СФ, комментарий, Налив тонн, месяц доп) to `shipment_registry`.
  - **SNT** import: `snt_documents` rows + auto-generated registry rows; raw row stored as `raw_data` JSONB.
  - **ESF** import: same shape; optionally links to a deal before import.
  - Volume toggle routes a single quantity column to either `shipment_volume` or `loading_volume`; explicit columns override the toggle.
- A separate "esf/" and "registry/" page exist marked "under construction".

### 6.3 1C (inferred — no direct integration)

`snt_documents` and `esf_documents` carry "1C"-style fields (`registration_number`, `account_system_number`, BIN/IIN, tax fields). No direct API calls to 1C are visible; data arrives via Excel upload (inferred).

### 6.4 Other external systems

No email/SMS/Slack integration. No payment gateway. No telemetry. No scheduled jobs (no cron or `pg_cron`). No materialized views. No edge functions beyond `/api/keepalive`.

### 6.5 Front-end run-time

Deployed to Vercel (production at `asia-petrol-crm.vercel.app`). Single deployment region (`fra1`). Edge middleware handles auth gating.

---

## 7. Non-Functional Requirements

### 7.1 Scale signals (from the code)

- Operator has imported deals up to `KZ/26/190` (per comment in `00089`), suggesting hundreds of deals per (type, year) — i.e. low thousands of total deals.
- Tariffs dataset is ~270 rows (per page comment); virtualized so the volume is expected to stay in low thousands.
- Registry is sized for 5000+ rows per type, hence eight FK joins were explicitly dropped from list queries and resolved client-side from a global refs cache.
- Quotations are ~22 trading days × 16 product types × 12 months = ~4200 rows/year.
- Activity feed limit on the `get_deal_bundle` RPC: 200 rows per deal (00093).

### 7.2 Concurrency

- Trigger chains include explicit anti-cycle flags (`_skip_sync_on_update` in 00055).
- Optimistic UI updates with realtime reconciliation in `deal_activity`.
- No long-running write transactions visible. No advisory locks.

### 7.3 Audit & retention

- All money-relevant tables (deals, deal_payments, deal_shipment_prices, shipment_registry, dt_kt_logistics, dt_kt_payments) are audited via `audit_log` with full before/after snapshots — **no retention policy** is set; the log grows forever.
- `deal_activity` feed is similarly unbounded.
- Reference data is NOT audited (deliberate, per `00036:70`).

### 7.4 Confidentiality

- All authenticated users can SELECT every row of every operational and reference table — there is no row-level or field-level confidentiality. The only restriction is write access by role.
- Service-role key in env is the only superuser path.

### 7.5 Compliance markers

- Document categories suggest workflow for: contracts, appendices, СНТ, ЭСФ, waybills, acts of completed works, invoices, quality certificates, reconciliation acts.
- Kazakhstan-specific BIN/IIN, virtual warehouse, tax authority code fields on applications imply integration target with KZ tax/SNT requirements.

### 7.6 Performance investments visible in the codebase

- LIST_SELECT projection trimmed to non-join columns; FK names resolved from a global cache.
- Per-tab URL state persistence so filter context survives navigation.
- `get_deal_bundle` RPC consolidates seven parallel deal-detail fetches into a single JSONB payload.
- Module-level SWR caches with TTL and in-flight promise deduplication.
- Virtualization on large tables.
- Compound partial indexes targeting list filters (`00091`).
- Denormalized counts on deals to avoid joining the line tables (`00092`).

---

## 8. Churn / Volatility Signals

### 8.1 Outright rollbacks

- **`00076_rollback_subquotation_tables.sql`** drops `product_subtypes`, `quotation_values`, `compute_subquotation_price`, and `sub_quotation_id` FKs from three line tables, completely reverting `00073`–`00075`. The wide-column approach in `quotations` was chosen instead. The enum value `'avg_to_date'` is retained for compatibility.

### 8.2 Currency churn

- Single `deals.currency` column (00014) → per-side split into `supplier_currency`, `buyer_currency`, `logistics_currency` (00043). Legacy `currency` retained as a mirror. Per-payment, per-shipment, per-company-group currency overrides added (00033/00034/00070). Currency-reset bug in the new-deal form was patched by mirroring the deal-level currency into all per-side fields on creation.

### 8.3 Pricing layer churn

The pricing layer has been redesigned across at least 9 migrations:

| Migration | Change |
|---|---|
| 00037 | Baseline `autoprice_registry_insert` / `_update` |
| 00045 | "Autoprice corrections" — adds `propagate_deal_price_to_autorows` |
| 00046 | "Self-healing" — auto-insert missing pricing row from UPDATE path |
| 00053 | Multi-variant pricing — introduces `deal_supplier_lines` / `deal_buyer_lines` and seed triggers |
| 00054 | `supplier_line_id` / `buyer_line_id` FK on `shipment_registry`; nullable for legacy |
| 00056 | Line-aware price propagation |
| 00057 | Auto-reassign line FK on station change + reprice |
| 00059 | Distinguish loading vs shipment pricing paths |
| 00067 | Monthly-average formula via RPC |
| 00068 | `price_stage` preliminary/final + snapshot |
| 00071 | `manual_formula` with `fx_rate` |
| 00077 | `price_source` enum (which wide column to read) |
| 00079 | `calc_mode` enum (on_date vs avg_month) |

The repeated rework, combined with multiple `price_condition` enum values that are no longer reachable from the UI (`avg_to_date`, `manual_in_formula`), indicates the pricing requirements have been the most volatile area of the system.

### 8.4 Overlapping / shadowed fields

- `deals.currency` vs `supplier_currency` / `buyer_currency` / `logistics_currency`.
- `deals.supplier_price` vs `deal_supplier_lines.price` (and buyer counterparts). Default line mirrors back, but mass updates require touching both.
- `deals.supplier_quotation` / `_discount` / `_delivery_basis` vs `deal_supplier_lines.*` of the same name.
- `deal_payments.payment_type='refund'` semantics overlap with submitting a negative `amount` — both work.
- `deals.buyer_shipped_volume` (00005) and `deals.supplier_shipped_volume` (00044) both auto-computed via shipment rollup.

### 8.5 Vestigial UI / dead fields

- `surcharges`: re-invoicing block (~14 columns) and `surcharge_code`, `accounted_quarter`, `accounted_amount_quarter`, `surcharges.deal_id` FK are not surfaced in the UI. Operator uses free-text `deal_passport_number` instead of FK.
- `tariffs`: `norm_days` is stored but its consumption is unclear (likely tariff lookup, inferred).
- `quotation_monthly_averages`: table is populated by `refresh_quotation_averages` RPC but never queried by the live UI (summary recomputes from `quotations`).
- `quotation_monthly_averages.avg_combined`: defined, never written.
- `applications`: dual buyer/consignee metadata (consignee_name/bin vs buyer_name_for_snt/bin_for_snt) — both kept because regulatory SNT forms require different parties.

### 8.6 Defensive flags / late additions

- `deals.is_draft` (00020), backfilled and NOT-NULL'd in 00091.
- `deals.is_archived` (00003 default false; lock-down in RLS 00010).
- `deal_attachments.section` (00042), with a default-on-NULL strategy for legacy rows.
- `shipment_registry.shipped_tonnage_amount_override`, `rounded_volume_override`, `round_volume` toggles (00050/00061/00086) — added because the auto-CEIL logic was wrong for some forwarders.
- `deal_supplier_lines.appendix` (00072).
- `deal_supplier_lines.calc_mode` (00079) NULL-default = legacy.
- `deal_supplier_lines.fx_rate` / `preliminary_fx_rate` (00071) — only used by `manual_formula`.
- `00060_flip_buyer_debt.sql`: buyer_debt sign was inverted; existing rows backfilled.
- `00052_railway_in_price_balance.sql`: the `railway_in_price` flag from 00018 was not affecting balance until this migration.

### 8.7 Permission churn

- `00082` added `finance` and `trader` to `user_role` enum and to `is_writable_role()`.
- `00083` notes trader is read-only — but `is_writable_role()` still includes trader in DB (audit needed).
- Frontend `isWritable` flag excludes both `trader` and `accounting`, includes `finance`. The comment in `role-context.tsx:28-29` references "migration 00083" but the actual changes were in 00082.

### 8.8 "Why" comments referencing client feedback

Several comments reference dated client feedback (e.g. `00045` notes operator complaint about auto-calc on shipment registry; `00088` notes draft skip rationale; `00046` documents the race that "00037 INSERT + UPDATE" could create). The system has been responsive to bug reports rather than driven by a forward roadmap.

---

## 9. Open Questions & Ambiguities

1. **Trader role: writable or read-only?** `00083` is named "trader_readonly" and the `role-context.tsx` comment claims so, but `is_writable_role()` still grants writes to trader after 00082, and `isWritable` on the frontend excludes trader. Authoritative answer needs cross-checking against the current DB state.

2. **No deal "completed" / "closed" state.** The system has no explicit completion. Is a deal considered closed when shipped + paid? Should the migration target define a status enum?

3. **`quotation_monthly_averages` purpose.** The cache is populated by `refresh_quotation_averages` (admin-triggered?) but never read by live code. Is it consumed by an external reporting pipeline, or genuinely dead?

4. **`quotation_monthly_averages.avg_combined`.** Defined but never written. Intended formula unknown.

5. **`price_cif_nwe_standalone`.** Kept in DB and `price_source` enum but removed from daily entry UI. Are there active deals referencing it? Migration must preserve those.

6. **`trigger` price_condition.** `00068` notes the trigger flow is not yet wired in autoprice — falls back to `line.price`. What is the intended `trigger` behaviour for shipment-derived pricing?

7. **Application → deal binding via filter.** Deal hooks expose an `applicationContract` filter that suggests deals reference applications, but no direct `application_id` column exists on `deals`. The link must traverse `application_deals`. Confirm filter behaviour empirically.

8. **`surcharges.deal_id`.** FK exists but is bypassed in favour of the free-text `deal_passport_number`. Is the FK ever populated? Migration risk if a successor system wants to enforce referential integrity.

9. **Re-invoicing block on surcharges.** All ~14 reinvoice columns appear unwired in the UI. Are they being populated by another channel, or are they dead?

10. **`norm_days` in tariffs.** Stored but not visibly consumed.

11. **Year archive enforcement.** `archive_years.is_locked` is defaulted true, but there is no obvious lock check in mutation paths.

12. **Draft cleanup.** Abandoned drafts (`is_draft=true`) are never cleaned up — only `beforeunload` warns. Migration must decide whether to import them.

13. **Forwarder ratio of "OGEM" fee.** The `ogem` column on `dt_kt_logistics` lacks a documented definition. Business meaning needs operator confirmation.

14. **Currency-mismatch payment rollup.** Payments whose currency differs from the side's currency are silently excluded from `supplier_payment` / `buyer_payment` rollups. Is this the intended business rule, or are mismatched payments meant to convert via FX?

15. **`buyer_debt` sign flip.** Migration 00060 inverted the formula; older external reports may rely on the previous sign convention.

16. **Activity feed permissions.** All authenticated users can write to `deal_activity` (per RLS), but only writable roles can write to the parent `deals`. A read-only user can theoretically post a comment they otherwise couldn't reflect via field edits.

17. **Service-role audit gap.** Operations executed with the service-role key bypass RLS and leave `auth.uid()` NULL in `audit_log`. Compliance posture for "who did what" relies on key custody, not on technical traceability.

18. **Multi-tenant possibility.** Nothing in the schema scopes data by company/tenant. Migration should explicitly decide single- vs multi-tenant.

19. **Backfill on `is_draft NOT NULL`.** `00091` backfilled `NULL → false`. Any draft created before that backfill — whose author was still in the form — was forced visible. Migration should re-verify.

20. **`deal_attachments.section` legacy buckets.** Files imported before 00042 may have NULL `section` and inconsistent UI placement.

21. **Deal copy / duplicate.** Hook surfaces (`Скопировать сделку` per project notes) exist for duplicating deals, but the deals-domain spec extraction did not find the implementation; verify scope.

22. **Activity logging of `deal_company_groups` and lines.** `log_deal_field_changes` only covers `deals` columns. Changes to lines or company-group chain rows are NOT in `deal_activity` (they are in `audit_log` only if the table is audited; lines are not currently audited).

---

**End of specification.**

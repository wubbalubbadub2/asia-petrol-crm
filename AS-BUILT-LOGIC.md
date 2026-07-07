# AS-BUILT-LOGIC.md — Database Business Logic

**CRM for Asia Petrol petroleum-trading operations. This document captures all database-level business logic that enforces deal accounting, payment tracking, shipment pricing, and multi-variant order processing.**

## 1. Triggers

### 1.1 Derived Field Computation — Deals

**Trigger:** `trg_deal_derived_fields`
**Table:** `deals`, **Operation:** BEFORE INSERT / UPDATE
**Function:** `compute_deal_derived_fields()` (00021_deal_derived_fields_trigger.sql)

**Business Logic:**
- Computes derived fields on every deal write:
  - `supplier_contracted_amount = supplier_contracted_volume × supplier_price`
  - `buyer_contracted_amount = buyer_contracted_volume × buyer_price`
  - `supplier_balance = supplier_shipped_amount − supplier_payment − (invoice_amount if railway_in_price=true and currencies match)` [modified in 00060]
  - `buyer_debt = buyer_payment − buyer_shipped_amount` [flipped in 00060 from shipped − payment]
  - `buyer_remaining = buyer_contracted_volume − buyer_ordered_volume`
  - `preliminary_amount = planned_tariff × preliminary_tonnage`

**Side Effects:** None (BEFORE trigger, only modifies the row being inserted/updated).

**Modifications:**
- 00021: Initial implementation with supplier_balance = shipped − payment; buyer_debt = shipped − payment.
- 00060: Flipped buyer_debt to payment − shipped for correct overpayment tracking.

---

### 1.2 Payment Rollup to Deal

**Trigger:** `trg_payment_refresh_deal`
**Table:** `deal_payments`, **Operation:** AFTER INSERT / UPDATE / DELETE
**Function:** `trg_refresh_deal_on_payment()` (00028_payment_rollup_trigger.sql)

**Business Logic:**
Keeps `deals.supplier_payment` and `deals.buyer_payment` (scalar sums) in sync with the sum of all rows in `deal_payments` table filtered by side. When a payment is created, updated, or deleted, the trigger calls `refresh_deal_payment_totals(p_deal_id)` to roll up the current month's total for each side:
- `supplier_payment = SUM(amount WHERE side = 'supplier')`
- `buyer_payment = SUM(amount WHERE side = 'buyer')`

**Side Effects:** Updates two columns on the parent `deals` row. Triggers the BEFORE UPDATE trigger `trg_deal_derived_fields` which recomputes derived fields (balance, debt).

**Migration:** 00028. No changes since.

---

### 1.3 Price Totals Rollup

**Trigger:** `trg_prices_refresh_deal`
**Table:** `deal_shipment_prices`, **Operation:** AFTER INSERT / UPDATE / DELETE
**Function:** `trg_refresh_deal_on_prices()` (00030_shipment_prices_rollup.sql)

**Business Logic:**
Keeps `deals.supplier_shipped_amount` and `deals.buyer_shipped_amount` in sync with the sums in `deal_shipment_prices`:
- `supplier_shipped_amount = SUM(amount WHERE side = 'supplier')`
- `buyer_shipped_amount = SUM(amount WHERE side = 'buyer')`

Per user: "Сумма отгрузки = общая сумма из секции триггер" (sum of shipment pricing section).

**Side Effects:** Updates two columns on `deals`. Triggers `trg_deal_derived_fields` which recomputes derived fields.

**Migration:** 00030. No changes since.

---

### 1.4 Shipment Totals Rollup

**Trigger:** `trg_shipment_refresh_deal`
**Table:** `shipment_registry`, **Operation:** AFTER INSERT / UPDATE / DELETE
**Function:** `trg_refresh_deal_on_shipment()` (00011_functions.sql)

**Business Logic:**
Aggregates `shipment_registry` volumes and amounts into deal passport:
- `buyer_shipped_volume = SUM(shipment_volume)`
- `actual_shipped_volume = SUM(shipment_volume)` [per docs: АВР from forwarder]
- `invoice_amount = SUM(shipped_tonnage_amount)`

Note: 00027 updated the function to also populate `actual_shipped_volume`.

**Side Effects:** Updates three columns on `deals`. Triggers `trg_deal_derived_fields`.

**Migration:** 00011 (initial); 00027 (added actual_shipped_volume).

---

### 1.5 ESF Document Aggregation

**Trigger:** `trg_esf_refresh_deal`
**Table:** `esf_documents`, **Operation:** AFTER INSERT / UPDATE / DELETE
**Function:** `trg_refresh_deal_on_esf()` (00024_esf_deal_aggregation_trigger.sql)

**Business Logic:**
Rolls up ESF invoices into deal invoice fields:
- `invoice_volume = SUM(quantity)`
- `invoice_amount = SUM(total_with_tax)`

Mirrors the shipment registry rollup pattern. Note: `invoice_amount` is clobbered by both this trigger and the shipment registry trigger (00027); shipment_registry's value wins if both are populated.

**Side Effects:** Updates two columns on `deals`.

**Migration:** 00024. No changes since.

---

### 1.6 Audit Trigger (Money-Relevant Tables)

**Trigger:** `trg_audit_*` (six triggers total)
**Tables:** deals, deal_payments, deal_shipment_prices, shipment_registry, dt_kt_logistics, dt_kt_payments
**Operation:** AFTER INSERT / UPDATE / DELETE
**Function:** `audit_trigger()` (00036_audit_log.sql)

**Business Logic:**
Generic trigger that logs every INSERT/UPDATE/DELETE to `audit_log` table. On UPDATE, extracts the list of changed columns (excluding cosmetic `updated_at` bumps) and stores old/new JSONB snapshots. Used for "who changed what, when" audit trail.

**Security:** `SECURITY DEFINER` — bypasses RLS so the function can write to audit_log even if the user normally can't.

**Side Effects:** Inserts into `audit_log` table.

**Migration:** 00036. No changes since.

---

### 1.7 Auto-Pricing: Registry Insert

**Trigger:** `trg_autoprice_registry_insert`
**Table:** `shipment_registry`, **Operation:** AFTER INSERT
**Function:** `autoprice_registry_insert()` (00037 initial; replaced by 00067, 00068)

**Business Logic:**
When a shipment is logged in the registry, auto-spawn `deal_shipment_prices` rows (one per side) with the preliminary price from the variant:
- For supplier side (loading_volume): uses `deal_supplier_lines[default].price`
- For buyer side (shipment_volume): uses `deal_buyer_lines[default].price`

The generated rows carry `shipment_registry_id` (FK) so updates/deletes stay in sync. Rows created manually in the pricing UI have `NULL registry_id` and are untouched by these triggers.

**Formula Logic (Evolution):**
- 00037: Simple price × volume. Uses deal scalar columns.
- 00067: Added `average_month` mode: per-shipment monthly avg lookup. Also added line-level configuration fallback.
- 00068: Added `price_stage` (preliminary/final) mode. In preliminary stage, use line.price literal. In final stage + average_month, recompute per-shipment monthly avg. Includes snapshot logic for preliminary quotation/price.

**Side Effects:** Inserts up to two rows into `deal_shipment_prices`. Triggers `trg_prices_refresh_deal` which rolls up amounts into `deals`.

**Migrations:** 00037 (initial); 00067 (average_month); 00068 (price_stage, final-stage formulae).

---

### 1.8 Auto-Pricing: Registry Update

**Trigger:** `trg_autoprice_registry_update`
**Table:** `shipment_registry`, **Operation:** AFTER UPDATE
**Function:** `autoprice_registry_insert()` (same function, kept in 00037)

**Business Logic:**
When a shipment's volume or date is edited, sync the volume + amount to linked pricing rows, but do NOT touch the price. The whole point is that users can correct prices independently of shipment volumes.

**Side Effects:** Updates `deal_shipment_prices` rows.

**Migration:** 00037.

---

### 1.9 Default Line Sync: Line → Deal (Forward)

**Trigger:** `trg_sync_deal_from_default_supplier_line`, `trg_sync_deal_from_default_buyer_line`
**Table:** `deal_supplier_lines`, `deal_buyer_lines`, **Operation:** AFTER INSERT / UPDATE
**Function:** `sync_deal_from_default_supplier_line()`, `sync_deal_from_default_buyer_line()` (00053_deal_pricing_lines.sql)

**Business Logic:**
When the default line (is_default=true) is created or updated, mirror its fields onto the parent deal's scalar columns:
- Supplier: price_condition, quotation, quotation_comment, discount, price, delivery_basis, departure_station_id
- Buyer: price_condition, quotation, quotation_comment, discount, price, delivery_basis, destination_station_id

In 00055, these functions were enhanced to set a session flag `app.in_line_sync = 'on'` to prevent the reverse trigger from looping.

**Side Effects:** Updates the parent `deals` row, which triggers `trg_deal_derived_fields`.

**Migrations:** 00053 (initial); 00055 (added loop-guard via session flag).

---

### 1.10 Default Line Sync: Deal → Line (Reverse)

**Trigger:** `trg_sync_default_supplier_line_from_deal`, `trg_sync_default_buyer_line_from_deal`
**Table:** `deals`, **Operation:** AFTER UPDATE
**Function:** `sync_default_supplier_line_from_deal()`, `sync_default_buyer_line_from_deal()` (00055_reverse_sync_default_line.sql)

**Business Logic:**
Bridge for legacy code paths that write directly to deal scalar columns (e.g., the deal-create form). When a deal's variant fields change, sync them to the default line if it exists. Session flag `app.in_line_sync` is checked to prevent infinite loops with the forward trigger.

Conceptually: the default line is the source of truth; scalars on deals are a synchronized mirror.

**Side Effects:** Updates `deal_supplier_lines` or `deal_buyer_lines` where is_default=true.

**Migration:** 00055.

---

### 1.11 Seed Default Lines

**Trigger:** `trg_seed_default_supplier_line`, `trg_seed_default_buyer_line`
**Table:** `deals`, **Operation:** AFTER INSERT
**Function:** `seed_default_supplier_line()`, `seed_default_buyer_line()` (00053_deal_pricing_lines.sql)

**Business Logic:**
Enforces the invariant "every deal has exactly one default line per side." When a new deal is created, auto-spawn a default supplier line and a default buyer line, copying values from the deal's scalar fields.

**Side Effects:** Inserts into `deal_supplier_lines` and `deal_buyer_lines`.

**Migration:** 00053. Backfill in same migration for existing deals.

---

### 1.12 Line Counts Maintenance

**Trigger:** `trg_sync_supplier_lines_count`, `trg_sync_buyer_lines_count`
**Table:** `deal_supplier_lines`, `deal_buyer_lines`, **Operation:** AFTER INSERT / UPDATE / DELETE
**Function:** `sync_supplier_lines_count()`, `sync_buyer_lines_count()` (00092_deal_lines_counts.sql)

**Business Logic:**
Maintains denormalized counters on `deals`:
- `supplier_lines_count = COUNT(*) of deal_supplier_lines for this deal`
- `buyer_lines_count = COUNT(*) of deal_buyer_lines for this deal`

Used by passport list query to avoid expensive embeds. Incremented on INSERT, decremented on DELETE, adjusted on UPDATE if line.deal_id changes.

**Side Effects:** Updates two INT columns on `deals`.

**Migration:** 00092.

---

### 1.13 Preliminary Price Snapshot

**Trigger:** `trg_supplier_lines_snapshot_preliminary`, `trg_buyer_lines_snapshot_preliminary`
**Table:** `deal_supplier_lines`, `deal_buyer_lines`, **Operation:** BEFORE UPDATE
**Function:** `snapshot_preliminary_on_finalize()` (00068_price_stage.sql)

**Business Logic:**
When `price_stage` transitions from 'preliminary' to 'final' for the first time, snapshot the current `quotation` and `price` into `preliminary_quotation` and `preliminary_price` columns. Stores `preliminary_set_at` timestamp. Ensures the preliminary estimate survives the finalization for audit purposes.

**Side Effects:** None (BEFORE trigger, modifies only the row being updated).

**Migration:** 00068.

---

## 2. Functions / RPCs

### 2.1 Deal Number Generation

**Function:** `generate_deal_number(p_type deal_type, p_year INT) → INT`
**Security:** SECURITY INVOKER (default)
**Called From:** Backend on deal creation (via API); not called directly from frontend.

**Business Logic:**
Generates sequential deal numbers per type per year. Uses a `deal_sequences` table with (deal_type, year) as composite key. Increments on each call via an upsert with ON CONFLICT. Returns the new number.

**Tables Read/Written:** deal_sequences (write).

**Migration:** 00011.

---

### 2.2 Compute Monthly Quotation Average

**Function:** `compute_monthly_quotation_avg(p_product_type_id UUID, p_year INT, p_month INT) → NUMERIC`
**Security:** SECURITY DEFINER
**Called From:** Trigger `autoprice_registry_insert()` (00067+); RPC `recompute_line_shipment_prices()`.

**Business Logic:**
Computes the average price from all quotations for a given product type and month. Fallback chain: use `price`, then `price_cif_nwe`, then `price_fob_rotterdam`, then `price_fob_med`. Returns NULL if no quotations exist for that period.

**Tables Read:** quotations.

**Migration:** 00067.

---

### 2.3 Resolve Shipment Year/Month

**Function:** `resolve_shipment_year_month(p_date DATE, p_shipment_month TEXT, p_deal_id UUID) → (y INT, m INT)`
**Security:** SECURITY INVOKER
**Called From:** Trigger `autoprice_registry_insert()` (00067+); RPC `recompute_line_shipment_prices()`.

**Business Logic:**
Derives (year, month) for a shipment row. Prefers the actual `date` column. Falls back to parsing `shipment_month` (Russian month name) against the deal's year. Returns (NULL, NULL) if neither source is usable. Supports both nominative and genitive month forms (e.g., "март" and "марта").

**Tables Read:** deals.

**Migration:** 00067.

---

### 2.4 Recompute Line Shipment Prices (RPC)

**Function:** `recompute_line_shipment_prices(p_line_id UUID, p_side TEXT) → INT`
**Signature:** Returns count of rows recomputed.
**Security:** SECURITY DEFINER
**Called From:** Frontend via `recomputeLineShipmentPrices()` hook (src/lib/hooks/use-deal-lines.ts:~200).

**Business Logic:**
Re-prices all existing shipments under a variant line after the manager flips `price_stage` from 'preliminary' to 'final'. Iterates over all `shipment_registry` rows linked to the line, recomputes their `deal_shipment_prices` rows using the final formula:
- If stage='final' AND price_condition='average_month', fetch monthly avg quotation for the shipment's month, apply discount.
- Otherwise, use line.price as-is.

Upserts (UPDATE if exists, INSERT if not) the pricing rows so existing amounts update in place.

**Tables Read:** deal_supplier_lines / deal_buyer_lines, shipment_registry, quotations.
**Tables Written:** deal_shipment_prices.

**Migration:** 00068.

**Frontend Call Site:** `/src/components/deals/deal-lines-editor.tsx` ~line 287 (when finalizing a variant, the UI calls this after the variant.price_stage = 'final' update succeeds).

---

### 2.5 Refresh Deal Shipment Totals (RPC)

**Function:** `refresh_deal_shipment_totals(p_deal_id UUID) → VOID`
**Security:** SECURITY INVOKER
**Called From:** Trigger `trg_refresh_deal_on_shipment()` (not directly from frontend).

**Business Logic:**
Aggregates `shipment_registry` volumes + amounts into deal passport. Computes:
- buyer_shipped_volume, actual_shipped_volume = SUM(shipment_volume)
- invoice_amount = SUM(shipped_tonnage_amount)

Used in 00027 (modified from initial 00011).

**Tables Read/Written:** shipment_registry (read), deals (write).

**Migration:** 00011 (initial); 00027 (updated to populate actual_shipped_volume).

---

### 2.6 Refresh Deal Payment Totals (RPC)

**Function:** `refresh_deal_payment_totals(p_deal_id UUID) → VOID`
**Security:** SECURITY INVOKER
**Called From:** Trigger `trg_refresh_deal_on_payment()` (not directly from frontend).

**Business Logic:**
Rolls up `deal_payments` sums into deal scalars:
- supplier_payment = SUM(amount WHERE side='supplier')
- buyer_payment = SUM(amount WHERE side='buyer')

Handles the case where all payments are deleted (sets both to 0).

**Tables Read/Written:** deal_payments (read), deals (write).

**Migration:** 00028.

---

### 2.7 Refresh Deal Price Totals (RPC)

**Function:** `refresh_deal_price_totals(p_deal_id UUID) → VOID`
**Security:** SECURITY INVOKER
**Called From:** Trigger `trg_refresh_deal_on_prices()` (not directly from frontend).

**Business Logic:**
Rolls up `deal_shipment_prices` sums:
- supplier_shipped_amount = SUM(amount WHERE side='supplier')
- buyer_shipped_amount = SUM(amount WHERE side='buyer')

**Tables Read/Written:** deal_shipment_prices (read), deals (write).

**Migration:** 00030.

---

### 2.8 Refresh Deal ESF Totals (RPC)

**Function:** `refresh_deal_esf_totals(p_deal_id UUID) → VOID`
**Security:** SECURITY INVOKER
**Called From:** Trigger `trg_refresh_deal_on_esf()` (not directly from frontend).

**Business Logic:**
Aggregates ESF document quantities + amounts:
- invoice_volume = SUM(quantity)
- invoice_amount = SUM(total_with_tax)

Note: Same column name `invoice_amount` is overwritten by both this and shipment_registry rollup; last trigger to fire wins (both are AFTER, so order depends on trigger creation order).

**Tables Read/Written:** esf_documents (read), deals (write).

**Migration:** 00024.

---

### 2.9 Get Deal Bundle (Compound RPC)

**Function:** `get_deal_bundle(p_deal_id UUID) → JSONB`
**Security:** SECURITY INVOKER
**Called From:** Frontend (src/lib/hooks/use-deal-bundle.ts).

**Business Logic:**
Consolidates seven separate queries into one round-trip RPC returning a single JSONB object with keys:
- deal: deal row + 11 FK joins (factory, fuel_type, supplier, buyer, forwarder, three managers, two stations, logistics_company_group, deal_company_groups)
- supplier_lines: full details + FK joins
- buyer_lines: full details + FK joins
- shipment_rollup_raw: volume data for client-side aggregation
- shipment_prices_raw: amount data for client-side aggregation
- attachments: grouped by section
- activity: up to 200 activity rows with user info

Replaces seven parallel queries.

**Tables Read:** deals, factories, fuel_types, counterparties, forwarders, profiles, stations, company_groups, deal_company_groups, deal_supplier_lines, deal_buyer_lines, shipment_registry, deal_shipment_prices, deal_attachments, deal_activity (15 tables).

**Migration:** 00093.

---

### 2.10 Additional Functions

The following functions exist but are not called from the frontend or are internal:

- `generate_deal_code()` (00039): Formats deal_number into "1C format" (e.g., "KZ/26/123").
- `compute_dt_kt_balance()` (00011): Computes DT-KT logistics balance (opening + shipped − payment − refund + penalties).
- `lookup_tariff()` (00011): Looks up planned tariff by route + forwarder + fuel type.
- `refresh_quotation_averages()` (00011): Called when quotations are updated (UI no longer triggers this — function exists but no consumer).
- `compute_registry_amount()` (00031): Auto-computes registry row's shipped_tonnage_amount from volume × tariff if amount_override is not set.
- `is_admin()`, `is_writable_role()` (00010): RLS helper functions.
- `update_updated_at()` (00010): Generic BEFORE UPDATE trigger to bump updated_at timestamp.
- `pin_registry_line_on_insert()` (00054): On shipment_registry insert, auto-assign supplier_line_id / buyer_line_id from the deal's default lines if not explicitly provided.
- `propagate_deal_price_to_autorows()` (00056): On deal price change, update linked pricing rows (only those with shipment_registry_id, i.e., auto-generated).
- `propagate_supplier_line_price_to_autorows()`, `propagate_buyer_line_price_to_autorows()` (00056): Per-line version of above.
- `reprice_registry_on_line_change()` (00057): When a variant's quotation_type_id or price_condition changes, trigger a reprice of all linked shipments.
- `reassign_registry_line_on_station_change()` (00057): If a station on a variant changes, re-examine whether shipments should be reassigned to a different line.
- `log_deal_payment_change()` (00087): Logs payment changes to deal_activity.
- `log_deal_field_changes()` (00088): Logs non-payment field changes to deal_activity (comprehensive, ~20 fields).
- `compute_quotation_value()` (00074): Computes quotation.value (uses wide-column lookup; the only call path remaining post-rollback in 00076).
- `compute_subquotation_price()` (00074): DEAD CODE (subquotations were rolled back in 00076).
- `handle_new_user()` (00010): Initializes a user profile on first sign-in.
- `trg_refresh_on_currency_change()` (00043): Trigger helper for per-section currency changes.

---

## 3. Views & Materialized Views

No explicit VIEW or MATERIALIZED VIEW definitions found in migrations. All queries are either raw SQL or stored procedures. The "shipment_rollup_raw" and "shipment_prices_raw" returned by `get_deal_bundle()` are computed on-the-fly, not materialized.

---

## 4. Field-Level Invariants

### 4.1 Exactly One Default Line Per Deal (Per Side)

**Invariant:** There is exactly one row in `deal_supplier_lines` with (deal_id, is_default=true); same for `deal_buyer_lines`.

**Enforcement:**
- **Database:** Unique partial index on (deal_id) WHERE is_default=true (00053_deal_pricing_lines.sql).
- **Trigger:** Auto-seed trigger `trg_seed_default_supplier_line` / `trg_seed_default_buyer_line` ensures a default line exists for every new deal (00053).

**What Breaks if Violated:** The sync triggers `trg_sync_deal_from_default_supplier_line` and its reverse counterpart assume they can UPDATE…WHERE is_default=true without ambiguity. Multiple defaults would cause unpredictable updates.

**Citation:** 00053, lines defining `uq_deal_supplier_lines_default` and `uq_deal_buyer_lines_default`.

---

### 4.2 is_draft Field Not NULL

**Invariant:** `deals.is_draft` is NOT NULL; defaults to false.

**Enforcement:**
- **Database:** ALTER COLUMN is_draft SET DEFAULT false; ALTER COLUMN is_draft SET NOT NULL (00091_deals_list_perf.sql).
- **Backfill:** UPDATE deals SET is_draft = false WHERE is_draft IS NULL in same migration.

**Business Impact:** Enables the query `WHERE is_draft = false` (simple) instead of `WHERE (is_draft IS NULL OR is_draft = false)` (bitmap-OR). Critical for /deals list performance (00091).

**What Breaks if Violated:** Dealboard /deals queries become 10x slower; the composite index idx_deals_list_path cannot be used.

**Citation:** 00091_deals_list_perf.sql.

---

### 4.3 Supplier/Buyer Shipped Amounts Consistency

**Invariant:** `deals.supplier_shipped_amount` and `deals.buyer_shipped_amount` are the exact sums of corresponding rows in `deal_shipment_prices`.

**Enforcement:**
- **Trigger:** `trg_prices_refresh_deal` (AFTER INSERT/UPDATE/DELETE on deal_shipment_prices) calls `refresh_deal_price_totals()` (00030).
- **No manual writes:** Columns are denormalized; direct UPDATE to these columns would desynchronize.

**What Breaks if Violated:** Derived field `supplier_balance` and `buyer_debt` become incorrect because they depend on shipped amounts.

**Citation:** 00030_shipment_prices_rollup.sql; 00021_deal_derived_fields_trigger.sql (depends on these).

---

### 4.4 Supplier/Buyer Payment Sums Consistency

**Invariant:** `deals.supplier_payment` and `deals.buyer_payment` are the exact sums of rows in `deal_payments` grouped by side.

**Enforcement:**
- **Trigger:** `trg_payment_refresh_deal` calls `refresh_deal_payment_totals()` on every deal_payments write (00028).

**What Breaks if Violated:** `supplier_balance` and `buyer_debt` are incorrect.

**Citation:** 00028_payment_rollup_trigger.sql.

---

### 4.5 Shipment Registry Totals Consistency

**Invariant:** `deals.buyer_shipped_volume`, `deals.actual_shipped_volume`, and `deals.invoice_amount` are the exact sums of corresponding shipment_registry rows.

**Enforcement:**
- **Trigger:** `trg_shipment_refresh_deal` calls `refresh_deal_shipment_totals()` on every shipment_registry write (00011, updated in 00027).

**What Breaks if Violated:** Passport display shows wrong volumes; any downstream calculations (e.g., remaining volume) are wrong.

**Citation:** 00011_functions.sql; 00027_update_shipment_totals_trigger.sql.

---

### 4.6 Line Counts Denormalization

**Invariant:** `deals.supplier_lines_count` = COUNT(*) WHERE deal_id and deal_supplier_lines; same for buyer_lines_count.

**Enforcement:**
- **Trigger:** `trg_sync_supplier_lines_count` / `trg_sync_buyer_lines_count` increment/decrement on every line INSERT/UPDATE/DELETE (00092).

**What Breaks if Violated:** Passport list displays wrong "+N variants" badge; frontend may request non-existent lines.

**Citation:** 00092_deal_lines_counts.sql.

---

### 4.7 Default Line Scalar Sync

**Invariant:** When `deal_supplier_lines[is_default=true].price` changes, `deals.supplier_price` must also change (and vice versa).

**Enforcement:**
- **Bidirectional Triggers:**
  - Forward (00053): `trg_sync_deal_from_default_supplier_line` syncs line → deal.
  - Reverse (00055): `trg_sync_default_supplier_line_from_deal` syncs deal → line, gated by session flag to prevent loops.

**Why:** Deal scalars are read by legacy code paths (e.g., passport table); lines table is the new source of truth. Scalars must stay synchronized.

**What Breaks if Violated:** Passport reads stale supplier_price; line updates don't propagate to shipment pricing.

**Citation:** 00053_deal_pricing_lines.sql; 00055_reverse_sync_default_line.sql.

---

### 4.8 Price Stage Snapshot

**Invariant:** When a variant flips from price_stage='preliminary' to 'final', the current quotation and price values are captured into preliminary_quotation and preliminary_price (one-time snapshot).

**Enforcement:**
- **Trigger:** `trg_supplier_lines_snapshot_preliminary` / `trg_buyer_lines_snapshot_preliminary` (BEFORE UPDATE) check if stage is changing to 'final' and snapshot if not already snapshotted (preliminary_quotation IS NULL) (00068).

**What Breaks if Violated:** Audit trail loses the preliminary estimate; can't reconstruct the pre-finalization pricing for reconciliation.

**Citation:** 00068_price_stage.sql.

---

### 4.9 Preliminary vs. Final Pricing

**Invariant:** When a shipment is auto-priced (trigger `trg_autoprice_registry_insert`):
- If variant.price_stage = 'preliminary': use variant.price literally (manager's provisional estimate).
- If variant.price_stage = 'final' AND variant.price_condition = 'average_month': use monthly-avg quotation for the shipment's month.

**Enforcement:**
- **Trigger:** `autoprice_registry_insert()` includes a branch that reads variant.price_stage and applies the correct formula (00068).
- **RPC:** `recompute_line_shipment_prices()` re-applies the same logic when called after finalization (00068).

**What Breaks if Violated:** Shipments created before finalization would not re-price correctly after finalization; users cannot see the effect of market moves during the settlement period.

**Citation:** 00068_price_stage.sql.

---

### 4.10 Supplier/Buyer Line Foreign Key Cascade

**Invariant:** When a deal is deleted, all deal_supplier_lines and deal_buyer_lines are automatically deleted (cascade).

**Enforcement:**
- **Database:** Foreign keys defined as `REFERENCES deals(id) ON DELETE CASCADE` in both tables (00053).

**What Breaks if Violated:** Orphaned line rows persist; queries using JOINs fail or return incomplete data; audit becomes confusing.

**Citation:** 00053_deal_pricing_lines.sql.

---

### 4.11 Shipment Registry ↔ Line Foreign Keys

**Invariant:** `shipment_registry.supplier_line_id` and `shipment_registry.buyer_line_id` are foreign keys to their respective line tables.

**Enforcement:**
- **Database:** FK constraints defined in 00054.
- **Trigger:** `trg_audit_shipment_registry` records the deletion.

**What Breaks if Violated:** Orphaned registry rows point to non-existent lines; pricing cannot be correctly re-derived.

**Citation:** 00054_registry_line_fk.sql.

---

### 4.12 Shipment Pricing Registry Link

**Invariant:** `deal_shipment_prices` rows auto-generated by the registry trigger carry a `shipment_registry_id` FK; manual pricing rows (user-created) have NULL registry_id.

**Enforcement:**
- **Trigger:** `trg_autoprice_registry_insert()` explicitly sets `shipment_registry_id = NEW.id` when inserting (00037).
- **Trigger:** `trg_autoprice_registry_update()` only touches rows WHERE shipment_registry_id = NEW.id (00037).

**What Breaks if Violated:** Updates to shipment volumes don't propagate to pricing; manual edits get clobbered by auto-pricing.

**Citation:** 00037_registry_autoprice.sql.

---

### 4.13 Currency Fallback (Payments)

**Invariant:** `deal_payments.currency` is nullable; NULL means "use the deal's currency" for that payment. Frontend must treat NULL as deal.supplier_currency (for supplier side) or deal.buyer_currency (for buyer side).

**Enforcement:**
- **Database:** Column is nullable (no NOT NULL constraint).
- **Frontend:** Query typically includes `COALESCE(payment.currency, deal.supplier_currency)` in client logic.
- **Rollup behavior:** Payments whose currency doesn't match the side's currency are SILENTLY EXCLUDED from the running side total (00043 logic in refresh_deal_payment_totals).

**Citation:** 00034_payments_currency.sql.

---

### 4.14 Draft → Real Deal Transition

**Invariant:** When a deal transitions from is_draft=true to is_draft=false, the activity feed should NOT be populated with spurious "field changed from NULL to X" rows for every scalar column.

**Enforcement:**
- **Trigger:** `trg_deal_field_changes()` explicitly checks `IF COALESCE(NEW.is_draft, FALSE) OR COALESCE(OLD.is_draft, FALSE) THEN RETURN NEW;` (00088).

**What Breaks if Violated:** Deal activity feed is flooded with 50+ rows when a new deal is saved; operators see noise instead of meaningful edits.

**Citation:** 00088_log_deal_field_changes.sql.

---

## 5. Trigger Interaction Diagrams

### 5.1 Deal Creation Flow

```
User creates new deal via frontend (POST /deals)
  ↓
INSERT deals row
  ↓
BEFORE INSERT: trg_deal_derived_fields
  ├─ Computes supplier_contracted_amount, buyer_contracted_amount, balances
  └─ Returns NEW
  ↓
AFTER INSERT: trg_seed_default_supplier_line
  ├─ INSERT deal_supplier_lines (position=1, is_default=true) with current deal scalars
  └─ Triggers trg_sync_deal_from_default_supplier_line (if the insert itself were an update, but it's INSERT so no forward sync yet)
  ↓
AFTER INSERT: trg_seed_default_buyer_line
  └─ Same as supplier
  ↓
AFTER INSERT: trg_deal_derived_fields (N/A, only BEFORE)
  ↓
AFTER INSERT: trg_audit_deals
  └─ INSERT audit_log row
```

### 5.2 Shipment Registry Insert → Auto-Pricing → Deal Rollup

```
Forwarder logs a shipment (INSERT shipment_registry)
  ↓
AFTER INSERT: trg_autoprice_registry_insert
  ├─ Fetch deal_supplier_lines[supplier_line_id or default], extract price, discount, price_condition, quotation_type_id, price_stage
  ├─ Fetch deal_buyer_lines[buyer_line_id or default], same fields
  ├─ If loading_volume NOT NULL:
  │  ├─ If price_stage='preliminary': use supplier_line.price × loading_volume
  │  └─ If price_stage='final' AND price_condition='average_month':
  │     ├─ Call compute_monthly_quotation_avg(supplier_line.quotation_type_id, year, month)
  │     └─ Use (monthly_avg - supplier_line.discount) × loading_volume
  │  └─ INSERT deal_shipment_prices (side='supplier', shipment_registry_id=NEW.id, calculated_price, amount)
  ├─ If shipment_volume NOT NULL:
  │  └─ Same logic for buyer side
  └─ (delete uses ON DELETE CASCADE automatically)
  ↓
AFTER INSERT: trg_prices_refresh_deal
  ├─ Call refresh_deal_price_totals(NEW.deal_id)
  └─ UPDATE deals SET
       supplier_shipped_amount = SUM(amount WHERE side='supplier'),
       buyer_shipped_amount = SUM(amount WHERE side='buyer')
  ↓
BEFORE UPDATE: trg_deal_derived_fields (fired because UPDATE deals in previous step)
  └─ Recompute supplier_balance, buyer_debt, supplier_contracted_amount, buyer_contracted_amount
  ↓
AFTER INSERT: trg_shipment_refresh_deal (parallel to trg_prices_refresh_deal, also AFTER INSERT)
  ├─ Call refresh_deal_shipment_totals(NEW.deal_id)
  └─ UPDATE deals SET
       buyer_shipped_volume = SUM(shipment_volume),
       actual_shipped_volume = SUM(shipment_volume),
       invoice_amount = SUM(shipped_tonnage_amount)
  ↓
BEFORE UPDATE: trg_deal_derived_fields (refires; invoice_amount may affect supplier_balance if railway_in_price=true)
  ↓
AFTER INSERT: trg_audit_shipment_registry
  └─ INSERT audit_log row
  ↓
AFTER INSERT: trg_audit_deal_shipment_prices
  └─ INSERT audit_log row (for the auto-generated pricing row)
```

**Critical Note:** Both `trg_prices_refresh_deal` and `trg_shipment_refresh_deal` fire on the same INSERT event. The order depends on trigger creation order (both AFTER). The second UPDATE to deals retriggers `trg_deal_derived_fields`, so derived fields are recomputed twice. This is safe (idempotent) but slightly inefficient.

### 5.3 Payment Insert → Rollup → Derived Fields

```
User records a payment (INSERT deal_payments)
  ↓
AFTER INSERT: trg_payment_refresh_deal
  ├─ Call refresh_deal_payment_totals(NEW.deal_id)
  └─ UPDATE deals SET
       supplier_payment = SUM(amount WHERE side='supplier'),
       buyer_payment = SUM(amount WHERE side='buyer')
  ↓
BEFORE UPDATE: trg_deal_derived_fields
  └─ Recompute supplier_balance and buyer_debt using new payment values
  ↓
AFTER INSERT: trg_audit_deal_payments
  └─ INSERT audit_log row
  ↓
(Optional) AFTER INSERT: trg_deal_payment_log (00087)
  └─ INSERT deal_activity row (chat-visible log of payment change)
```

### 5.4 Deal Scalar Write (Legacy Path) → Sync to Line → Sync Back (Loop Prevention)

```
Legacy API writes supplier_price = 100 (e.g., deal-create form)
  ↓
BEFORE UPDATE: trg_deal_derived_fields
  └─ Recompute supplier_contracted_amount
  ↓
AFTER UPDATE: trg_sync_default_supplier_line_from_deal
  ├─ Check session flag: app.in_line_sync = '' (not 'on'), so proceed
  ├─ UPDATE deal_supplier_lines SET price = 100
  │  WHERE deal_id = NEW.id AND is_default = true
  │
  └─ (This UPDATE fires trg_sync_deal_from_default_supplier_line)
      ├─ Inside that trigger: SET app.in_line_sync = 'on'
      ├─ UPDATE deals SET supplier_price = 100 (same value, no-op)
      ├─ SET app.in_line_sync = ''
      └─ RETURN NEW
      ↓
      (Loop prevented because app.in_line_sync was set)
```

### 5.5 Variant Finalization (price_stage: preliminary → final)

```
User updates variant: price_stage = 'final'
  ↓
BEFORE UPDATE: trg_supplier_lines_snapshot_preliminary
  ├─ Check: OLD.price_stage='preliminary' AND NEW.price_stage='final'
  ├─ IF NEW.preliminary_quotation IS NULL:
  │  ├─ NEW.preliminary_quotation := OLD.quotation
  │  ├─ NEW.preliminary_price := OLD.price
  │  └─ NEW.preliminary_set_at := now()
  └─ RETURN NEW
  ↓
UPDATE succeeds (variant now has price_stage='final', snapshot taken)
  ↓
Frontend detects finalization, calls RPC: recompute_line_shipment_prices(line_id, 'supplier')
  ├─ Iterate over shipment_registry rows WHERE supplier_line_id = line_id
  ├─ For each, compute (year, month) via resolve_shipment_year_month()
  ├─ Fetch compute_monthly_quotation_avg(quotation_type_id, year, month)
  ├─ Calculate final_price = monthly_avg - discount
  ├─ UPSERT deal_shipment_prices (UPDATE if exists, INSERT if not)
  │  SET calculated_price = final_price, amount = volume × final_price, quotation_avg = monthly_avg
  └─ RETURN count of rows recomputed
  ↓
Each pricing row UPDATE fires: trg_prices_refresh_deal
  └─ Rolls up new amounts into deals.supplier_shipped_amount
  ↓
BEFORE UPDATE: trg_deal_derived_fields
  └─ Recomputes supplier_balance with new shipped amounts
```

### 5.6 Line Deletion Cascade

```
User deletes a non-default variant (DELETE deal_supplier_lines WHERE id=X, is_default=false)
  ↓
AFTER DELETE: trg_sync_supplier_lines_count
  ├─ UPDATE deals SET supplier_lines_count = GREATEST(0, supplier_lines_count - 1)
  └─ WHERE id = OLD.deal_id
  ↓
(FK cascade): shipment_registry rows WHERE supplier_line_id = X
  ├─ ON DELETE CASCADE deletes all linked registry rows
  └─ Each triggers trg_shipment_refresh_deal, trg_audit_shipment_registry, etc.
  ↓
(FK cascade): deal_shipment_prices rows WHERE shipment_registry_id = X (chain via registry deletion)
  ├─ Cascade deletes pricing rows
  └─ Triggers trg_prices_refresh_deal
      └─ Rolls up new (lower) totals into deals.supplier_shipped_amount
```

---

## Summary

The CRM's database layer implements a tightly coupled, trigger-driven accounting system for petroleum trades. The core invariants are:

1. **Derived fields always in sync:** Balances, debts, and contracted amounts recompute on every source change (price, volume, payment).
2. **Denormalized totals are accurate:** Rollup columns (supplier_shipped_amount, buyer_payment, etc.) exactly match their source tables via trigger maintenance.
3. **Variant lines are the source of truth:** Scalar columns on deals are synchronized mirrors; changes to the default line propagate to scalars and vice versa (with loop prevention).
4. **Audit trail is comprehensive:** Every payment, shipment, and deal field change is logged to audit_log; critical edits also appear in deal_activity (chat).
5. **Preliminary pricing snapshots are immutable:** When a variant finalizes, the provisional estimate is captured for reconciliation purposes.
6. **Auto-pricing respects workflow stages:** Shipments in preliminary variants use literal prices; shipments in finalized average_month variants recompute against market quotations.

The most complex flow is auto-pricing (00037 → 00067 → 00068), where a registry insert spawns pricing rows, which then roll up to deal totals, which recompute derived fields—and later the variant can be finalized to re-price all shipments per market conditions. The reverse-sync trigger (00055) bridges legacy scalar writes and the new lines table, preventing endless loops via session-level flags.

Performance optimizations include denormalization (line counts, totals), partial indexes (is_draft), and the compound RPC `get_deal_bundle()` (00093) that replaces seven queries with one.

---

**Key Migration References:** 00011, 00021, 00027–00030, 00036–00037, 00053, 00055, 00060, 00067–00068, 00088, 00091–00093
**Frontend Call Sites:** src/lib/hooks/use-deal-lines.ts (recomputeLineShipmentPrices), src/lib/hooks/use-deal-bundle.ts (get_deal_bundle), src/components/deals/deal-lines-editor.tsx

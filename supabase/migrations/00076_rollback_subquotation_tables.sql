-- Rollback of the parallel sub-quotation design from migrations 00073-00075
-- (2026-05-21).
--
-- The first-pass design (product_subtypes + quotation_values +
-- compute_subquotation_price RPC) duplicated machinery that already exists
-- in the project: sub-quotations per parent are encoded by the WIDE
-- columns of `quotations` (price, price_cif_nwe, price_fob_med,
-- price_fob_rotterdam, price_cif_nwe_standalone), with the per-product
-- column layout defined in src/lib/constants/quotation-columns.ts via
-- getColumnsForProduct(productName).
--
-- This migration drops the redundant tables, the RPC, and the
-- sub_quotation_id FK on the three lines tables. Migration 00077 then
-- adds a minimal nullable `price_source` text column + a new RPC that
-- averages the chosen wide column over a window.
--
-- The `avg_to_date` enum value introduced in 00073 is KEPT — it's still
-- useful for the new design (partial-month-average mode) and Postgres
-- doesn't support cleanly removing enum values anyway.
--
-- Idempotent.

-- ── 1. Drop the RPC ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS compute_subquotation_price(uuid, text, jsonb);

-- ── 2. Drop the long-format values table ─────────────────────────────────
DROP TABLE IF EXISTS quotation_values;

-- ── 3. Drop sub_quotation_id FK columns from the three lines tables ──────
ALTER TABLE deal_supplier_lines DROP COLUMN IF EXISTS sub_quotation_id;
ALTER TABLE deal_buyer_lines    DROP COLUMN IF EXISTS sub_quotation_id;
ALTER TABLE shipment_registry   DROP COLUMN IF EXISTS sub_quotation_id;

-- ── 4. Drop the product_subtypes table ───────────────────────────────────
DROP TABLE IF EXISTS product_subtypes;

-- Note: `avg_to_date` value on the `price_condition` enum is intentionally
-- left in place. See header.

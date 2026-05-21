-- price_source column + compute_quotation_value RPC — replaces the
-- rolled-back sub-quotation design with a minimal version that builds
-- on the EXISTING data model (2026-05-21).
--
-- Sub-quotations are already encoded as WIDE COLUMNS of `quotations`:
-- price, price_cif_nwe, price_fob_med, price_fob_rotterdam,
-- price_cif_nwe_standalone. The per-product layout (which columns are
-- meaningful, their labels, which one is the formula-averaged column)
-- lives in src/lib/constants/quotation-columns.ts via
-- getColumnsForProduct(productName).
--
-- This migration:
--   1. Adds a nullable `price_source` TEXT column on the three lines
--      tables (deal_supplier_lines, deal_buyer_lines, shipment_registry)
--      with a CHECK constraint enumerating the five valid column names.
--      NULL = legacy/unset (frontend falls back to fetchQuotationPrice).
--   2. Creates compute_quotation_value(product_type_id, price_source,
--      mode, params) — averages the picked wide column from `quotations`
--      over a window. Modes mirror the rolled-back RPC: avg_month,
--      avg_to_date, on_date, trigger.
--
-- Idempotent.

-- ── 1. price_source columns ──────────────────────────────────────────────
ALTER TABLE deal_supplier_lines ADD COLUMN IF NOT EXISTS price_source TEXT;
ALTER TABLE deal_buyer_lines    ADD COLUMN IF NOT EXISTS price_source TEXT;
ALTER TABLE shipment_registry   ADD COLUMN IF NOT EXISTS price_source TEXT;

-- Soft constraint: only the wide-column names from quotations.
ALTER TABLE deal_supplier_lines DROP CONSTRAINT IF EXISTS deal_supplier_lines_price_source_chk;
ALTER TABLE deal_supplier_lines ADD CONSTRAINT deal_supplier_lines_price_source_chk
  CHECK (price_source IS NULL OR price_source IN ('price','price_cif_nwe','price_fob_med','price_fob_rotterdam','price_cif_nwe_standalone'));

ALTER TABLE deal_buyer_lines DROP CONSTRAINT IF EXISTS deal_buyer_lines_price_source_chk;
ALTER TABLE deal_buyer_lines ADD CONSTRAINT deal_buyer_lines_price_source_chk
  CHECK (price_source IS NULL OR price_source IN ('price','price_cif_nwe','price_fob_med','price_fob_rotterdam','price_cif_nwe_standalone'));

ALTER TABLE shipment_registry DROP CONSTRAINT IF EXISTS shipment_registry_price_source_chk;
ALTER TABLE shipment_registry ADD CONSTRAINT shipment_registry_price_source_chk
  CHECK (price_source IS NULL OR price_source IN ('price','price_cif_nwe','price_fob_med','price_fob_rotterdam','price_cif_nwe_standalone'));

COMMENT ON COLUMN deal_supplier_lines.price_source IS
  'Which wide column of `quotations` to read for this variant (price/price_cif_nwe/price_fob_med/price_fob_rotterdam/price_cif_nwe_standalone). NULL = legacy fallback.';
COMMENT ON COLUMN deal_buyer_lines.price_source IS
  'Which wide column of `quotations` to read for this variant (price/price_cif_nwe/price_fob_med/price_fob_rotterdam/price_cif_nwe_standalone). NULL = legacy fallback.';
COMMENT ON COLUMN shipment_registry.price_source IS
  'Which wide column of `quotations` to read for this shipment (price/price_cif_nwe/price_fob_med/price_fob_rotterdam/price_cif_nwe_standalone). NULL = legacy fallback.';

-- ── 2. compute_quotation_value RPC ───────────────────────────────────────
-- Reads the chosen wide column from `quotations` averaged over a window
-- scoped to the given product_type_id. NULL values in the chosen column
-- are excluded by AVG natively. Returns NULL when no rows match.
--
-- Dynamic SQL (format + EXECUTE) is required because the column itself
-- is a parameter; the price_source input is validated against an
-- explicit allow-list before format() to keep the query injection-safe.
CREATE OR REPLACE FUNCTION compute_quotation_value(
  p_product_type_id UUID,
  p_price_source    TEXT,
  p_mode            TEXT,
  p_params          JSONB
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_start DATE;
  v_end   DATE;
  v_avg   NUMERIC;
  v_days  INT;
BEGIN
  IF p_product_type_id IS NULL OR p_price_source IS NULL OR p_mode IS NULL OR p_params IS NULL THEN
    RAISE EXCEPTION 'compute_quotation_value: null required input';
  END IF;
  IF p_price_source NOT IN ('price','price_cif_nwe','price_fob_med','price_fob_rotterdam','price_cif_nwe_standalone') THEN
    RAISE EXCEPTION 'invalid price_source: %', p_price_source;
  END IF;

  -- Resolve window per mode.
  CASE p_mode
    WHEN 'avg_month' THEN
      v_start := make_date((p_params->>'year')::int, (p_params->>'month')::int, 1);
      v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
    WHEN 'avg_to_date' THEN
      v_end   := (p_params->>'date')::date;
      v_start := date_trunc('month', v_end)::date;
    WHEN 'on_date' THEN
      v_start := (p_params->>'date')::date;
      v_end   := v_start;
    WHEN 'trigger' THEN
      v_start := (p_params->>'start_date')::date;
      v_days  := (p_params->>'days')::int;
      IF v_days < 1 OR v_days > 90 THEN
        RAISE EXCEPTION 'days out of 1..90: %', v_days;
      END IF;
      v_end   := v_start + v_days;
    ELSE
      RAISE EXCEPTION 'unknown mode: %', p_mode;
  END CASE;

  EXECUTE format(
    'SELECT AVG(%I) FROM quotations WHERE product_type_id = $1 AND date BETWEEN $2 AND $3',
    p_price_source
  ) INTO v_avg USING p_product_type_id, v_start, v_end;

  RETURN v_avg;
END;
$$;

GRANT EXECUTE ON FUNCTION compute_quotation_value(UUID, TEXT, TEXT, JSONB) TO authenticated, service_role, anon;

COMMENT ON FUNCTION compute_quotation_value(UUID, TEXT, TEXT, JSONB) IS
  'Read a wide-column price from quotations averaged over a window. price_source picks the column (price/price_cif_nwe/price_fob_med/price_fob_rotterdam/price_cif_nwe_standalone). Modes: avg_month, avg_to_date, on_date, trigger.';

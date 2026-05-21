-- Phase 4 — orthogonal subtype × calc_mode. Earlier modes (avg_to_date,
-- manual_in_formula) remain in the price_condition enum but are no longer
-- driven from the UI (2026-05-21).
--
-- Beken's clarified model: the variant editor's «формульная» tier is
-- driven by TWO independent dimensions, both required:
--
--   • «Подтип формулы»  — derives the target date:
--       fixed             → target = anchor date (shipment, 0-day shift)
--       trigger_shipment  → target = shipment_date + N days
--       trigger_border    → target = border_crossing_date + N days
--
--   • «Режим расчёта»   — extracts a price from the target date:
--       on_date           → quotation value ON target_date
--       avg_month         → AVG over the calendar month of target_date
--
-- This migration adds the new `calc_mode` TEXT column to the two lines
-- tables and rewrites `compute_quotation_value` to take an explicit
-- target_date + calc_mode pair (frontend computes target_date = anchor
-- + days client-side).
--
-- Idempotent.

-- ── 1. calc_mode columns on the two lines tables ─────────────────────────
ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS calc_mode TEXT NOT NULL DEFAULT 'on_date';
ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS calc_mode TEXT NOT NULL DEFAULT 'on_date';

-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS`; guard via catalog lookup.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'deal_supplier_lines'
       AND constraint_name = 'deal_supplier_lines_calc_mode_chk'
  ) THEN
    ALTER TABLE deal_supplier_lines
      ADD CONSTRAINT deal_supplier_lines_calc_mode_chk
      CHECK (calc_mode IN ('on_date','avg_month'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'deal_buyer_lines'
       AND constraint_name = 'deal_buyer_lines_calc_mode_chk'
  ) THEN
    ALTER TABLE deal_buyer_lines
      ADD CONSTRAINT deal_buyer_lines_calc_mode_chk
      CHECK (calc_mode IN ('on_date','avg_month'));
  END IF;
END $$;

COMMENT ON COLUMN deal_supplier_lines.calc_mode IS
  '«Режим расчёта»: on_date = quotation value on target date, avg_month = average over the calendar month of target date.';
COMMENT ON COLUMN deal_buyer_lines.calc_mode IS
  'see deal_supplier_lines.calc_mode';

-- ── 2. compute_quotation_value RPC — new signature ───────────────────────
-- Reads the chosen wide column from `quotations` either on a single
-- target_date (on_date) or averaged over the calendar month of the
-- target_date (avg_month). The old (mode, params JSONB) signature is
-- dropped — the frontend now computes the target_date client-side as
-- anchor + days and passes both pieces here.
--
-- Dynamic SQL (format + EXECUTE) is required because the column itself
-- is a parameter; p_price_source is validated against an explicit
-- allow-list before format() to keep the query injection-safe.

DROP FUNCTION IF EXISTS compute_quotation_value(UUID, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION compute_quotation_value(
  p_product_type_id UUID,
  p_price_source    TEXT,
  p_target_date     DATE,
  p_calc_mode       TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_start DATE;
  v_end   DATE;
  v_avg   NUMERIC;
BEGIN
  IF p_product_type_id IS NULL OR p_price_source IS NULL OR p_target_date IS NULL OR p_calc_mode IS NULL THEN
    RAISE EXCEPTION 'compute_quotation_value: null required input';
  END IF;
  IF p_price_source NOT IN ('price','price_cif_nwe','price_fob_med','price_fob_rotterdam','price_cif_nwe_standalone') THEN
    RAISE EXCEPTION 'invalid price_source: %', p_price_source;
  END IF;
  IF p_calc_mode = 'on_date' THEN
    v_start := p_target_date;
    v_end   := p_target_date;
  ELSIF p_calc_mode = 'avg_month' THEN
    v_start := date_trunc('month', p_target_date)::date;
    v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
  ELSE
    RAISE EXCEPTION 'invalid calc_mode: %', p_calc_mode;
  END IF;
  EXECUTE format(
    'SELECT AVG(%I) FROM quotations WHERE product_type_id = $1 AND date BETWEEN $2 AND $3',
    p_price_source
  ) INTO v_avg USING p_product_type_id, v_start, v_end;
  RETURN v_avg;
END;
$$;

GRANT EXECUTE ON FUNCTION compute_quotation_value(UUID, TEXT, DATE, TEXT) TO authenticated, service_role, anon;

COMMENT ON FUNCTION compute_quotation_value(UUID, TEXT, DATE, TEXT) IS
  'Read a wide-column price from quotations around a target date. p_calc_mode in (on_date, avg_month).';

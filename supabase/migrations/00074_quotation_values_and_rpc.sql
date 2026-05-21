-- Sub-quotation daily values (long format) + compute_subquotation_price RPC
-- — Phase 2 of the sub-quotation feature (2026-05-21).
--
-- Phase 1 (00073) introduced product_subtypes and wired sub_quotation_id
-- onto the lines tables. This migration adds the storage layer for daily
-- sub-quotation values and the read-only computation RPC the frontend
-- will call instead of the legacy wide-column ?? fallback.
--
-- Storage shape: ONE row per (sub_quotation_id, date). The old `quotations`
-- table keeps its wide columns (price, price_cif_nwe, price_fob_med,
-- price_fob_rotterdam) as read-only legacy — managers re-enter the values
-- they care about going forward, and historical deals already have their
-- prices snapshotted on deal_shipment_prices. Per design discussion, NO
-- backfill from the wide columns is performed: every quotation_values row
-- is a fresh manager-authored value tied explicitly to a sub-quotation.
--
-- Phase 3 will swap the frontend's fetchQuotationPrice over to this RPC;
-- this migration touches DB only.

-- ── 1. quotation_values table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotation_values (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_quotation_id UUID NOT NULL REFERENCES product_subtypes(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  value            NUMERIC(14,4) NOT NULL,
  comment          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sub_quotation_id, date)
);

CREATE INDEX IF NOT EXISTS idx_quotation_values_lookup
  ON quotation_values (sub_quotation_id, date);

-- Reuse the project-wide updated_at trigger function defined in
-- 00001_reference_tables.sql (`update_updated_at`). Drop-and-recreate so the
-- migration is idempotent.
DROP TRIGGER IF EXISTS trg_quotation_values_updated ON quotation_values;
CREATE TRIGGER trg_quotation_values_updated
  BEFORE UPDATE ON quotation_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. compute_subquotation_price RPC ────────────────────────────────────
-- Returns AVG(value) over a closed [v_start, v_end] window of quotation_values
-- for the given sub-quotation. NULL when no rows match. Raises on bad input.
--
-- Modes (p_mode + p_params):
--   'avg_month'   { "month": 1-12, "year": int }
--                   → window = [year-month-01, last day of that month]
--   'avg_to_date' { "date": "YYYY-MM-DD" }
--                   → window = [first day of date's month, date]
--                     (partial-month average ending on the given date)
--   'on_date'     { "date": "YYYY-MM-DD" }
--                   → window = [date, date] (single-day lookup)
--   'trigger'     { "start_date": "YYYY-MM-DD", "days": 1-90 }
--                   → window = [start_date, start_date + days days]
CREATE OR REPLACE FUNCTION compute_subquotation_price(
  p_sub_quotation_id UUID,
  p_mode             TEXT,
  p_params           JSONB
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start  DATE;
  v_end    DATE;
  v_year   INT;
  v_month  INT;
  v_date   DATE;
  v_days   INT;
  v_avg    NUMERIC;
BEGIN
  IF p_sub_quotation_id IS NULL THEN
    RAISE EXCEPTION 'compute_subquotation_price: p_sub_quotation_id is required';
  END IF;
  IF p_mode IS NULL THEN
    RAISE EXCEPTION 'compute_subquotation_price: p_mode is required';
  END IF;
  IF p_params IS NULL THEN
    RAISE EXCEPTION 'compute_subquotation_price: p_params is required (mode=%)', p_mode;
  END IF;

  IF p_mode = 'avg_month' THEN
    IF (p_params ? 'year') IS NOT TRUE OR (p_params ? 'month') IS NOT TRUE THEN
      RAISE EXCEPTION 'compute_subquotation_price avg_month: params must include {year, month}, got %', p_params;
    END IF;
    v_year  := (p_params->>'year')::INT;
    v_month := (p_params->>'month')::INT;
    IF v_month < 1 OR v_month > 12 THEN
      RAISE EXCEPTION 'compute_subquotation_price avg_month: month must be 1-12, got %', v_month;
    END IF;
    v_start := make_date(v_year, v_month, 1);
    v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  ELSIF p_mode = 'avg_to_date' THEN
    IF (p_params ? 'date') IS NOT TRUE THEN
      RAISE EXCEPTION 'compute_subquotation_price avg_to_date: params must include {date}, got %', p_params;
    END IF;
    v_date  := (p_params->>'date')::DATE;
    v_start := date_trunc('month', v_date)::DATE;
    v_end   := v_date;

  ELSIF p_mode = 'on_date' THEN
    IF (p_params ? 'date') IS NOT TRUE THEN
      RAISE EXCEPTION 'compute_subquotation_price on_date: params must include {date}, got %', p_params;
    END IF;
    v_date  := (p_params->>'date')::DATE;
    v_start := v_date;
    v_end   := v_date;

  ELSIF p_mode = 'trigger' THEN
    IF (p_params ? 'start_date') IS NOT TRUE OR (p_params ? 'days') IS NOT TRUE THEN
      RAISE EXCEPTION 'compute_subquotation_price trigger: params must include {start_date, days}, got %', p_params;
    END IF;
    v_date := (p_params->>'start_date')::DATE;
    v_days := (p_params->>'days')::INT;
    IF v_days < 1 OR v_days > 90 THEN
      RAISE EXCEPTION 'compute_subquotation_price trigger: days must be 1-90, got %', v_days;
    END IF;
    v_start := v_date;
    v_end   := (v_date + make_interval(days => v_days))::DATE;

  ELSE
    RAISE EXCEPTION 'compute_subquotation_price: unknown mode %, expected avg_month | avg_to_date | on_date | trigger', p_mode;
  END IF;

  SELECT AVG(value)
    INTO v_avg
  FROM quotation_values
  WHERE sub_quotation_id = p_sub_quotation_id
    AND date BETWEEN v_start AND v_end;

  RETURN v_avg;
END;
$$;

GRANT EXECUTE ON FUNCTION compute_subquotation_price(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION compute_subquotation_price(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION compute_subquotation_price(UUID, TEXT, JSONB) TO anon;

-- ── 3. comments ──────────────────────────────────────────────────────────
COMMENT ON TABLE quotation_values IS
  'Daily values per sub-quotation in long format (one row per sub_quotation_id + date); replaces the wide-column layout on `quotations` going forward.';

COMMENT ON FUNCTION compute_subquotation_price(UUID, TEXT, JSONB) IS
  'Read-only price computation over quotation_values. Modes: avg_month {year,month}, avg_to_date {date}, on_date {date}, trigger {start_date,days 1-90}. Returns NULL when no data; raises on invalid mode or missing params.';

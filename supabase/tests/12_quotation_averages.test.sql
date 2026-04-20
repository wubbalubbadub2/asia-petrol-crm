-- Test: refresh_quotation_averages (mig 00011)
--
-- The function aggregates daily quotations into a per-(product_type,
-- year, month) row in quotation_monthly_averages. Prices drive the
-- "Средний месяц" pricing mode, so drift here silently reprices deals.
--
-- Assertions:
--   1. First call inserts a new averages row with AVG() across
--      quotations in that (product, year, month) window.
--   2. Quotations outside the window are ignored.
--   3. Quotations with NULL price are filtered out (WHERE price IS NOT NULL).
--   4. A follow-up call with the same (product, year, month) updates
--      the existing row via ON CONFLICT DO UPDATE (no duplicate).
--
-- The function is *not* fired by a trigger (design choice flagged in
-- the architecture plan: Phase 3.3 adds a nightly edge function). The
-- test calls it explicitly the same way the UI refresh button does.

BEGIN;

DO $$
DECLARE
  v_prod_id  UUID := gen_random_uuid();
  v_prod_id2 UUID := gen_random_uuid();
  v_row      quotation_monthly_averages%ROWTYPE;
  v_count    INT;
BEGIN
  INSERT INTO quotation_product_types (id, name)
  VALUES (v_prod_id,  'T-Diesel'),
         (v_prod_id2, 'T-Gasoline');

  -- In-window quotations for (v_prod_id, 2099-01).
  INSERT INTO quotations (product_type_id, date, price, price_fob_med,
                          price_fob_rotterdam, price_cif_nwe)
  VALUES
    (v_prod_id, '2099-01-05', 500, 400, 450, 480),
    (v_prod_id, '2099-01-15', 600, 500, 550, 580),
    (v_prod_id, '2099-01-25', 700, 600, 650, 680);

  -- Null-price row must be excluded.
  INSERT INTO quotations (product_type_id, date, price)
  VALUES (v_prod_id, '2099-01-10', NULL);

  -- Other-month row for same product — must be excluded.
  INSERT INTO quotations (product_type_id, date, price)
  VALUES (v_prod_id, '2099-02-05', 999);

  -- Different product in the same month — must be excluded.
  INSERT INTO quotations (product_type_id, date, price)
  VALUES (v_prod_id2, '2099-01-05', 123);

  PERFORM refresh_quotation_averages(v_prod_id, 2099, 1);

  SELECT * INTO v_row FROM quotation_monthly_averages
    WHERE product_type_id = v_prod_id AND year = 2099 AND month = 1;
  IF v_row.avg_price <> 600 THEN  -- (500+600+700)/3
    RAISE EXCEPTION 'avg_price expected 600, got %', v_row.avg_price;
  END IF;
  IF v_row.avg_fob_med <> 500 THEN  -- (400+500+600)/3
    RAISE EXCEPTION 'avg_fob_med expected 500, got %', v_row.avg_fob_med;
  END IF;
  IF v_row.avg_fob_rotterdam <> 550 THEN
    RAISE EXCEPTION 'avg_fob_rotterdam expected 550, got %', v_row.avg_fob_rotterdam;
  END IF;
  IF v_row.avg_cif_nwe <> 580 THEN
    RAISE EXCEPTION 'avg_cif_nwe expected 580, got %', v_row.avg_cif_nwe;
  END IF;

  -- One row per (product, year, month).
  SELECT COUNT(*) FROM quotation_monthly_averages
    WHERE product_type_id = v_prod_id AND year = 2099
    INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 averages row after first refresh, got %', v_count;
  END IF;

  -- Insert a 4th quotation and re-run. ON CONFLICT DO UPDATE should
  -- overwrite the existing row, still yielding one row.
  INSERT INTO quotations (product_type_id, date, price)
  VALUES (v_prod_id, '2099-01-30', 800);

  PERFORM refresh_quotation_averages(v_prod_id, 2099, 1);

  SELECT COUNT(*) FROM quotation_monthly_averages
    WHERE product_type_id = v_prod_id AND year = 2099
    INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected still 1 averages row after rerun, got %', v_count;
  END IF;

  SELECT * INTO v_row FROM quotation_monthly_averages
    WHERE product_type_id = v_prod_id AND year = 2099 AND month = 1;
  IF v_row.avg_price <> 650 THEN  -- (500+600+700+800)/4
    RAISE EXCEPTION 'after rerun: avg_price expected 650, got %', v_row.avg_price;
  END IF;

  -- Cross-product isolation: v_prod_id2's January wasn't averaged.
  SELECT COUNT(*) FROM quotation_monthly_averages
    WHERE product_type_id = v_prod_id2
    INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'cross-product isolation violated: v_prod_id2 got % rows', v_count;
  END IF;
END $$;

ROLLBACK;

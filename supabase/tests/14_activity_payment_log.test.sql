-- Test: payment changes cascade into deal_activity (mig 00016 + 00028)
--
-- Chain under test:
--   deal_payments INSERT
--     → trg_payment_refresh_deal (mig 00028)
--     → refresh_deal_payment_totals updates deals.supplier_payment
--     → trg_deal_payment_log (mig 00016)
--     → INSERT INTO deal_activity ('payment', ...)
--
-- That's four triggers across two migrations hanging off a single
-- user action. This test asserts the full chain produces a visible
-- activity entry — both side's payment rollups fire independently,
-- and null → null noise is suppressed (the log trigger guards on
-- `NEW.supplier_payment IS NOT NULL`).

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000b01', 'supplier', 'T-ActSupplier'),
  ('00000000-0000-0000-0000-000000000b02', 'buyer',    'T-ActBuyer');

DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_count   INT;
  v_content TEXT;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id, currency)
  VALUES (v_deal_id, 'KZ', 9950, 2099, 'январь',
          '00000000-0000-0000-0000-000000000b01',
          '00000000-0000-0000-0000-000000000b02',
          'KZT');

  -- Add a supplier payment. Rollup brings supplier_payment from NULL
  -- to 100, log trigger emits one activity entry.
  INSERT INTO deal_payments (deal_id, side, amount, currency, payment_date)
  VALUES (v_deal_id, 'supplier', 100, 'KZT', '2099-01-10');

  SELECT COUNT(*) FROM deal_activity
    WHERE deal_id = v_deal_id AND type = 'payment'
    INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'supplier payment: expected 1 activity entry, got %', v_count;
  END IF;

  SELECT content FROM deal_activity
    WHERE deal_id = v_deal_id AND type = 'payment'
    ORDER BY created_at DESC LIMIT 1
    INTO v_content;
  IF v_content NOT LIKE 'Оплата поставщику:%' THEN
    RAISE EXCEPTION 'supplier activity content malformed: %', v_content;
  END IF;

  -- Add a buyer payment. Buyer-side rollup fires, buyer activity emitted.
  INSERT INTO deal_payments (deal_id, side, amount, currency, payment_date)
  VALUES (v_deal_id, 'buyer', 250, 'KZT', '2099-01-11');

  SELECT COUNT(*) FROM deal_activity
    WHERE deal_id = v_deal_id AND type = 'payment'
    INTO v_count;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'after buyer payment: expected 2 activity entries, got %', v_count;
  END IF;

  SELECT content FROM deal_activity
    WHERE deal_id = v_deal_id AND type = 'payment'
    ORDER BY created_at DESC LIMIT 1
    INTO v_content;
  IF v_content NOT LIKE 'Оплата покупателя:%' THEN
    RAISE EXCEPTION 'buyer activity content malformed: %', v_content;
  END IF;

  -- Adding a second supplier payment in the same currency changes
  -- supplier_payment from 100 → 300. Log trigger fires again.
  INSERT INTO deal_payments (deal_id, side, amount, currency, payment_date)
  VALUES (v_deal_id, 'supplier', 200, 'KZT', '2099-01-12');

  SELECT COUNT(*) FROM deal_activity
    WHERE deal_id = v_deal_id AND type = 'payment'
    INTO v_count;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'after 2nd supplier payment: expected 3 activity entries, got %', v_count;
  END IF;

  -- Touch the deal without changing supplier/buyer_payment (e.g. an
  -- unrelated field). The log trigger's IS DISTINCT FROM guard should
  -- suppress the activity entry.
  UPDATE deals SET buyer_ordered_volume = 50 WHERE id = v_deal_id;
  SELECT COUNT(*) FROM deal_activity
    WHERE deal_id = v_deal_id AND type = 'payment'
    INTO v_count;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'unrelated UPDATE logged a spurious payment entry, now %', v_count;
  END IF;
END $$;

ROLLBACK;

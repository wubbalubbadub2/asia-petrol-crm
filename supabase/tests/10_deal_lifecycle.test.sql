-- Test: full deal lifecycle integration (mig 00011, 00021, 00027,
-- 00028, 00030, 00037, 00040, 00041).
--
-- Individual trigger/function tests cover each rollup in isolation.
-- This file stitches them together in the order a real user hits
-- them and asserts the deal row converges on the right aggregate
-- state. Catches regressions that only show up at the boundary
-- between features (e.g. supplier_balance depends on payment +
-- shipped rollups both having run at the right time).
--
-- Sequence:
--   1. Admin creates a deal with volumes + prices + tariffs.
--   2. Admin logs a shipment (registry_autoprice spawns the two
--      deal_shipment_prices rows).
--   3. Admin logs a matching-currency buyer payment.
--   4. Assert: supplier_shipped_amount, buyer_shipped_amount,
--      buyer_payment, supplier_balance, buyer_debt,
--      actual_shipped_volume, invoice_amount are all coherent.
--   5. Admin deletes the shipment. Assert totals snap to payment-
--      only state (00041 ensures this rather than leaving stale
--      aggregates).

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000a01', 'supplier', 'T-LifecycleSupplier'),
  ('00000000-0000-0000-0000-000000000a02', 'buyer',    'T-LifecycleBuyer');

DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_reg_id  UUID;
  v_deal    deals%ROWTYPE;
BEGIN
  -- 1. Create a KZT-denominated deal with 100t volume, prices on
  --    both sides, railway tariff.
  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id,
                     currency,
                     supplier_contracted_volume, supplier_price,
                     buyer_contracted_volume,    buyer_price,
                     planned_tariff, preliminary_tonnage)
  VALUES (v_deal_id, 'KZ', 9920, 2099, 'январь',
          '00000000-0000-0000-0000-000000000a01',
          '00000000-0000-0000-0000-000000000a02',
          'KZT',
          100, 50,
          100, 60,
          5, 100);

  SELECT * INTO v_deal FROM deals WHERE id = v_deal_id;

  -- Derived amounts after INSERT:
  IF v_deal.supplier_contracted_amount <> 100 * 50 THEN
    RAISE EXCEPTION 'stage 1: supplier_contracted_amount expected 5000, got %', v_deal.supplier_contracted_amount;
  END IF;
  IF v_deal.buyer_contracted_amount <> 100 * 60 THEN
    RAISE EXCEPTION 'stage 1: buyer_contracted_amount expected 6000, got %', v_deal.buyer_contracted_amount;
  END IF;
  IF v_deal.preliminary_amount <> 5 * 100 THEN
    RAISE EXCEPTION 'stage 1: preliminary_amount expected 500, got %', v_deal.preliminary_amount;
  END IF;

  -- 2. Log a 40-ton shipment. shipped_tonnage_amount = CEIL(40) * 5 = 200.
  --    Registry autoprice (00037) should spawn supplier + buyer pricing
  --    rows each = 40 * respective price.
  INSERT INTO shipment_registry
    (deal_id, registry_type, shipment_volume, railway_tariff, date)
  VALUES (v_deal_id, 'KZ', 40, 5, '2099-01-10')
  RETURNING id INTO v_reg_id;

  SELECT * INTO v_deal FROM deals WHERE id = v_deal_id;
  IF v_deal.actual_shipped_volume <> 40 THEN
    RAISE EXCEPTION 'stage 2: actual_shipped_volume expected 40, got %', v_deal.actual_shipped_volume;
  END IF;
  IF v_deal.invoice_amount <> 200 THEN  -- CEIL(40) * 5
    RAISE EXCEPTION 'stage 2: invoice_amount expected 200, got %', v_deal.invoice_amount;
  END IF;
  IF v_deal.supplier_shipped_amount <> 40 * 50 THEN
    RAISE EXCEPTION 'stage 2: supplier_shipped_amount expected 2000, got %', v_deal.supplier_shipped_amount;
  END IF;
  IF v_deal.buyer_shipped_amount <> 40 * 60 THEN
    RAISE EXCEPTION 'stage 2: buyer_shipped_amount expected 2400, got %', v_deal.buyer_shipped_amount;
  END IF;
  -- supplier_balance = shipped - payment (no payment yet)
  IF v_deal.supplier_balance <> 40 * 50 THEN
    RAISE EXCEPTION 'stage 2: supplier_balance expected 2000, got %', v_deal.supplier_balance;
  END IF;
  IF v_deal.buyer_debt <> 40 * 60 THEN
    RAISE EXCEPTION 'stage 2: buyer_debt expected 2400, got %', v_deal.buyer_debt;
  END IF;

  -- 3. Log a KZT buyer payment of 1500 — currency matches deal, should
  --    roll into buyer_payment and collapse buyer_debt.
  INSERT INTO deal_payments (deal_id, side, amount, currency, payment_date)
  VALUES (v_deal_id, 'buyer', 1500, 'KZT', '2099-01-12');

  SELECT * INTO v_deal FROM deals WHERE id = v_deal_id;
  IF v_deal.buyer_payment <> 1500 THEN
    RAISE EXCEPTION 'stage 3: buyer_payment expected 1500, got %', v_deal.buyer_payment;
  END IF;
  IF v_deal.buyer_debt <> 40 * 60 - 1500 THEN  -- 2400 - 1500 = 900
    RAISE EXCEPTION 'stage 3: buyer_debt expected 900, got %', v_deal.buyer_debt;
  END IF;

  -- Payment in a non-matching currency should NOT affect buyer_payment.
  INSERT INTO deal_payments (deal_id, side, amount, currency, payment_date)
  VALUES (v_deal_id, 'buyer', 50000, 'USD', '2099-01-13');

  SELECT * INTO v_deal FROM deals WHERE id = v_deal_id;
  IF v_deal.buyer_payment <> 1500 THEN
    RAISE EXCEPTION 'stage 3b: cross-currency payment must be ignored. buyer_payment expected 1500, got %', v_deal.buyer_payment;
  END IF;

  -- 4. Delete the shipment. ON DELETE CASCADE wipes the autoprice
  --    pricing rows; the registry + price rollups both IF-NOT-FOUND
  --    back to zero thanks to mig 00041. Buyer payment rollup is
  --    unaffected.
  DELETE FROM shipment_registry WHERE id = v_reg_id;

  SELECT * INTO v_deal FROM deals WHERE id = v_deal_id;
  IF COALESCE(v_deal.actual_shipped_volume, 0) <> 0 THEN
    RAISE EXCEPTION 'stage 4: actual_shipped_volume expected 0, got %', v_deal.actual_shipped_volume;
  END IF;
  IF COALESCE(v_deal.invoice_amount, 0) <> 0 THEN
    RAISE EXCEPTION 'stage 4: invoice_amount expected 0, got %', v_deal.invoice_amount;
  END IF;
  IF COALESCE(v_deal.supplier_shipped_amount, 0) <> 0 THEN
    RAISE EXCEPTION 'stage 4: supplier_shipped_amount expected 0, got %', v_deal.supplier_shipped_amount;
  END IF;
  IF COALESCE(v_deal.buyer_shipped_amount, 0) <> 0 THEN
    RAISE EXCEPTION 'stage 4: buyer_shipped_amount expected 0, got %', v_deal.buyer_shipped_amount;
  END IF;
  -- Buyer payment retains the 1500; buyer_debt = 0 shipped - 1500 payment = -1500
  IF v_deal.buyer_payment <> 1500 THEN
    RAISE EXCEPTION 'stage 4: buyer_payment expected to survive shipment delete, got %', v_deal.buyer_payment;
  END IF;
  IF v_deal.buyer_debt <> -1500 THEN
    RAISE EXCEPTION 'stage 4: buyer_debt expected -1500 (overpayment), got %', v_deal.buyer_debt;
  END IF;
END $$;

ROLLBACK;

-- Test: deal_payments rollup respects deal currency (mig 00028 + 00040)
--
-- Migration 00040 amended refresh_deal_payment_totals so that
-- supplier_payment / buyer_payment only sum rows whose per-payment
-- currency matches the deal's currency (NULL currency treated as
-- deal-currency for legacy rows). Prior behaviour summed every
-- payment regardless, producing mixed-currency nonsense for deals
-- with payments in multiple currencies.
--
-- We also verify the AFTER UPDATE OF currency trigger rebases totals
-- when the deal's own currency is changed — that's what migration
-- 00040 exists to guarantee end-to-end.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000301', 'supplier', 'T-PaySupplier'),
  ('00000000-0000-0000-0000-000000000302', 'buyer',    'T-PayBuyer');

DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  -- Deal denominated in KZT.
  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id, currency)
  VALUES (v_deal_id, 'KZ', 9905, 2099, 'январь',
          '00000000-0000-0000-0000-000000000301',
          '00000000-0000-0000-0000-000000000302',
          'KZT');

  -- Buyer side: two KZT payments (80k each) + one USD (ignored for the KZT rollup)
  INSERT INTO deal_payments (deal_id, side, amount, currency, date) VALUES
    (v_deal_id, 'buyer', 80000, 'KZT', '2099-01-10'),
    (v_deal_id, 'buyer', 80000, 'KZT', '2099-01-11'),
    (v_deal_id, 'buyer', 80000, 'USD', '2099-01-12');

  -- Supplier side: one KZT + one NULL (legacy, treated as KZT)
  INSERT INTO deal_payments (deal_id, side, amount, currency, date) VALUES
    (v_deal_id, 'supplier', 50000, 'KZT', '2099-01-13'),
    (v_deal_id, 'supplier', 10000, NULL,  '2099-01-14');

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.buyer_payment <> 160000 THEN
    RAISE EXCEPTION 'buyer_payment expected 160000 (KZT-only), got %', v_row.buyer_payment;
  END IF;
  IF v_row.supplier_payment <> 60000 THEN
    RAISE EXCEPTION 'supplier_payment expected 60000 (KZT + NULL), got %', v_row.supplier_payment;
  END IF;

  -- Balance derivation: supplier_balance = shipped_amount - payment.
  -- No shipped_amount on this deal, so balance should be -supplier_payment.
  IF v_row.supplier_balance <> -60000 THEN
    RAISE EXCEPTION 'supplier_balance expected -60000, got %', v_row.supplier_balance;
  END IF;
  IF v_row.buyer_debt <> -160000 THEN
    RAISE EXCEPTION 'buyer_debt expected -160000, got %', v_row.buyer_debt;
  END IF;

  -- Flip the deal's currency to USD. The trg_deal_currency_change
  -- trigger should re-run the rollup, so now only the lone 80k USD
  -- buyer payment counts. NULL-currency supplier rows now count as
  -- USD (by "NULL = deal currency" semantics), so supplier_payment
  -- drops to the 10k NULL row.
  UPDATE deals SET currency = 'USD' WHERE id = v_deal_id;

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.buyer_payment <> 80000 THEN
    RAISE EXCEPTION 'after currency flip to USD: buyer_payment expected 80000, got %', v_row.buyer_payment;
  END IF;
  IF v_row.supplier_payment <> 10000 THEN
    RAISE EXCEPTION 'after currency flip to USD: supplier_payment expected 10000 (NULL only), got %', v_row.supplier_payment;
  END IF;
  IF v_row.buyer_debt <> -80000 THEN
    RAISE EXCEPTION 'after currency flip: buyer_debt expected -80000, got %', v_row.buyer_debt;
  END IF;

  -- Deleting a matching-currency payment should shrink the rollup.
  DELETE FROM deal_payments
    WHERE deal_id = v_deal_id AND side = 'buyer' AND currency = 'USD';
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF COALESCE(v_row.buyer_payment, 0) <> 0 THEN
    RAISE EXCEPTION 'after deleting only matching buyer payment: buyer_payment expected 0, got %', v_row.buyer_payment;
  END IF;
END $$;

ROLLBACK;

-- Test: compute_deal_derived_fields (migration 00021)
-- The BEFORE INSERT OR UPDATE trigger should materialize:
--   supplier_contracted_amount = volume * price
--   buyer_contracted_amount    = volume * price
--   supplier_balance           = shipped - payment
--   buyer_debt                 = shipped - payment
--   buyer_remaining            = contracted - ordered
--   preliminary_amount         = planned_tariff * preliminary_tonnage

BEGIN;

-- Fixtures: one supplier, one buyer, one deal stub.
INSERT INTO counterparties (id, type, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'supplier', 'T-Supplier'),
  ('00000000-0000-0000-0000-000000000002', 'buyer',    'T-Buyer');

DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  INSERT INTO deals (
    id, deal_type, deal_number, year, month,
    supplier_id, supplier_contracted_volume, supplier_price, supplier_payment, supplier_shipped_amount,
    buyer_id,    buyer_contracted_volume,    buyer_price,    buyer_ordered_volume,
    buyer_payment, buyer_shipped_amount,
    planned_tariff, preliminary_tonnage
  ) VALUES (
    v_deal_id, 'KG', 9901, 2099, 'январь',
    '00000000-0000-0000-0000-000000000001', 100, 10,   500, 1000,
    '00000000-0000-0000-0000-000000000002', 100, 20,    30,
    800, 2000,
    5, 50
  );

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;

  -- Contracted amount = volume * price
  IF v_row.supplier_contracted_amount <> 100 * 10 THEN
    RAISE EXCEPTION 'supplier_contracted_amount expected 1000, got %', v_row.supplier_contracted_amount;
  END IF;
  IF v_row.buyer_contracted_amount <> 100 * 20 THEN
    RAISE EXCEPTION 'buyer_contracted_amount expected 2000, got %', v_row.buyer_contracted_amount;
  END IF;

  -- Balance = shipped - payment
  IF v_row.supplier_balance <> 1000 - 500 THEN
    RAISE EXCEPTION 'supplier_balance expected 500, got %', v_row.supplier_balance;
  END IF;
  IF v_row.buyer_debt <> 2000 - 800 THEN
    RAISE EXCEPTION 'buyer_debt expected 1200, got %', v_row.buyer_debt;
  END IF;

  -- buyer_remaining = contracted - ordered
  IF v_row.buyer_remaining <> 100 - 30 THEN
    RAISE EXCEPTION 'buyer_remaining expected 70, got %', v_row.buyer_remaining;
  END IF;

  -- preliminary_amount = tariff * tonnage
  IF v_row.preliminary_amount <> 5 * 50 THEN
    RAISE EXCEPTION 'preliminary_amount expected 250, got %', v_row.preliminary_amount;
  END IF;

  -- Update the volume and check re-derivation
  UPDATE deals SET supplier_contracted_volume = 200 WHERE id = v_deal_id;
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.supplier_contracted_amount <> 200 * 10 THEN
    RAISE EXCEPTION 'on update: supplier_contracted_amount expected 2000, got %', v_row.supplier_contracted_amount;
  END IF;
END $$;

ROLLBACK;

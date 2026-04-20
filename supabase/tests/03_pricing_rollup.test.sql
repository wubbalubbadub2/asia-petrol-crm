-- Test: deal_shipment_prices rollup → deals.supplier_shipped_amount / buyer_shipped_amount (mig 00030)

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000201', 'supplier', 'T-PriceSupplier'),
  ('00000000-0000-0000-0000-000000000202', 'buyer',    'T-PriceBuyer');

DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id)
  VALUES (v_deal_id, 'KG', 9903, 2099, 'январь',
          '00000000-0000-0000-0000-000000000201',
          '00000000-0000-0000-0000-000000000202');

  -- Supplier side: two rows totalling 500 + 300 = 800
  INSERT INTO deal_shipment_prices (deal_id, side, volume, calculated_price, amount)
  VALUES
    (v_deal_id, 'supplier', 10, 50,  500),
    (v_deal_id, 'supplier', 10, 30,  300);

  -- Buyer side: one row = 1200
  INSERT INTO deal_shipment_prices (deal_id, side, volume, calculated_price, amount)
  VALUES (v_deal_id, 'buyer', 20, 60, 1200);

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.supplier_shipped_amount <> 800 THEN
    RAISE EXCEPTION 'supplier_shipped_amount expected 800, got %', v_row.supplier_shipped_amount;
  END IF;
  IF v_row.buyer_shipped_amount <> 1200 THEN
    RAISE EXCEPTION 'buyer_shipped_amount expected 1200, got %', v_row.buyer_shipped_amount;
  END IF;

  -- Update a row and verify rollup moves
  UPDATE deal_shipment_prices SET amount = 700
    WHERE deal_id = v_deal_id AND side = 'supplier' AND amount = 500;
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.supplier_shipped_amount <> 700 + 300 THEN
    RAISE EXCEPTION 'after update: supplier_shipped_amount expected 1000, got %', v_row.supplier_shipped_amount;
  END IF;

  -- Delete all supplier rows → supplier_shipped_amount goes to 0, buyer unaffected
  DELETE FROM deal_shipment_prices WHERE deal_id = v_deal_id AND side = 'supplier';
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF COALESCE(v_row.supplier_shipped_amount, 0) <> 0 THEN
    RAISE EXCEPTION 'after supplier delete: supplier_shipped_amount expected 0, got %', v_row.supplier_shipped_amount;
  END IF;
  IF v_row.buyer_shipped_amount <> 1200 THEN
    RAISE EXCEPTION 'after supplier delete: buyer_shipped_amount expected 1200, got %', v_row.buyer_shipped_amount;
  END IF;
END $$;

ROLLBACK;

-- Test: registry insert auto-spawns deal_shipment_prices rows (mig 00037)
--
-- Migration 00037 added a trigger that, when a shipment_registry row
-- is inserted for a deal, spawns up to two deal_shipment_prices rows
-- (one supplier-side, one buyer-side) using the deal's current
-- supplier_price / buyer_price. The linking column
-- shipment_registry_id keeps updates + deletes in sync.
--
-- Assertions:
--   1. Insert → one supplier + one buyer pricing row (when both
--      prices are set on the deal).
--   2. Each spawned row's amount = volume × the deal's corresponding
--      price at insert time.
--   3. Updating the shipment's volume propagates to the pricing rows
--      (amount = new volume × stored calculated_price).
--   4. Updating the shipment's date moves shipment_date on the
--      pricing rows.
--   5. Deleting the shipment cascades-deletes its pricing rows.
--   6. When only one side of the deal has a price, only that side's
--      pricing row is created.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000801', 'supplier', 'T-APriceSupplier'),
  ('00000000-0000-0000-0000-000000000802', 'buyer',    'T-APriceBuyer');

-- Case A: both sides priced.
DO $$
DECLARE
  v_deal_id   UUID := gen_random_uuid();
  v_reg_id    UUID;
  v_sup_cnt   INT;
  v_buy_cnt   INT;
  v_sup_amt   NUMERIC;
  v_buy_amt   NUMERIC;
  v_sup_date  DATE;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id,
                     supplier_price, buyer_price,
                     supplier_discount, buyer_discount)
  VALUES (v_deal_id, 'KG', 9908, 2099, 'январь',
          '00000000-0000-0000-0000-000000000801',
          '00000000-0000-0000-0000-000000000802',
          50, 60, 1, 2);

  INSERT INTO shipment_registry
    (deal_id, registry_type, shipment_volume, railway_tariff, date)
  VALUES (v_deal_id, 'KG', 10, 5, '2099-01-10')
  RETURNING id INTO v_reg_id;

  SELECT COUNT(*) FROM deal_shipment_prices
   WHERE shipment_registry_id = v_reg_id AND side = 'supplier'
   INTO v_sup_cnt;
  SELECT COUNT(*) FROM deal_shipment_prices
   WHERE shipment_registry_id = v_reg_id AND side = 'buyer'
   INTO v_buy_cnt;

  IF v_sup_cnt <> 1 THEN
    RAISE EXCEPTION 'expected 1 supplier pricing row, got %', v_sup_cnt;
  END IF;
  IF v_buy_cnt <> 1 THEN
    RAISE EXCEPTION 'expected 1 buyer pricing row, got %', v_buy_cnt;
  END IF;

  SELECT amount FROM deal_shipment_prices
   WHERE shipment_registry_id = v_reg_id AND side = 'supplier'
   INTO v_sup_amt;
  IF v_sup_amt <> 500 THEN  -- 10 * 50
    RAISE EXCEPTION 'supplier amount expected 500, got %', v_sup_amt;
  END IF;

  SELECT amount FROM deal_shipment_prices
   WHERE shipment_registry_id = v_reg_id AND side = 'buyer'
   INTO v_buy_amt;
  IF v_buy_amt <> 600 THEN  -- 10 * 60
    RAISE EXCEPTION 'buyer amount expected 600, got %', v_buy_amt;
  END IF;

  -- UPDATE shipment volume → amount recomputes off stored price.
  UPDATE shipment_registry SET shipment_volume = 20 WHERE id = v_reg_id;
  SELECT amount FROM deal_shipment_prices
   WHERE shipment_registry_id = v_reg_id AND side = 'supplier'
   INTO v_sup_amt;
  IF v_sup_amt <> 1000 THEN  -- 20 * 50
    RAISE EXCEPTION 'after volume bump: supplier amount expected 1000, got %', v_sup_amt;
  END IF;

  -- UPDATE shipment date → pricing rows follow.
  UPDATE shipment_registry SET date = '2099-02-01' WHERE id = v_reg_id;
  SELECT shipment_date FROM deal_shipment_prices
   WHERE shipment_registry_id = v_reg_id AND side = 'supplier'
   INTO v_sup_date;
  IF v_sup_date <> '2099-02-01' THEN
    RAISE EXCEPTION 'after date update: supplier shipment_date expected 2099-02-01, got %', v_sup_date;
  END IF;

  -- DELETE shipment → ON DELETE CASCADE on shipment_registry_id
  -- should drop both pricing rows.
  DELETE FROM shipment_registry WHERE id = v_reg_id;
  SELECT COUNT(*) FROM deal_shipment_prices
   WHERE shipment_registry_id = v_reg_id
   INTO v_sup_cnt;
  IF v_sup_cnt <> 0 THEN
    RAISE EXCEPTION 'after delete: expected 0 pricing rows, got %', v_sup_cnt;
  END IF;
END $$;

-- Case B: only buyer side priced — no supplier pricing row should spawn.
DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_reg_id  UUID;
  v_sup_cnt INT;
  v_buy_cnt INT;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id, buyer_price)
  VALUES (v_deal_id, 'KG', 9909, 2099, 'январь',
          '00000000-0000-0000-0000-000000000801',
          '00000000-0000-0000-0000-000000000802',
          70);

  INSERT INTO shipment_registry
    (deal_id, registry_type, shipment_volume, railway_tariff, date)
  VALUES (v_deal_id, 'KG', 5, 3, '2099-01-15')
  RETURNING id INTO v_reg_id;

  SELECT COUNT(*) FROM deal_shipment_prices
   WHERE shipment_registry_id = v_reg_id AND side = 'supplier'
   INTO v_sup_cnt;
  SELECT COUNT(*) FROM deal_shipment_prices
   WHERE shipment_registry_id = v_reg_id AND side = 'buyer'
   INTO v_buy_cnt;

  IF v_sup_cnt <> 0 THEN
    RAISE EXCEPTION 'supplier-unpriced: expected 0 supplier rows, got %', v_sup_cnt;
  END IF;
  IF v_buy_cnt <> 1 THEN
    RAISE EXCEPTION 'supplier-unpriced: expected 1 buyer row, got %', v_buy_cnt;
  END IF;
END $$;

ROLLBACK;

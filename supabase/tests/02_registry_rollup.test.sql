-- Test: registry auto-compute + deal rollup (migrations 00011, 00027, 00031)
-- A shipment insert should:
--   1. Auto-compute shipped_tonnage_amount = CEIL(volume) * tariff (00031)
--   2. Propagate to deals.invoice_amount + actual_shipped_volume (00027)

BEGIN;

-- Fixtures
INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000101', 'supplier', 'T-RollupSupplier'),
  ('00000000-0000-0000-0000-000000000102', 'buyer',    'T-RollupBuyer');

DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
  v_reg_row shipment_registry%ROWTYPE;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id)
  VALUES (v_deal_id, 'KG', 9902, 2099, 'январь',
          '00000000-0000-0000-0000-000000000101',
          '00000000-0000-0000-0000-000000000102');

  -- First shipment: volume 54.719 × tariff 56.59 should = CEIL(54.719)=55 × 56.59 = 3112.45
  INSERT INTO shipment_registry (deal_id, registry_type, shipment_volume, railway_tariff)
  VALUES (v_deal_id, 'KG', 54.719, 56.59)
  RETURNING * INTO v_reg_row;

  IF v_reg_row.shipped_tonnage_amount <> 55 * 56.59 THEN
    RAISE EXCEPTION 'auto-compute: shipped_tonnage_amount expected %, got %',
      55 * 56.59, v_reg_row.shipped_tonnage_amount;
  END IF;

  -- Rollup into deal
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.actual_shipped_volume <> 54.719 THEN
    RAISE EXCEPTION 'deal.actual_shipped_volume expected 54.719, got %', v_row.actual_shipped_volume;
  END IF;
  IF v_row.invoice_amount <> 55 * 56.59 THEN
    RAISE EXCEPTION 'deal.invoice_amount expected %, got %',
      55 * 56.59, v_row.invoice_amount;
  END IF;

  -- Add a second shipment
  INSERT INTO shipment_registry (deal_id, registry_type, shipment_volume, railway_tariff)
  VALUES (v_deal_id, 'KG', 54.719, 56.59);

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.actual_shipped_volume <> 2 * 54.719 THEN
    RAISE EXCEPTION 'after 2nd insert: actual_shipped_volume expected %, got %',
      2 * 54.719, v_row.actual_shipped_volume;
  END IF;
  IF v_row.invoice_amount <> 2 * 55 * 56.59 THEN
    RAISE EXCEPTION 'after 2nd insert: invoice_amount expected %, got %',
      2 * 55 * 56.59, v_row.invoice_amount;
  END IF;

  -- Delete should roll back totals
  DELETE FROM shipment_registry WHERE deal_id = v_deal_id;
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF COALESCE(v_row.actual_shipped_volume, 0) <> 0 THEN
    RAISE EXCEPTION 'after delete all: actual_shipped_volume expected 0, got %', v_row.actual_shipped_volume;
  END IF;
END $$;

ROLLBACK;

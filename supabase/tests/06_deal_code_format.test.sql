-- Test: compute_deal_code produces the 1C format TYPE/YY/NNN (mig 00039)
--
-- Migration 00039 changed the deal_code format from the old TYPE/NUM/YY
-- (e.g. KG/7/26) to TYPE/YY/NNN (e.g. KG/26/006) so the codes match
-- the client's 1C setup. The trigger fires BEFORE INSERT OR UPDATE, so
-- the test asserts the format on insert and after field updates.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000401', 'supplier', 'T-CodeSupplier'),
  ('00000000-0000-0000-0000-000000000402', 'buyer',    'T-CodeBuyer');

DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id)
  VALUES (v_deal_id, 'KG', 6, 2026, 'январь',
          '00000000-0000-0000-0000-000000000401',
          '00000000-0000-0000-0000-000000000402');

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.deal_code <> 'KG/26/006' THEN
    RAISE EXCEPTION 'deal_code expected KG/26/006, got %', v_row.deal_code;
  END IF;

  -- Updating the deal_number should retrigger the format.
  UPDATE deals SET deal_number = 123 WHERE id = v_deal_id;
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.deal_code <> 'KG/26/123' THEN
    RAISE EXCEPTION 'after number update: deal_code expected KG/26/123, got %', v_row.deal_code;
  END IF;

  -- Year century strip: 2099 → 99, 2000 → 00.
  UPDATE deals SET year = 2099 WHERE id = v_deal_id;
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.deal_code <> 'KG/99/123' THEN
    RAISE EXCEPTION 'year 2099 → expected KG/99/123, got %', v_row.deal_code;
  END IF;

  UPDATE deals SET year = 2000 WHERE id = v_deal_id;
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.deal_code <> 'KG/00/123' THEN
    RAISE EXCEPTION 'year 2000 → expected KG/00/123, got %', v_row.deal_code;
  END IF;

  -- Triple-digit numbers must not overflow the padding.
  UPDATE deals SET deal_number = 1234 WHERE id = v_deal_id;
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.deal_code <> 'KG/00/1234' THEN
    RAISE EXCEPTION 'four-digit number → expected KG/00/1234, got %', v_row.deal_code;
  END IF;
END $$;

ROLLBACK;

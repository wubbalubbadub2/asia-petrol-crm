-- Test: audit_trigger logs every meaningful change (migration 00036)

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000301', 'supplier', 'T-AuditSupplier');

DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_count   INT;
  v_entry   audit_log%ROWTYPE;
BEGIN
  -- INSERT should create exactly one audit entry. We populate both
  -- volume and price so the derived-fields trigger (00021) has the
  -- inputs it needs — otherwise updating supplier_price later would
  -- not cascade to supplier_contracted_amount and the
  -- "derived fields also tracked" assertion below wouldn't fire.
  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id,
                     supplier_contracted_volume, supplier_price)
  VALUES (v_deal_id, 'KG', 9904, 2099, 'январь',
          '00000000-0000-0000-0000-000000000301',
          10, 10);

  SELECT COUNT(*) INTO v_count
  FROM audit_log WHERE table_name = 'deals' AND row_id = v_deal_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'INSERT: expected 1 audit entry, got %', v_count;
  END IF;

  SELECT * INTO v_entry
  FROM audit_log WHERE table_name = 'deals' AND row_id = v_deal_id LIMIT 1;
  IF v_entry.op <> 'INSERT' THEN
    RAISE EXCEPTION 'INSERT: op expected INSERT, got %', v_entry.op;
  END IF;

  -- A meaningful UPDATE should add one entry with changed_fields populated
  UPDATE deals SET supplier_price = 20 WHERE id = v_deal_id;

  SELECT COUNT(*) INTO v_count
  FROM audit_log WHERE table_name = 'deals' AND row_id = v_deal_id;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'UPDATE: expected 2 audit entries, got %', v_count;
  END IF;

  SELECT * INTO v_entry
  FROM audit_log
  WHERE table_name = 'deals' AND row_id = v_deal_id AND op = 'UPDATE';
  IF NOT ('supplier_price' = ANY (v_entry.changed_fields)) THEN
    RAISE EXCEPTION 'UPDATE: changed_fields should include supplier_price, got %', v_entry.changed_fields;
  END IF;
  -- Derived fields (supplier_contracted_amount) also changed — so they
  -- should appear in changed_fields too. Sanity check that the trigger
  -- captured more than just the literal update.
  IF array_length(v_entry.changed_fields, 1) < 2 THEN
    RAISE EXCEPTION 'UPDATE: expected derived fields also tracked, got %', v_entry.changed_fields;
  END IF;

  -- Trivial updated_at bump should NOT create a new entry
  UPDATE deals SET updated_at = now() WHERE id = v_deal_id;
  SELECT COUNT(*) INTO v_count
  FROM audit_log WHERE table_name = 'deals' AND row_id = v_deal_id;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'updated_at-only update should not log, got % entries', v_count;
  END IF;

  -- DELETE should log one more entry
  DELETE FROM deals WHERE id = v_deal_id;
  SELECT COUNT(*) INTO v_count
  FROM audit_log WHERE table_name = 'deals' AND row_id = v_deal_id;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'DELETE: expected 3 entries total, got %', v_count;
  END IF;

  SELECT * INTO v_entry
  FROM audit_log
  WHERE table_name = 'deals' AND row_id = v_deal_id AND op = 'DELETE';
  IF v_entry.old_row IS NULL OR v_entry.new_row IS NOT NULL THEN
    RAISE EXCEPTION 'DELETE: old_row should be set and new_row null';
  END IF;
END $$;

ROLLBACK;

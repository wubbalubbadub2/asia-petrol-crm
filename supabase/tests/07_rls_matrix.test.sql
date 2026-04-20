-- Test: RLS policies enforce the role matrix (mig 00010)
--
-- Matrix we expect to hold:
--   readonly  → SELECT only, no INSERT/UPDATE/DELETE on deals
--   manager   → SELECT + INSERT + UPDATE, no DELETE on deals
--   admin     → everything including DELETE
--
-- To simulate an authenticated user we set the request.jwt.claims
-- GUC (the same mechanism PostgREST uses) and the `authenticated`
-- role so policies evaluate `auth.uid()` correctly. Each case is in
-- its own DO block; failures RAISE EXCEPTION and abort the test.
--
-- Fixtures include rows in auth.users because profiles.id is a FK to
-- auth.users(id). We clean up via the outer ROLLBACK.
--
-- run.sh sets PGOPTIONS='-c row_security=off' so the rollup/trigger
-- tests can write as a superuser without tripping RLS. Flip it back
-- on here — the whole point of this file is to exercise the policies.

SET row_security = on;

BEGIN;

-- Three synthetic users, one per role.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        aud, role, instance_id, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-0000000000aa', 'rls-admin@test.local',    '', now(),
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000bb', 'rls-manager@test.local',  '', now(),
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000cc', 'rls-readonly@test.local', '', now(),
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Upsert profiles with explicit roles (the handle_new_user trigger may
-- have created them already with the default role).
INSERT INTO profiles (id, full_name, role) VALUES
  ('00000000-0000-0000-0000-0000000000aa', 'RLS Admin',    'admin'),
  ('00000000-0000-0000-0000-0000000000bb', 'RLS Manager',  'manager'),
  ('00000000-0000-0000-0000-0000000000cc', 'RLS Readonly', 'readonly')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Fixture counterparties so we have something to insert deals for.
INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000501', 'supplier', 'T-RLS-Supplier'),
  ('00000000-0000-0000-0000-000000000502', 'buyer',    'T-RLS-Buyer')
ON CONFLICT (id) DO NOTHING;

-- ── Admin: full access ───────────────────────────────────────────────
DO $$
DECLARE v_id UUID := gen_random_uuid();
BEGIN
  SET LOCAL role = authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id)
  VALUES (v_id, 'KG', 9910, 2099, 'январь',
          '00000000-0000-0000-0000-000000000501',
          '00000000-0000-0000-0000-000000000502');

  UPDATE deals SET buyer_ordered_volume = 10 WHERE id = v_id;

  DELETE FROM deals WHERE id = v_id;  -- admin-only

  RESET role;
END $$;

-- ── Manager: insert/update yes, delete no ────────────────────────────
DO $$
DECLARE
  v_id        UUID := gen_random_uuid();
  v_del_count INT;
BEGIN
  SET LOCAL role = authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id)
  VALUES (v_id, 'KG', 9911, 2099, 'январь',
          '00000000-0000-0000-0000-000000000501',
          '00000000-0000-0000-0000-000000000502');

  UPDATE deals SET buyer_ordered_volume = 20 WHERE id = v_id;

  -- Delete is gated by is_admin(); the statement succeeds but
  -- affects zero rows because the RLS USING clause filters them out.
  DELETE FROM deals WHERE id = v_id;
  GET DIAGNOSTICS v_del_count = ROW_COUNT;
  IF v_del_count <> 0 THEN
    RAISE EXCEPTION 'manager DELETE should be filtered to 0 rows, got %', v_del_count;
  END IF;

  RESET role;
END $$;

-- ── Readonly: select yes, insert/update/delete no ────────────────────
DO $$
DECLARE
  v_id          UUID := gen_random_uuid();
  v_insert_err  TEXT;
  v_upd_count   INT;
BEGIN
  SET LOCAL role = authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);

  -- INSERT: policy should reject with "new row violates row-level
  -- security policy". We catch the error string so the test passes
  -- only when the rejection actually fires.
  BEGIN
    INSERT INTO deals (id, deal_type, deal_number, year, month,
                       supplier_id, buyer_id)
    VALUES (v_id, 'KG', 9912, 2099, 'январь',
            '00000000-0000-0000-0000-000000000501',
            '00000000-0000-0000-0000-000000000502');
    v_insert_err := 'NO_ERROR';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_insert_err := 'BLOCKED';
  END;

  IF v_insert_err <> 'BLOCKED' THEN
    RAISE EXCEPTION 'readonly INSERT on deals should be blocked, got %', v_insert_err;
  END IF;

  -- UPDATE: should affect zero rows (USING clause filters).
  UPDATE deals SET buyer_ordered_volume = 99 WHERE deal_number = 9910;
  GET DIAGNOSTICS v_upd_count = ROW_COUNT;
  IF v_upd_count <> 0 THEN
    RAISE EXCEPTION 'readonly UPDATE should affect 0 rows, got %', v_upd_count;
  END IF;

  -- SELECT still works — readonly users must be able to read.
  PERFORM 1 FROM deals LIMIT 1;

  RESET role;
END $$;

-- ── Archive protection: manager cannot update is_archived deals ──────
-- Migration 00010 carves out an extra condition on deals UPDATE:
--   is_writable_role() AND (NOT is_archived OR is_admin())
-- so a manager can edit active deals but not archived ones. An admin
-- can edit anything.
DO $$
DECLARE
  v_id        UUID := gen_random_uuid();
  v_upd_count INT;
BEGIN
  -- Seed as admin (the SET LOCAL below doesn't escape this block).
  SET LOCAL role = authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id, is_archived)
  VALUES (v_id, 'KG', 9915, 2099, 'январь',
          '00000000-0000-0000-0000-000000000501',
          '00000000-0000-0000-0000-000000000502',
          true);

  -- Switch to manager.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

  UPDATE deals SET buyer_ordered_volume = 50 WHERE id = v_id;
  GET DIAGNOSTICS v_upd_count = ROW_COUNT;
  IF v_upd_count <> 0 THEN
    RAISE EXCEPTION 'manager UPDATE of archived deal should be filtered to 0 rows, got %', v_upd_count;
  END IF;

  -- Admin still can.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
  UPDATE deals SET buyer_ordered_volume = 50 WHERE id = v_id;
  GET DIAGNOSTICS v_upd_count = ROW_COUNT;
  IF v_upd_count <> 1 THEN
    RAISE EXCEPTION 'admin UPDATE of archived deal expected 1 row, got %', v_upd_count;
  END IF;

  RESET role;
END $$;

-- ── Known gap: archive protection doesn't cascade to child rows ───────
-- The `writable_update_deals` policy forbids UPDATEs to archived deals
-- (unless admin), but child tables (deal_payments, shipment_registry,
-- deal_shipment_prices, dt_kt_logistics, deal_attachments, …) only
-- check is_writable_role(). A manager therefore can still INSERT new
-- shipments or payments into an archived deal and the totals will
-- recompute as if it were active.
--
-- This assertion *documents* the current behaviour so anyone widening
-- the policies knows the test has to flip accordingly. The fix lives
-- in a future migration outside the audit scope — it needs to walk
-- each child policy and add an EXISTS check against the parent deal's
-- is_archived column.
DO $$
DECLARE
  v_deal_id   UUID := gen_random_uuid();
  v_ins_count INT;
BEGIN
  -- Admin seeds an archived deal.
  SET LOCAL role = authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id, is_archived)
  VALUES (v_deal_id, 'KG', 9916, 2099, 'январь',
          '00000000-0000-0000-0000-000000000501',
          '00000000-0000-0000-0000-000000000502',
          true);

  -- Manager now adds a payment to the archived deal. If the gap has
  -- been closed in a future migration this will start failing with
  -- `check_violation`; flip the assertion then.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

  INSERT INTO deal_payments (deal_id, side, amount, payment_date)
  VALUES (v_deal_id, 'buyer', 1, '2099-01-10');

  SELECT COUNT(*) FROM deal_payments WHERE deal_id = v_deal_id
    INTO v_ins_count;
  IF v_ins_count <> 1 THEN
    RAISE EXCEPTION
      'archive cascade closed? manager INSERT on deal_payments for archived deal should succeed under current policies, got % rows',
      v_ins_count;
  END IF;

  RESET role;
END $$;

ROLLBACK;

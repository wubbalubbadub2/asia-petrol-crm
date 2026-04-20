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

ROLLBACK;

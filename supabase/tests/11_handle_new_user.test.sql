-- Test: handle_new_user auto-provisions profiles on auth.users insert (mig 00001)
--
-- Supabase fires this trigger after a signup. The function should:
--   1. Always create a matching profiles row with the same id.
--   2. Prefer raw_user_meta_data.full_name, fall back to email.
--   3. Prefer raw_user_meta_data.role, default to 'readonly'.
--
-- Known pitfall: a malformed `role` meta string (e.g. "admini") makes
-- the ::user_role cast raise and the whole auth.users insert fail —
-- i.e. a bad role kills the signup. This test documents the current
-- behaviour with a BEGIN / EXCEPTION block so a future migration that
-- swaps in a safe fallback can flip the assertion.

BEGIN;

DO $$
DECLARE
  v_id1 UUID := gen_random_uuid();
  v_id2 UUID := gen_random_uuid();
  v_id3 UUID := gen_random_uuid();
  v_role     TEXT;
  v_name     TEXT;
  v_bad_caught BOOLEAN := false;
BEGIN
  -- Case A: signup with both full_name and role in metadata.
  INSERT INTO auth.users (id, email, aud, role, instance_id,
                          raw_user_meta_data)
  VALUES (v_id1, 'a@test.local', 'authenticated', 'authenticated',
          '00000000-0000-0000-0000-000000000000',
          '{"full_name":"Анна Управленец","role":"manager"}'::jsonb);

  SELECT role::TEXT, full_name INTO v_role, v_name
    FROM profiles WHERE id = v_id1;
  IF v_role <> 'manager' THEN
    RAISE EXCEPTION 'case A: expected role=manager, got %', v_role;
  END IF;
  IF v_name <> 'Анна Управленец' THEN
    RAISE EXCEPTION 'case A: expected full_name from meta, got %', v_name;
  END IF;

  -- Case B: signup with no metadata → defaults to 'readonly' + email-as-name.
  INSERT INTO auth.users (id, email, aud, role, instance_id,
                          raw_user_meta_data)
  VALUES (v_id2, 'b@test.local', 'authenticated', 'authenticated',
          '00000000-0000-0000-0000-000000000000',
          '{}'::jsonb);

  SELECT role::TEXT, full_name INTO v_role, v_name
    FROM profiles WHERE id = v_id2;
  IF v_role <> 'readonly' THEN
    RAISE EXCEPTION 'case B: expected default role=readonly, got %', v_role;
  END IF;
  IF v_name <> 'b@test.local' THEN
    RAISE EXCEPTION 'case B: expected fallback full_name=email, got %', v_name;
  END IF;

  -- Case C: signup with a malformed role string. Current behaviour —
  -- the ::user_role cast inside handle_new_user raises, which aborts
  -- the auth.users insert. Catching the exception here locks the
  -- state so a future safer-fallback migration forces the test update.
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, instance_id,
                            raw_user_meta_data)
    VALUES (v_id3, 'c@test.local', 'authenticated', 'authenticated',
            '00000000-0000-0000-0000-000000000000',
            '{"role":"admini"}'::jsonb);   -- typo
  EXCEPTION WHEN invalid_text_representation THEN
    v_bad_caught := true;
  END;

  IF NOT v_bad_caught THEN
    RAISE EXCEPTION 'case C: malformed role string should have aborted the signup under current trigger, but it succeeded — safe-fallback landed?';
  END IF;

  -- And the aborted signup left no profile.
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_id3) THEN
    RAISE EXCEPTION 'case C: bad-role insert aborted but a profile was created — trigger semantics changed';
  END IF;
END $$;

ROLLBACK;

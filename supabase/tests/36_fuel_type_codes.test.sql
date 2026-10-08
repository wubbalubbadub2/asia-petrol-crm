-- Test: «Коды по видам ГСМ» (00182) — несколько строк на вид ГСМ по % серы.

BEGIN;

INSERT INTO fuel_types (id, name) VALUES
  ('00000000-0000-0000-0000-0000000e0a01', 'T-FTC Мазут'),
  ('00000000-0000-0000-0000-0000000e0a02', 'T-FTC ДТ');

DO $$
DECLARE
  f_mazut CONSTANT UUID := '00000000-0000-0000-0000-0000000e0a01';
  f_dt    CONSTANT UUID := '00000000-0000-0000-0000-0000000e0a02';
  v_ok    BOOLEAN;
  v_n     INT;
BEGIN
  -- 1. У одного вида — несколько строк по сере; без серы — одна.
  INSERT INTO fuel_type_codes (fuel_type_id, sulfur_percent, gng_code, tnved_code) VALUES
    (f_mazut, 1.0, '27101966', '2710196201'),
    (f_mazut, 1.5, '27101967', '2710196201'),
    (f_dt,    NULL, '27101943', NULL);
  SELECT count(*) INTO v_n FROM fuel_type_codes WHERE fuel_type_id = f_mazut;
  IF v_n <> 2 THEN RAISE EXCEPTION 'ждали 2 строки мазута, есть %', v_n; END IF;

  -- 2. Дубль «вид + сера» — нельзя; второй «без серы» — тоже.
  v_ok := FALSE;
  BEGIN INSERT INTO fuel_type_codes (fuel_type_id, sulfur_percent, gng_code) VALUES (f_mazut, 1.0, 'x');
  EXCEPTION WHEN unique_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'сохранился дубль вид + сера'; END IF;
  v_ok := FALSE;
  BEGIN INSERT INTO fuel_type_codes (fuel_type_id, sulfur_percent, gng_code) VALUES (f_dt, NULL, 'y');
  EXCEPTION WHEN unique_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'сохранился второй «без серы» для одного вида'; END IF;

  -- 3. Пустая строка без кодов и сера вне 0..100 — нельзя.
  v_ok := FALSE;
  BEGIN INSERT INTO fuel_type_codes (fuel_type_id, sulfur_percent) VALUES (f_dt, 0.5);
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'сохранилась строка без кодов'; END IF;
  v_ok := FALSE;
  BEGIN INSERT INTO fuel_type_codes (fuel_type_id, sulfur_percent, gng_code) VALUES (f_dt, 150, 'z');
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'сохранилась сера 150%%'; END IF;

  -- 4. Удаление вида ГСМ уносит его коды; аудит пишется.
  DELETE FROM fuel_types WHERE id = f_dt;
  SELECT count(*) INTO v_n FROM fuel_type_codes WHERE fuel_type_id = f_dt;
  IF v_n <> 0 THEN RAISE EXCEPTION 'коды удалённого вида остались'; END IF;
  SELECT count(*) INTO v_n FROM audit_log WHERE table_name = 'fuel_type_codes';
  IF v_n < 3 THEN RAISE EXCEPTION 'audit_log: ждали ≥3 записи, есть %', v_n; END IF;

  RAISE NOTICE 'OK: коды по видам ГСМ — строки по сере, уникальность, проверки, каскад, аудит';
END $$;

-- 5. RLS — как у справочников; проверяем сами политики (в CI хелперы заглушены).
DO $$
DECLARE r RECORD; v_n INT := 0;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'fuel_type_codes'::regclass) THEN
    RAISE EXCEPTION 'RLS: на fuel_type_codes не включён';
  END IF;
  FOR r IN SELECT cmd, coalesce(qual, '') AS q, coalesce(with_check, '') AS w
             FROM pg_policies WHERE tablename = 'fuel_type_codes' LOOP
    v_n := v_n + 1;
    IF r.cmd = 'SELECT' AND r.q NOT LIKE '%auth.uid() IS NOT NULL%' THEN RAISE EXCEPTION 'RLS SELECT: %', r.q;
    ELSIF r.cmd = 'INSERT' AND r.w NOT LIKE '%is_writable_role()%' THEN RAISE EXCEPTION 'RLS INSERT: %', r.w;
    ELSIF r.cmd = 'UPDATE' AND (r.q NOT LIKE '%is_writable_role()%' OR r.w NOT LIKE '%is_writable_role()%') THEN RAISE EXCEPTION 'RLS UPDATE: % / %', r.q, r.w;
    ELSIF r.cmd = 'DELETE' AND r.q NOT LIKE '%is_admin()%' THEN RAISE EXCEPTION 'RLS DELETE: %', r.q;
    ELSIF r.cmd = 'ALL' THEN RAISE EXCEPTION 'RLS: политика FOR ALL не ожидалась';
    END IF;
  END LOOP;
  IF v_n <> 4 THEN RAISE EXCEPTION 'RLS: ждали 4 политики, есть %', v_n; END IF;
  RAISE NOTICE 'OK: RLS кодов по видам ГСМ';
END $$;

ROLLBACK;

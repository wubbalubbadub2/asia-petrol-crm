-- Test: представления фискального реестра (migration 00139)
--
-- Правила, которые проверяем:
--   1. fiscal_rejected_document — РОВНО семь колонок и именно те.
--      Это главный предохранитель: представление намеренно обходит RLS
--      базовой integration_1c_payload, и любое случайное расширение
--      списка вынесет наружу договорные и персональные данные из
--      сырого payload;
--   2. в нём нет полей, которых там быть не должно (проверяем поимённо,
--      чтобы падение объясняло себя, а не только меняло счёт);
--   3. гранты: authenticated читает, anon — нет. Именно гранты, а не
--      политики: у представлений RLS не бывает;
--   4. базовая integration_1c_payload при этом закрыта от обоих;
--   5. fiscal_rejected_document отдаёт только отклонённые;
--   6. fiscal_counterparty схлопывает БИН в одну строку и берёт самое
--      частое написание, а при равном счёте — первое по алфавиту;
--   7. fiscal_counterparty исполняется с правами вызывающего
--      (security_invoker), то есть RLS базовой таблицы жива.

BEGIN;

-- 1 + 2. Состав колонок -----------------------------------------------
DO $$
DECLARE
  v_count    INT;
  v_expected TEXT[] := ARRAY[
    'currency_code', 'doc_kind', 'operation_kind_code', 'registration_date',
    'registration_number', 'reject_reason', 'total_amount'
  ];
  v_actual   TEXT[];
  v_extra    TEXT[];
BEGIN
  SELECT count(*), array_agg(column_name ORDER BY column_name)
    INTO v_count, v_actual
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'fiscal_rejected_document';

  IF v_count <> 7 THEN
    RAISE EXCEPTION 'fiscal_rejected_document должно иметь ровно 7 колонок, найдено %: %',
      v_count, array_to_string(v_actual, ', ');
  END IF;

  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'состав колонок изменился. ожидали [%], получили [%]',
      array_to_string(v_expected, ', '), array_to_string(v_actual, ', ');
  END IF;

  -- Поимённо то, что из payload наружу выходить не должно ни при каких
  -- правках. Список не исчерпывающий — он ловит самые чувствительные.
  SELECT array_agg(c) INTO v_extra
    FROM unnest(ARRAY['payload', 'counterparty_name', 'own_party_name',
                      'file_base_ref', 'ingest_run_id', 'direction_code']) AS c
   WHERE c = ANY(v_actual);
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'в fiscal_rejected_document просочились запрещённые колонки: %',
      array_to_string(v_extra, ', ');
  END IF;
END $$;

-- 3. Гранты на представление отклонённых -------------------------------
DO $$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.fiscal_rejected_document', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated должен читать fiscal_rejected_document — иначе предупреждение о недогруженных документах увидит только админ';
  END IF;
  IF has_table_privilege('anon', 'public.fiscal_rejected_document', 'SELECT') THEN
    RAISE EXCEPTION 'anon НЕ должен читать fiscal_rejected_document: анонимный ключ лежит в клиентском бандле';
  END IF;
  -- Запись через представление не нужна никому.
  IF has_table_privilege('authenticated', 'public.fiscal_rejected_document', 'INSERT')
     OR has_table_privilege('authenticated', 'public.fiscal_rejected_document', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.fiscal_rejected_document', 'DELETE') THEN
    RAISE EXCEPTION 'fiscal_rejected_document должно быть только для чтения';
  END IF;

  -- То же для справочника контрагентов: там RLS базовой таблицы жива
  -- (security_invoker), но дефолтный грант anon снимать всё равно надо —
  -- рубежей должно быть два.
  IF has_table_privilege('anon', 'public.fiscal_counterparty', 'SELECT') THEN
    RAISE EXCEPTION 'anon НЕ должен читать fiscal_counterparty';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.fiscal_counterparty', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated должен читать fiscal_counterparty';
  END IF;
END $$;

-- 4. Матрица прав на базовых таблицах ----------------------------------
-- Supabase раздаёт гранты на новые таблицы схемы public через
-- ALTER DEFAULT PRIVILEGES, поэтому одних политик RLS мало: без явного
-- REVOKE у anon остаётся право обратиться к таблице, и вся защита
-- держится на единственном рубеже. Здесь проверяется, что рубежа два.
DO $$
DECLARE
  v_table TEXT;
  v_priv  TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['integration_1c_payload', 'fiscal_document', 'fiscal_document_line'] LOOP
    -- RLS включён.
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_table)::regclass) THEN
      RAISE EXCEPTION 'на % должен быть включён RLS', v_table;
    END IF;

    -- anon не может вообще ничего: ключ лежит в клиентском бандле.
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege('anon', 'public.' || v_table, v_priv) THEN
        RAISE EXCEPTION 'anon не должен иметь грант % на %', v_priv, v_table;
      END IF;
    END LOOP;

    -- authenticated читает (дальше сужает RLS), но не пишет: писать
    -- может только загрузчик под service_role.
    IF NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated должен иметь SELECT на %', v_table;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege('authenticated', 'public.' || v_table, v_priv) THEN
        RAISE EXCEPTION 'authenticated не должен иметь грант % на %', v_priv, v_table;
      END IF;
    END LOOP;

    -- Загрузчик не должен пострадать от REVOKE.
    IF NOT has_table_privilege('service_role', 'public.' || v_table, 'INSERT') THEN
      RAISE EXCEPTION 'service_role потерял право записи в % — загрузчик сломается', v_table;
    END IF;
  END LOOP;
END $$;

-- 5 + 6. Поведение представлений на фикстурах --------------------------
DO $$
DECLARE
  v_rejected INT;
  v_leaked   INT;
  v_name     TEXT;
  v_variants INT;
  v_rows     INT;
BEGIN
  INSERT INTO integration_1c_payload
    (content_sha256, payload, source_org_code, doc_kind, registration_number,
     ingest_status, reject_reason)
  VALUES
    ('sha-view-rej-1',
     jsonb_build_object('operation_kind_code', 'Ввоз',
                        'registration_date', '2023-11-12T14:29:35',
                        'total_amount', 173505896,
                        'currency_code', 'KZT',
                        'counterparty_name', 'ООО "СЕКРЕТНЫЙ КОНТРАГЕНТ"'),
     NULL, 'snt', 'KZ-SNT-VIEW-REJ-1', 'rejected', 'no_own_identifier'),
    ('sha-view-acc-1', '{"total_amount": 1}'::jsonb, '200240037215', 'snt',
     'KZ-SNT-VIEW-ACC-1', 'accepted', NULL);

  SELECT count(*) INTO v_rejected FROM fiscal_rejected_document
   WHERE registration_number = 'KZ-SNT-VIEW-REJ-1';
  IF v_rejected <> 1 THEN
    RAISE EXCEPTION 'отклонённый документ не виден в представлении';
  END IF;

  SELECT count(*) INTO v_leaked FROM fiscal_rejected_document
   WHERE registration_number = 'KZ-SNT-VIEW-ACC-1';
  IF v_leaked <> 0 THEN
    RAISE EXCEPTION 'принятый документ не должен попадать в fiscal_rejected_document';
  END IF;

  -- Разбор payload: суммы и даты должны приезжать типизированными.
  PERFORM 1 FROM fiscal_rejected_document
   WHERE registration_number = 'KZ-SNT-VIEW-REJ-1'
     AND operation_kind_code = 'Ввоз'
     AND registration_date = '2023-11-12T14:29:35'::timestamp
     AND total_amount = 173505896
     AND currency_code = 'KZT'
     AND reject_reason = 'no_own_identifier';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'значения из payload разобраны неверно';
  END IF;

  -- Каноническое имя: 3 документа под «Б», 2 под «А» → канон «Б».
  INSERT INTO fiscal_document
    (source_org_code, doc_kind, registration_number, registration_date,
     direction_code, doc_type_code, status_code, state_code, currency_code,
     fx_rate, counterparty_identifier, counterparty_name)
  VALUES
    ('200240037215', 'snt', 'VIEW-CP-1', '2025-01-01', 'Входящий', 'Первичная',
     'Подтвержден', 'ПодтвержденПолучателем', 'KZT', 1, '111111111111', 'Б-написание'),
    ('200240037215', 'snt', 'VIEW-CP-2', '2025-01-02', 'Входящий', 'Первичная',
     'Подтвержден', 'ПодтвержденПолучателем', 'KZT', 1, '111111111111', 'Б-написание'),
    ('200240037215', 'snt', 'VIEW-CP-3', '2025-01-03', 'Входящий', 'Первичная',
     'Подтвержден', 'ПодтвержденПолучателем', 'KZT', 1, '111111111111', 'Б-написание'),
    ('200240037215', 'snt', 'VIEW-CP-4', '2025-01-04', 'Входящий', 'Первичная',
     'Подтвержден', 'ПодтвержденПолучателем', 'KZT', 1, '111111111111', 'А-написание'),
    ('200240037215', 'snt', 'VIEW-CP-5', '2025-01-05', 'Входящий', 'Первичная',
     'Подтвержден', 'ПодтвержденПолучателем', 'KZT', 1, '111111111111', 'А-написание');

  SELECT count(*) INTO v_rows FROM fiscal_counterparty
   WHERE counterparty_identifier = '111111111111';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'на один БИН должна приходиться одна строка, получили %', v_rows;
  END IF;

  SELECT canonical_name, name_variants INTO v_name, v_variants
    FROM fiscal_counterparty WHERE counterparty_identifier = '111111111111';
  IF v_name <> 'Б-написание' THEN
    RAISE EXCEPTION 'каноническим должно быть самое частое написание, получили %', v_name;
  END IF;
  IF v_variants <> 2 THEN
    RAISE EXCEPTION 'ожидали 2 варианта написания, получили %', v_variants;
  END IF;

  -- Равный счёт → первое по алфавиту, иначе имя прыгало бы от запроса
  -- к запросу.
  INSERT INTO fiscal_document
    (source_org_code, doc_kind, registration_number, registration_date,
     direction_code, doc_type_code, status_code, state_code, currency_code,
     fx_rate, counterparty_identifier, counterparty_name)
  VALUES
    ('200240037215', 'snt', 'VIEW-CP-6', '2025-01-06', 'Входящий', 'Первичная',
     'Подтвержден', 'ПодтвержденПолучателем', 'KZT', 1, '222222222222', 'Яблоко'),
    ('200240037215', 'snt', 'VIEW-CP-7', '2025-01-07', 'Входящий', 'Первичная',
     'Подтвержден', 'ПодтвержденПолучателем', 'KZT', 1, '222222222222', 'Арбуз');

  SELECT canonical_name INTO v_name
    FROM fiscal_counterparty WHERE counterparty_identifier = '222222222222';
  IF v_name <> 'Арбуз' THEN
    RAISE EXCEPTION 'при равном счёте канон берётся по алфавиту, ожидали «Арбуз», получили %', v_name;
  END IF;
END $$;

-- 7. fiscal_counterparty уважает RLS базовой таблицы -------------------
DO $$
DECLARE v_invoker TEXT;
BEGIN
  SELECT COALESCE((
    SELECT option_value FROM pg_options_to_table(c.reloptions)
     WHERE option_name = 'security_invoker'
  ), 'false')
    INTO v_invoker
    FROM pg_class c WHERE c.oid = 'public.fiscal_counterparty'::regclass;

  IF v_invoker <> 'true' THEN
    RAISE EXCEPTION 'fiscal_counterparty должно быть security_invoker = true, иначе имена контрагентов уедут мимо RLS (сейчас %)', v_invoker;
  END IF;
END $$;

-- Обратная проверка: у окна сквозь RLS этого флага быть НЕ должно,
-- иначе представление перестанет выполнять свою задачу.
DO $$
DECLARE v_invoker TEXT;
BEGIN
  SELECT COALESCE((
    SELECT option_value FROM pg_options_to_table(c.reloptions)
     WHERE option_name = 'security_invoker'
  ), 'false')
    INTO v_invoker
    FROM pg_class c WHERE c.oid = 'public.fiscal_rejected_document'::regclass;

  IF v_invoker = 'true' THEN
    RAISE EXCEPTION 'fiscal_rejected_document с security_invoker = true вернёт пустоту всем, кроме админов — предупреждение перестанет работать';
  END IF;
END $$;

SELECT '09_fiscal_views: OK' AS result;

ROLLBACK;

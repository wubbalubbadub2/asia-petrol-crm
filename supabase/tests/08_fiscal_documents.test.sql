-- Test: фискальные документы 1С (migration 00138)
--
-- Правила, которые проверяем:
--   1. is_void вычисляется из state_code ∈ {Аннулирован, Отозван},
--      и «АннулированПриОтзывеСНТ» в это множество НЕ входит;
--   2. is_void нельзя записать вручную — это вычисляемая колонка;
--   3. ключ документа — (source_org_code, doc_kind, registration_number):
--      тот же номер у другого вида или другой организации допустим;
--   4. ключ строки — (document_id, line_no); ДУБЛИ snt_line_no внутри
--      документа ДОПУСТИМЫ (боевой СНТ с 88 строками и двумя позициями);
--   5. незнакомое направление отбивается CHECK'ом;
--   6. landing требует причину ровно у отклонённых;
--   7. удаление документа уносит его строки.

BEGIN;

DO $$
DECLARE
  v_payload UUID := gen_random_uuid();
  v_doc     UUID := gen_random_uuid();
  v_other   UUID;
  v_void    BOOLEAN;
  v_count   INT;
  v_state   TEXT;
BEGIN
  INSERT INTO integration_1c_payload
    (id, content_sha256, payload, source_org_code, doc_kind,
     registration_number, ingest_status)
  VALUES
    (v_payload, 'sha-test-0001', '{"doc_kind":"snt"}'::jsonb, '200240037215',
     'snt', 'KZ-SNT-TEST-0001', 'accepted');

  -- 1. is_void из state_code ------------------------------------------
  INSERT INTO fiscal_document
    (id, payload_id, source_org_code, doc_kind, registration_number,
     registration_date, direction_code, doc_type_code, status_code,
     state_code, currency_code, fx_rate)
  VALUES
    (v_doc, v_payload, '200240037215', 'snt', 'KZ-SNT-TEST-0001',
     '2025-12-21T13:57:10', 'Исходящий', 'Первичная', 'Отозванный',
     'Отозван', 'KZT', 1);

  SELECT is_void INTO v_void FROM fiscal_document WHERE id = v_doc;
  IF v_void IS NOT TRUE THEN
    RAISE EXCEPTION 'state_code «Отозван» должен давать is_void = true, получили %', v_void;
  END IF;

  UPDATE fiscal_document SET state_code = 'ПодтвержденПолучателем' WHERE id = v_doc;
  SELECT is_void INTO v_void FROM fiscal_document WHERE id = v_doc;
  IF v_void IS NOT FALSE THEN
    RAISE EXCEPTION 'подтверждённый документ не может быть is_void = %', v_void;
  END IF;

  -- «Аннулирован при отзыве СНТ» — отдельное состояние, в множество
  -- аннулированных не входит: источник отдаёт по нему is_void = false.
  UPDATE fiscal_document SET state_code = 'АннулированПриОтзывеСНТ' WHERE id = v_doc;
  SELECT is_void INTO v_void FROM fiscal_document WHERE id = v_doc;
  IF v_void IS NOT FALSE THEN
    RAISE EXCEPTION 'АннулированПриОтзывеСНТ не должно давать is_void = true';
  END IF;

  UPDATE fiscal_document SET state_code = 'Аннулирован' WHERE id = v_doc;
  SELECT is_void INTO v_void FROM fiscal_document WHERE id = v_doc;
  IF v_void IS NOT TRUE THEN
    RAISE EXCEPTION 'state_code «Аннулирован» должен давать is_void = true';
  END IF;

  -- 2. is_void не записывается вручную --------------------------------
  -- 428C9 = generated_always. Ловим по коду и печатаем фактический,
  -- чтобы при неожиданной ошибке было видно, какая именно случилась.
  v_state := NULL;
  BEGIN
    EXECUTE 'UPDATE fiscal_document SET is_void = false WHERE id = $1' USING v_doc;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '428C9' THEN
    RAISE EXCEPTION 'is_void должна быть невписываемой (ожидали SQLSTATE 428C9, получили %)',
      COALESCE(v_state, 'запись прошла');
  END IF;

  -- 3. Ключ документа --------------------------------------------------
  BEGIN
    INSERT INTO fiscal_document
      (source_org_code, doc_kind, registration_number, registration_date,
       direction_code, doc_type_code, status_code, state_code, currency_code, fx_rate)
    VALUES
      ('200240037215', 'snt', 'KZ-SNT-TEST-0001', '2025-12-22T10:00:00',
       'Исходящий', 'Первичная', 'Подтвержден', 'ПодтвержденПолучателем', 'KZT', 1);
    RAISE EXCEPTION 'дубль (организация, вид, рег. номер) должен отбиваться';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- Тот же номер у другого вида и у другой организации — разные документы.
  INSERT INTO fiscal_document
    (source_org_code, doc_kind, registration_number, registration_date,
     direction_code, doc_type_code, status_code, state_code, currency_code, fx_rate)
  VALUES
    ('200240037215', 'esf', 'KZ-SNT-TEST-0001', '2025-12-22T10:00:00',
     'Исходящий', 'Обычный', 'Доставленный', 'ПринятОтПоставщика', 'KZT', 1),
    ('990740000683', 'snt', 'KZ-SNT-TEST-0001', '2025-12-22T10:00:00',
     'Исходящий', 'Первичная', 'Подтвержден', 'ПодтвержденПолучателем', 'KZT', 1);

  -- 4. Ключ строки и дубли snt_line_no ---------------------------------
  -- Боевой случай: одна позиция бланка разложена по партиям
  -- виртуального склада, поэтому snt_line_no повторяется.
  INSERT INTO fiscal_document_line
    (document_id, table_name, line_no, snt_line_no, quantity, unit, net_weight, source_lot_id)
  VALUES
    (v_doc, 'ДанныеПоНефтепродуктам', 1, 1, 94.912, 'т', 0,     '480930131'),
    (v_doc, 'ДанныеПоНефтепродуктам', 2, 1, 0.8,    'т', 0,     '481890338'),
    (v_doc, 'ДанныеПоНефтепродуктам', 3, 2, 0.281,  'т', 59744, '494332651');

  SELECT count(*) INTO v_count FROM fiscal_document_line WHERE document_id = v_doc;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'дубли snt_line_no внутри документа должны допускаться, вставилось % строк', v_count;
  END IF;

  SELECT count(DISTINCT snt_line_no) INTO v_count
    FROM fiscal_document_line WHERE document_id = v_doc;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'ожидали 2 позиции бланка, получили %', v_count;
  END IF;

  BEGIN
    INSERT INTO fiscal_document_line (document_id, table_name, line_no, snt_line_no)
    VALUES (v_doc, 'ДанныеПоНефтепродуктам', 1, 5);
    RAISE EXCEPTION 'дубль (document_id, line_no) должен отбиваться';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- Единицы не сверяются: 0.281 т и 59744 кг на одной строке — норма.
  SELECT count(*) INTO v_count
    FROM fiscal_document_line
   WHERE document_id = v_doc AND quantity = 0.281 AND net_weight = 59744;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'quantity и net_weight должны храниться независимо';
  END IF;

  -- 5. Направление -----------------------------------------------------
  BEGIN
    INSERT INTO fiscal_document
      (source_org_code, doc_kind, registration_number, registration_date,
       direction_code, doc_type_code, status_code, state_code, currency_code, fx_rate)
    VALUES
      ('200240037215', 'snt', 'KZ-SNT-TEST-0002', '2025-12-22T10:00:00',
       'Входящая', 'Первичная', 'Подтвержден', 'ПодтвержденПолучателем', 'KZT', 1);
    RAISE EXCEPTION 'женский род направления должен отбиваться CHECK''ом';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- 6. Landing: причина обязательна ровно у отклонённых -----------------
  BEGIN
    INSERT INTO integration_1c_payload (content_sha256, payload, ingest_status)
    VALUES ('sha-test-0002', '{}'::jsonb, 'rejected');
    RAISE EXCEPTION 'отклонённый документ обязан нести причину';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO integration_1c_payload (content_sha256, payload, ingest_status, reject_reason)
    VALUES ('sha-test-0003', '{}'::jsonb, 'accepted', 'no_own_identifier');
    RAISE EXCEPTION 'у принятого документа причины отклонения быть не должно';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO integration_1c_payload (content_sha256, payload, ingest_status, reject_reason)
  VALUES ('sha-test-0004', '{}'::jsonb, 'rejected', 'no_own_identifier');

  -- Повторная выгрузка того же содержимого новой строки не создаёт.
  BEGIN
    INSERT INTO integration_1c_payload (content_sha256, payload, ingest_status)
    VALUES ('sha-test-0001', '{"doc_kind":"snt"}'::jsonb, 'accepted');
    RAISE EXCEPTION 'дедуп по content_sha256 не сработал';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- 7. Каскад ----------------------------------------------------------
  SELECT id INTO v_other FROM fiscal_document
   WHERE source_org_code = '990740000683' AND doc_kind = 'snt';
  DELETE FROM fiscal_document WHERE id = v_doc;
  SELECT count(*) INTO v_count FROM fiscal_document_line WHERE document_id = v_doc;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'строки удалённого документа должны уходить каскадом, осталось %', v_count;
  END IF;
  IF v_other IS NULL THEN
    RAISE EXCEPTION 'документ другой организации не должен был пострадать';
  END IF;

  RAISE NOTICE '08_fiscal_documents: OK';
END $$;

-- Дублируем результат строкой: SQL-редактор Supabase показывает только
-- результаты запросов и ошибки, NOTICE в нём не виден. В psql лишняя
-- строка тоже не мешает.
SELECT '08_fiscal_documents: OK' AS result;

ROLLBACK;

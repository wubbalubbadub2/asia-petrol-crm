-- Test: заявки на перевозку (00153).
--
-- Проверяется то, что нельзя увидеть глазами в миграции: нумерация по
-- годам не сбивается и не повторяется, у компании не может быть двух
-- активных бланков одновременно, маршрут удаляется вместе со своими
-- станциями, а одна и та же станция может стоять в маршруте дважды —
-- в образце «Турксиб-эксп.» встречается два раза под разными кодами.

BEGIN;

INSERT INTO company_groups (id, name) VALUES
  ('00000000-0000-0000-0000-0000000ac001', 'T-REQ ОРТ'),
  ('00000000-0000-0000-0000-0000000ac002', 'T-REQ Вторая компания');

INSERT INTO stations (id, name, code, type) VALUES
  ('00000000-0000-0000-0000-0000000ac101', 'T-REQ Темир',        '660308', 'departure'),
  ('00000000-0000-0000-0000-0000000ac102', 'T-REQ Турксиб-эксп.', '704402', 'both'),
  ('00000000-0000-0000-0000-0000000ac103', 'T-REQ Карабалта',    '715905', 'destination');

DO $$
DECLARE
  v_req_a  UUID;
  v_req_b  UUID;
  v_req_c  UUID;
  v_route  UUID := gen_random_uuid();
  v_num    INT;
  v_year   INT;
  v_cnt    INT;
  v_printed TEXT;
BEGIN
  -- ── 1. Номер выдаётся сам и растёт внутри года ─────────────────────
  INSERT INTO transport_requests (date, company_group_id)
  VALUES ('2026-03-27', '00000000-0000-0000-0000-0000000ac001')
  RETURNING id, request_number, request_year INTO v_req_a, v_num, v_year;

  IF v_num IS DISTINCT FROM 1 OR v_year IS DISTINCT FROM 2026 THEN
    RAISE EXCEPTION '1. первая заявка 2026 должна быть № 1 за 2026, получили № % за %', v_num, v_year;
  END IF;

  INSERT INTO transport_requests (date, company_group_id)
  VALUES ('2026-04-02', '00000000-0000-0000-0000-0000000ac002')
  RETURNING id, request_number INTO v_req_b, v_num;

  IF v_num IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION '2. вторая заявка 2026 должна быть № 2, получили %', v_num;
  END IF;

  -- ── 2. У каждого года свой счётчик ─────────────────────────────────
  -- Иначе заявки прошлого года продолжали бы нумерацию текущего и
  -- номер перестал бы что-либо значить.
  INSERT INTO transport_requests (date, company_group_id)
  VALUES ('2025-12-31', '00000000-0000-0000-0000-0000000ac001')
  RETURNING id, request_number, request_year INTO v_req_c, v_num, v_year;

  IF v_num IS DISTINCT FROM 1 OR v_year IS DISTINCT FROM 2025 THEN
    RAISE EXCEPTION '3. заявка 2025 должна быть № 1 за 2025, получили № % за %', v_num, v_year;
  END IF;

  -- ── 3. Номер не переписывается при правке даты ─────────────────────
  -- Заявку уже отправили под этим номером; смена даты составления не
  -- должна её переименовывать.
  UPDATE transport_requests SET date = '2026-05-15' WHERE id = v_req_a;
  SELECT request_number, request_year INTO v_num, v_year
    FROM transport_requests WHERE id = v_req_a;
  IF v_num IS DISTINCT FROM 1 OR v_year IS DISTINCT FROM 2026 THEN
    RAISE EXCEPTION '4. номер не должен меняться при правке даты, стало № % за %', v_num, v_year;
  END IF;

  -- ── 4. Черновик по умолчанию, чужой статус не принимается ──────────
  SELECT COUNT(*) INTO v_cnt FROM transport_requests
   WHERE id = v_req_a AND status = 'draft';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '5. заявка должна создаваться черновиком';
  END IF;

  BEGIN
    UPDATE transport_requests SET status = 'отправлена' WHERE id = v_req_a;
    RAISE EXCEPTION '6. status принял значение вне списка';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE transport_requests SET cargo_purpose = 'transit' WHERE id = v_req_a;
    RAISE EXCEPTION '7. cargo_purpose принял значение вне списка';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── 5. Маршрут: одна станция может встречаться дважды ──────────────
  INSERT INTO transport_routes (id, name) VALUES (v_route, 'T-REQ Темир — Карабалта');
  INSERT INTO transport_route_stations (route_id, station_id, position) VALUES
    (v_route, '00000000-0000-0000-0000-0000000ac101', 1),
    (v_route, '00000000-0000-0000-0000-0000000ac102', 2),
    (v_route, '00000000-0000-0000-0000-0000000ac102', 3),
    (v_route, '00000000-0000-0000-0000-0000000ac103', 4);

  -- Печатная строка собирается из справочника станций, а не хранится.
  SELECT string_agg(s.name || ' (' || s.code || ')', ' — ' ORDER BY rs.position)
    INTO v_printed
    FROM transport_route_stations rs
    JOIN stations s ON s.id = rs.station_id
   WHERE rs.route_id = v_route;

  IF v_printed IS DISTINCT FROM
     'T-REQ Темир (660308) — T-REQ Турксиб-эксп. (704402) — T-REQ Турксиб-эксп. (704402) — T-REQ Карабалта (715905)' THEN
    RAISE EXCEPTION '8. печатная строка маршрута собралась неверно: %', v_printed;
  END IF;

  -- ── 6. Две станции на одной позиции — ошибка ───────────────────────
  BEGIN
    INSERT INTO transport_route_stations (route_id, station_id, position)
    VALUES (v_route, '00000000-0000-0000-0000-0000000ac103', 4);
    RAISE EXCEPTION '9. позиция в маршруте продублировалась';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- ── 7. Удаление маршрута уносит его станции ────────────────────────
  DELETE FROM transport_routes WHERE id = v_route;
  SELECT COUNT(*) INTO v_cnt FROM transport_route_stations WHERE route_id = v_route;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '10. после удаления маршрута осталось % строк станций', v_cnt;
  END IF;

  -- ── 8. Активный бланк у компании ровно один ────────────────────────
  INSERT INTO transport_company_templates (company_group_id, file_path)
  VALUES ('00000000-0000-0000-0000-0000000ac001', 'transport-templates/ort-v1.docx');

  BEGIN
    INSERT INTO transport_company_templates (company_group_id, file_path)
    VALUES ('00000000-0000-0000-0000-0000000ac001', 'transport-templates/ort-v2.docx');
    RAISE EXCEPTION '11. у компании стало два активных бланка';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Замена бланка: старый уходит в историю, новый становится активным.
  UPDATE transport_company_templates
     SET is_active = false
   WHERE company_group_id = '00000000-0000-0000-0000-0000000ac001';

  INSERT INTO transport_company_templates (company_group_id, file_path)
  VALUES ('00000000-0000-0000-0000-0000000ac001', 'transport-templates/ort-v2.docx');

  SELECT COUNT(*) INTO v_cnt FROM transport_company_templates
   WHERE company_group_id = '00000000-0000-0000-0000-0000000ac001';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '12. история бланков не сохранилась, строк %', v_cnt;
  END IF;

  -- Разным компаниям активные бланки не мешают друг другу.
  INSERT INTO transport_company_templates (company_group_id, file_path)
  VALUES ('00000000-0000-0000-0000-0000000ac002', 'transport-templates/other-v1.docx');

  -- ── 9. Файлы заявки удаляются вместе с заявкой ─────────────────────
  INSERT INTO transport_request_files (request_id, kind, file_path)
  VALUES (v_req_b, 'word', 'transport-request-files/b.docx'),
         (v_req_b, 'pdf',  'transport-request-files/b.pdf');

  BEGIN
    INSERT INTO transport_request_files (request_id, kind, file_path)
    VALUES (v_req_b, 'excel', 'transport-request-files/b.xlsx');
    RAISE EXCEPTION '13. kind принял значение вне списка';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  DELETE FROM transport_requests WHERE id = v_req_b;
  SELECT COUNT(*) INTO v_cnt FROM transport_request_files WHERE request_id = v_req_b;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '14. после удаления заявки осталось % файлов', v_cnt;
  END IF;

  -- ── 10. Освободившийся номер повторно не выдаётся ──────────────────
  -- Заявку № 2 удалили; следующая должна получить № 3, иначе в списке
  -- окажутся две разные заявки с одним номером за год.
  INSERT INTO transport_requests (date, company_group_id)
  VALUES ('2026-06-01', '00000000-0000-0000-0000-0000000ac001')
  RETURNING request_number INTO v_num;

  IF v_num IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '15. после удаления № 2 следующей должна быть № 3, получили %', v_num;
  END IF;

  RAISE NOTICE 'OK: нумерация по годам, один активный бланк, каскады и списки значений работают';
END $$;

ROLLBACK;

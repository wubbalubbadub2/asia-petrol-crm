-- Test: дислокация → рейсы → стоянки → сверхнормативный простой (00174)
--
-- Сценарии из спеки docs/superpowers/specs/2026-09-27-dislocation-demurrage-design.md §6.
-- Сценарий 1 — реальный вагон 70524723 из архива Шагыр (снимки 19–23.08.2026).
-- Остальные — синтетические вагоны 9000000N с датами под формулу.

BEGIN;

DO $$
DECLARE
  v_fwd     UUID := gen_random_uuid();
  v_fwd2    UUID := gen_random_uuid();
  v_shagyr  UUID := gen_random_uuid();
  v_kb      UUID := gen_random_uuid();
  v_arys    UUID := gen_random_uuid();
  v_taraz   UUID := gen_random_uuid();
  v_prot    UUID := gen_random_uuid();
  v_prot2a  UUID := gen_random_uuid();
  v_prot2b  UUID := gen_random_uuid();
  r         RECORD;
  v_cnt     INT;
  v_failed  BOOLEAN;
BEGIN
  -- ── Справочники ────────────────────────────────────────────────────
  INSERT INTO forwarders (id, name) VALUES (v_fwd, 'T-RAIL PTC'), (v_fwd2, 'T-RAIL Другой');
  INSERT INTO stations (id, name, type) VALUES
    (v_shagyr, 'T-Шагыр', 'departure'),
    (v_kb,     'T-Карабалта', 'destination'),
    (v_arys,   'T-Арыс 1', 'both'),
    (v_taraz,  'T-Тараз', 'both');
  -- «Шагыр (Эксп.)» и «Шагыр» — одна станция погрузки.
  INSERT INTO rail_station_aliases (alias, station_id) VALUES
    (rail_norm_station('Шагыр (Эксп.)'), v_shagyr),
    (rail_norm_station('Шагыр'),         v_shagyr),
    (rail_norm_station('Кара-Балта'),    v_kb),
    (rail_norm_station('Арыс 1'),        v_arys),
    (rail_norm_station('Тараз'),         v_taraz);

  IF rail_norm_station('  Шагыр   (Эксп.) ') <> 'шагыр (эксп.)' THEN
    RAISE EXCEPTION 'rail_norm_station: получили %', rail_norm_station('  Шагыр   (Эксп.) ');
  END IF;

  -- Протокол: погрузка 3, выгрузка 2, 35 USD за вагон-сутки, день прибытия считается.
  INSERT INTO rail_price_protocols (id, forwarder_id, number, valid_from, demurrage_rate, currency, arrival_day_counts)
  VALUES (v_prot, v_fwd, 'T-20', DATE '2026-07-01', 35, 'USD', true);
  INSERT INTO rail_price_protocol_routes (protocol_id, departure_station_id, destination_station_id,
                                          loading_norm_days, unloading_norm_days)
  VALUES (v_prot, v_shagyr, v_kb, 3, 2);

  -- ── Загрузка снимков через функцию ─────────────────────────────────
  -- 19.08: 70524723 гружёный в пути; 90000004 порожний под погрузкой — нет.
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-19 09:23:37', 'd19.xlsx', 'h19', jsonb_build_array(
    jsonb_build_object('wagon_number','70524723','departure_station','Шагыр (Эксп.)','current_station','Арыс 1',
      'destination_station','Кара-Балта','waybill_number','Д0394175','waybill_date','2026-08-18',
      'last_operation_at','2026-08-19 07:55:00','operation_code','ОТПР','load_state','Груж','idle_at_station',0.08)
  ));
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-21 09:23:39', 'd21.xlsx', 'h21', jsonb_build_array(
    jsonb_build_object('wagon_number','70524723','departure_station','Шагыр (Эксп.)','current_station','Кара-Балта',
      'destination_station','Кара-Балта','waybill_number','Д0394175','waybill_date','2026-08-18',
      'last_operation_at','2026-08-20 15:01:00','operation_code','ИСКП','load_state','Груж','idle_at_station',0.75)
  ));
  -- 22.08: слит, числится «Порож» на той же гружёной накладной.
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-22 09:23:38', 'd22.xlsx', 'h22', jsonb_build_array(
    jsonb_build_object('wagon_number','70524723','departure_station','Шагыр (Эксп.)','current_station','Кара-Балта',
      'destination_station','Кара-Балта','waybill_number','Д0394175','waybill_date','2026-08-18',
      'last_operation_at','2026-08-21 20:30:00','operation_code','ВЫГ1','load_state','Порож','idle_at_station',1.75)
  ));
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-23 09:23:39', 'd23.xlsx', 'h23', jsonb_build_array(
    jsonb_build_object('wagon_number','70524723','departure_station','Кара-Балта','current_station','Тараз',
      'destination_station','Арыс 1','waybill_number','04005810','waybill_date','2026-08-21',
      'last_operation_at','2026-08-23 07:01:00','operation_code','ПРИБ','load_state','Порож','idle_at_station',0.04)
  ));

  -- Сценарий 2: погрузка 01.08 → 11.08. Сценарий 3: выгрузка 29.07 → 05.08.
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-07-29 09:00:00', 's0729.xlsx', 'hs0729', jsonb_build_array(
    jsonb_build_object('wagon_number','90000002','departure_station','Шагыр (Эксп.)','current_station','Кара-Балта',
      'destination_station','Кара-Балта','waybill_number','Д2','waybill_date','2026-07-26',
      'last_operation_at','2026-07-29 06:00:00','load_state','Груж','idle_at_station',0.1)
  ));
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-01 12:00:00', 's0801.xlsx', 'hs0801', jsonb_build_array(
    jsonb_build_object('wagon_number','90000001','departure_station','Арыс 1','current_station','Шагыр',
      'destination_station','Шагыр','waybill_number','ЭЛ1','waybill_date','2026-07-30',
      'last_operation_at','2026-08-01 10:00:00','load_state','Порож','idle_at_station',0.05)
  ));
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-03 12:00:00', 's0803.xlsx', 'hs0803', jsonb_build_array(
    jsonb_build_object('wagon_number','90000002','departure_station','Шагыр (Эксп.)','current_station','Кара-Балта',
      'destination_station','Кара-Балта','waybill_number','Д2','waybill_date','2026-07-26',
      'last_operation_at','2026-07-29 06:00:00','load_state','Груж','idle_at_station',5.2)
  ));
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-06 12:00:00', 's0806.xlsx', 'hs0806', jsonb_build_array(
    jsonb_build_object('wagon_number','90000002','departure_station','Кара-Балта','current_station','Тараз',
      'destination_station','Арыс 1','waybill_number','04X2','waybill_date','2026-08-05',
      'last_operation_at','2026-08-06 07:00:00','load_state','Порож','idle_at_station',0.1),
    -- Сценарий 6-бис: пропуск между снимками — ПВПП 05.08, но на станции 3 суток.
    jsonb_build_object('wagon_number','90000006','departure_station','Арыс 1','current_station','Шагыр',
      'destination_station','Шагыр','waybill_number','ЭЛ6','waybill_date','2026-08-01',
      'last_operation_at','2026-08-05 16:00:00','operation_code','ПВПП','load_state','Порож','idle_at_station',3.0)
  ));
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-12 09:00:00', 's0812.xlsx', 'hs0812', jsonb_build_array(
    jsonb_build_object('wagon_number','90000001','departure_station','Шагыр (Эксп.)','current_station','Тараз',
      'destination_station','Кара-Балта','waybill_number','Д1','waybill_date','2026-08-11',
      'last_operation_at','2026-08-12 06:00:00','load_state','Груж','idle_at_station',0.1)
  ));

  -- Сценарий 4: заглушка накладной у порожнего рейса.
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-24 09:23:39', 's0824.xlsx', 'hs0824', jsonb_build_array(
    jsonb_build_object('wagon_number','73932139','departure_station','Кара-Балта','current_station','Кара-Балта',
      'destination_station','Арыс 1','waybill_number','00000000','waybill_date','2026-08-24',
      'last_operation_at','2026-08-24 05:00:00','operation_code','ОТПР','load_state','Порож')
  ));
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-25 09:23:38', 's0825.xlsx', 'hs0825', jsonb_build_array(
    jsonb_build_object('wagon_number','73932139','departure_station','Кара-Балта','current_station','Тараз',
      'destination_station','Арыс 1','waybill_number','04005923','waybill_date','2026-08-23',
      'last_operation_at','2026-08-25 06:00:00','operation_code','ВКЛП','load_state','Порож')
  ));

  -- Сценарий 5: незакрытая стоянка на погрузке, последний снимок 04.09.
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-09-02 09:39:50', 's0902.xlsx', 'hs0902', jsonb_build_array(
    jsonb_build_object('wagon_number','90000004','departure_station','Арыс 1','current_station','Шагыр',
      'destination_station','Шагыр','waybill_number','ЭЛ4','waybill_date','2026-08-31',
      'last_operation_at','2026-09-02 08:00:00','load_state','Порож','idle_at_station',0.05)
  ));
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-09-04 09:39:49', 's0904.xlsx', 'hs0904', jsonb_build_array(
    jsonb_build_object('wagon_number','90000004','departure_station','Арыс 1','current_station','Шагыр',
      'destination_station','Шагыр','waybill_number','ЭЛ4','waybill_date','2026-08-31',
      'last_operation_at','2026-09-02 08:00:00','load_state','Порож','idle_at_station',2.07)
  ));

  -- Сценарий 6: экспедитор без протокола.
  PERFORM rail_upload_dislocation(v_fwd2, TIMESTAMP '2026-08-21 10:00:00', 'o21.xlsx', 'ho21', jsonb_build_array(
    jsonb_build_object('wagon_number','90000005','departure_station','Шагыр (Эксп.)','current_station','Кара-Балта',
      'destination_station','Кара-Балта','waybill_number','Д5','waybill_date','2026-08-18',
      'last_operation_at','2026-08-20 12:00:00','load_state','Груж','idle_at_station',0.9)
  ));
  PERFORM rail_upload_dislocation(v_fwd2, TIMESTAMP '2026-08-25 10:00:00', 'o25.xlsx', 'ho25', jsonb_build_array(
    jsonb_build_object('wagon_number','90000005','departure_station','Кара-Балта','current_station','Тараз',
      'destination_station','Арыс 1','waybill_number','04X5','waybill_date','2026-08-24',
      'last_operation_at','2026-08-25 06:00:00','load_state','Порож','idle_at_station',0.1)
  ));

  -- ── Сценарий 7: повторная загрузка того же файла ───────────────────
  v_failed := false;
  BEGIN
    PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-19 09:23:37', 'd19 (1).xlsx', 'h19', '[]'::jsonb);
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'сценарий 7: повторная загрузка файла должна быть отклонена';
  END IF;
  SELECT count(*) INTO v_cnt FROM rail_dislocation_uploads WHERE content_hash = 'h19';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'сценарий 7: файлов с хэшем h19 %', v_cnt; END IF;

  -- ── Сценарий 1: выгрузка 70524723 без сверхнорматива ───────────────
  SELECT count(*) INTO v_cnt FROM rail_wagon_trips WHERE wagon_number = '70524723';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'сценарий 1: ожидали 2 рейса (гружёный + порожний), получили %', v_cnt;
  END IF;

  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '70524723' AND stay_kind = 'unloading';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage WHERE wagon_number = ''70524723'' AND stay_kind = ''unloading'''; END IF;
  IF r.arrival_date <> DATE '2026-08-20' OR r.departure_date <> DATE '2026-08-21'
     OR r.total_days <> 2 OR r.norm_days <> 2 OR r.overage_days <> 0 OR r.amount <> 0
     OR NOT r.is_final OR r.needs_check OR r.protocol_status <> 'ok' THEN
    RAISE EXCEPTION 'сценарий 1: %', row_to_json(r);
  END IF;

  -- ── Сценарий 2: формула клиента 01.08 → 11.08, норма 3 ─────────────
  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '90000001' AND stay_kind = 'loading';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage WHERE wagon_number = ''90000001'' AND stay_kind = ''loading'''; END IF;
  IF r.arrival_date <> DATE '2026-08-01' OR r.departure_date <> DATE '2026-08-11'
     OR r.total_days <> 11 OR r.overage_days <> 8 OR r.amount <> 280 THEN
    RAISE EXCEPTION 'сценарий 2 (день в день): %', row_to_json(r);
  END IF;

  UPDATE rail_price_protocols SET arrival_day_counts = false WHERE id = v_prot;
  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '90000001' AND stay_kind = 'loading';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage WHERE wagon_number = ''90000001'' AND stay_kind = ''loading'''; END IF;
  IF r.overage_days <> 7 OR r.amount <> 245 THEN
    RAISE EXCEPTION 'сценарий 2 (со следующих суток): %', row_to_json(r);
  END IF;
  UPDATE rail_price_protocols SET arrival_day_counts = true WHERE id = v_prot;

  -- ── Сценарий 3: переход месяца, выгрузка 29.07 → 05.08, норма 2 ────
  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '90000002' AND stay_kind = 'unloading';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage WHERE wagon_number = ''90000002'' AND stay_kind = ''unloading'''; END IF;
  IF r.arrival_date <> DATE '2026-07-29' OR r.departure_date <> DATE '2026-08-05' OR r.overage_days <> 6 THEN
    RAISE EXCEPTION 'сценарий 3: %', row_to_json(r);
  END IF;
  SELECT overage_days INTO v_cnt FROM rail_demurrage_by_month
   WHERE stay_key = r.stay_key AND month = DATE '2026-07-01';
  IF v_cnt IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'сценарий 3: июль % суток, ожидали 1', v_cnt; END IF;
  SELECT overage_days INTO v_cnt FROM rail_demurrage_by_month
   WHERE stay_key = r.stay_key AND month = DATE '2026-08-01';
  IF v_cnt IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'сценарий 3: август % суток, ожидали 5', v_cnt; END IF;

  -- Реестр: у 90000002 две строки (июль и август), в августе 5 суток × 35.
  SELECT * INTO r FROM rail_demurrage_registry WHERE wagon_number = '90000002' AND month = DATE '2026-08-01';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage_registry WHERE wagon_number = ''90000002'' AND month = DATE ''2026-08-01'''; END IF;
  IF r.unloading_overage_days <> 5 OR r.amount <> 175 OR r.loaded_waybill_number <> 'Д2' THEN
    RAISE EXCEPTION 'сценарий 3, реестр август: %', row_to_json(r);
  END IF;
  -- Цикл 90000001: погрузка и выгрузка в одной строке по гружёной накладной Д1.
  SELECT count(*) INTO v_cnt FROM rail_demurrage_registry WHERE wagon_number = '90000001';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'реестр 90000001: строк %, ожидали 1', v_cnt; END IF;
  SELECT * INTO r FROM rail_demurrage_registry WHERE wagon_number = '90000001';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage_registry WHERE wagon_number = ''90000001'''; END IF;
  IF r.loaded_waybill_number <> 'Д1' OR r.loading_overage_days <> 8 OR r.amount <> 280 THEN
    RAISE EXCEPTION 'реестр 90000001: %', row_to_json(r);
  END IF;

  -- ── Сценарий 4: заглушка «00000000» — один рейс с датой из последнего снимка
  SELECT count(*) INTO v_cnt FROM rail_wagon_trips WHERE wagon_number = '73932139';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'сценарий 4: рейсов %, ожидали 1', v_cnt; END IF;
  SELECT * INTO r FROM rail_wagon_trips WHERE wagon_number = '73932139';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_wagon_trips WHERE wagon_number = ''73932139'''; END IF;
  IF r.waybill_number <> '04005923' OR r.waybill_date <> DATE '2026-08-23' THEN
    RAISE EXCEPTION 'сценарий 4: %', row_to_json(r);
  END IF;

  -- ── Сценарий 5: незакрытая стоянка ─────────────────────────────────
  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '90000004' AND stay_kind = 'loading';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage WHERE wagon_number = ''90000004'' AND stay_kind = ''loading'''; END IF;
  IF r.is_final OR r.end_date <> DATE '2026-09-04' OR r.arrival_date <> DATE '2026-09-02'
     OR r.total_days <> 3 OR r.overage_days <> 0 OR r.protocol_status <> 'ok' THEN
    RAISE EXCEPTION 'сценарий 5: %', row_to_json(r);
  END IF;

  -- ── Сценарий 6: нет протокола ──────────────────────────────────────
  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '90000005' AND stay_kind = 'unloading';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage WHERE wagon_number = ''90000005'' AND stay_kind = ''unloading'''; END IF;
  IF r.protocol_status <> 'none' OR r.total_days <> 5 OR r.amount IS NOT NULL OR r.overage_days IS NOT NULL THEN
    RAISE EXCEPTION 'сценарий 6: %', row_to_json(r);
  END IF;

  -- Два протокола на один маршрут и дату → «неоднозначный», суммы нет.
  INSERT INTO rail_price_protocols (id, forwarder_id, number, valid_from, demurrage_rate) VALUES
    (v_prot2a, v_fwd2, 'T-A', DATE '2026-08-01', 30),
    (v_prot2b, v_fwd2, 'T-B', DATE '2026-08-15', 30);
  INSERT INTO rail_price_protocol_routes (protocol_id, departure_station_id, destination_station_id,
                                          loading_norm_days, unloading_norm_days)
  VALUES (v_prot2a, v_shagyr, v_kb, 3, 3), (v_prot2b, v_shagyr, v_kb, 3, 3);
  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '90000005' AND stay_kind = 'unloading';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage WHERE wagon_number = ''90000005'' AND stay_kind = ''unloading'''; END IF;
  IF r.protocol_status <> 'ambiguous' OR r.amount IS NOT NULL THEN
    RAISE EXCEPTION 'неоднозначный протокол: %', row_to_json(r);
  END IF;

  -- ── Пропуск между снимками: прибытие по «простою на станции» ───────
  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '90000006' AND stay_kind = 'loading';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage WHERE wagon_number = ''90000006'' AND stay_kind = ''loading'''; END IF;
  IF r.arrival_date <> DATE '2026-08-03' OR NOT r.needs_check THEN
    RAISE EXCEPTION 'пропуск между снимками: %', row_to_json(r);
  END IF;

  -- Ручная правка даты снимает флаг и меняет расчёт.
  INSERT INTO rail_stay_overrides (forwarder_id, wagon_number, arrival_waybill_number, field, value, reason)
  VALUES (v_fwd, '90000006', 'ЭЛ6', 'arrival', DATE '2026-08-04', 'сверено по накладной');
  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '90000006' AND stay_kind = 'loading';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage WHERE wagon_number = ''90000006'' AND stay_kind = ''loading'''; END IF;
  -- Флаг «пропуск» снят; «пропал из дислокации» остаётся — снимок 06.08 последний.
  IF r.arrival_date <> DATE '2026-08-04' OR r.check_reason LIKE 'пропуск%' OR NOT r.has_override THEN
    RAISE EXCEPTION 'ручная правка: %', row_to_json(r);
  END IF;

  -- ── Переадресовка порожнего: Кара-Балта → Арыс 1 → Шагыр — не стоянка
  SELECT count(*) INTO v_cnt FROM rail_wagon_stays
   WHERE wagon_number = '70524723' AND station_id = v_arys;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'порожний на Арыс 1 без погрузки: стоянок %', v_cnt; END IF;
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-26 09:00:00', 's0826.xlsx', 'hs0826', jsonb_build_array(
    jsonb_build_object('wagon_number','70524723','departure_station','Арыс 1','current_station','Арыс 1',
      'destination_station','Шагыр','waybill_number','ЭЛ7','waybill_date','2026-08-25',
      'last_operation_at','2026-08-25 20:00:00','load_state','Порож','idle_at_station',0.5)
  ));
  SELECT count(*) INTO v_cnt FROM rail_wagon_stays
   WHERE wagon_number = '70524723' AND station_id = v_arys;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'переадресовка на Арыс 1 дала стоянок %', v_cnt; END IF;

  -- ── Вагон пропал из рассылки: стоит под выгрузкой в снимке 21.08,
  --    а последние снимки экспедитора — 04.09. Требует проверки.
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-21 09:23:40', 'd21b.xlsx', 'h21b', jsonb_build_array(
    jsonb_build_object('wagon_number','90000007','departure_station','Шагыр (Эксп.)','current_station','Кара-Балта',
      'destination_station','Кара-Балта','waybill_number','Д7','waybill_date','2026-08-18',
      'last_operation_at','2026-08-20 15:01:00','load_state','Груж','idle_at_station',0.75)
  ));
  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '90000007' AND stay_kind = 'unloading';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage WHERE wagon_number = ''90000007'' AND stay_kind = ''unloading'''; END IF;
  IF r.is_final OR NOT r.needs_check OR r.check_reason NOT LIKE 'вагон пропал из дислокации после 21.08.2026' THEN
    RAISE EXCEPTION 'пропавший вагон: %', row_to_json(r);
  END IF;
  -- Незакрытая стоянка вагона, который есть в последнем снимке, флага не получает.
  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '90000004' AND stay_kind = 'loading';
  IF NOT FOUND THEN RAISE EXCEPTION 'нет строки: rail_demurrage WHERE wagon_number = ''90000004'' AND stay_kind = ''loading'''; END IF;
  IF r.needs_check THEN RAISE EXCEPTION 'сценарий 5 не должен требовать проверки: %', row_to_json(r); END IF;

  -- ── Станция отправления следующего рейса пустая, а на станции назначения
  --    вагон не видели: стоянка не пропадает, а требует проверки.
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-19 10:00:00', 'n19.xlsx', 'hn19', jsonb_build_array(
    jsonb_build_object('wagon_number','90000008','departure_station','Шагыр (Эксп.)','current_station','Тараз',
      'destination_station','Кара-Балта','waybill_number','Д8','waybill_date','2026-08-18',
      'last_operation_at','2026-08-19 06:00:00','load_state','Груж','idle_at_station',0.1)
  ));
  PERFORM rail_upload_dislocation(v_fwd, TIMESTAMP '2026-08-24 10:00:00', 'n24.xlsx', 'hn24', jsonb_build_array(
    jsonb_build_object('wagon_number','90000008','departure_station',NULL,'current_station','Тараз',
      'destination_station','Арыс 1','waybill_number','04X8','waybill_date','2026-08-23',
      'last_operation_at','2026-08-24 06:00:00','load_state','Порож','idle_at_station',0.1)
  ));
  SELECT * INTO r FROM rail_demurrage WHERE wagon_number = '90000008' AND stay_kind = 'unloading';
  IF NOT FOUND THEN RAISE EXCEPTION 'пустая станция следующего рейса: стоянка пропала'; END IF;
  IF NOT r.needs_check OR r.is_final THEN
    RAISE EXCEPTION 'пустая станция следующего рейса: %', row_to_json(r);
  END IF;

  RAISE NOTICE 'rail demurrage: все сценарии прошли';
END $$;

ROLLBACK;

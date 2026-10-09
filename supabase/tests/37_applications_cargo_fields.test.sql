-- Test: «Заявки» — поля груза и ссылки на справочники (00183).

BEGIN;

INSERT INTO fuel_types (id, name) VALUES ('00000000-0000-0000-0000-0000000e0b01', 'T-APP Мазут');
INSERT INTO stations (id, name, code, type) VALUES ('00000000-0000-0000-0000-0000000e0b02', 'T-APP Станция', '700204', 'departure');
INSERT INTO factories (id, name) VALUES ('00000000-0000-0000-0000-0000000e0b03', 'T-APP Завод');
INSERT INTO consignees (id, name, bin_iin) VALUES ('00000000-0000-0000-0000-0000000e0b04', 'T-APP Получатель', '123456789012');
INSERT INTO transport_carriers (id, name) VALUES ('00000000-0000-0000-0000-0000000e0b05', 'T-APP Перевозчик');

DO $$
DECLARE
  v_id UUID;
  v_ok BOOLEAN;
  r RECORD;
BEGIN
  -- 1. Все новые поля пишутся и читаются.
  INSERT INTO applications (date, fuel_type_id, sulfur_percent, etsng_code, gng_code, tnved_code,
                            departure_station_id, consignor_factory_id, consignee_id, carrier_id)
  VALUES (current_date, '00000000-0000-0000-0000-0000000e0b01', 1.5, '221066', '27101967', '2710196201',
          '00000000-0000-0000-0000-0000000e0b02', '00000000-0000-0000-0000-0000000e0b03',
          '00000000-0000-0000-0000-0000000e0b04', '00000000-0000-0000-0000-0000000e0b05')
  RETURNING id INTO v_id;
  SELECT * INTO r FROM applications WHERE id = v_id;
  IF r.sulfur_percent <> 1.5 OR r.gng_code <> '27101967' OR r.consignee_id IS NULL OR r.carrier_id IS NULL THEN
    RAISE EXCEPTION 'поля 00183 не сохранились: %', r;
  END IF;

  -- 2. Сера вне 0..100 — нельзя.
  v_ok := FALSE;
  BEGIN UPDATE applications SET sulfur_percent = 150 WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'сохранилась сера 150%%'; END IF;

  -- 3. Ссылки на справочники — только на существующие строки.
  v_ok := FALSE;
  BEGIN UPDATE applications SET carrier_id = '00000000-0000-0000-0000-00000000dead' WHERE id = v_id;
  EXCEPTION WHEN foreign_key_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'перевозчик без строки в справочнике сохранился'; END IF;

  RAISE NOTICE 'OK: заявки — поля груза и ссылки (00183)';
END $$;

ROLLBACK;

-- Test: в реестре ВСЕГДА ставка из справочника (00167).
--
-- Клиент 2026-09-23: «нужно сделать, чтобы в реестре всегда были ставки
-- со справочника, а не только в определённых случаях». До 00167
-- справочник доезжал до реестра лишь при добавлении ставки и при
-- изменении её суммы; правка месяца/станции/экспедитора/ГСМ и удаление
-- не распространялись вовсе, а снять ручную пометку было нечем.
--
-- Каждый случай ниже — это жалоба, которая приходила от клиента.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-0000000009a1', 'supplier', 'T-ALW Поставщик'),
  ('00000000-0000-0000-0000-0000000009a2', 'buyer',    'T-ALW Покупатель');
INSERT INTO stations (id, name, type) VALUES
  ('00000000-0000-0000-0000-0000000009b1', 'T-ALW Отправление', 'departure'),
  ('00000000-0000-0000-0000-0000000009b2', 'T-ALW Назначение',  'destination');
INSERT INTO fuel_types (id, name) VALUES
  ('00000000-0000-0000-0000-0000000009c1', 'T-ALW Печное топливо');
INSERT INTO forwarders (id, name) VALUES
  ('00000000-0000-0000-0000-0000000009d1', 'T-ALW Экспедитор');

DO $$
DECLARE
  v_deal   UUID := gen_random_uuid();
  v_rate   UUID;
  v_rate2  UUID;
  v_row    UUID;
  v_row2   UUID;
  v_tariff NUMERIC;
  v_amount NUMERIC;
  v_ovr    BOOLEAN;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id,
                     fuel_type_id, forwarder_id,
                     supplier_departure_station_id, buyer_destination_station_id)
  VALUES (v_deal, 'KG', 9995, 2099, 'август',
          '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009a2',
          '00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009d1',
          '00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009b2');

  -- ── 1. Строка заведена раньше ставки, со «своим» тарифом от формы ──
  -- Ровно случай КГ/26/434: форма подставила 44, справочник молчал.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month,
                                 shipment_volume, railway_tariff)
  VALUES (v_deal, 'KG', 'ALW-0001', 'август', 60, 44.00)
  RETURNING id INTO v_row;

  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE id = v_row;
  IF v_tariff IS DISTINCT FROM 44.00 THEN
    RAISE EXCEPTION '1. пока ставки нет, строка держит своё: ожидали 44.00, получили %', v_tariff;
  END IF;

  -- ── 2. Ставка заведена на ДРУГОЙ месяц — строку не трогает ─────────
  INSERT INTO tariffs (departure_station_id, destination_station_id, fuel_type_id,
                       forwarder_id, month, year, planned_tariff)
  VALUES ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009b2',
          '00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009d1',
          'сентябрь', 2099, 42.00)
  RETURNING id INTO v_rate;

  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE id = v_row;
  IF v_tariff IS DISTINCT FROM 44.00 THEN
    RAISE EXCEPTION '2. сентябрьская ставка не должна попадать в августовскую строку, получили %', v_tariff;
  END IF;

  -- ── 3. ГЛАВНАЯ ДЫРА: у ставки правят КЛЮЧ, а не сумму ──────────────
  -- Оператор исправляет месяц ставки на август. Сумма НЕ меняется.
  -- До 00167 распространение висело на условии «изменилась сумма»
  -- (00117:81), поэтому строка оставалась с 44 навсегда — это и есть
  -- жалоба «в справочнике 42, а в реестре 44».
  UPDATE tariffs SET month = 'август' WHERE id = v_rate;

  SELECT railway_tariff, shipped_tonnage_amount INTO v_tariff, v_amount
    FROM shipment_registry WHERE id = v_row;
  IF v_tariff IS DISTINCT FROM 42.00 THEN
    RAISE EXCEPTION '3. правка месяца ставки не дошла до реестра: ожидали 42.00, получили %', v_tariff;
  END IF;
  IF v_amount IS DISTINCT FROM 2520.00 THEN
    RAISE EXCEPTION '3. сумма обязана пересчитаться: ожидали 2520 (60 × 42), получили %', v_amount;
  END IF;

  -- ── 4. Правка только суммы (регресс поведения 00117) ───────────────
  UPDATE tariffs SET planned_tariff = 41.50 WHERE id = v_rate;
  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE id = v_row;
  IF v_tariff IS DISTINCT FROM 41.50 THEN
    RAISE EXCEPTION '4. смена суммы ставки: ожидали 41.50, получили %', v_tariff;
  END IF;

  -- Дальше тест считает от 39.00; в п. 5 ставка поменяется на 40.00 уже
  -- при заблокированной строке, и это должно её не тронуть.
  UPDATE tariffs SET planned_tariff = 39.00 WHERE id = v_rate;

  -- ── 5. Ручная строка неприкосновенна, очистка её освобождает ───────
  UPDATE shipment_registry
     SET railway_tariff = 99.00, railway_tariff_override = TRUE WHERE id = v_row;
  UPDATE tariffs SET planned_tariff = 40.00 WHERE id = v_rate;
  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE id = v_row;
  IF v_tariff IS DISTINCT FROM 99.00 THEN
    RAISE EXCEPTION '5. ручную ставку выравнивание тронуло: ожидали 99.00, получили %', v_tariff;
  END IF;

  -- Интерфейс на очистку ячейки шлёт (NULL, override = FALSE).
  UPDATE shipment_registry
     SET railway_tariff = NULL, railway_tariff_override = FALSE WHERE id = v_row;
  SELECT railway_tariff, railway_tariff_override INTO v_tariff, v_ovr
    FROM shipment_registry WHERE id = v_row;
  IF v_tariff IS DISTINCT FROM 40.00 THEN
    RAISE EXCEPTION '5. очистка обязана вернуть ставку справочника 40.00, получили %', v_tariff;
  END IF;
  IF v_ovr THEN
    RAISE EXCEPTION '5. после очистки строка должна быть авто, а не ручной';
  END IF;

  -- ── 6. Удаление ставки: значение остаётся, строка не обнуляется ────
  DELETE FROM tariffs WHERE id = v_rate;
  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE id = v_row;
  IF v_tariff IS DISTINCT FROM 40.00 THEN
    RAISE EXCEPTION '6. после удаления ставки значение строки должно остаться 40.00, получили %', v_tariff;
  END IF;

  -- ── 7. Двух ставок на один ключ быть не может ─────────────────────
  INSERT INTO tariffs (departure_station_id, destination_station_id, fuel_type_id,
                       forwarder_id, month, year, planned_tariff)
  VALUES ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009b2',
          '00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009d1',
          'август', 2099, 55.00)
  RETURNING id INTO v_rate;
  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE id = v_row;
  IF v_tariff IS DISTINCT FROM 55.00 THEN
    RAISE EXCEPTION '7. новая ставка 55.00 не доехала, получили %', v_tariff;
  END IF;

  -- UNIQUE(назначение, отправление, экспедитор, ГСМ, месяц, год) из 00006
  -- не даёт завести вторую ставку на тот же ключ. Поэтому у подбора
  -- всегда не больше одного кандидата, а ORDER BY planned_tariff в
  -- resolve_registry_tariff — страховка на исторические строки, где в
  -- ключе есть NULL (UNIQUE такие не ловит).
  BEGIN
    INSERT INTO tariffs (departure_station_id, destination_station_id, fuel_type_id,
                         forwarder_id, month, year, planned_tariff)
    VALUES ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009b2',
            '00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009d1',
            'август', 2099, 33.00);
    RAISE EXCEPTION '7. дубль ставки на один ключ прошёл — UNIQUE из 00006 не работает';
  EXCEPTION WHEN unique_violation THEN
    NULL; -- так и должно быть
  END;

  -- ── 8. Новая строка получает ставку сразу при вставке ──────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month,
                                 shipment_volume, railway_tariff)
  VALUES (v_deal, 'KG', 'ALW-0002', 'август', 50, 77.00)
  RETURNING id INTO v_row2;
  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE id = v_row2;
  IF v_tariff IS DISTINCT FROM 55.00 THEN
    RAISE EXCEPTION '8. форма прислала 77.00, но справочник главнее: ожидали 55.00, получили %', v_tariff;
  END IF;

  -- ── 9. Одна правка справочника выравнивает все затронутые строки ───
  -- Триггер операторный: массовый UPDATE по нескольким ставкам делает
  -- одно выравнивание, а не по проходу на строку.
  INSERT INTO tariffs (departure_station_id, destination_station_id, fuel_type_id,
                       forwarder_id, month, year, planned_tariff)
  VALUES ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009b2',
          '00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009d1',
          'сентябрь', 2099, 60.00)
  RETURNING id INTO v_rate2;
  UPDATE shipment_registry SET shipment_month = 'сентябрь' WHERE id = v_row2;
  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE id = v_row2;
  IF v_tariff IS DISTINCT FROM 60.00 THEN
    RAISE EXCEPTION '9. смена месяца строки: ожидали 60.00, получили %', v_tariff;
  END IF;

  UPDATE tariffs SET planned_tariff = planned_tariff + 1 WHERE id IN (v_rate, v_rate2);
  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE id = v_row;
  IF v_tariff IS DISTINCT FROM 56.00 THEN
    RAISE EXCEPTION '9. августовская строка: ожидали 56.00, получили %', v_tariff;
  END IF;
  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE id = v_row2;
  IF v_tariff IS DISTINCT FROM 61.00 THEN
    RAISE EXCEPTION '9. сентябрьская строка: ожидали 61.00, получили %', v_tariff;
  END IF;

  -- ── 10. Правка справочника пишется в журнал изменений ───────────────
  PERFORM 1 FROM audit_log WHERE table_name = 'tariffs' AND row_id = v_rate;
  IF NOT FOUND THEN
    RAISE EXCEPTION '10. правки справочника тарифов не попадают в audit_log';
  END IF;

  RAISE NOTICE 'OK: реестр следует за справочником на добавление, правку любого поля, удаление и снятие ручной пометки';
END $$;

ROLLBACK;

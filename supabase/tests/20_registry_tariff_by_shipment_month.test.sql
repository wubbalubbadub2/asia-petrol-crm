-- Test: тариф логистов подбирается по МЕСЯЦУ ОТГРУЗКИ строки реестра.
--
-- Клиент 2026-09-18 (скриншоты КГ/26/541): в справочнике ст. Темир →
-- ст. Карабалта, PTC - Operator, Мазут, август = 64,80, а в реестре у
-- строк с «мес. отгр.» = август стоял 63,45 — ставка июля, месяца самой
-- сделки. Клиент: «нужно смотреть месяц отгрузки».
--
-- Разбор на боевых данных показал, что ключ подбора уже смотрит на
-- shipment_month (COALESCE(sr.shipment_month, d.month)), а те 20 строк —
-- осадок импорта от 07.08.2026, сделанного до появления подбора при
-- вставке (00148); их выравнивает 00161. Этот тест закрепляет само
-- правило, чтобы приоритет месяца отгрузки нельзя было потерять тихо.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000bb01', 'supplier', 'T-TRF Поставщик'),
  ('00000000-0000-0000-0000-00000000bb02', 'buyer',    'T-TRF Покупатель');
INSERT INTO forwarders (id, name) VALUES ('00000000-0000-0000-0000-00000000bb03', 'T-TRF Экспедитор');
INSERT INTO stations (id, name, type) VALUES
  ('00000000-0000-0000-0000-00000000bb04', 'T-TRF Отправление', 'departure'),
  ('00000000-0000-0000-0000-00000000bb05', 'T-TRF Назначение',  'destination');
INSERT INTO fuel_types (id, name) VALUES ('00000000-0000-0000-0000-00000000bb06', 'T-TRF Мазут');

DO $$
DECLARE
  v_deal UUID := gen_random_uuid();
  v_row  UUID;
  v_t    NUMERIC;
  v_amt  NUMERIC;
BEGIN
  -- Сделка июльская, отгрузки — августовские: ровно расклад КГ/26/541.
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id,
                     forwarder_id, fuel_type_id,
                     supplier_departure_station_id, buyer_destination_station_id)
  VALUES (v_deal, 'KG', 9970, 2099, 'июль',
          '00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bb02',
          '00000000-0000-0000-0000-00000000bb03', '00000000-0000-0000-0000-00000000bb06',
          '00000000-0000-0000-0000-00000000bb04', '00000000-0000-0000-0000-00000000bb05');

  -- Две ставки на один маршрут: июль дешевле, август дороже.
  INSERT INTO tariffs (departure_station_id, destination_station_id, fuel_type_id, forwarder_id, month, year, planned_tariff)
  VALUES ('00000000-0000-0000-0000-00000000bb04', '00000000-0000-0000-0000-00000000bb05',
          '00000000-0000-0000-0000-00000000bb06', '00000000-0000-0000-0000-00000000bb03', 'июль', 2099, 63.45),
         ('00000000-0000-0000-0000-00000000bb04', '00000000-0000-0000-0000-00000000bb05',
          '00000000-0000-0000-0000-00000000bb06', '00000000-0000-0000-0000-00000000bb03', 'август', 2099, 64.80);

  -- ── 1. Месяц отгрузки главнее месяца сделки ────────────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date, shipment_volume)
  VALUES (v_deal, 'KG', 'TRF-0001', 'август', DATE '2099-08-07', 60)
  RETURNING id INTO v_row;

  SELECT railway_tariff INTO v_t FROM shipment_registry WHERE id = v_row;
  IF v_t IS DISTINCT FROM 64.80 THEN
    RAISE EXCEPTION '1. у строки с «мес. отгр.» = август ожидали ставку августа 64.80, получили %', v_t;
  END IF;
  IF v_t = 63.45 THEN
    RAISE EXCEPTION '1. подбор ушёл на месяц сделки (июль) вместо месяца отгрузки';
  END IF;

  -- Сумма 1 считается уже по августовской ставке: 60 × 64,80.
  SELECT shipped_tonnage_amount INTO v_amt FROM shipment_registry WHERE id = v_row;
  IF v_amt IS DISTINCT FROM 3888.00 THEN
    RAISE EXCEPTION '1. ожидали Сумму 1 = 3888.00 (60 × 64.80), получили %', v_amt;
  END IF;

  -- ── 2. Импортное значение перетирается справочником ────────────────
  -- Ровно то, чего ждёт клиент от «подтягивается из Тарифа»: строка
  -- пришла со своей ставкой, справочник победил.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date, shipment_volume, railway_tariff)
  VALUES (v_deal, 'KG', 'TRF-0002', 'август', DATE '2099-08-08', 50, 63.45)
  RETURNING id INTO v_row;

  SELECT railway_tariff INTO v_t FROM shipment_registry WHERE id = v_row;
  IF v_t IS DISTINCT FROM 64.80 THEN
    RAISE EXCEPTION '2. импортную ставку 63.45 должен был перебить справочник (64.80), получили %', v_t;
  END IF;

  -- ── 3. Месяц отгрузки не указан — берём месяц сделки ───────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, date, shipment_volume)
  VALUES (v_deal, 'KG', 'TRF-0003', DATE '2099-08-09', 40)
  RETURNING id INTO v_row;

  SELECT railway_tariff INTO v_t FROM shipment_registry WHERE id = v_row;
  IF v_t IS DISTINCT FROM 63.45 THEN
    RAISE EXCEPTION '3. без «мес. отгр.» ожидали ставку месяца сделки (июль, 63.45), получили %', v_t;
  END IF;

  -- ── 4. Смена месяца отгрузки пересматривает ставку ─────────────────
  UPDATE shipment_registry SET shipment_month = 'август' WHERE id = v_row;

  SELECT railway_tariff, shipped_tonnage_amount INTO v_t, v_amt FROM shipment_registry WHERE id = v_row;
  IF v_t IS DISTINCT FROM 64.80 THEN
    RAISE EXCEPTION '4. после смены месяца отгрузки на август ожидали 64.80, получили %', v_t;
  END IF;
  IF v_amt IS DISTINCT FROM 2592.00 THEN
    RAISE EXCEPTION '4. Сумма 1 должна была пересчитаться в 2592.00 (40 × 64.80), получили %', v_amt;
  END IF;

  -- ── 5. Ручная ставка остаётся ручной ───────────────────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date, shipment_volume,
                                 railway_tariff, railway_tariff_override)
  VALUES (v_deal, 'KG', 'TRF-0004', 'август', DATE '2099-08-10', 30, 10.00, TRUE)
  RETURNING id INTO v_row;

  SELECT railway_tariff INTO v_t FROM shipment_registry WHERE id = v_row;
  IF v_t IS DISTINCT FROM 10.00 THEN
    RAISE EXCEPTION '5. ручную ставку 10.00 трогать нельзя, получили %', v_t;
  END IF;

  UPDATE shipment_registry SET shipment_month = 'июль' WHERE id = v_row;
  SELECT railway_tariff INTO v_t FROM shipment_registry WHERE id = v_row;
  IF v_t IS DISTINCT FROM 10.00 THEN
    RAISE EXCEPTION '5. смена месяца не должна перетирать ручную ставку, получили %', v_t;
  END IF;

  -- ── 6. Ставки на этот месяц нет — тариф не выдумывается ────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date, shipment_volume)
  VALUES (v_deal, 'KG', 'TRF-0005', 'сентябрь', DATE '2099-09-01', 20)
  RETURNING id INTO v_row;

  SELECT railway_tariff INTO v_t FROM shipment_registry WHERE id = v_row;
  IF v_t IS NOT NULL THEN
    RAISE EXCEPTION '6. на сентябрь ставки нет — тариф должен остаться пустым, получили %', v_t;
  END IF;

  RAISE NOTICE 'OK: тариф берётся по месяцу отгрузки, справочник главнее импорта, ручная ставка неприкосновенна';
END $$;

ROLLBACK;

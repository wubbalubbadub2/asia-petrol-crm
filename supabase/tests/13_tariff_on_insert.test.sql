-- Test: тариф из справочника подставляется при СОЗДАНИИ строки реестра
-- (миграция 00148).
--
-- Клиент 2026-08-13: «в реестре тариф логистов не подтягивается».
-- Ставка в справочнике есть, строку внесли позже — и тариф оставался
-- пустым, потому что подбор висел только на изменении строки.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-0000000008a1', 'supplier', 'T-TRF Поставщик'),
  ('00000000-0000-0000-0000-0000000008a2', 'buyer',    'T-TRF Покупатель');
INSERT INTO stations (id, name, type) VALUES
  ('00000000-0000-0000-0000-0000000008b1', 'T-TRF Отправление', 'departure'),
  ('00000000-0000-0000-0000-0000000008b2', 'T-TRF Назначение',  'destination');
INSERT INTO fuel_types (id, name) VALUES
  ('00000000-0000-0000-0000-0000000008c1', 'T-TRF Печное топливо');
INSERT INTO forwarders (id, name) VALUES
  ('00000000-0000-0000-0000-0000000008d1', 'T-TRF Экспедитор');

DO $$
DECLARE
  v_deal   UUID := gen_random_uuid();
  v_tariff NUMERIC;
BEGIN
  -- Ставку заводим ПЕРВОЙ — как в жизни: тариф опубликован, вагоны ещё нет.
  INSERT INTO tariffs (departure_station_id, destination_station_id, fuel_type_id,
                       forwarder_id, month, year, planned_tariff)
  VALUES ('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000008b2',
          '00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-0000000008d1',
          'июль', 2099, 22.10);

  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id,
                     fuel_type_id, forwarder_id,
                     supplier_departure_station_id, buyer_destination_station_id)
  VALUES (v_deal, 'KZ', 9940, 2099, 'июнь',
          '00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-0000000008a2',
          '00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-0000000008d1',
          '00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000008b2');

  -- ── 1. Тариф встаёт сам при создании строки ────────────────────────
  -- Месяц отгрузки июль, месяц сделки июнь — ставку ищем по отгрузке.
  -- У KZ-строк база расчёта суммы — входящее СНТ (00086), задаём его.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month,
                                 loading_volume, shipment_volume)
  VALUES (v_deal, 'KZ', 'TRF-0001', 'июль', 60, 60);

  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE wagon_number = 'TRF-0001';
  IF v_tariff IS DISTINCT FROM 22.10 THEN
    RAISE EXCEPTION 'при создании строки ожидали тариф 22.10, получили %', v_tariff;
  END IF;

  -- ── 2. Ручной тариф подбор не перебивает ───────────────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month,
                                 shipment_volume, railway_tariff, railway_tariff_override)
  VALUES (v_deal, 'KZ', 'TRF-0002', 'июль', 60, 99.99, TRUE);

  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE wagon_number = 'TRF-0002';
  IF v_tariff <> 99.99 THEN
    RAISE EXCEPTION 'ручной тариф должен остаться 99.99, получили %', v_tariff;
  END IF;

  -- ── 3. Нет ставки на месяц — тариф пуст, а не ноль ─────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, shipment_volume)
  VALUES (v_deal, 'KZ', 'TRF-0003', 'май', 60);

  SELECT railway_tariff INTO v_tariff FROM shipment_registry WHERE wagon_number = 'TRF-0003';
  IF v_tariff IS NOT NULL THEN
    RAISE EXCEPTION 'без ставки в справочнике тариф должен остаться пустым, получили %', v_tariff;
  END IF;

  -- ── 4. Сумма посчиталась уже по подставленному тарифу ──────────────
  -- ⌈60⌉ × 22.10 = 1326 (база KZ — входящее СНТ). Значит подбор
  -- отработал ДО расчёта суммы.
  SELECT shipped_tonnage_amount INTO v_tariff FROM shipment_registry WHERE wagon_number = 'TRF-0001';
  IF v_tariff IS DISTINCT FROM 1326 THEN
    RAISE EXCEPTION 'сумма должна считаться по подставленному тарифу (1326), получили %', v_tariff;
  END IF;
END $$;

ROLLBACK;

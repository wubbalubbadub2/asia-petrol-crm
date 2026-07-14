-- 00118_station_propagation.sql
--
-- Клиент 2026-07-18 (KG/26/275): «в некоторых отгрузках отсутствует
-- ст. отправления». Root cause по audit_log:
--   12:50 сделка создана БЕЗ ст. отправления;
--   12:53 массовое добавление 24 вагонов — поле станции в диалоге
--         преинициализируется из сделки, станции не было → NULL;
--   12:55 станцию заполнили, второй batch из 24 — уже со станцией.
-- Обратного заполнения не существует: когда станция появляется на
-- сделке позже, старые строки реестра с NULL остаются пустыми навсегда.
--
-- Фикс (по образцу 00117 tariff propagation):
--   1. Триггер на deals: изменение ст. отправления/назначения →
--      дозаполнить строки реестра сделки, где станция NULL. Только
--      NULL — явно выбранные станции не перетираем (station в реестре
--      редактируется вручную, ошибочно затирать выбор нельзя).
--   2. Catch-up: разово дозаполнить NULL-станции по всей базе.
--   3. После заполнения станций повторить tariff catch-up из 00117 —
--      строки, у которых раньше не было станции, не могли сматчиться
--      со справочником тарифов; теперь могут.

-- ── 1. Propagation trigger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION propagate_deal_stations_to_registry()
RETURNS TRIGGER AS $$
DECLARE
  v_rows INT;
BEGIN
  IF NEW.supplier_departure_station_id IS NOT NULL
     AND NEW.supplier_departure_station_id IS DISTINCT FROM OLD.supplier_departure_station_id THEN
    UPDATE shipment_registry
       SET departure_station_id = NEW.supplier_departure_station_id
     WHERE deal_id = NEW.id
       AND departure_station_id IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      RAISE NOTICE 'ст. отправления сделки % → % строк реестра дозаполнено', NEW.deal_code, v_rows;
    END IF;
  END IF;

  IF NEW.buyer_destination_station_id IS NOT NULL
     AND NEW.buyer_destination_station_id IS DISTINCT FROM OLD.buyer_destination_station_id THEN
    UPDATE shipment_registry
       SET destination_station_id = NEW.buyer_destination_station_id
     WHERE deal_id = NEW.id
       AND destination_station_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_propagate_deal_stations ON deals;
CREATE TRIGGER trg_propagate_deal_stations
  AFTER UPDATE ON deals
  FOR EACH ROW
  WHEN (OLD.supplier_departure_station_id IS DISTINCT FROM NEW.supplier_departure_station_id
     OR OLD.buyer_destination_station_id  IS DISTINCT FROM NEW.buyer_destination_station_id)
  EXECUTE FUNCTION propagate_deal_stations_to_registry();

-- ── 2. Catch-up: дозаполнить NULL-станции из сделки ──────────────────
DO $$
DECLARE
  v_dep INT; v_dest INT;
BEGIN
  UPDATE shipment_registry sr
     SET departure_station_id = d.supplier_departure_station_id
    FROM deals d
   WHERE sr.deal_id = d.id
     AND sr.departure_station_id IS NULL
     AND d.supplier_departure_station_id IS NOT NULL;
  GET DIAGNOSTICS v_dep = ROW_COUNT;

  UPDATE shipment_registry sr
     SET destination_station_id = d.buyer_destination_station_id
    FROM deals d
   WHERE sr.deal_id = d.id
     AND sr.destination_station_id IS NULL
     AND d.buyer_destination_station_id IS NOT NULL;
  GET DIAGNOSTICS v_dest = ROW_COUNT;

  RAISE NOTICE 'catch-up станций: отправления — % строк, назначения — % строк', v_dep, v_dest;
END $$;

-- ── 3. Re-run tariff catch-up (00117) — станции появились, матчинг
--       со справочником тарифов теперь возможен ──────────────────────
DO $$
DECLARE
  v_total INT := 0;
  v_rows INT;
  rec RECORD;
BEGIN
  FOR rec IN SELECT * FROM tariffs WHERE planned_tariff IS NOT NULL LOOP
    UPDATE shipment_registry sr
       SET railway_tariff = rec.planned_tariff
      FROM deals d
     WHERE sr.deal_id = d.id
       AND COALESCE(sr.railway_tariff_override, FALSE) = FALSE
       AND rec.departure_station_id   = COALESCE(sr.departure_station_id,   d.supplier_departure_station_id)
       AND rec.destination_station_id = COALESCE(sr.destination_station_id, d.buyer_destination_station_id)
       AND rec.fuel_type_id           = COALESCE(sr.fuel_type_id, d.fuel_type_id)
       AND rec.forwarder_id           = COALESCE(sr.forwarder_id, d.forwarder_id)
       AND rec.month                  = COALESCE(sr.shipment_month, d.month)
       AND rec.year                   = d.year
       AND sr.railway_tariff IS DISTINCT FROM rec.planned_tariff;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
  END LOOP;
  RAISE NOTICE 'tariff catch-up после заполнения станций: % строк', v_total;
END $$;

-- 00134_reresolve_tariff_on_any_key_change.sql
--
-- Клиент 2026-07-30 (KG/26/348): за июнь у строк стоят РАЗНЫЕ тарифы
-- (76.64 и 75.43), хотя месяц отгрузки и дата — июнь. Диагностика:
--   • В справочнике для маршрута (ст.отпр 24694594 → ст.назн 0d06bf04,
--     Мазут, PTC-Operator, июнь-2026) РОВНО один тариф — 75.43.
--   • 76.64 не встречается в справочнике вообще → это застрявшее значение.
--   • Эти 8 строк обновлены сегодня (2026-07-30): 00130 (пропагация полей
--     сделки) залила им forwarder_id сделки. Тариф при смене forwarder НЕ
--     пересматривался: 00132 пересматривает только при смене shipment_month,
--     00117 — только при изменении справочника. Отсюда рассинхрон.
--
-- Масштаб по всей базе: 99 не-ручных (override=FALSE) строк держат тариф,
-- отличный от текущего справочника (233 ключа справочника уникальны —
-- дублей нет). По правилу клиента (00117) для не-ручных строк справочник
-- авторитетен, значит эти 99 — стухшие и должны быть выровнены.
--
-- Что делаем:
--   1. Расширяем пересмотр тарифа: триггер срабатывает при изменении
--      ЛЮБОГО поля ключа тарифа (shipment_month, forwarder_id, обе станции,
--      fuel_type_id, deal_id), а не только месяца. Ручные строки
--      (railway_tariff_override=TRUE) по-прежнему не трогаем.
--   2. Разовый catch-up: выравниваем 99 стухших не-ручных строк по
--      справочнику (та же логика, что 00117). shipped_tonnage_amount
--      пересчитается через compute_registry_amount (BEFORE UPDATE).

-- ── 1. Обобщённая функция + триггер (заменяет 00132) ─────────────────
-- Функция идентична 00132 (подбор по 6-ключу, guard на override); имя
-- обобщено, старый триггер/функция снимаются.
CREATE OR REPLACE FUNCTION reresolve_registry_tariff_on_key_change()
RETURNS TRIGGER AS $$
DECLARE
  v_tariff NUMERIC;
  v_dep UUID; v_dest UUID; v_fuel UUID; v_fwd UUID; v_month TEXT; v_year INT;
BEGIN
  IF COALESCE(NEW.railway_tariff_override, FALSE) THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(NEW.departure_station_id,   d.supplier_departure_station_id),
    COALESCE(NEW.destination_station_id, d.buyer_destination_station_id),
    COALESCE(NEW.fuel_type_id,           d.fuel_type_id),
    COALESCE(NEW.forwarder_id,           d.forwarder_id),
    COALESCE(NEW.shipment_month,         d.month),
    d.year
  INTO v_dep, v_dest, v_fuel, v_fwd, v_month, v_year
  FROM deals d WHERE d.id = NEW.deal_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT t.planned_tariff INTO v_tariff
  FROM tariffs t
  WHERE t.departure_station_id   = v_dep
    AND t.destination_station_id = v_dest
    AND t.fuel_type_id           = v_fuel
    AND t.forwarder_id           = v_fwd
    AND t.month                  = v_month
    AND t.year                   = v_year
    AND t.planned_tariff IS NOT NULL
  ORDER BY t.planned_tariff
  LIMIT 1;

  IF v_tariff IS NOT NULL THEN
    NEW.railway_tariff := v_tariff;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Снимаем узкий триггер 00132.
DROP TRIGGER IF EXISTS trg_month_reresolve_tariff ON shipment_registry;

-- Имя trg_key_reresolve_tariff сортируется РАНЬШЕ trg_registry_compute_amount
-- (BEFORE-триггеры — по алфавиту), поэтому сумма пересчитается по новому тарифу.
DROP TRIGGER IF EXISTS trg_key_reresolve_tariff ON shipment_registry;
CREATE TRIGGER trg_key_reresolve_tariff
  BEFORE UPDATE ON shipment_registry
  FOR EACH ROW
  WHEN (
       NEW.shipment_month         IS DISTINCT FROM OLD.shipment_month
    OR NEW.forwarder_id           IS DISTINCT FROM OLD.forwarder_id
    OR NEW.departure_station_id   IS DISTINCT FROM OLD.departure_station_id
    OR NEW.destination_station_id IS DISTINCT FROM OLD.destination_station_id
    OR NEW.fuel_type_id           IS DISTINCT FROM OLD.fuel_type_id
    OR NEW.deal_id                IS DISTINCT FROM OLD.deal_id
  )
  EXECUTE FUNCTION reresolve_registry_tariff_on_key_change();

-- ── 2. Catch-up: выровнять стухшие не-ручные строки по справочнику ────
DO $$
DECLARE v_rows INT;
BEGIN
  UPDATE shipment_registry sr
     SET railway_tariff = t.planned_tariff
    FROM deals d, tariffs t
   WHERE sr.deal_id = d.id
     AND COALESCE(sr.railway_tariff_override, FALSE) = FALSE
     AND t.planned_tariff IS NOT NULL
     AND t.departure_station_id   = COALESCE(sr.departure_station_id,   d.supplier_departure_station_id)
     AND t.destination_station_id = COALESCE(sr.destination_station_id, d.buyer_destination_station_id)
     AND t.fuel_type_id           = COALESCE(sr.fuel_type_id, d.fuel_type_id)
     AND t.forwarder_id           = COALESCE(sr.forwarder_id, d.forwarder_id)
     AND t.month                  = COALESCE(sr.shipment_month, d.month)
     AND t.year                   = d.year
     AND sr.railway_tariff IS DISTINCT FROM t.planned_tariff;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'catch-up тарифа: выровнено % строк по справочнику (ожидается ~99)', v_rows;
END $$;

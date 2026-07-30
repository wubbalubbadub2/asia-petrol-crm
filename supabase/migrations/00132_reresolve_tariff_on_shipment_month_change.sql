-- 00132_reresolve_tariff_on_shipment_month_change.sql
--
-- Клиент 2026-07-30 (KG/26/338): «нужно брать тариф смотря на месяц
-- отгрузки; если месяц отгрузки меняется — должен меняться тариф».
--
-- Как тариф подбирается сейчас (см. 00047 backfill, 00117 propagation,
-- форма реестра): railway_tariff = tariffs.planned_tariff по 6-ключу
--   departure + destination + fuel + forwarder + МЕСЯЦ + year(сделки),
-- где МЕСЯЦ = shipment_registry.shipment_month ?? deals.month. Ключевое:
-- месяц берётся из поля «Месяц отгрузки», а НЕ из даты отгрузки (date).
--
-- Пробел: тариф подбирался только (а) при вставке строки и (б) при
-- изменении справочника Тарифы. При РУЧНОЙ смене «Месяц отгрузки» на уже
-- существующей строке тариф не пересматривался. Пример: отгрузка 07.06,
-- но месяц стоял «май» → тянулся майский 68.62 вместо июньского 66.18.
--
-- Правило (утв. клиентом): при изменении shipment_month заново подобрать
-- railway_tariff по тому же 6-ключу с НОВЫМ месяцем. Найдено → проставить.
-- Не найдено (для нового месяца тарифа нет) → строку не трогаем.
--
-- Ручные строки не трогаем: если railway_tariff_override = TRUE (тариф
-- введён вручную в реестре), пересмотр НЕ выполняется — та же семантика,
-- что у propagation 00117 («справочник главный, но ручной ввод главнее»).
-- Клиент 2026-07-30: «то, что изменено вручную, вообще не трогаем».
--
-- Порядок BEFORE-триггеров: имя trg_month_reresolve_tariff намеренно
-- сортируется РАНЬШЕ trg_registry_compute_amount (Postgres выполняет
-- BEFORE-триггеры в алфавитном порядке по имени). Сначала пересматриваем
-- тариф, затем compute_registry_amount пересчитывает shipped_tonnage_amount
-- уже по новому тарифу. trg_reassign_registry_line_on_station на смену
-- только месяца — no-op (реагирует на станцию/deal_id).

CREATE OR REPLACE FUNCTION reresolve_registry_tariff_on_month_change()
RETURNS TRIGGER AS $$
DECLARE
  v_tariff NUMERIC;
  v_dep UUID; v_dest UUID; v_fuel UUID; v_fwd UUID; v_month TEXT; v_year INT;
BEGIN
  -- Ручной тариф не трогаем (как в 00117).
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

DROP TRIGGER IF EXISTS trg_month_reresolve_tariff ON shipment_registry;
CREATE TRIGGER trg_month_reresolve_tariff
  BEFORE UPDATE ON shipment_registry
  FOR EACH ROW
  WHEN (NEW.shipment_month IS DISTINCT FROM OLD.shipment_month)
  EXECUTE FUNCTION reresolve_registry_tariff_on_month_change();

-- 00117_tariff_propagation.sql
--
-- Клиент 2026-07-18: «когда меняют тариф в справочнике Тарифы, в
-- реестре Тариф (логисты) не обновляется — а должен всегда получать
-- обновлённый тариф, если его не правили вручную в реестре».
-- Пример: ст. Карабалта ← ст. Тендык, PTC-Operator, Мазут, май → в
-- справочнике 76.00, а строки KG/26/270 держат 78.71.
--
-- До сих пор lookup тарифа происходил только (а) при вставке строки
-- (UI) и (б) разовыми backfill'ами (00047). Обратной связи
-- «справочник изменился → реестр обновился» не было.
--
-- Что добавляется:
--   1. shipment_registry.railway_tariff_override BOOLEAN — «тариф в
--      этой строке введён вручную, справочник её не трогает». UI
--      ставит его при ручной правке ячейки «Тариф (логисты)»
--      (та же семантика, что у shipped_tonnage_amount_override:
--      ручной ввод всегда приоритетнее, очистка = тоже ручной ввод).
--   2. Триггер на tariffs: INSERT или изменение ставки → UPDATE всех
--      подходящих строк реестра без override. Ключ матчинга — тот же,
--      что в 00047: departure + destination + fuel + forwarder + month
--      (поле строки, fallback на поле сделки) + year сделки.
--   3. Catch-up: разовый прогон всех тарифов по текущему реестру,
--      чтобы уже разъехавшиеся строки (78.71 vs 76.00) выровнялись.
--
-- Пересчёт сумм и rollup'ов происходит по существующей цепочке
-- (compute_registry_amount BEFORE + guarded rollup-триггеры 00116).
-- NB: у строк, где оператор вручную вводил тариф ДО этой миграции,
-- флага нет (по умолчанию FALSE) — они выровняются по справочнику.
-- Отличить их задним числом невозможно; правило клиента — справочник
-- главный.

ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS railway_tariff_override BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN shipment_registry.railway_tariff_override IS
  'Клиент 2026-07-18: TRUE = тариф введён вручную в реестре, propagation из справочника tariffs эту строку не трогает.';

-- ── Propagation function ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION propagate_tariff_to_registry()
RETURNS TRIGGER AS $$
DECLARE
  v_updated INT;
BEGIN
  -- Ставка не задана — нечего распространять (строки не трогаем,
  -- намеренное обнуление справочника не должно массово стирать реестр).
  IF NEW.planned_tariff IS NULL THEN RETURN NEW; END IF;

  UPDATE shipment_registry sr
     SET railway_tariff = NEW.planned_tariff
    FROM deals d
   WHERE sr.deal_id = d.id
     AND COALESCE(sr.railway_tariff_override, FALSE) = FALSE
     AND NEW.departure_station_id   = COALESCE(sr.departure_station_id,   d.supplier_departure_station_id)
     AND NEW.destination_station_id = COALESCE(sr.destination_station_id, d.buyer_destination_station_id)
     AND NEW.fuel_type_id           = COALESCE(sr.fuel_type_id, d.fuel_type_id)
     AND NEW.forwarder_id           = COALESCE(sr.forwarder_id, d.forwarder_id)
     AND NEW.month                  = COALESCE(sr.shipment_month, d.month)
     AND NEW.year                   = d.year
     AND sr.railway_tariff IS DISTINCT FROM NEW.planned_tariff;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN
    RAISE NOTICE 'tariff % → % строк реестра обновлено', NEW.planned_tariff, v_updated;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Triggers: INSERT безусловно, UPDATE только при смене ставки ──────
DROP TRIGGER IF EXISTS trg_propagate_tariff_ins ON tariffs;
DROP TRIGGER IF EXISTS trg_propagate_tariff_upd ON tariffs;

CREATE TRIGGER trg_propagate_tariff_ins
  AFTER INSERT ON tariffs
  FOR EACH ROW EXECUTE FUNCTION propagate_tariff_to_registry();

CREATE TRIGGER trg_propagate_tariff_upd
  AFTER UPDATE ON tariffs
  FOR EACH ROW
  WHEN (OLD.planned_tariff IS DISTINCT FROM NEW.planned_tariff)
  EXECUTE FUNCTION propagate_tariff_to_registry();

-- ── Catch-up: выровнять уже разъехавшиеся строки ─────────────────────
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
  RAISE NOTICE 'catch-up: % строк реестра выровнено по справочнику тарифов', v_total;
END $$;

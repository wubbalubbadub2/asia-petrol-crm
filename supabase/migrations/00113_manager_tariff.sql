-- 00113_manager_tariff.sql
--
-- Клиент 2026-07-10: в реестре отгрузок KZ переименовать тариф ↔
-- логисты и добавить второй тариф от менеджера, который считает
-- сумму грузоотправителя.
--
-- Изменения:
-- • shipment_registry.manager_tariff NUMERIC(14,4) — новый тариф от
--   менеджера (в UI только для KZ).
-- • additional_expenses теперь auto-computed: manager_tariff × base
--   (та же логика base_volume как у shipped_tonnage_amount:
--   loading для KZ, shipment для KG, с учётом round_volume и
--   rounded_volume_override). В UI на реестре колонка называется
--   «Сумма грузоотправителя».
-- • На сделке галочка additional_expenses_in_price остаётся, но в UI
--   переименовать в «Грузоотправитель в цене». Флаг остаётся —
--   плюсует additional_expenses_amount к балансу поставщика.
--
-- Триггер compute_registry_amount расширяется: считает и
-- shipped_tonnage_amount, и additional_expenses по симметричной
-- формуле; ручной override additional_expenses тоже уважается.

ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS manager_tariff NUMERIC(14, 4),
  ADD COLUMN IF NOT EXISTS additional_expenses_override BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_base NUMERIC;
  v_effective_base NUMERIC;  -- база после учёта rounded_volume_override
BEGIN
  IF NEW.registry_type = 'KZ' THEN
    v_base := NEW.loading_volume;
  ELSE
    v_base := NEW.shipment_volume;
  END IF;

  -- Общая база с учётом override округления и режима round_volume.
  IF NEW.rounded_volume_override IS NOT NULL THEN
    v_effective_base := NEW.rounded_volume_override;
  ELSIF v_base IS NULL THEN
    v_effective_base := NULL;
  ELSIF NEW.round_volume THEN
    v_effective_base := CEIL(v_base);
  ELSE
    v_effective_base := v_base;
  END IF;

  -- === shipped_tonnage_amount === (сумма ж/д тариф × база) ===
  IF NEW.shipped_tonnage_amount_override THEN
    -- Ручной override — уважаем.
    NULL;
  ELSIF NEW.railway_tariff IS NULL OR v_base IS NULL THEN
    NEW.shipped_tonnage_amount := NULL;
  ELSE
    NEW.shipped_tonnage_amount := v_effective_base * NEW.railway_tariff;
  END IF;

  -- === additional_expenses === (сумма грузоотправителя) ===
  IF NEW.additional_expenses_override THEN
    -- Ручной override.
    NULL;
  ELSIF NEW.manager_tariff IS NULL OR v_base IS NULL THEN
    NEW.additional_expenses := NULL;
  ELSE
    NEW.additional_expenses := v_effective_base * NEW.manager_tariff;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Прогоняем триггер по всем строкам, чтобы существующие суммы
-- пересчитались согласно новой формуле для строк без override.
UPDATE shipment_registry
   SET railway_tariff = railway_tariff
 WHERE id IS NOT NULL;

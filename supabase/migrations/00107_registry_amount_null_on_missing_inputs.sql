-- 00107_registry_amount_null_on_missing_inputs.sql
--
-- Клиент 2026-07-09 (KZ/26/087): показал строки где railway_tariff
-- пусто, но shipped_tonnage_amount по-прежнему = «авто-расчёт» c
-- реальной суммой. Например строка 21.03.2026, вагон 4, налив 125.3
-- — тариф NULL, а сумма 2 988 745,20 ₸ (это ровно ⌈125.3⌉ × 23 720.2,
-- т.е. старый тариф, который потом стёрли).
--
-- Root cause: compute_registry_amount (миграции 00031/00050/00061/
-- 00086) при NULL-тарифе делает early return без NULL-ования суммы.
-- Т.е. при первом INSERT'е сумма посчиталась и записалась; потом
-- оператор очистил railway_tariff, триггер вышел на NULL-проверке —
-- shipped_tonnage_amount остался старым.
--
-- Фикс: если override=false и любой из входов (tariff, base_volume)
-- отсутствует — обнуляем shipped_tonnage_amount, а не сохраняем старое.
-- Плюс heal-скрипт для существующих залипших строк по всей БД.

CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_base NUMERIC;
BEGIN
  -- Ручной override — уважаем и не трогаем сумму никогда.
  IF NEW.shipped_tonnage_amount_override THEN
    RETURN NEW;
  END IF;

  -- База объёма зависит от KG/KZ, как и раньше (см. 00086).
  IF NEW.registry_type = 'KZ' THEN
    v_base := NEW.loading_volume;
  ELSE
    v_base := NEW.shipment_volume;
  END IF;

  -- Если тарифа НЕТ либо базы объёма НЕТ (и нет ручного round-override
  -- заменяющего v_base) — сумма ДОЛЖНА быть NULL. Раньше здесь был
  -- early RETURN, который оставлял старое значение. Клиент 2026-07-09.
  IF NEW.railway_tariff IS NULL
     OR (v_base IS NULL AND NEW.rounded_volume_override IS NULL) THEN
    NEW.shipped_tonnage_amount := NULL;
    RETURN NEW;
  END IF;

  -- Обычный авто-расчёт (та же логика что в 00086).
  IF NEW.rounded_volume_override IS NOT NULL THEN
    NEW.shipped_tonnage_amount := NEW.rounded_volume_override * NEW.railway_tariff;
  ELSIF NEW.round_volume THEN
    NEW.shipped_tonnage_amount := CEIL(v_base) * NEW.railway_tariff;
  ELSE
    NEW.shipped_tonnage_amount := v_base * NEW.railway_tariff;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Heal-скрипт: все залипшие строки по всей БД, где override=false,
-- тариф NULL, а сумма НЕ NULL. No-op self-UPDATE запустит BEFORE
-- триггер, который теперь корректно обнулит сумму.
DO $$
DECLARE
  v_healed INT;
BEGIN
  UPDATE shipment_registry
     SET railway_tariff = railway_tariff
   WHERE COALESCE(shipped_tonnage_amount_override, FALSE) = FALSE
     AND railway_tariff IS NULL
     AND shipped_tonnage_amount IS NOT NULL;

  GET DIAGNOSTICS v_healed = ROW_COUNT;
  RAISE NOTICE 'Обнулено «залипших» shipped_tonnage_amount: %', v_healed;
END $$;

-- 00110_registry_amount_manual_wins.sql
--
-- Клиент 2026-07-09 уточнил: «ручной ввод всегда приоритетнее
-- автоматического расчета». То есть shipped_tonnage_amount_override=true
-- ДОЛЖНО перекрывать любые правила, даже если базы или тарифа нет.
--
-- Миграции 00108 и 00109 перевернули порядок и ставили base-check ДО
-- override-check, что ломало это правило. Возвращаемся к семантике
-- 00107, но с учётом всех накопленных фиксов:
--
-- Порядок проверок в триггере:
--   1. Если override=true → уважаем ручную сумму, выходим.
--   2. Иначе если тариф NULL или база NULL → сумма := NULL, выходим.
--      (Это фикс из 00107: раньше был early RETURN, оставлявший
--      старую сумму — фоссил при очистке тарифа.)
--   3. Иначе — авто-расчёт: rounded_volume_override или CEIL(base)
--      или base as-is, умножаем на тариф.
--
-- Про 00108/00109-heal: он мог обнулить override=true строки, у
-- которых базы не было (пример KZ/26/022, часть italic-amber строк).
-- Клиент может их вручную восстановить теперь — override=true
-- сохранится корректно новым триггером.

CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_base NUMERIC;
BEGIN
  -- 1. Ручная override-сумма всегда выигрывает.
  IF NEW.shipped_tonnage_amount_override THEN
    RETURN NEW;
  END IF;

  -- База по типу реестра (см. 00086).
  IF NEW.registry_type = 'KZ' THEN
    v_base := NEW.loading_volume;
  ELSE
    v_base := NEW.shipment_volume;
  END IF;

  -- 2. Автосумма требует и тариф, и базу (или round-override как
  -- замену CEIL-этапа, но не как замену базы — если базы нет,
  -- сумма NULL).
  IF NEW.railway_tariff IS NULL OR v_base IS NULL THEN
    NEW.shipped_tonnage_amount := NULL;
    RETURN NEW;
  END IF;

  -- 3. Авто-расчёт.
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

-- Heal-скрипт: обнуляем только НЕ-override строки где нет базы или
-- тарифа. Ручные override-суммы не трогаем — уважаем клиентское
-- правило приоритета.
DO $$
DECLARE
  v_kz_healed INT;
  v_kg_healed INT;
BEGIN
  UPDATE shipment_registry
     SET railway_tariff = railway_tariff
   WHERE registry_type = 'KZ'
     AND COALESCE(shipped_tonnage_amount_override, FALSE) = FALSE
     AND (loading_volume IS NULL OR railway_tariff IS NULL)
     AND shipped_tonnage_amount IS NOT NULL;
  GET DIAGNOSTICS v_kz_healed = ROW_COUNT;

  UPDATE shipment_registry
     SET railway_tariff = railway_tariff
   WHERE registry_type = 'KG'
     AND COALESCE(shipped_tonnage_amount_override, FALSE) = FALSE
     AND (shipment_volume IS NULL OR railway_tariff IS NULL)
     AND shipped_tonnage_amount IS NOT NULL;
  GET DIAGNOSTICS v_kg_healed = ROW_COUNT;

  RAISE NOTICE 'Обнулено auto-сумм без базы/тарифа: KZ=%, KG=%', v_kz_healed, v_kg_healed;
END $$;

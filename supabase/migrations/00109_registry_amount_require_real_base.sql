-- 00109_registry_amount_require_real_base.sql
--
-- Клиент 2026-07-09: 00107 и 00108 применены, но суммы всё ещё
-- висят на строках без Входящего СНТ. Причина: в 00108 триггер и
-- heal-скрипт разрешали `rounded_volume_override` заменять базу.
-- То есть строка «loading=NULL, rounded_volume_override=60,
-- tariff=22442.24» → сумма = 60 × 22442.24 (мимо правила).
--
-- Правило клиента строже: для KZ база = loading_volume, для KG =
-- shipment_volume. Если базы нет — сумма NULL, независимо от
-- rounded_volume_override (это override округления, а не замена
-- базы) и shipped_tonnage_amount_override (это ручная сумма, но
-- она инвалидна без базы).
--
-- Фикс: v_base IS NULL → сумма := NULL, без OR-условий.

CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_base NUMERIC;
BEGIN
  IF NEW.registry_type = 'KZ' THEN
    v_base := NEW.loading_volume;
  ELSE
    v_base := NEW.shipment_volume;
  END IF;

  -- STRICT: и тариф, и база должны быть заполнены. Иначе сумма
  -- обнуляется, override любого рода игнорируется.
  IF NEW.railway_tariff IS NULL OR v_base IS NULL THEN
    NEW.shipped_tonnage_amount := NULL;
    RETURN NEW;
  END IF;

  -- Ручная override-сумма: уважаем, но только когда база и тариф
  -- реальные (см. проверку выше).
  IF NEW.shipped_tonnage_amount_override THEN
    RETURN NEW;
  END IF;

  -- Авто-расчёт. rounded_volume_override теперь только заменяет
  -- CEIL(v_base) — не подменяет саму v_base.
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

-- Heal: убираем `rounded_volume_override IS NULL` из WHERE — теперь
-- лечим ВСЕ строки где база пустая, независимо от округл-override.
DO $$
DECLARE
  v_kz_healed INT;
  v_kg_healed INT;
BEGIN
  UPDATE shipment_registry
     SET railway_tariff = railway_tariff
   WHERE registry_type = 'KZ'
     AND loading_volume IS NULL
     AND shipped_tonnage_amount IS NOT NULL;
  GET DIAGNOSTICS v_kz_healed = ROW_COUNT;

  UPDATE shipment_registry
     SET railway_tariff = railway_tariff
   WHERE registry_type = 'KG'
     AND shipment_volume IS NULL
     AND shipped_tonnage_amount IS NOT NULL;
  GET DIAGNOSTICS v_kg_healed = ROW_COUNT;

  RAISE NOTICE 'Обнулено сумм на строках без базы: KZ=%, KG=%', v_kz_healed, v_kg_healed;
END $$;

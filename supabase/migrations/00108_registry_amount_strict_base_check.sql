-- 00108_registry_amount_strict_base_check.sql
--
-- Клиент 2026-07-09 (KZ/26/022): в KZ-реестре есть строки где
-- Входящее СНТ (loading_volume) пусто, а сумма всё равно
-- заполнена. Правило клиента: «сумма = тариф × Входящее СНТ»
-- (для KZ; для KG — по Исходящему). Если любой из входов
-- пуст — сумма ДОЛЖНА быть пустой. Даже если override=true.
--
-- Сейчас override=true возвращает управление в начале триггера
-- и оставляет старую сумму. Так по всей истории приложения были
-- поставлены суммы, для которых уже нет базы. Это ломает
-- бизнес-инвариант.
--
-- Фикс: base-и-tariff проверка идёт ДО override. Если базы или
-- тарифа нет — сумма := NULL и выход. override уважается только
-- когда оба входа присутствуют.
--
-- Heal-скрипт: no-op self-UPDATE прогонит триггер на всех
-- «залипших» строках по всей БД.

CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_base NUMERIC;
BEGIN
  -- База объёма зависит от KG/KZ (см. 00086).
  IF NEW.registry_type = 'KZ' THEN
    v_base := NEW.loading_volume;
  ELSE
    v_base := NEW.shipment_volume;
  END IF;

  -- STRICT: сумма требует и тарифа, и базы (или ручного round-override,
  -- который заменяет базу). Если чего-то нет — сумма NULL, override НЕ
  -- уважается (иначе ломается инвариант «сумма = тариф × база»).
  IF NEW.railway_tariff IS NULL
     OR (v_base IS NULL AND NEW.rounded_volume_override IS NULL) THEN
    NEW.shipped_tonnage_amount := NULL;
    RETURN NEW;
  END IF;

  -- Override теперь: пользователь ввёл сумму вручную, входы валидны —
  -- уважаем.
  IF NEW.shipped_tonnage_amount_override THEN
    RETURN NEW;
  END IF;

  -- Обычный авто-расчёт.
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

-- Heal: KZ-строки где loading_volume=NULL и сумма НЕ NULL.
-- (У KZ база — loading; для KG — shipment. Обе стороны в одном
-- DO блоке.) No-op self-UPDATE прогоняет BEFORE-триггер, который
-- теперь чистит сумму без оглядки на override.
DO $$
DECLARE
  v_kz_healed INT;
  v_kg_healed INT;
BEGIN
  UPDATE shipment_registry
     SET railway_tariff = railway_tariff
   WHERE registry_type = 'KZ'
     AND loading_volume IS NULL
     AND rounded_volume_override IS NULL
     AND shipped_tonnage_amount IS NOT NULL;
  GET DIAGNOSTICS v_kz_healed = ROW_COUNT;

  UPDATE shipment_registry
     SET railway_tariff = railway_tariff
   WHERE registry_type = 'KG'
     AND shipment_volume IS NULL
     AND rounded_volume_override IS NULL
     AND shipped_tonnage_amount IS NOT NULL;
  GET DIAGNOSTICS v_kg_healed = ROW_COUNT;

  RAISE NOTICE 'Обнулено «залипших» сумм: KZ=%, KG=%', v_kz_healed, v_kg_healed;
END $$;

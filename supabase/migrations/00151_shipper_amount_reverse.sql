-- 00151_shipper_amount_reverse.sql
--
-- «Сумма 3» — сумма грузоотправления. Клиент 2026-08-15:
--
--   «Сумма 3 - сумма грузоотправления = тариф грузоотправления *
--    объем входящего снт - обратная формула - тариф груоотправления =
--    сумма грузоотправления / объем входящего снт»
--
-- ЧТО УЖЕ СОВПАДАЕТ. Прямая формула и база менять НЕ нужно:
-- compute_registry_amount (00113) считает additional_expenses как
-- округл. база × manager_tariff, а база в KZ — это loading_volume,
-- то есть входящее СНТ. Ровно то, что просит клиент.
--
-- ЧЕГО НЕ ХВАТАЛО. Обратной формулы на уровне СТРОКИ реестра. На
-- уровне сделки она есть с 00120 (deals.shipper_actual_tariff =
-- additional_expenses_amount ÷ входящее СНТ), а в строке ручной ввод
-- суммы просто взводил флаг additional_expenses_override и замораживал
-- её — тариф оставался старым и переставал соответствовать сумме.
--
-- ЧТО ДЕЛАЕТ ЭТА МИГРАЦИЯ.
--   1. Учит триггер считать Сумму 3 в обе стороны — как Сумму 2 (00150):
--        правишь тариф → сумма  = тариф × округл. база
--        правишь сумму → тариф  = сумма ÷ округл. база
--   2. Разбирает накопленные override-строки: выводит из ручной суммы
--      тариф и снимает флаг. САМА СУММА ПРИ ЭТОМ НЕ МЕНЯЕТСЯ — это
--      проверяется построчно в конце файла, с падением при расхождении.
--
-- ⚠ БАЗУ НЕ ТРОГАЕМ. Соблазн был переписать её на loading_volume
-- «как в ТЗ», но у KG-строк база — исходящее СНТ (shipment_volume), и
-- такая замена обнулила бы там Сумму 3 при первой же правке строки.
-- Клиент описывал KZ, где база и так входящее СНТ. Поэтому везде
-- используется ровно тот же v_effective_base, что и раньше.
--
-- ЧТО ОСТАЁТСЯ КАК БЫЛО.
--   • Флаг additional_expenses_override не удаляется (миграции
--     append-only) и продолжает работать в одном-единственном случае:
--     сумму ввели, а базы нет — тариф вывести не из чего, и введённое
--     человеком число надо сохранить.
--   • Суммы 1 и 2, роллапы, балансы, галочка «Грузоотправитель в цене»
--     не тронуты.

-- ── Двусторонняя формула ────────────────────────────────────────────
-- Блоки Суммы 1 и Суммы 2 переносятся из 00150 ДОСЛОВНО. Меняется
-- только блок Суммы 3.

CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_base NUMERIC;
  v_effective_base NUMERIC;      -- база сумм 1 и 3 (как в 00113)
  v_effective_base_old NUMERIC;  -- она же до правки, только для UPDATE
  v_in_base NUMERIC;             -- округл. входящее СНТ (база Суммы 2)
  v_in_base_old NUMERIC;
  v_amount_edited BOOLEAN;       -- правили сумму 2, а не тариф
  v_exp_edited BOOLEAN;          -- правили сумму 3, а не тариф
BEGIN
  IF NEW.registry_type = 'KZ' THEN
    v_base := NEW.loading_volume;
  ELSE
    v_base := NEW.shipment_volume;
  END IF;

  IF NEW.rounded_volume_override IS NOT NULL THEN
    v_effective_base := NEW.rounded_volume_override;
  ELSIF v_base IS NULL THEN
    v_effective_base := NULL;
  ELSIF NEW.round_volume THEN
    v_effective_base := CEIL(v_base);
  ELSE
    v_effective_base := v_base;
  END IF;

  -- Округл. входящее СНТ. В KZ совпадает с v_effective_base.
  IF NEW.rounded_volume_override IS NOT NULL AND NEW.registry_type = 'KZ' THEN
    v_in_base := NEW.rounded_volume_override;
  ELSIF NEW.loading_volume IS NULL THEN
    v_in_base := NULL;
  ELSIF NEW.round_volume THEN
    v_in_base := CEIL(NEW.loading_volume);
  ELSE
    v_in_base := NEW.loading_volume;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.registry_type = 'KZ' THEN
      v_effective_base_old := OLD.loading_volume;
    ELSE
      v_effective_base_old := OLD.shipment_volume;
    END IF;
    IF OLD.rounded_volume_override IS NOT NULL THEN
      v_effective_base_old := OLD.rounded_volume_override;
    ELSIF v_effective_base_old IS NULL THEN
      v_effective_base_old := NULL;
    ELSIF OLD.round_volume THEN
      v_effective_base_old := CEIL(v_effective_base_old);
    END IF;

    IF OLD.rounded_volume_override IS NOT NULL AND OLD.registry_type = 'KZ' THEN
      v_in_base_old := OLD.rounded_volume_override;
    ELSIF OLD.loading_volume IS NULL THEN
      v_in_base_old := NULL;
    ELSIF OLD.round_volume THEN
      v_in_base_old := CEIL(OLD.loading_volume);
    ELSE
      v_in_base_old := OLD.loading_volume;
    END IF;
  END IF;

  -- === Сумма 1: тариф логистов × база ===============================
  IF NEW.shipped_tonnage_amount_override THEN
    NULL;
  ELSIF NEW.railway_tariff IS NULL OR v_base IS NULL THEN
    NEW.shipped_tonnage_amount := NULL;
  ELSE
    NEW.shipped_tonnage_amount := v_effective_base * NEW.railway_tariff;
  END IF;

  -- === Сумма 3: сумма грузоотправления (двусторонняя, 00151) ========
  v_exp_edited :=
    (TG_OP = 'INSERT'
       AND NEW.additional_expenses IS NOT NULL
       AND NEW.manager_tariff IS NULL)
    OR
    (TG_OP = 'UPDATE'
       AND NEW.additional_expenses IS DISTINCT FROM OLD.additional_expenses
       AND NEW.manager_tariff IS NOT DISTINCT FROM OLD.manager_tariff);

  IF v_exp_edited THEN
    -- Обратная формула: тариф = сумма ÷ округл. база.
    IF NEW.additional_expenses IS NULL THEN
      NEW.manager_tariff := NULL;
      NEW.additional_expenses_override := FALSE;
    ELSIF COALESCE(v_effective_base, 0) > 0 THEN
      NEW.manager_tariff := NEW.additional_expenses / v_effective_base;
      NEW.additional_expenses_override := FALSE;
    ELSE
      -- Базы нет — тариф вывести не из чего. Единственный случай, где
      -- флаг ещё нужен: он защищает ручную сумму от обнуления при
      -- следующей правке строки.
      NEW.additional_expenses_override := TRUE;
    END IF;

  ELSIF NEW.manager_tariff IS NOT NULL AND v_effective_base IS NOT NULL THEN
    NEW.additional_expenses := v_effective_base * NEW.manager_tariff;
    NEW.additional_expenses_override := FALSE;

  ELSIF COALESCE(NEW.additional_expenses_override, FALSE) THEN
    -- Строка без базы: сумма введена руками, тариф не выводится.
    NULL;

  ELSIF TG_OP = 'UPDATE'
        AND (NEW.manager_tariff IS DISTINCT FROM OLD.manager_tariff
             OR v_effective_base IS DISTINCT FROM v_effective_base_old) THEN
    -- Вход реально исчез. Посторонние правки строки сюда не попадают.
    NEW.additional_expenses := NULL;
  ELSIF TG_OP = 'INSERT' AND NEW.manager_tariff IS NULL THEN
    NULL;
  END IF;

  -- === Сумма 2: ЖД расходы поставщика (00150) =======================
  v_amount_edited :=
    (TG_OP = 'INSERT'
       AND NEW.supplier_railway_amount IS NOT NULL
       AND NEW.supplier_railway_tariff IS NULL)
    OR
    (TG_OP = 'UPDATE'
       AND NEW.supplier_railway_amount IS DISTINCT FROM OLD.supplier_railway_amount
       AND NEW.supplier_railway_tariff IS NOT DISTINCT FROM OLD.supplier_railway_tariff);

  IF v_amount_edited THEN
    IF NEW.supplier_railway_amount IS NULL THEN
      NEW.supplier_railway_tariff := NULL;
    ELSIF COALESCE(v_in_base, 0) > 0 THEN
      NEW.supplier_railway_tariff := NEW.supplier_railway_amount / v_in_base;
    END IF;

  ELSIF NEW.supplier_railway_tariff IS NOT NULL AND v_in_base IS NOT NULL THEN
    NEW.supplier_railway_amount := v_in_base * NEW.supplier_railway_tariff;

  ELSIF TG_OP = 'UPDATE'
        AND (NEW.supplier_railway_tariff IS DISTINCT FROM OLD.supplier_railway_tariff
             OR v_in_base IS DISTINCT FROM v_in_base_old) THEN
    NEW.supplier_railway_amount := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Разбор накопленных override-строк ───────────────────────────────
-- Снимок сумм ДО правки. Сверяем по нему построчно в конце: разошлась
-- хотя бы одна больше чем на копейку — миграция падает целиком.
--
-- Обычная временная таблица без ON COMMIT DROP: файл может исполняться
-- в автокоммите, и ON COMMIT DROP снёс бы снимок сразу после создания.
DROP TABLE IF EXISTS _m151_before;
CREATE TEMP TABLE _m151_before AS
SELECT id, additional_expenses AS amount_before, manager_tariff AS tariff_before
  FROM shipment_registry
 WHERE COALESCE(additional_expenses_override, FALSE)
    OR additional_expenses IS NOT NULL;

DO $$
DECLARE
  v_derived  INT;
  v_restored INT;
  v_kept     INT;
  v_moved    INT;
  v_worst    NUMERIC;
BEGIN
  -- Выводим тариф из ручной суммы там, где база есть. Саму сумму не
  -- трогаем — она остаётся той, что ввёл человек, а тариф подстраивается
  -- под неё. Это и есть обратная формула.
  --
  -- Тариф считаем напрямую, а не «прогоном триггера»: обратная формула
  -- внутри срабатывает по IS DISTINCT FROM на сумме, а сумма здесь как
  -- раз и не должна меняться. Выражение базы повторяет v_effective_base
  -- из триггера: сперва ручное округление, иначе объём по типу реестра
  -- с учётом round_volume.
  UPDATE shipment_registry r
     SET manager_tariff = r.additional_expenses / (
           CASE
             WHEN r.rounded_volume_override IS NOT NULL THEN r.rounded_volume_override
             WHEN r.registry_type = 'KZ' THEN
               CASE WHEN r.round_volume THEN CEIL(r.loading_volume) ELSE r.loading_volume END
             ELSE
               CASE WHEN r.round_volume THEN CEIL(r.shipment_volume) ELSE r.shipment_volume END
           END),
         additional_expenses_override = FALSE
   WHERE COALESCE(r.additional_expenses_override, FALSE)
     AND r.additional_expenses IS NOT NULL
     AND COALESCE(
           CASE
             WHEN r.rounded_volume_override IS NOT NULL THEN r.rounded_volume_override
             WHEN r.registry_type = 'KZ' THEN
               CASE WHEN r.round_volume THEN CEIL(r.loading_volume) ELSE r.loading_volume END
             ELSE
               CASE WHEN r.round_volume THEN CEIL(r.shipment_volume) ELSE r.shipment_volume END
           END, 0) > 0;
  GET DIAGNOSTICS v_derived = ROW_COUNT;

  -- Проставив тариф, мы запустили прямую формулу, и она пересчитала
  -- сумму из тарифа. Там, где сумма на объём нацело не делится, это
  -- даёт осадок в доли тиына: 1000 ÷ 30 = 33.3333, обратно 30 × 33.3333
  -- = 999.9990. На экране (2 знака) не видно, но в базе цифра уже не
  -- та, что ввёл человек.
  --
  -- Возвращаем исходные суммы. Обратная ветка триггера ловит правку
  -- суммы, сохраняет её как есть и выводит из неё тот же тариф —
  -- поэтому второй проход сходится и осадка не оставляет.
  UPDATE shipment_registry r
     SET additional_expenses = b.amount_before
    FROM _m151_before b
   WHERE r.id = b.id
     AND r.additional_expenses IS DISTINCT FROM b.amount_before;
  GET DIAGNOSTICS v_restored = ROW_COUNT;

  SELECT count(*) INTO v_kept
    FROM shipment_registry
   WHERE COALESCE(additional_expenses_override, FALSE);

  -- Допуска нет: после восстановления суммы обязаны совпасть точь-в-точь.
  SELECT count(*), COALESCE(MAX(ABS(COALESCE(r.additional_expenses, 0) - COALESCE(b.amount_before, 0))), 0)
    INTO v_moved, v_worst
    FROM _m151_before b
    JOIN shipment_registry r ON r.id = b.id
   WHERE r.additional_expenses IS DISTINCT FROM b.amount_before;

  IF v_moved > 0 THEN
    RAISE EXCEPTION
      '00151: Сумма 3 сдвинулась в % строках, максимум на %. Миграция отменена.',
      v_moved, v_worst;
  END IF;

  RAISE NOTICE '00151: тариф выведен из ручной суммы в % строках; % сумм восстановлено после округления тарифа; % строк остались ручными (нет базы); ни одна сумма не изменилась',
    v_derived, v_restored, v_kept;
END $$;

DROP TABLE IF EXISTS _m151_before;

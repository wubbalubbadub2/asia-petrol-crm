-- Test: коды груза из таблицы клиента (00157).
--
-- Клиент 27.08.2026 прислал «Нефтепродукты_все_коды_ЕТСНГ_ГНГ_ТНВЭД» —
-- 21 пару «продукт + завод». Утреннюю таблицу он же назвал неверной, и
-- часть кодов в новой ДРУГАЯ, поэтому здесь закреплены именно новые
-- значения: тихая правка кода в миграции обязана уронить тест.
--
-- Главное, что проверяется: одного продукта мало. У ПКОП мазут двух
-- марок, и коды у них разные — если марки схлопнуть в общий «Мазут»,
-- в заявку уедет чужой ГНГ.

BEGIN;

DO $$
DECLARE
  v_gng_100 TEXT;
  v_gng_150 TEXT;
  v_tnved_150 TEXT;
  v_cnt INT;
  v_dup INT;
BEGIN
  -- ── 1. Таблица клиента загружена целиком ──
  SELECT COUNT(*) INTO v_cnt FROM transport_cargo_codes;
  IF v_cnt <> 21 THEN
    RAISE EXCEPTION '1. в матрице % строк вместо 21', v_cnt;
  END IF;

  -- ── 2. У ПКОП две марки мазута с РАЗНЫМИ кодами ──
  SELECT c.gng_code INTO v_gng_100
    FROM transport_cargo_codes c
    JOIN fuel_types ft ON ft.id = c.fuel_type_id
    JOIN factories f ON f.id = c.factory_id
   WHERE f.name = 'ПКОП' AND ft.name = 'Мазут топочный 100, 1,00%';

  SELECT c.gng_code, c.tnved_code INTO v_gng_150, v_tnved_150
    FROM transport_cargo_codes c
    JOIN fuel_types ft ON ft.id = c.fuel_type_id
    JOIN factories f ON f.id = c.factory_id
   WHERE f.name = 'ПКОП' AND ft.name = 'Мазут топочный 100, 1,50%';

  IF v_gng_100 IS DISTINCT FROM '27101966' OR v_gng_150 IS DISTINCT FROM '27101967' THEN
    RAISE EXCEPTION '2. у ПКОП ГНГ должны различаться: 1,00%% → 27101966, 1,50%% → 27101967, получили % и %',
      v_gng_100, v_gng_150;
  END IF;
  IF v_tnved_150 IS DISTINCT FROM '2710196401' THEN
    RAISE EXCEPTION '3. у мазута 1,50%% ТН ВЭД должен быть 2710196401, получили %', v_tnved_150;
  END IF;

  -- ── 3. Коды, исправленные второй таблицей ──
  -- Утром у Жараса стояло 27101967, у Талды сервис 27101966, у Актобе
  -- Нефтепереработки 27101967 — всё это оказалось неверным.
  IF (SELECT c.gng_code FROM transport_cargo_codes c
        JOIN factories f ON f.id = c.factory_id WHERE f.name = 'Жарас') <> '27101962' THEN
    RAISE EXCEPTION '4. у Жараса ГНГ должен быть 27101962';
  END IF;

  IF (SELECT c.gng_code FROM transport_cargo_codes c
        JOIN factories f ON f.id = c.factory_id
        JOIN fuel_types ft ON ft.id = c.fuel_type_id
       WHERE f.name = 'Талды сервис' AND ft.name = 'Мазут топочный М-100') <> '27101967' THEN
    RAISE EXCEPTION '5. у Талды сервис по мазуту ГНГ должен быть 27101967';
  END IF;

  -- ── 4. Двойники заводов отключены ──
  SELECT COUNT(*) INTO v_dup
    FROM factories
   WHERE name IN ('Амангельдинский ГПЗ', 'Kyzylorda Refinery', 'Batys Trans Group')
     AND is_active;
  IF v_dup <> 0 THEN
    RAISE EXCEPTION '6. двойники заводов остались активными: %', v_dup;
  END IF;

  -- ── 5. Общий «Мазут» кодов не получил ──
  -- Иначе менеджер выберет его и уедет с кодом непонятно какой марки.
  IF EXISTS (
    SELECT 1 FROM transport_cargo_codes c
      JOIN fuel_types ft ON ft.id = c.fuel_type_id
     WHERE ft.name = 'Мазут'
  ) THEN
    RAISE EXCEPTION '7. у общего «Мазута» появились коды — марка должна выбираться явно';
  END IF;

  RAISE NOTICE 'OK: таблица кодов загружена, марки мазута различаются, двойники отключены';
END $$;

ROLLBACK;

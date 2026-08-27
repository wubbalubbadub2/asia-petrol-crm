-- 00157_cargo_codes_full_table.sql
--
-- Полная таблица кодов груза от клиента (27.08.2026,
-- «Нефтепродукты_все_коды_ЕТСНГ_ГНГ_ТНВЭД.xlsx») — 21 пара «продукт +
-- завод» с кодами ЕТСНГ, ГНГ и ТН ВЭД.
--
-- ЧТО ОНА МЕНЯЕТ ПО СРАВНЕНИЮ С УТРЕННЕЙ (00154 / 00155):
--
--   1. Появился ТРЕТИЙ код — ТН ВЭД. Колонки под него не было.
--   2. Часть кодов ГНГ ДРУГИЕ: у Жараса было 27101967, стало 27101962;
--      у Талды Сервис было 27101966, стало 27101967; у Актобе
--      Нефтепереработки было 27101967, стало 27101966. Клиент про первую
--      таблицу так и сказал: «таблицу неверную отправили». Поэтому
--      матрица не дополняется, а ПЕРЕСОБИРАЕТСЯ целиком.
--   3. Продуктов шесть, а не один: кроме мазута есть печное топливо,
--      судовое DMA и нафта, и у ПКОП мазут двух марок (1,00% и 1,50%) с
--      РАЗНЫМИ кодами ГНГ и ТН ВЭД. Значит «Мазут» одной строкой
--      справочника коды не определяет.
--   4. Заводы названы так, как они уже заведены в CRM: АГПЗ, КМНПЗ,
--      АНПЗ, ПКОП. 00154 брала имена из утренней таблицы и завела трёх
--      двойников — «Амангельдинский ГПЗ», «Kyzylorda Refinery» и
--      «Batys Trans Group». Это те же заводы: у них совпадают станции
--      отправления (Аса, Белкол, Тендык).

ALTER TABLE transport_cargo_codes ADD COLUMN IF NOT EXISTS tnved_code TEXT;
COMMENT ON COLUMN transport_cargo_codes.tnved_code IS 'Код ТН ВЭД груза (в таблице клиента 27.08.2026)';

-- ═══════════════════════════════════════════════════════════════
-- 1. Двойники заводов, заведённые 00154
-- ═══════════════════════════════════════════════════════════════
-- Не удаляем и не сливаем: на завод могут ссылаться сделки, реестр и
-- ДТ-КТ, а переподвязка чужих ссылок — не дело этой миграции. Помечаем
-- неактивными, чтобы они пропали из выпадающих списков, и ТОЛЬКО если
-- на них никто не ссылается. Ссылается — оставляем как есть и пишем в
-- NOTICE: разбирать такое должен человек.
--
-- Станцию отправления, если она у двойника проставлена, а у настоящего
-- завода нет, переносим: данные из утренней таблицы верные, ошибочным
-- было только имя.

DO $$
DECLARE
  r         RECORD;
  v_dup     UUID;
  v_real    UUID;
  v_refs    INT;
  v_station UUID;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('Амангельдинский ГПЗ', 'АГПЗ'),
      ('Kyzylorda Refinery',  'КМНПЗ'),
      ('Batys Trans Group',   'АНПЗ')
    ) AS t(dup, real_name)
  LOOP
    SELECT id, departure_station_id INTO v_dup, v_station
      FROM factories WHERE name = r.dup;
    SELECT id INTO v_real FROM factories WHERE name = r.real_name;

    IF v_dup IS NULL OR v_real IS NULL THEN
      CONTINUE;
    END IF;

    SELECT
      (SELECT COUNT(*) FROM deals WHERE factory_id = v_dup)
      + (SELECT COUNT(*) FROM shipment_registry WHERE factory_id = v_dup)
      + (SELECT COUNT(*) FROM tariffs WHERE factory_id = v_dup)
      + (SELECT COUNT(*) FROM stations WHERE default_factory_id = v_dup)
      + (SELECT COUNT(*) FROM transport_requests WHERE consignor_factory_id = v_dup)
    INTO v_refs;

    IF v_refs > 0 THEN
      RAISE NOTICE '  ДВОЙНИК «%» оставлен: на него ссылаются % записей, слить вручную с «%»',
        r.dup, v_refs, r.real_name;
      CONTINUE;
    END IF;

    UPDATE factories
       SET departure_station_id = COALESCE(departure_station_id, v_station)
     WHERE id = v_real;

    UPDATE factories SET is_active = FALSE WHERE id = v_dup;
    RAISE NOTICE '  двойник «%» отключён, настоящий завод — «%»', r.dup, r.real_name;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. Продукты, заводы, станции и сама матрица
-- ═══════════════════════════════════════════════════════════════
-- Продукт в этой таблице — не «Мазут» вообще, а конкретная марка: у
-- ПКОП мазут 1,00% и 1,50% дают разные коды. Поэтому марки заводятся
-- отдельными позициями справочника ГСМ, а общий «Мазут» остаётся как
-- был: на нём висят сделки и реестр.
--
-- Матрица пересобирается ЦЕЛИКОМ: прежние строки пришли из таблицы,
-- которую клиент назвал неверной. Если между 00155 и этой миграцией
-- кто-то правил коды руками, правки потеряются — миграция сообщает,
-- сколько строк удалила.
--
-- Сверка названий — по «голому» имени и вхождению, как в 00154, и БЕЗ
-- [:alnum:] и lower() для кириллицы: в локали C они её не понимают.

DO $$
DECLARE
  r        RECORD;
  v_fuel   UUID;
  v_fact   UUID;
  v_stat   UUID;
  v_wiped  INT;
  v_new_f  INT := 0;
  v_new_p  INT := 0;
  v_rows   INT := 0;
  v_nostat INT := 0;
BEGIN
  DELETE FROM transport_cargo_codes;
  GET DIAGNOSTICS v_wiped = ROW_COUNT;
  RAISE NOTICE 'Прежняя матрица очищена: удалено строк %', v_wiped;

  FOR r IN
    SELECT * FROM (VALUES
      ('Мазут топочный М-100',      'Актобе Нефтепереработка', 'Актобе-2',  '221066', '27101966', '2710196201'),
      ('Мазут топочный М-100',      'Каратау Транс Сервис',    'Арысь 1',   '221066', '27101962', '2710196201'),
      ('Мазут топочный М-100',      'Жарас',                   'Жанатас',   '221066', '27101962', '2710196201'),
      ('Мазут топочный М-100',      'АГПЗ',                    'Аса',       '221066', '27101967', '2710196201'),
      ('Мазут топочный М-100',      'Ural Petroleum',          'Пойма',     '221066', '27101966', '2710196201'),
      ('Мазут топочный М-100',      'Талды сервис',            'Жинишке',   '221066', '27101967', '2710196201'),
      ('Мазут топочный М-100',      'КМНПЗ',                   'Белкол',    '221066', '27101966', '2710196201'),
      ('Мазут топочный М-100',      'Meeras',                  'Кандыагаш', '221066', '27101966', '2710196201'),
      ('Мазут топочный М-100',      'Эко Рефайнинг',           'Жанаозен',  '221066', '27101967', '2710196201'),
      ('Мазут топочный М-100',      'RAMCO REFINERY',          'Темир',     '221066', '27101966', '2710196201'),
      ('Мазут топочный М-100',      'Базис Ойл',               'Кульсары',  '221066', '27101967', '2710196201'),
      ('Мазут топочный М-100',      'АНПЗ',                    'Тендык',    '221066', '27101967', '2710196201'),
      ('Мазут топочный 100, 1,00%', 'ПКОП',                    'Текесу',    '221066', '27101966', '2710196201'),
      ('Мазут топочный 100, 1,50%', 'ПКОП',                    'Текесу',    '221066', '27101967', '2710196401'),
      ('Печное топливо',            'Талды сервис',            'Жинишке',   '214096', '27101951', '2710194600'),
      ('Судовое топливо DMA',       'Meeras',                  'Кандыагаш', '214109', '27101931', '2710194600'),
      ('Судовое топливо DMA',       'Ural Petroleum',          'Пойма',     '214109', '27101948', '2710196209'),
      ('Судовое топливо DMA',       'Актобе Нефтепереработка', 'Актобе-2',  '214109', '27101931', '2710194600'),
      ('Судовое топливо DMA',       'RAMCO REFINERY',          'Темир',     '214109', '27101948', '2710194600'),
      ('Судовое топливо DMA',       'Базис Ойл',               'Кульсары',  '214109', '27101948', '2710194600'),
      ('Нафта',                     'КМНПЗ',                   'Белкол',    '226069', '27101211', '2710121109')
    ) AS t(product, factory, station, etsng, gng, tnved)
  LOOP
    -- ── Продукт ──
    SELECT id INTO v_fuel FROM fuel_types WHERE btrim(name) = r.product LIMIT 1;
    IF v_fuel IS NULL THEN
      INSERT INTO fuel_types (name, is_active, sort_order)
      VALUES (r.product, TRUE, 100)
      RETURNING id INTO v_fuel;
      v_new_p := v_new_p + 1;
      RAISE NOTICE '  заведён продукт: %', r.product;
    END IF;

    -- Полное наименование для печати в заявке — из этой же таблицы,
    -- если его ещё не проставили руками.
    UPDATE fuel_types SET full_name = COALESCE(full_name, r.product) WHERE id = v_fuel;

    -- ── Завод ──
    SELECT f.id INTO v_fact
      FROM factories f
     WHERE f.is_active
       AND (
         regexp_replace(f.name,   '[[:space:]«»"''.,()/-]', '', 'g')
           = regexp_replace(r.factory, '[[:space:]«»"''.,()/-]', '', 'g')
         OR position(
              regexp_replace(r.factory, '[[:space:]«»"''.,()/-]', '', 'g')
              IN regexp_replace(f.name, '[[:space:]«»"''.,()/-]', '', 'g')
            ) > 0
       )
     ORDER BY length(f.name)
     LIMIT 1;

    IF v_fact IS NULL THEN
      INSERT INTO factories (name, is_active) VALUES (r.factory, TRUE)
      RETURNING id INTO v_fact;
      v_new_f := v_new_f + 1;
      RAISE NOTICE '  заведён завод: %', r.factory;
    END IF;

    -- ── Станция отправления ──
    -- «Актобе-2» и «Актобе 2» — одна станция, поэтому сверяем без
    -- пробелов и дефисов.
    SELECT s.id INTO v_stat
      FROM stations s
     WHERE regexp_replace(s.name, '[[:space:]-]', '', 'g')
         = regexp_replace(r.station, '[[:space:]-]', '', 'g')
     ORDER BY (s.type IN ('departure', 'both')) DESC
     LIMIT 1;

    IF v_stat IS NULL THEN
      v_nostat := v_nostat + 1;
      RAISE NOTICE '  станция «%» не найдена (завод %) — завести в справочнике станций', r.station, r.factory;
    ELSE
      UPDATE factories SET departure_station_id = v_stat
       WHERE id = v_fact AND departure_station_id IS DISTINCT FROM v_stat;
    END IF;

    INSERT INTO transport_cargo_codes (factory_id, fuel_type_id, etsng_code, gng_code, tnved_code)
    VALUES (v_fact, v_fuel, r.etsng, r.gng, r.tnved)
    ON CONFLICT (factory_id, fuel_type_id) DO UPDATE
      SET etsng_code = EXCLUDED.etsng_code,
          gng_code   = EXCLUDED.gng_code,
          tnved_code = EXCLUDED.tnved_code;
    v_rows := v_rows + 1;
  END LOOP;

  RAISE NOTICE 'Матрица собрана: строк %, заведено продуктов %, заводов %, без станции отправления %',
    v_rows, v_new_p, v_new_f, v_nostat;
  RAISE NOTICE 'Общий «Мазут» остался без кодов намеренно: коды зависят от марки, в заявке выбирайте конкретную.';
END $$;

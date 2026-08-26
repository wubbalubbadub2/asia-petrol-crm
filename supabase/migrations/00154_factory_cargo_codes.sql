-- 00154_factory_cargo_codes.sql
--
-- Коды ЕТСНГ и ГНГ переезжают на ЗАВОД. Плюс станция отправления.
--
-- Клиент 26.08.2026 прислал таблицу «КОД ГНГ, ТНВЭД.xlsx»: завод →
-- станция отправления → «Код ЕТСНГ, ГНГ». ЕТСНГ у всех один (221066), а
-- ГНГ различается по заводу — 27101966 или 27101967. То есть код зависит
-- не от продукта в справочнике ГСМ, как я заложил в 00153, а от того,
-- ЧЕЙ это мазут: марка у заводов разная.
--
-- Колонки fuel_types.etsng_code / gng_code, добавленные в 00153,
-- остаются (миграции append-only), но источником больше не считаются:
-- форма заявки берёт коды у грузоотправителя. Ничего не заполнялось —
-- 00153 приехала накануне, поля стояли пустыми.
--
-- Станция отправления нужна затем же: в образце ОРТ грузоотправитель
-- RAMCO REFINERY, и маршрут начинается с «Темир (660308)» — ровно та
-- станция, что стоит у завода в этой таблице.

ALTER TABLE factories ADD COLUMN IF NOT EXISTS etsng_code TEXT;
ALTER TABLE factories ADD COLUMN IF NOT EXISTS gng_code TEXT;
ALTER TABLE factories ADD COLUMN IF NOT EXISTS departure_station_id UUID REFERENCES stations(id);

COMMENT ON COLUMN factories.etsng_code IS 'Код ЕТСНГ груза этого завода (в таблице клиента у всех 221066)';
COMMENT ON COLUMN factories.gng_code IS 'Код ГНГ груза этого завода: 27101966 или 27101967';
COMMENT ON COLUMN factories.departure_station_id IS 'Станция отправления завода — начало маршрута';

-- ═══════════════════════════════════════════════════════════════
-- Данные из таблицы клиента
-- ═══════════════════════════════════════════════════════════════
-- Заводы в базе заведены с правовой формой («ТОО "RAMCO REFINERY"»), а
-- в таблице клиента — без неё. Поэтому сверяем по «голому» имени и по
-- вхождению одного в другое. Не нашли — заводим завод, он всё равно
-- понадобится как грузоотправитель; каждый заведённый печатается в
-- NOTICE, чтобы дубль под другим названием было видно сразу.
--
-- Миграция НЕ падает, если станция отправления не нашлась: станции
-- клиент отдельно не присылал, часть из них может быть не заведена.
-- Такие строки перечисляются в NOTICE, их дозаполняют в справочнике.

DO $$
DECLARE
  r          RECORD;
  v_factory  UUID;
  v_station  UUID;
  v_created  INT := 0;
  v_updated  INT := 0;
  v_no_stat  INT := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('Талды сервис',              'Жинишке',    '221066', '27101966'),
      ('Эко Рефайнинг',             'Жанаозен',   '221066', '27101967'),
      ('RAMCO REFINERY',            'Темир',      '221066', '27101966'),
      ('Базис Ойл',                 'Кульсары',   '221066', '27101967'),
      ('Kyzylorda Refinery',        'Белкол',     '221066', '27101966'),
      ('Амангельдинский ГПЗ',       'Аса',        '221066', '27101967'),
      ('Актобе Нефтепереработка',   'Актобе-2',   '221066', '27101967'),
      ('Meeras',                    'Кандыагаш',  '221066', '27101966'),
      ('Batys Trans Group',         'Тендык',     '221066', '27101967'),
      ('Актау Петролеум ЛТД',       'Актау порт', '221066', '27101967'),
      ('Жарас',                     'Жанатас',    '221066', '27101967'),
      ('Ural Petroleum',            'Пойма',      '221066', '27101966')
    ) AS t(factory, station, etsng, gng)
  LOOP
    -- ── Завод ──
    -- Сверяем по «голому» имени: без пробелов, кавычек, точек и дефисов.
    -- ВАЖНО: НЕ через [:alnum:] и не полагаясь на lower() для кириллицы.
    -- В локали C (а на ней собирается база в CI) класс [:alnum:] считает
    -- буквами только латиницу, поэтому «Талды сервис» превращалось в
    -- пустую строку и совпадало со всеми остальными русскими
    -- названиями разом. Явный список мусорных символов от локали не
    -- зависит.
    --
    -- Правовую форму не вырезаем списком, а берём вхождением: в базе
    -- завод записан как «ТОО "RAMCO REFINERY"», в таблице клиента —
    -- «RAMCO REFINERY», и одно содержит другое. Так же ловятся ОсОО, АО
    -- и любые другие приписки, которых мы не предусмотрели.
    SELECT f.id INTO v_factory
      FROM factories f
     WHERE length(regexp_replace(r.factory, '[[:space:]«»"''.,()/-]', '', 'g')) >= 5
       AND (
         lower(regexp_replace(f.name,     '[[:space:]«»"''.,()/-]', '', 'g'))
           = lower(regexp_replace(r.factory, '[[:space:]«»"''.,()/-]', '', 'g'))
         OR position(
              regexp_replace(r.factory, '[[:space:]«»"''.,()/-]', '', 'g')
              IN regexp_replace(f.name, '[[:space:]«»"''.,()/-]', '', 'g')
            ) > 0
         OR position(
              regexp_replace(f.name, '[[:space:]«»"''.,()/-]', '', 'g')
              IN regexp_replace(r.factory, '[[:space:]«»"''.,()/-]', '', 'g')
            ) > 0
       )
     ORDER BY length(f.name)
     LIMIT 1;

    IF v_factory IS NULL THEN
      INSERT INTO factories (name, is_active) VALUES (r.factory, TRUE)
      RETURNING id INTO v_factory;
      v_created := v_created + 1;
      RAISE NOTICE '  заведён завод: %', r.factory;
    ELSE
      v_updated := v_updated + 1;
    END IF;

    -- ── Станция отправления ──
    SELECT s.id INTO v_station
      FROM stations s
     WHERE lower(btrim(s.name)) = lower(btrim(r.station))
     ORDER BY (s.type IN ('departure', 'both')) DESC
     LIMIT 1;

    IF v_station IS NULL THEN
      v_no_stat := v_no_stat + 1;
      RAISE NOTICE '  СТАНЦИЯ НЕ НАЙДЕНА: % (завод %) — завести в справочнике станций', r.station, r.factory;
    END IF;

    -- Коды проставляем всегда, станцию — только если нашли: пустая
    -- ссылка лучше, чем ссылка не на ту станцию.
    UPDATE factories
       SET etsng_code = r.etsng,
           gng_code   = r.gng,
           departure_station_id = COALESCE(v_station, departure_station_id)
     WHERE id = v_factory;

    v_station := NULL;
  END LOOP;

  RAISE NOTICE 'Коды ЕТСНГ/ГНГ проставлены: заводов найдено %, заведено %, без станции отправления %',
    v_updated, v_created, v_no_stat;
END $$;

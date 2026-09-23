-- 00163_fix_station_type_references.sql
--
-- Клиент 2026-09-19: «Если есть тип станции, то нужно его оставить и
-- пусть будут две станции с одинаковым именем, но с разными типами. Нам
-- лучше логику починить… в реестре на станцию отправления была выбрана
-- станция с типом "назначение". Это наше упущение, что мы дали такой
-- выбор пользователю. Теперь нам нужно поменять везде станции и привести
-- все в порядок».
--
-- ЧТО ГОВОРЯТ ДАННЫЕ (18–19.09.2026, боевая база).
-- Одинаковое название у двух записей ровно одно — «ст. Мерке»
-- (departure + destination). Ссылок, где выбрана запись НЕ той роли и при
-- этом существует одноимённая запись нужной роли, — 53:
--   реестр, станция назначения   — 41 (стоит Мерке-отправление);
--   реестр, станция отправления  —  4 (стоит Мерке-назначение);
--   тарифы, станция назначения   —  4 (стоит Мерке-отправление);
--   тарифы, станция отправления  —  4 (стоит Мерке-назначение).
-- Это и есть последствие свободного выбора в интерфейсе.
--
-- Отдельно: в КГ/26/411 неверно заполнен был НЕ реестр, а справочник
-- тарифов — там в поле «станция отправления» стояла Мерке-назначение, а
-- в другой ставке в поле «станция назначения» — Мерке-отправление.
-- Строки реестра как раз ссылались на записи правильных ролей, поэтому
-- ключ и не совпадал.
--
-- ЧТО ДЕЛАЕТ МИГРАЦИЯ. Для каждой ссылки, где роль записи не совпадает с
-- ролью поля, подставляет ОДНОИМЁННУЮ запись нужной роли. Ничего не
-- сливает, не удаляет и типов станций не меняет. Ссылки, для которых
-- одноимённой записи нужной роли нет, не трогаются — это не ошибка
-- выбора, а вопрос к типу самой станции (см. примечание в конце).
--
-- Порядок важен: сначала справочник тарифов, потом реестр. Тогда строки
-- реестра, у которых меняется станция, пересчитают тариф триггером
-- (00134) уже по исправленному справочнику.
--
-- ОЖИДАЕМЫЙ ЭФФЕКТ (симуляция на данных 19.09.2026):
--   • КГ/26/411 — тариф появится у 80 строк из 110 (станет 110 из 110);
--     Сумма 1 у 55 строк, где уже есть исходящее СНТ: 0 → 35 561,43 USD;
--     `deals.invoice_amount` 0 → 35 561,43, «тариф факт» пересчитается сам;
--   • ни одна строка ставку НЕ теряет, изменившихся ставок нет;
--   • КГ/26/001, 024, 101 (33 строки с Мерке) — без изменений;
--   • баланс поставщика КГ/26/411 не меняется: railway_in_price = FALSE.
--
-- ROLLBACK: миграция печатает каждую правку (таблица, id строки, было →
-- стало). Вернуть — теми же UPDATE с обратной подстановкой id.

DO $$
DECLARE
  v_cnt   INT;
  v_total INT := 0;
  v_before NUMERIC;
  v_after  NUMERIC;
  v_null_before INT;
  v_null_after  INT;
BEGIN
  -- ── 0. Предпосылки ────────────────────────────────────────────────
  -- Коллизия по уникальному ключу тарифов (назначение, отправление,
  -- экспедитор, ГСМ, месяц, год) сделала бы UPDATE невозможным.
  SELECT count(*) INTO v_cnt FROM (
    SELECT COALESCE(fd.right_id, t.departure_station_id)   AS dep,
           COALESCE(fs.right_id, t.destination_station_id) AS dest,
           t.fuel_type_id, t.forwarder_id, t.month, t.year
      FROM tariffs t
      LEFT JOIN (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
                   JOIN stations s2 ON s2.name = s.name AND s2.type = 'departure'
                  WHERE s.type <> 'departure') fd ON fd.wrong_id = t.departure_station_id
      LEFT JOIN (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
                   JOIN stations s2 ON s2.name = s.name AND s2.type = 'destination'
                  WHERE s.type <> 'destination') fs ON fs.wrong_id = t.destination_station_id
     GROUP BY 1,2,3,4,5,6 HAVING count(*) > 1) x;
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'после правки % ставок справочника получат одинаковый ключ — разберите их вручную', v_cnt;
  END IF;

  -- Снимок по реестру, которого касается правка.
  SELECT COALESCE(SUM(sr.shipped_tonnage_amount), 0), COUNT(*) FILTER (WHERE sr.railway_tariff IS NULL)
    INTO v_before, v_null_before
    FROM shipment_registry sr
   WHERE sr.departure_station_id   IN (SELECT id FROM stations WHERE name IN (SELECT name FROM stations GROUP BY name HAVING count(*) > 1))
      OR sr.destination_station_id IN (SELECT id FROM stations WHERE name IN (SELECT name FROM stations GROUP BY name HAVING count(*) > 1));

  -- ── 1. Справочник тарифов ─────────────────────────────────────────
  UPDATE tariffs t SET departure_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'departure'
           WHERE s.type <> 'departure') fx
   WHERE t.departure_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;
  RAISE NOTICE 'тарифы, станция отправления: % ссылок', v_cnt;

  UPDATE tariffs t SET destination_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'destination'
           WHERE s.type <> 'destination') fx
   WHERE t.destination_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;
  RAISE NOTICE 'тарифы, станция назначения: % ссылок', v_cnt;

  -- ── 2. Сделки и строки-варианты ───────────────────────────────────
  UPDATE deals d SET supplier_departure_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'departure'
           WHERE s.type <> 'departure') fx
   WHERE d.supplier_departure_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;
  RAISE NOTICE 'сделки, станция отправления поставщика: % ссылок', v_cnt;

  UPDATE deals d SET buyer_destination_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'destination'
           WHERE s.type <> 'destination') fx
   WHERE d.buyer_destination_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;
  RAISE NOTICE 'сделки, станция назначения покупателя: % ссылок', v_cnt;

  UPDATE deal_supplier_lines l SET departure_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'departure'
           WHERE s.type <> 'departure') fx
   WHERE l.departure_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;
  RAISE NOTICE 'строки-варианты поставщика: % ссылок', v_cnt;

  UPDATE deal_buyer_lines l SET destination_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'destination'
           WHERE s.type <> 'destination') fx
   WHERE l.destination_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;
  RAISE NOTICE 'строки-варианты покупателя: % ссылок', v_cnt;

  -- ── 3. Прочие документы ───────────────────────────────────────────
  UPDATE surcharges x SET departure_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'departure'
           WHERE s.type <> 'departure') fx
   WHERE x.departure_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;

  UPDATE surcharges x SET destination_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'destination'
           WHERE s.type <> 'destination') fx
   WHERE x.destination_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;

  UPDATE applications a SET destination_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'destination'
           WHERE s.type <> 'destination') fx
   WHERE a.destination_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;

  UPDATE transport_requests tr SET destination_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'destination'
           WHERE s.type <> 'destination') fx
   WHERE tr.destination_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;

  UPDATE factories f SET departure_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'departure'
           WHERE s.type <> 'departure') fx
   WHERE f.departure_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;

  -- transport_route_stations.station_id — точка маршрута, роль зависит от
  -- позиции в маршруте, а не от колонки. Не трогаем.

  -- ── 4. Реестр — последним ─────────────────────────────────────────
  -- У строк, где станция меняется, тариф пересчитает триггер 00134 уже
  -- по исправленному справочнику.
  UPDATE shipment_registry sr SET departure_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'departure'
           WHERE s.type <> 'departure') fx
   WHERE sr.departure_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;
  RAISE NOTICE 'реестр, станция отправления: % строк', v_cnt;

  UPDATE shipment_registry sr SET destination_station_id = fx.right_id
    FROM (SELECT s.id AS wrong_id, s2.id AS right_id FROM stations s
            JOIN stations s2 ON s2.name = s.name AND s2.type = 'destination'
           WHERE s.type <> 'destination') fx
   WHERE sr.destination_station_id = fx.wrong_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT; v_total := v_total + v_cnt;
  RAISE NOTICE 'реестр, станция назначения: % строк', v_cnt;

  -- ── 5. Догоняем строки, чья станция не менялась ───────────────────
  -- Им правка справочника тарифов ставку нашла, но триггер их не задел:
  -- ключ строки прежний. Ручные ставки не трогаем.
  -- Цель UPDATE нельзя сослаться из LATERAL, поэтому ставка считается
  -- в CTE — тем же приёмом, что и бэкфилл в 00148.
  WITH ref AS (
    SELECT sr.id,
           (SELECT t.planned_tariff FROM tariffs t
             WHERE t.departure_station_id   = COALESCE(sr.departure_station_id,   d.supplier_departure_station_id)
               AND t.destination_station_id = COALESCE(sr.destination_station_id, d.buyer_destination_station_id)
               AND t.fuel_type_id           = COALESCE(sr.fuel_type_id,           d.fuel_type_id)
               AND t.forwarder_id           = COALESCE(sr.forwarder_id,           d.forwarder_id)
               AND t.month                  = COALESCE(sr.shipment_month,         d.month)
               AND t.year                   = d.year
               AND t.planned_tariff IS NOT NULL
             ORDER BY t.planned_tariff LIMIT 1) AS tariff
      FROM shipment_registry sr
      JOIN deals d ON d.id = sr.deal_id
     WHERE COALESCE(sr.railway_tariff_override, FALSE) = FALSE
  )
  UPDATE shipment_registry sr
     SET railway_tariff = ref.tariff
    FROM ref
   WHERE sr.id = ref.id
     AND ref.tariff IS NOT NULL
     AND sr.railway_tariff IS DISTINCT FROM ref.tariff;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RAISE NOTICE 'тариф пересчитан у % строк реестра', v_cnt;

  -- ── 6. Отчёт и сверка ─────────────────────────────────────────────
  SELECT COALESCE(SUM(sr.shipped_tonnage_amount), 0), COUNT(*) FILTER (WHERE sr.railway_tariff IS NULL)
    INTO v_after, v_null_after
    FROM shipment_registry sr
   WHERE sr.departure_station_id   IN (SELECT id FROM stations WHERE name IN (SELECT name FROM stations GROUP BY name HAVING count(*) > 1))
      OR sr.destination_station_id IN (SELECT id FROM stations WHERE name IN (SELECT name FROM stations GROUP BY name HAVING count(*) > 1));

  RAISE NOTICE 'переставлено ссылок: %. По задвоенным станциям: строк без тарифа % → %, Сумма 1 % → % (дельта %)',
    v_total, v_null_before, v_null_after, v_before, v_after, v_after - v_before;

  -- Ссылок «не та роль при наличии одноимённой нужной» остаться не должно.
  SELECT count(*) INTO v_cnt FROM (
    SELECT 1 FROM tariffs t JOIN stations s ON s.id = t.departure_station_id
      WHERE s.type <> 'departure' AND EXISTS (SELECT 1 FROM stations s2 WHERE s2.name = s.name AND s2.type = 'departure')
    UNION ALL
    SELECT 1 FROM tariffs t JOIN stations s ON s.id = t.destination_station_id
      WHERE s.type <> 'destination' AND EXISTS (SELECT 1 FROM stations s2 WHERE s2.name = s.name AND s2.type = 'destination')
    UNION ALL
    SELECT 1 FROM shipment_registry r JOIN stations s ON s.id = r.departure_station_id
      WHERE s.type <> 'departure' AND EXISTS (SELECT 1 FROM stations s2 WHERE s2.name = s.name AND s2.type = 'departure')
    UNION ALL
    SELECT 1 FROM shipment_registry r JOIN stations s ON s.id = r.destination_station_id
      WHERE s.type <> 'destination' AND EXISTS (SELECT 1 FROM stations s2 WHERE s2.name = s.name AND s2.type = 'destination')) x;
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'осталось % ссылок на запись не той роли при наличии одноимённой нужной', v_cnt;
  END IF;
END $$;

-- ПРИМЕЧАНИЕ про остальные несовпадения. Помимо Мерке в базе много ссылок
-- на станции, чья роль в справочнике просто указана неверно: 15 станций с
-- типом «отправление» используются только как назначение, ещё 10 — в обе
-- стороны (на них приходится ~5 100 строк реестра). Одноимённых записей
-- нужной роли у них нет, поэтому эта миграция их не касается: сначала нужно
-- решить, править ли им тип (departure → destination / both) или заводить
-- вторые записи. Фильтрацию выпадающих списков по типу до этого включать
-- нельзя — операторы перестанут находить нужные станции.

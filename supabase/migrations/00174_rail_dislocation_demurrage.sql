-- 00174_rail_dislocation_demurrage.sql
--
-- Этап 1: дислокация вагонов и сверхнормативный простой.
-- Спека: docs/superpowers/specs/2026-09-27-dislocation-demurrage-design.md
--
-- Что здесь:
--   • снимки дислокации (файл → строки вагонов), загрузка одной функцией —
--     файл либо целиком в базе, либо его нет;
--   • справочник соответствий «название станции в файле → stations»;
--   • протокол согласования цены экспедитора и его маршруты;
--   • ручные правки дат стоянки;
--   • цепочка представлений: снимки → рейсы → стоянки → простой → по месяцам
--     → реестр в формате экспедитора.
--
-- Правила (клиент 27.09.2026, реестры PTC за июль — 487/487 строк):
--   • рейс = вагон + накладная; заглушка «00000000» — номер из следующего
--     снимка; дата накладной — из ПОСЛЕДНЕГО снимка рейса;
--   • отправление — дата ЖДН следующего рейса; прибытие — по дислокации;
--   • сверх = число суток от (прибытие + норма [+1, если «со следующих
--     суток»]) до ухода включительно; сумма = сверх × ставка за вагон-сутки.
--
-- Таблицы с префиксом rail_: схема public общая со вторым продуктом.
-- Миграция идемпотентна: повторный прогон ничего не ломает.

-- =====================================================================
-- 1. Нормализация названия станции (та же функция на клиенте —
--    src/lib/dislocation/stations.ts normalizeStationName).

CREATE OR REPLACE FUNCTION rail_norm_station(p TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(replace(lower(btrim(p)), 'ё', 'е'), '\s+', ' ', 'g'), '')
$$;

-- =====================================================================
-- 2. Таблицы

CREATE TABLE IF NOT EXISTS rail_station_aliases (
  alias       TEXT PRIMARY KEY CHECK (alias = rail_norm_station(alias)),
  station_id  UUID NOT NULL REFERENCES stations(id),
  created_by  UUID REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE rail_station_aliases IS
  'Название станции из файла дислокации (нормализованное) → справочник stations. «Кара-Балта» → «Карабалта», «Шагыр (Эксп.)» и «Шагыр» → одна станция.';

CREATE TABLE IF NOT EXISTS rail_dislocation_uploads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forwarder_id  UUID NOT NULL REFERENCES forwarders(id),
  -- Местное время дороги из имени файла; часовой пояс не нужен.
  snapshot_at   TIMESTAMP NOT NULL,
  file_name     TEXT NOT NULL,
  content_hash  TEXT NOT NULL UNIQUE,
  row_count     INT NOT NULL DEFAULT 0,
  uploaded_by   UUID REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rail_uploads_forwarder
  ON rail_dislocation_uploads(forwarder_id, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS rail_dislocation_rows (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id            UUID NOT NULL REFERENCES rail_dislocation_uploads(id) ON DELETE CASCADE,
  wagon_number         TEXT NOT NULL CHECK (wagon_number ~ '^[0-9]{8}$'),
  departure_station    TEXT,
  current_station      TEXT,
  destination_station  TEXT,
  waybill_number       TEXT,
  waybill_date         DATE,
  last_operation_at    TIMESTAMP,
  operation_code       TEXT,
  operation_name       TEXT,
  load_state           TEXT,
  cargo_name           TEXT,
  weight_tons          NUMERIC(12,3),
  idle_at_station      NUMERIC(10,2),
  wagon_owner          TEXT,
  marker               TEXT,
  UNIQUE (upload_id, wagon_number)
);
CREATE INDEX IF NOT EXISTS idx_rail_rows_wagon ON rail_dislocation_rows(wagon_number);

CREATE TABLE IF NOT EXISTS rail_price_protocols (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forwarder_id             UUID NOT NULL REFERENCES forwarders(id),
  company_group_id         UUID REFERENCES company_groups(id),
  number                   TEXT NOT NULL CHECK (btrim(number) <> ''),
  protocol_date            DATE,
  valid_from               DATE NOT NULL,
  valid_to                 DATE,
  demurrage_rate           NUMERIC(12,2) NOT NULL CHECK (demurrage_rate >= 0),
  currency                 TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  rate_includes_vat        BOOLEAN NOT NULL DEFAULT false,
  -- true: день прибытия — первые сутки нормы («день в день»);
  -- false: норма считается со следующих суток.
  arrival_day_counts       BOOLEAN NOT NULL DEFAULT true,
  partial_day_counts_full  BOOLEAN NOT NULL DEFAULT true,
  note                     TEXT,
  created_by               UUID REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS rail_price_protocol_routes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id             UUID NOT NULL REFERENCES rail_price_protocols(id) ON DELETE CASCADE,
  position                INT NOT NULL DEFAULT 0,
  departure_station_id    UUID NOT NULL REFERENCES stations(id),
  destination_station_id  UUID NOT NULL REFERENCES stations(id),
  fuel_type_id            UUID REFERENCES fuel_types(id),
  loading_norm_days       INT NOT NULL CHECK (loading_norm_days BETWEEN 0 AND 60),
  unloading_norm_days     INT NOT NULL CHECK (unloading_norm_days BETWEEN 0 AND 60),
  -- Ставки за тонну на этапе 1 только хранятся (этапы 2–4).
  railway_tariff_per_ton  NUMERIC(12,4),
  operator_rate_per_ton   NUMERIC(12,4),
  forwarding_fee_per_ton  NUMERIC(12,4)
);
CREATE INDEX IF NOT EXISTS idx_rail_protocol_routes_protocol
  ON rail_price_protocol_routes(protocol_id, position);

CREATE TABLE IF NOT EXISTS rail_stay_overrides (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forwarder_id            UUID NOT NULL REFERENCES forwarders(id),
  wagon_number            TEXT NOT NULL,
  -- Стоянку определяет рейс, которым вагон на неё прибыл.
  arrival_waybill_number  TEXT NOT NULL,
  field                   TEXT NOT NULL CHECK (field IN ('arrival', 'departure')),
  value                   DATE NOT NULL,
  reason                  TEXT NOT NULL CHECK (btrim(reason) <> ''),
  created_by              UUID REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE (forwarder_id, wagon_number, arrival_waybill_number, field)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rail_price_protocols_updated') THEN
    CREATE TRIGGER trg_rail_price_protocols_updated BEFORE UPDATE ON rail_price_protocols
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- =====================================================================
-- 3. RLS: читают вошедшие, пишут writable (admin/manager/logistics),
--    удаляет админ. Правки дат и строки маршрутов удаляет writable —
--    это часть редактирования протокола / отмена своей правки.

ALTER TABLE rail_station_aliases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rail_dislocation_uploads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rail_dislocation_rows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rail_price_protocols        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rail_price_protocol_routes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rail_stay_overrides         ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  v_del TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['rail_station_aliases', 'rail_dislocation_uploads',
    'rail_dislocation_rows', 'rail_price_protocols', 'rail_price_protocol_routes',
    'rail_stay_overrides']
  LOOP
    v_del := CASE WHEN t IN ('rail_price_protocol_routes', 'rail_stay_overrides')
                  THEN 'is_writable_role()' ELSE 'is_admin()' END;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'auth_select_' || t, t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', 'auth_select_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'writable_insert_' || t, t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (is_writable_role())', 'writable_insert_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'writable_update_' || t, t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (is_writable_role())', 'writable_update_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'delete_' || t, t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (%s)', 'delete_' || t, t, v_del);
  END LOOP;
END $$;

-- =====================================================================
-- 4. Загрузка файла одним вызовом: либо файл целиком, либо ничего.
--    SECURITY INVOKER — действуют RLS вызывающего.

CREATE OR REPLACE FUNCTION rail_upload_dislocation(
  p_forwarder_id  UUID,
  p_snapshot_at   TIMESTAMP,
  p_file_name     TEXT,
  p_content_hash  TEXT,
  p_rows          JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id    UUID;
  v_count INT;
BEGIN
  IF EXISTS (SELECT 1 FROM rail_dislocation_uploads WHERE content_hash = p_content_hash) THEN
    RAISE EXCEPTION 'Файл уже загружен: %', p_file_name USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO rail_dislocation_uploads (forwarder_id, snapshot_at, file_name, content_hash)
  VALUES (p_forwarder_id, p_snapshot_at, p_file_name, p_content_hash)
  RETURNING id INTO v_id;

  -- Один вагон дважды в одном файле — берём первую строку.
  INSERT INTO rail_dislocation_rows (
    upload_id, wagon_number, departure_station, current_station, destination_station,
    waybill_number, waybill_date, last_operation_at, operation_code, operation_name,
    load_state, cargo_name, weight_tons, idle_at_station, wagon_owner, marker)
  SELECT DISTINCT ON (x.wagon_number)
    v_id, x.wagon_number, x.departure_station, x.current_station, x.destination_station,
    x.waybill_number, x.waybill_date, x.last_operation_at, x.operation_code, x.operation_name,
    x.load_state, x.cargo_name, x.weight_tons, x.idle_at_station, x.wagon_owner, x.marker
  FROM jsonb_to_recordset(p_rows) AS x(
    wagon_number TEXT, departure_station TEXT, current_station TEXT, destination_station TEXT,
    waybill_number TEXT, waybill_date DATE, last_operation_at TIMESTAMP, operation_code TEXT,
    operation_name TEXT, load_state TEXT, cargo_name TEXT, weight_tons NUMERIC,
    idle_at_station NUMERIC, wagon_owner TEXT, marker TEXT)
  ORDER BY x.wagon_number;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE rail_dislocation_uploads SET row_count = v_count WHERE id = v_id;
  PERFORM rail_refresh_trips(p_forwarder_id);
  RETURN v_id;
END;
$$;

-- =====================================================================
-- 5. Снимки: строка файла + дата снимка + станции из справочника.

CREATE OR REPLACE VIEW rail_dislocation_snapshots
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.upload_id,
  u.forwarder_id,
  u.snapshot_at,
  r.wagon_number,
  r.departure_station,
  r.current_station,
  r.destination_station,
  ad.station_id AS departure_station_id,
  ac.station_id AS current_station_id,
  ae.station_id AS destination_station_id,
  -- Заглушка «00000000» — накладной ещё нет.
  CASE WHEN r.waybill_number ~ '^0*$' THEN NULL ELSE r.waybill_number END AS waybill_number,
  CASE WHEN r.waybill_number IS NULL OR r.waybill_number ~ '^0*$' THEN NULL ELSE r.waybill_date END AS waybill_date,
  r.last_operation_at,
  r.operation_code,
  r.operation_name,
  r.load_state,
  COALESCE(lower(r.load_state) LIKE 'груж%', false) AS is_loaded,
  r.cargo_name,
  r.weight_tons,
  r.idle_at_station,
  r.wagon_owner,
  r.marker
FROM rail_dislocation_rows r
JOIN rail_dislocation_uploads u ON u.id = r.upload_id
LEFT JOIN rail_station_aliases ad ON ad.alias = rail_norm_station(r.departure_station)
LEFT JOIN rail_station_aliases ac ON ac.alias = rail_norm_station(r.current_station)
LEFT JOIN rail_station_aliases ae ON ae.alias = rail_norm_station(r.destination_station);

-- =====================================================================
-- 6. Рейсы: вагон + накладная + станции. Гружёный — если хоть в одном
--    снимке «Груж»: после слива вагон ещё сутки числится «Порож» на
--    той же гружёной накладной (проверено на Шагыр).
--
--    Рейсы — ТАБЛИЦА, а не представление: пересчёт из всех снимков на
--    каждом чтении на реальных данных Шагыр (2 860 строк за 17 дней)
--    занимал минуты. Пересчитываются по экспедитору после загрузки или
--    удаления файла и после правки справочника станций.

CREATE TABLE IF NOT EXISTS rail_wagon_trips (
  forwarder_id             UUID NOT NULL REFERENCES forwarders(id),
  wagon_number             TEXT NOT NULL,
  waybill_number           TEXT,
  departure_station_id     UUID,
  destination_station_id   UUID,
  is_loaded                BOOLEAN NOT NULL,
  waybill_date             DATE,
  first_seen_at            TIMESTAMP NOT NULL,
  last_seen_at             TIMESTAMP NOT NULL,
  dest_first_operation_at  TIMESTAMP,
  dest_arrival_estimate    TIMESTAMP,
  dest_last_seen_at        TIMESTAMP,
  cargo_name               TEXT,
  weight_tons              NUMERIC(12,3)
);
CREATE INDEX IF NOT EXISTS idx_rail_trips_wagon
  ON rail_wagon_trips(forwarder_id, wagon_number, first_seen_at);
CREATE INDEX IF NOT EXISTS idx_rail_trips_loaded_departure
  ON rail_wagon_trips(forwarder_id, departure_station_id) WHERE is_loaded;

ALTER TABLE rail_wagon_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_select_rail_wagon_trips ON rail_wagon_trips;
CREATE POLICY auth_select_rail_wagon_trips ON rail_wagon_trips FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS writable_insert_rail_wagon_trips ON rail_wagon_trips;
CREATE POLICY writable_insert_rail_wagon_trips ON rail_wagon_trips FOR INSERT WITH CHECK (is_writable_role());
DROP POLICY IF EXISTS writable_delete_rail_wagon_trips ON rail_wagon_trips;
CREATE POLICY writable_delete_rail_wagon_trips ON rail_wagon_trips FOR DELETE USING (is_writable_role());

CREATE OR REPLACE FUNCTION rail_refresh_trips(p_forwarder_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  DELETE FROM rail_wagon_trips WHERE forwarder_id = p_forwarder_id;

  INSERT INTO rail_wagon_trips (
    forwarder_id, wagon_number, waybill_number, departure_station_id, destination_station_id,
    is_loaded, waybill_date, first_seen_at, last_seen_at, dest_first_operation_at,
    dest_arrival_estimate, dest_last_seen_at, cargo_name, weight_tons)
  WITH s AS (
    SELECT
      s.*,
      -- Заглушка «00000000»: номер из ближайшего следующего снимка того же
      -- вагона на том же маршруте. Окно идёт от поздних к ранним, последний
      -- элемент массива — ближайший.
      COALESCE(s.waybill_number, (
        array_agg(s.waybill_number) FILTER (WHERE s.waybill_number IS NOT NULL) OVER (
          PARTITION BY s.wagon_number, s.departure_station_id, s.destination_station_id
          ORDER BY s.snapshot_at DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      )[array_length(array_agg(s.waybill_number) FILTER (WHERE s.waybill_number IS NOT NULL) OVER (
          PARTITION BY s.wagon_number, s.departure_station_id, s.destination_station_id
          ORDER BY s.snapshot_at DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 1)]) AS trip_waybill
    FROM rail_dislocation_snapshots s
    WHERE s.forwarder_id = p_forwarder_id
  )
  SELECT
    p_forwarder_id,
    wagon_number,
    trip_waybill,
    departure_station_id,
    destination_station_id,
    bool_or(is_loaded),
    (array_agg(waybill_date ORDER BY snapshot_at DESC) FILTER (WHERE waybill_date IS NOT NULL))[1],
    min(snapshot_at),
    max(snapshot_at),
    min(last_operation_at) FILTER (WHERE current_station_id = destination_station_id),
    min(snapshot_at - make_interval(secs => (COALESCE(idle_at_station, 0) * 86400)::double precision))
      FILTER (WHERE current_station_id = destination_station_id),
    max(snapshot_at) FILTER (WHERE current_station_id = destination_station_id),
    (array_agg(cargo_name ORDER BY snapshot_at DESC))[1],
    (array_agg(weight_tons ORDER BY snapshot_at DESC))[1]
  FROM s
  GROUP BY wagon_number, trip_waybill, departure_station_id, destination_station_id;
END;
$$;

-- Удалили файл (админ) → рейсы экспедитора пересчитываются.
CREATE OR REPLACE FUNCTION rail_uploads_after_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM rail_refresh_trips(OLD.forwarder_id);
  RETURN NULL;
END;
$$;

-- Сопоставили станцию → меняются станции рейсов у всех экспедиторов.
CREATE OR REPLACE FUNCTION rail_aliases_after_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_fwd UUID;
BEGIN
  FOR v_fwd IN SELECT DISTINCT forwarder_id FROM rail_dislocation_uploads LOOP
    PERFORM rail_refresh_trips(v_fwd);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rail_uploads_after_delete ON rail_dislocation_uploads;
CREATE TRIGGER trg_rail_uploads_after_delete AFTER DELETE ON rail_dislocation_uploads
  FOR EACH ROW EXECUTE FUNCTION rail_uploads_after_delete();

DROP TRIGGER IF EXISTS trg_rail_aliases_after_change ON rail_station_aliases;
CREATE TRIGGER trg_rail_aliases_after_change AFTER INSERT OR UPDATE OR DELETE ON rail_station_aliases
  FOR EACH STATEMENT EXECUTE FUNCTION rail_aliases_after_change();

-- =====================================================================
-- 7. Стоянки: рейс прибыл на станцию назначения → следующий рейс ушёл
--    с неё. Порожний рейс → стоянка на погрузке, гружёный → на выгрузке.

CREATE OR REPLACE VIEW rail_wagon_stays
WITH (security_invoker = true) AS
WITH t AS (
  SELECT
    t.*,
    LEAD(t.waybill_number)         OVER w AS next_waybill_number,
    LEAD(t.waybill_date)           OVER w AS next_waybill_date,
    LEAD(t.is_loaded)              OVER w AS next_is_loaded,
    LEAD(t.departure_station_id)   OVER w AS next_departure_station_id,
    LEAD(t.destination_station_id) OVER w AS next_destination_station_id
  FROM rail_wagon_trips t
  WINDOW w AS (PARTITION BY t.forwarder_id, t.wagon_number
               ORDER BY t.first_seen_at, t.waybill_date NULLS LAST)
), base AS (
  SELECT
    t.forwarder_id,
    t.wagon_number,
    CASE WHEN t.is_loaded THEN 'unloading' ELSE 'loading' END AS stay_kind,
    t.destination_station_id AS station_id,
    t.waybill_number AS arrival_waybill_number,
    t.first_seen_at AS arrival_trip_first_seen_at,
    LEAST(t.dest_first_operation_at::date, t.dest_arrival_estimate::date) AS computed_arrival,
    COALESCE(t.dest_arrival_estimate::date < t.dest_first_operation_at::date, false) AS arrival_gap,
    (t.next_waybill_number IS NOT NULL
      AND t.next_departure_station_id = t.destination_station_id
      AND t.next_is_loaded IS DISTINCT FROM t.is_loaded) AS next_departs_here,
    (t.next_waybill_number IS NOT NULL
      AND (t.next_departure_station_id IS DISTINCT FROM t.destination_station_id
           OR t.next_is_loaded IS NOT DISTINCT FROM t.is_loaded)) AS sequence_broken,
    t.next_waybill_number,
    t.next_waybill_date,
    t.next_destination_station_id,
    t.dest_last_seen_at::date AS last_seen_date,
    t.is_loaded,
    t.waybill_number,
    t.waybill_date,
    t.departure_station_id,
    t.destination_station_id,
    t.cargo_name,
    t.weight_tons
  FROM t
  WHERE t.destination_station_id IS NOT NULL
    AND (t.dest_first_operation_at IS NOT NULL
         OR (t.next_waybill_number IS NOT NULL
             -- Пустая станция следующего рейса (NULL) — не повод выкинуть
             -- стоянку: она попадёт в «требует проверки» через sequence_broken.
             AND (t.next_departure_station_id = t.destination_station_id
                  OR t.next_departure_station_id IS NULL)))
    -- Порожний → порожний — переадресовка (Кара-Балта → Арыс 1 → Шагыр),
    -- а не стоянка под погрузкой.
    -- IS NOT DISTINCT FROM: у последнего рейса next_is_loaded = NULL, и
    -- обычное «= false» дало бы NULL и молча выкинуло незакрытую погрузку.
    AND NOT (NOT t.is_loaded AND t.next_is_loaded IS NOT DISTINCT FROM false)
    -- Порожний рейс без продолжения — стоянка только на станции, откуда у
    -- этого экспедитора уходят гружёные рейсы. Иначе транзитный Арыс 1
    -- висит «незакрытой погрузкой без протокола».
    AND (t.is_loaded
         OR t.next_waybill_number IS NOT NULL
         OR EXISTS (SELECT 1 FROM rail_wagon_trips lt
                    WHERE lt.forwarder_id = t.forwarder_id
                      AND lt.is_loaded
                      AND lt.departure_station_id = t.destination_station_id))
), resolved AS (
  SELECT
    b.*,
    CASE WHEN b.next_departs_here THEN b.next_waybill_date END AS computed_departure,
    -- Гружёный рейс цикла: для выгрузки — рейс прибытия, для погрузки —
    -- следующий рейс (если он уже есть).
    CASE WHEN b.is_loaded THEN b.waybill_number
         WHEN b.next_departs_here THEN b.next_waybill_number END AS loaded_waybill_number,
    CASE WHEN b.is_loaded THEN b.waybill_date
         WHEN b.next_departs_here THEN b.next_waybill_date END AS loaded_waybill_date,
    CASE WHEN b.is_loaded THEN b.departure_station_id ELSE b.station_id END AS loaded_departure_station_id,
    CASE WHEN b.is_loaded THEN b.destination_station_id
         WHEN b.next_departs_here THEN b.next_destination_station_id END AS loaded_destination_station_id,
    oa.value AS arrival_override,
    oa.reason AS arrival_override_reason,
    od.value AS departure_override,
    od.reason AS departure_override_reason,
    -- Файл Шагыр — не полный список: вагон может пропасть из рассылки.
    (SELECT max(u.snapshot_at) FROM rail_dislocation_uploads u
      WHERE u.forwarder_id = b.forwarder_id)::date AS forwarder_last_snapshot
  FROM base b
  LEFT JOIN rail_stay_overrides oa
    ON oa.forwarder_id = b.forwarder_id AND oa.wagon_number = b.wagon_number
   AND oa.arrival_waybill_number = b.arrival_waybill_number AND oa.field = 'arrival'
  LEFT JOIN rail_stay_overrides od
    ON od.forwarder_id = b.forwarder_id AND od.wagon_number = b.wagon_number
   AND od.arrival_waybill_number = b.arrival_waybill_number AND od.field = 'departure'
)
SELECT
  concat_ws('|', r.forwarder_id, r.wagon_number, r.stay_kind, r.station_id,
            COALESCE(r.arrival_waybill_number, to_char(r.arrival_trip_first_seen_at, 'YYYYMMDDHH24MISS'))) AS stay_key,
  r.forwarder_id,
  f.name AS forwarder_name,
  r.wagon_number,
  r.stay_kind,
  r.station_id,
  st.name AS station_name,
  r.arrival_waybill_number,
  r.computed_arrival,
  r.computed_departure,
  COALESCE(r.arrival_override, r.computed_arrival) AS arrival_date,
  COALESCE(r.departure_override, r.computed_departure) AS departure_date,
  COALESCE(r.departure_override, r.computed_departure, r.last_seen_date) AS end_date,
  COALESCE(r.departure_override, r.computed_departure) IS NOT NULL AS is_final,
  r.arrival_override IS NOT NULL OR r.departure_override IS NOT NULL AS has_override,
  r.arrival_override_reason,
  r.departure_override_reason,
  -- Требует проверки: нет даты прибытия, пропуск между снимками или
  -- следующий рейс ушёл не с этой станции. Ручная правка снимает флаг.
  (COALESCE(r.arrival_override, r.computed_arrival) IS NULL
   OR (r.arrival_gap AND r.arrival_override IS NULL)
   OR (r.sequence_broken AND r.departure_override IS NULL)
   OR r.vanished) AS needs_check,
  CASE
    WHEN COALESCE(r.arrival_override, r.computed_arrival) IS NULL THEN 'нет даты прибытия'
    WHEN r.arrival_gap AND r.arrival_override IS NULL THEN 'пропуск между снимками — прибытие могло быть раньше'
    WHEN r.sequence_broken AND r.departure_override IS NULL THEN 'следующий рейс ушёл не с этой станции'
    WHEN r.vanished THEN 'вагон пропал из дислокации после ' || to_char(r.last_seen_date, 'DD.MM.YYYY')
  END AS check_reason,
  r.loaded_waybill_number,
  r.loaded_waybill_date,
  r.loaded_departure_station_id,
  r.loaded_destination_station_id,
  r.cargo_name,
  r.weight_tons,
  sr.deal_id,
  d.deal_code,
  sr.company_group_id,
  cg.name AS company_group_name
FROM (
  SELECT resolved.*,
    (COALESCE(resolved.departure_override, resolved.computed_departure) IS NULL
     AND NOT resolved.sequence_broken
     AND resolved.last_seen_date < resolved.forwarder_last_snapshot) AS vanished
  FROM resolved
) r
JOIN forwarders f ON f.id = r.forwarder_id
LEFT JOIN stations st ON st.id = r.station_id
LEFT JOIN LATERAL (
  SELECT s.deal_id, s.company_group_id
  FROM shipment_registry s
  WHERE r.loaded_waybill_number IS NOT NULL
    AND btrim(s.wagon_number) = r.wagon_number
    AND upper(btrim(s.waybill_number)) = upper(btrim(r.loaded_waybill_number))
  ORDER BY s.created_at
  LIMIT 1
) sr ON TRUE
LEFT JOIN deals d ON d.id = sr.deal_id
LEFT JOIN company_groups cg ON cg.id = sr.company_group_id;

-- =====================================================================
-- 8. Простой: стоянка + протокол + сутки + сумма.
--    Протокол — по экспедитору, станциям гружёного рейса и дате
--    гружёного рейса (у незакрытой погрузки — дате прибытия).

CREATE OR REPLACE VIEW rail_demurrage
WITH (security_invoker = true) AS
WITH m AS (
  SELECT
    s.*,
    pm.match_count,
    CASE WHEN pm.match_count = 1 THEN pm.route_id END AS route_id,
    CASE WHEN pm.match_count = 1 THEN pm.protocol_id END AS protocol_id
  FROM rail_wagon_stays s
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS match_count,
           (array_agg(rt.id))[1] AS route_id,
           (array_agg(pp.id))[1] AS protocol_id
    FROM rail_price_protocols pp
    JOIN rail_price_protocol_routes rt ON rt.protocol_id = pp.id
    WHERE pp.forwarder_id = s.forwarder_id
      AND rt.departure_station_id = s.loaded_departure_station_id
      AND (s.loaded_destination_station_id IS NULL
           OR rt.destination_station_id = s.loaded_destination_station_id)
      AND COALESCE(s.loaded_waybill_date, s.arrival_date)
          BETWEEN pp.valid_from AND COALESCE(pp.valid_to, 'infinity'::date)
  ) pm ON TRUE
), n AS (
  SELECT
    m.*,
    p.number AS protocol_number,
    p.demurrage_rate,
    p.currency,
    p.rate_includes_vat,
    p.arrival_day_counts,
    CASE m.stay_kind WHEN 'loading' THEN r.loading_norm_days ELSE r.unloading_norm_days END AS norm_days,
    CASE WHEN p.arrival_day_counts THEN 0 WHEN p.arrival_day_counts = false THEN 1 END AS norm_shift
  FROM m
  LEFT JOIN rail_price_protocol_routes r ON r.id = m.route_id
  LEFT JOIN rail_price_protocols p ON p.id = m.protocol_id
)
SELECT
  n.*,
  CASE WHEN n.match_count = 0 THEN 'none'
       WHEN n.match_count > 1 THEN 'ambiguous'
       ELSE 'ok' END AS protocol_status,
  CASE WHEN n.arrival_date IS NOT NULL THEN n.end_date - n.arrival_date + 1 END AS total_days,
  n.arrival_date + n.norm_days + n.norm_shift AS overage_start,
  CASE WHEN n.arrival_date IS NOT NULL AND n.norm_days IS NOT NULL
       THEN GREATEST(0, n.end_date - (n.arrival_date + n.norm_days + n.norm_shift) + 1) END AS overage_days,
  CASE WHEN n.arrival_date IS NOT NULL AND n.norm_days IS NOT NULL
       THEN GREATEST(0, n.end_date - (n.arrival_date + n.norm_days + n.norm_shift) + 1) * n.demurrage_rate END AS amount
FROM n;

-- =====================================================================
-- 9. Сверхнормативные сутки по месяцам: в реестр месяца идут только
--    сутки этого месяца.

CREATE OR REPLACE VIEW rail_demurrage_by_month
WITH (security_invoker = true) AS
SELECT
  d.stay_key,
  date_trunc('month', g.day)::date AS month,
  count(*)::int AS overage_days,
  count(*) * d.demurrage_rate AS amount
FROM rail_demurrage d
CROSS JOIN LATERAL generate_series(d.overage_start, d.end_date, interval '1 day') AS g(day)
WHERE d.overage_days > 0
GROUP BY d.stay_key, date_trunc('month', g.day)::date, d.demurrage_rate;

-- =====================================================================
-- 10. Реестр в формате экспедитора (PTC, колонки A–R): строка = гружёный
--     рейс × месяц; погрузка и выгрузка одного цикла в одной строке.
--     Простой и сутки по месяцам считаются ОДИН раз (MATERIALIZED) и
--     присоединяются — иначе представление пересчитывается на каждую строку.

CREATE OR REPLACE VIEW rail_demurrage_registry
WITH (security_invoker = true) AS
WITH d AS MATERIALIZED (
  SELECT * FROM rail_demurrage
), bm AS MATERIALIZED (
  SELECT
    d.stay_key,
    date_trunc('month', g.day)::date AS month,
    count(*)::int AS days,
    count(*) * d.demurrage_rate AS amount
  FROM d
  CROSS JOIN LATERAL generate_series(d.overage_start, d.end_date, interval '1 day') AS g(day)
  WHERE d.overage_days > 0
  GROUP BY d.stay_key, date_trunc('month', g.day)::date, d.demurrage_rate
), cyc AS (
  SELECT
    COALESCE(l.forwarder_id, u.forwarder_id) AS forwarder_id,
    COALESCE(l.forwarder_name, u.forwarder_name) AS forwarder_name,
    COALESCE(l.wagon_number, u.wagon_number) AS wagon_number,
    COALESCE(u.arrival_waybill_number, l.loaded_waybill_number) AS loaded_waybill_number,
    COALESCE(u.loaded_waybill_date, l.loaded_waybill_date) AS loaded_waybill_date,
    COALESCE(u.loaded_departure_station_id, l.station_id) AS departure_station_id,
    COALESCE(u.station_id, l.loaded_destination_station_id) AS destination_station_id,
    COALESCE(u.cargo_name, l.cargo_name) AS cargo_name,
    COALESCE(u.company_group_name, l.company_group_name) AS company_group_name,
    COALESCE(u.deal_code, l.deal_code) AS deal_code,
    l.stay_key AS loading_key,
    u.stay_key AS unloading_key,
    l.arrival_date AS loading_arrival,
    l.departure_date AS loading_departure,
    u.arrival_date AS unloading_arrival,
    u.departure_date AS unloading_departure,
    l.norm_days AS loading_norm,
    u.norm_days AS unloading_norm,
    COALESCE(u.demurrage_rate, l.demurrage_rate) AS rate,
    COALESCE(u.currency, l.currency) AS currency,
    COALESCE(u.is_final, false) AS unloading_final,
    (COALESCE(l.needs_check, false) OR COALESCE(u.needs_check, false)) AS needs_check
  FROM (SELECT * FROM d WHERE stay_kind = 'loading' AND loaded_waybill_number IS NOT NULL) l
  FULL JOIN (SELECT * FROM d WHERE stay_kind = 'unloading') u
    ON u.forwarder_id = l.forwarder_id
   AND u.wagon_number = l.wagon_number
   AND u.arrival_waybill_number = l.loaded_waybill_number
), months AS (
  SELECT c.*, mm.month
  FROM cyc c
  CROSS JOIN LATERAL (
    SELECT date_trunc('month', c.loaded_waybill_date)::date AS month
    WHERE c.loaded_waybill_date IS NOT NULL
    UNION
    SELECT bm.month FROM bm WHERE bm.stay_key IN (c.loading_key, c.unloading_key)
  ) mm
)
SELECT
  x.*,
  ds.name AS departure_station_name,
  dd.name AS destination_station_name,
  COALESCE(bl.days, 0) AS loading_overage_days,
  COALESCE(bu.days, 0) AS unloading_overage_days,
  COALESCE(bl.amount, 0) + COALESCE(bu.amount, 0) AS amount
FROM months x
LEFT JOIN bm bl ON bl.stay_key = x.loading_key AND bl.month = x.month
LEFT JOIN bm bu ON bu.stay_key = x.unloading_key AND bu.month = x.month
LEFT JOIN stations ds ON ds.id = x.departure_station_id
LEFT JOIN stations dd ON dd.id = x.destination_station_id;

-- Поиск сделки по вагону в реестре отгрузок (8 650 строк): без индекса
-- каждая стоянка читала реестр целиком.
CREATE INDEX IF NOT EXISTS idx_shipment_registry_wagon_trim
  ON shipment_registry (btrim(wagon_number));

-- =====================================================================
-- 11. Гранты: как в 00141 — снимаем дефолтные (их получает anon),
--     возвращаем вошедшим. RLS базовых таблиц действует через
--     security_invoker.

REVOKE ALL ON rail_dislocation_snapshots FROM anon, authenticated;
REVOKE ALL ON rail_wagon_stays           FROM anon, authenticated;
REVOKE ALL ON rail_demurrage             FROM anon, authenticated;
REVOKE ALL ON rail_demurrage_by_month    FROM anon, authenticated;
REVOKE ALL ON rail_demurrage_registry    FROM anon, authenticated;
GRANT SELECT ON rail_dislocation_snapshots TO authenticated;
GRANT SELECT ON rail_wagon_stays           TO authenticated;
GRANT SELECT ON rail_demurrage             TO authenticated;
GRANT SELECT ON rail_demurrage_by_month    TO authenticated;
GRANT SELECT ON rail_demurrage_registry    TO authenticated;

REVOKE ALL ON FUNCTION rail_upload_dislocation(UUID, TIMESTAMP, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION rail_refresh_trips(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION rail_refresh_trips(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rail_upload_dislocation(UUID, TIMESTAMP, TEXT, TEXT, JSONB) TO authenticated;

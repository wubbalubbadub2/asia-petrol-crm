-- 00183: «Заявки» — сера, коды груза, станция отправления, грузоотправитель,
-- грузополучатель и перевозчик из справочников.
--
-- Клиент 2026-10-09: «При создании новой заявки автоматом должны выходить
-- все коды при выборе вида ГСМ и % серы. % серы можно вставить вместо
-- «Продукт (текст)», далее пойдут три кода топлива: ЕТСНГ, ГНГ, ТН ВЭД.
-- Станция назначения — фильтром, код станции автоматом, БИН автоматом,
-- грузополучатель фильтром, перевозчик фильтром, ответственный — по ID
-- сотрудника, номер сделки фильтром. Добавить грузоотправителя, станцию
-- отправления».
--
-- Что добавляется в applications:
--   sulfur_percent          — % серы числом (как в fuel_type_codes, 00182);
--   etsng_code / gng_code / tnved_code — коды груза: подставляются из
--                             «Видов ГСМ» (ЕТСНГ) и «Кодов по видам ГСМ»
--                             (ГНГ, ТН ВЭД) по виду + сере, правятся руками;
--   departure_station_id    — станция отправления (справочник станций);
--   consignor_factory_id    — грузоотправитель (справочник заводов; у
--                             станции есть «Грузоотправитель» по умолчанию —
--                             stations.default_factory_id);
--   consignee_id            — грузополучатель (справочник «Грузополучатели»,
--                             оттуда же БИН);
--   carrier_id              — перевозчик (справочник «Перевозчики ЖД»).
-- Текстовые consignor / carrier / consignee_name / consignee_bin остаются:
-- в них пишется выбранное из справочника, их показывает список и PDF.
-- product_name тоже остаётся — теперь собирается из вида ГСМ и серы.
--
-- Таблица уже под RLS (auth_select / writable_insert / writable_update /
-- admin_delete) — политики на колонки не смотрят, менять нечего.
-- Применяется вручную одним блоком DO; повторный запуск ничего не ломает.

DO $mig$
BEGIN
  ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS sulfur_percent NUMERIC(6,3)
      CHECK (sulfur_percent IS NULL OR (sulfur_percent >= 0 AND sulfur_percent <= 100)),
    ADD COLUMN IF NOT EXISTS etsng_code TEXT,
    ADD COLUMN IF NOT EXISTS gng_code TEXT,
    ADD COLUMN IF NOT EXISTS tnved_code TEXT,
    ADD COLUMN IF NOT EXISTS departure_station_id UUID REFERENCES stations(id),
    ADD COLUMN IF NOT EXISTS consignor_factory_id UUID REFERENCES factories(id),
    ADD COLUMN IF NOT EXISTS consignee_id UUID REFERENCES consignees(id),
    ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES transport_carriers(id);

  COMMENT ON COLUMN applications.sulfur_percent IS '% серы числом; по виду ГСМ + сере подбираются коды из fuel_type_codes (00183).';
  COMMENT ON COLUMN applications.etsng_code IS 'Код ЕТСНГ — подставляется из fuel_types.etsng_code, правится руками (00183).';
  COMMENT ON COLUMN applications.gng_code IS 'Код ГНГ — подставляется из fuel_type_codes по виду + сере, правится руками (00183).';
  COMMENT ON COLUMN applications.tnved_code IS 'Код ТН ВЭД — подставляется из fuel_type_codes по виду + сере, правится руками (00183).';
  COMMENT ON COLUMN applications.departure_station_id IS 'Станция отправления (00183).';
  COMMENT ON COLUMN applications.consignor_factory_id IS 'Грузоотправитель из справочника заводов; по умолчанию — stations.default_factory_id станции отправления (00183).';
  COMMENT ON COLUMN applications.consignee_id IS 'Грузополучатель из справочника consignees; имя и БИН копируются в consignee_name / consignee_bin (00183).';
  COMMENT ON COLUMN applications.carrier_id IS 'Перевозчик из справочника transport_carriers; имя копируется в carrier (00183).';

  CREATE INDEX IF NOT EXISTS idx_applications_departure_station ON applications (departure_station_id);
  CREATE INDEX IF NOT EXISTS idx_applications_consignee ON applications (consignee_id);

  RAISE NOTICE '00183: заявок — %', (SELECT count(*) FROM applications);
END
$mig$;

-- Откат (не выполнять вместе с миграцией):
-- ALTER TABLE applications
--   DROP COLUMN IF EXISTS sulfur_percent, DROP COLUMN IF EXISTS etsng_code,
--   DROP COLUMN IF EXISTS gng_code, DROP COLUMN IF EXISTS tnved_code,
--   DROP COLUMN IF EXISTS departure_station_id, DROP COLUMN IF EXISTS consignor_factory_id,
--   DROP COLUMN IF EXISTS consignee_id, DROP COLUMN IF EXISTS carrier_id;

-- 00155_cargo_codes_by_factory_product.sql
--
-- Коды ЕТСНГ и ГНГ зависят от ПАРЫ «завод + продукт».
--
-- Уточнение клиента 26.08.2026. Присланная утром таблица «КОД ГНГ,
-- ТНВЭД» выглядела как «завод → коды», и 00154 положила их на завод. На
-- деле в той таблице был только один продукт: «У всех продукт мазут,
-- забыла добавить». На вопрос «коды же к заводу относятся?» ответ —
-- «в заводу и продукту». Таблица по остальным продуктам готовится.
--
-- Поэтому коды переезжают в матрицу: у одного завода мазут и дизель
-- имеют разные ГНГ, а один и тот же мазут у разных заводов — тоже
-- разный (27101966 против 27101967, марка отличается).
--
-- factories.etsng_code / gng_code (00154) остаются — миграции
-- append-only, — но источником больше не считаются: из них ПЕРЕНОСЯТСЯ
-- строки в матрицу как «этот завод + мазут», после чего форма заявки
-- читает только матрицу.

CREATE TABLE IF NOT EXISTS transport_cargo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  fuel_type_id UUID NOT NULL REFERENCES fuel_types(id) ON DELETE CASCADE,
  etsng_code TEXT,
  gng_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (factory_id, fuel_type_id)
);

CREATE INDEX IF NOT EXISTS idx_transport_cargo_codes_lookup
  ON transport_cargo_codes(factory_id, fuel_type_id);

ALTER TABLE transport_cargo_codes ENABLE ROW LEVEL SECURITY;

-- Тот же шаблон, что у остальных справочников: читают все
-- аутентифицированные, пишут writable-роли, удаляет админ.
CREATE POLICY "auth_select_transport_cargo_codes" ON transport_cargo_codes
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_transport_cargo_codes" ON transport_cargo_codes
  FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_transport_cargo_codes" ON transport_cargo_codes
  FOR UPDATE USING (is_writable_role());
CREATE POLICY "admin_delete_transport_cargo_codes" ON transport_cargo_codes
  FOR DELETE USING (is_admin());

CREATE TRIGGER trg_transport_cargo_codes_updated BEFORE UPDATE ON transport_cargo_codes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE transport_cargo_codes IS
  'Коды ЕТСНГ и ГНГ по паре «завод + продукт» для заявки на перевозку';

-- ═══════════════════════════════════════════════════════════════
-- Перенос строк, заведённых 00154, в матрицу
-- ═══════════════════════════════════════════════════════════════
-- Утренняя таблица была целиком про мазут, поэтому каждая строка
-- становится парой «завод + мазут». Продукт ищем в справочнике ГСМ.
--
-- ВАЖНО: сравнение регистра пишем явным перечислением, а НЕ через
-- lower(). В локали C — на ней собирается база в CI — lower() не
-- трогает кириллицу, и «Мазут» не совпал бы с «мазут». На этом уже
-- обожглись в 00154.
--
-- Мазутов в справочнике может оказаться несколько (М-100, М-40) — тогда
-- пару не за кого зацепить, и перенос пропускается: клиент всё равно
-- готовит таблицу по всем продуктам, а угадывать марку опаснее, чем
-- оставить поле пустым.

DO $$
DECLARE
  v_fuel   UUID;
  v_count  INT;
  v_moved  INT;
  r        RECORD;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM fuel_types
   WHERE name LIKE '%мазут%' OR name LIKE '%Мазут%' OR name LIKE '%МАЗУТ%';

  IF v_count = 0 THEN
    RAISE NOTICE 'Мазут в справочнике ГСМ не найден — коды 00154 остались на заводах, матрица пустая';
    RETURN;
  END IF;

  IF v_count > 1 THEN
    RAISE NOTICE 'В справочнике ГСМ % продуктов со словом «мазут» — какой из них имелся в виду, неизвестно.', v_count;
    RAISE NOTICE 'Перенос пропущен: заполните коды в справочнике «Коды груза» или дождитесь таблицы по всем продуктам.';
    FOR r IN
      SELECT name FROM fuel_types
       WHERE name LIKE '%мазут%' OR name LIKE '%Мазут%' OR name LIKE '%МАЗУТ%'
       ORDER BY name
    LOOP
      RAISE NOTICE '    кандидат: %', r.name;
    END LOOP;
    RETURN;
  END IF;

  SELECT id INTO v_fuel
    FROM fuel_types
   WHERE name LIKE '%мазут%' OR name LIKE '%Мазут%' OR name LIKE '%МАЗУТ%';

  INSERT INTO transport_cargo_codes (factory_id, fuel_type_id, etsng_code, gng_code)
  SELECT f.id, v_fuel, f.etsng_code, f.gng_code
    FROM factories f
   WHERE f.etsng_code IS NOT NULL OR f.gng_code IS NOT NULL
  ON CONFLICT (factory_id, fuel_type_id) DO UPDATE
    SET etsng_code = EXCLUDED.etsng_code,
        gng_code   = EXCLUDED.gng_code;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RAISE NOTICE 'Перенесено в матрицу пар «завод + мазут»: %', v_moved;
END $$;

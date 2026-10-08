-- 00182: «Коды по видам ГСМ» — ГНГ и ТН ВЭД по виду ГСМ и % серы.
--
-- Клиент 2026-10-08: «добавить столбец виды ГСМ Код ЕТСНГ, в справочнике
-- добавить раздел «Коды по видам ГСМ»: Вид ГСМ, % серы, код ГНГ, код
-- ТН ВЭД. Логисты будут заносить индивидуальные коды по каждому виду».
-- Решения владельца: у одного вида ГСМ может быть несколько строк (по
-- % серы); % серы — число; заявка на перевозку берёт эти коды, когда
-- пары «завод + продукт» (transport_cargo_codes, 00155) нет.
--
-- «Код ЕТСНГ» остаётся на самом виде ГСМ — колонка fuel_types.etsng_code
-- есть с 00153, теперь она видна и правится в справочнике.
--
-- Схема public общая со вторым продуктом — имя с доменным префиксом
-- fuel_. Применяется вручную одним блоком DO; повторный запуск
-- ничего не ломает.

DO $mig$
BEGIN
  CREATE TABLE IF NOT EXISTS fuel_type_codes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuel_type_id   UUID NOT NULL REFERENCES fuel_types(id) ON DELETE CASCADE,
    -- Число, не текст: в сделках сера записана как попало («0,3%», « 0,30 »),
    -- здесь — только число, чтобы по нему можно было сопоставлять.
    sulfur_percent NUMERIC(6,3) CHECK (sulfur_percent IS NULL OR (sulfur_percent >= 0 AND sulfur_percent <= 100)),
    gng_code       TEXT,
    tnved_code     TEXT,
    comment        TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID DEFAULT auth.uid(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (btrim(coalesce(gng_code, '')) <> '' OR btrim(coalesce(tnved_code, '')) <> ''),
    -- Одна строка на «вид ГСМ + % серы»; строка без серы — одна на вид.
    UNIQUE NULLS NOT DISTINCT (fuel_type_id, sulfur_percent)
  );
  COMMENT ON TABLE fuel_type_codes IS
    'Коды по видам ГСМ: ГНГ и ТН ВЭД по виду ГСМ и % серы. В заявку на перевозку идут, когда нет пары «завод + продукт» (transport_cargo_codes). 00182.';
  CREATE INDEX IF NOT EXISTS idx_fuel_type_codes_fuel ON fuel_type_codes (fuel_type_id);

  ALTER TABLE fuel_type_codes ENABLE ROW LEVEL SECURITY;
  -- Как у прочих справочников: читать — вошедшие, писать — admin /
  -- manager / logistics, удалять — admin.
  DROP POLICY IF EXISTS auth_select_fuel_type_codes ON fuel_type_codes;
  CREATE POLICY auth_select_fuel_type_codes ON fuel_type_codes
    FOR SELECT USING (auth.uid() IS NOT NULL);
  DROP POLICY IF EXISTS writable_insert_fuel_type_codes ON fuel_type_codes;
  CREATE POLICY writable_insert_fuel_type_codes ON fuel_type_codes
    FOR INSERT WITH CHECK (is_writable_role());
  DROP POLICY IF EXISTS writable_update_fuel_type_codes ON fuel_type_codes;
  CREATE POLICY writable_update_fuel_type_codes ON fuel_type_codes
    FOR UPDATE USING (is_writable_role()) WITH CHECK (is_writable_role());
  DROP POLICY IF EXISTS admin_delete_fuel_type_codes ON fuel_type_codes;
  CREATE POLICY admin_delete_fuel_type_codes ON fuel_type_codes
    FOR DELETE USING (is_admin());

  DROP TRIGGER IF EXISTS trg_fuel_type_codes_updated ON fuel_type_codes;
  CREATE TRIGGER trg_fuel_type_codes_updated
    BEFORE UPDATE ON fuel_type_codes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  DROP TRIGGER IF EXISTS trg_audit_fuel_type_codes ON fuel_type_codes;
  CREATE TRIGGER trg_audit_fuel_type_codes
    AFTER INSERT OR UPDATE OR DELETE ON fuel_type_codes
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();

  GRANT SELECT, INSERT, UPDATE, DELETE ON fuel_type_codes TO authenticated;

  COMMENT ON COLUMN fuel_types.etsng_code IS
    'Код ЕТСНГ вида ГСМ. В заявку идёт, когда нет пары «завод + продукт» (00182).';

  RAISE NOTICE '00182: строк в fuel_type_codes — %', (SELECT count(*) FROM fuel_type_codes);
END
$mig$;

-- Откат (не выполнять вместе с миграцией):
-- DROP TABLE IF EXISTS fuel_type_codes;

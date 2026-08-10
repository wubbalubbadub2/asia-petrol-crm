-- Разделение базиса поставки (клиент 2026-08-04).
--
-- Было: одно свободнотекстовое поле delivery_basis на строке варианта
-- цены («FCA Текесу», «EXW нефтебаза ТОО «ШМО»/ Шымкент, пос Жулдыз»).
-- В проде 925 непустых значений и 100+ различных написаний одного и
-- того же — «CPT Турксиб эксп.», «СРТ Турксиб эксп» (кириллицей),
-- «Fca Пойма», «FCA  Текесу».
--
-- Стало: тип базиса выбирается из справочника, место берётся из уже
-- существующей станции варианта (отправления у поставщика, назначения
-- у покупателя), а всё, что не станция — адрес нефтебазы и прочие
-- уточнения — вводится отдельным полем.
--
-- Решения владельца (2026-08-04):
--   * исторические значения НЕ трогаем и НЕ парсим — миграция данных не
--     выполняется, старый текст остаётся как есть до тех пор, пока
--     менеджер сам не отредактирует базис у конкретного варианта;
--   * станция берётся существующая (departure_station_id /
--     destination_station_id), отдельного поля станции у базиса нет;
--   * в Excel-паспортах остаётся ОДНА колонка «Базис» со склейкой
--     «FCA Текесу» — структура выгрузки не меняется.
--
-- Поэтому delivery_basis остаётся TEXT и продолжает быть тем, что
-- читают паспорт, выгрузки, фильтры и лента активности. Новые колонки —
-- источник, текст — производное: его пересобирает триггер.

-- ── Справочник типов базиса ────────────────────────────────────────
-- Редактируемый: клиент прямо просил «базис добавить в справочник,
-- чтобы менеджеры вносили туда». Шаблон и RLS — как в 00090_consignees.
CREATE TABLE IF NOT EXISTS delivery_bases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_order INT DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE delivery_bases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_delivery_bases" ON delivery_bases
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_delivery_bases" ON delivery_bases
  FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_delivery_bases" ON delivery_bases
  FOR UPDATE USING (is_writable_role());
CREATE POLICY "admin_delete_delivery_bases" ON delivery_bases
  FOR DELETE USING (is_admin());

DROP TRIGGER IF EXISTS trg_delivery_bases_updated ON delivery_bases;
CREATE TRIGGER trg_delivery_bases_updated
  BEFORE UPDATE ON delivery_bases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- FCA / CPT / DAP названы клиентом. EXW добавлен по факту данных: это
-- ~40% всех заполненных базисов в проде, без него справочник нерабочий.
INSERT INTO delivery_bases (name, sort_order) VALUES
  ('FCA', 10), ('CPT', 20), ('DAP', 30), ('EXW', 40)
ON CONFLICT (name) DO NOTHING;

-- ── Структурные поля на строках вариантов цены ─────────────────────
ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS delivery_basis_id UUID REFERENCES delivery_bases(id),
  ADD COLUMN IF NOT EXISTS delivery_basis_note TEXT;

ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS delivery_basis_id UUID REFERENCES delivery_bases(id),
  ADD COLUMN IF NOT EXISTS delivery_basis_note TEXT;

COMMENT ON COLUMN deal_supplier_lines.delivery_basis IS
  'Отображаемый текст базиса. С 00136 пересобирается из delivery_basis_id + станции + delivery_basis_note; у исторических строк — исходный ручной текст.';
COMMENT ON COLUMN deal_buyer_lines.delivery_basis IS
  'Отображаемый текст базиса. С 00136 пересобирается из delivery_basis_id + станции + delivery_basis_note; у исторических строк — исходный ручной текст.';

-- ── Склейка отображаемого текста ───────────────────────────────────
-- «FCA» + «ст. Текесу» → «FCA Текесу»: префикс «ст.» в названии станции
-- служебный, в базисе клиент его не пишет.
CREATE OR REPLACE FUNCTION compose_delivery_basis(
  p_basis_id  UUID,
  p_station_id UUID,
  p_note      TEXT
) RETURNS TEXT AS $$
DECLARE
  v_kind    TEXT;
  v_station TEXT;
  v_note    TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  SELECT name INTO v_kind FROM delivery_bases WHERE id = p_basis_id;

  SELECT btrim(regexp_replace(name, '^\s*(ст\.?|станция)\s*', '', 'i'))
    INTO v_station
    FROM stations WHERE id = p_station_id;

  v_station := NULLIF(btrim(COALESCE(v_station, '')), '');

  -- Тип не выбран — текст не собираем: пусть остаётся то, что есть.
  IF v_kind IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN btrim(
    v_kind
    || COALESCE(' ' || v_station, '')
    || COALESCE(', ' || v_note, '')
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Пересобираем текст ТОЛЬКО когда менеджер тронул структурные поля
-- (тип / станцию / уточнение). Если правится сам текст — не вмешиваемся:
-- иначе ручная правка в табличном паспорте затиралась бы молча, а
-- исторические строки без типа переписывались бы в NULL.
CREATE OR REPLACE FUNCTION sync_supplier_line_delivery_basis()
RETURNS TRIGGER AS $$
DECLARE
  v_text TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.delivery_basis_id IS NOT DISTINCT FROM OLD.delivery_basis_id
     AND NEW.delivery_basis_note IS NOT DISTINCT FROM OLD.delivery_basis_note
     AND NEW.departure_station_id IS NOT DISTINCT FROM OLD.departure_station_id THEN
    RETURN NEW;
  END IF;

  IF NEW.delivery_basis_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_text := compose_delivery_basis(NEW.delivery_basis_id, NEW.departure_station_id, NEW.delivery_basis_note);
  IF v_text IS NOT NULL THEN
    NEW.delivery_basis := v_text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_buyer_line_delivery_basis()
RETURNS TRIGGER AS $$
DECLARE
  v_text TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.delivery_basis_id IS NOT DISTINCT FROM OLD.delivery_basis_id
     AND NEW.delivery_basis_note IS NOT DISTINCT FROM OLD.delivery_basis_note
     AND NEW.destination_station_id IS NOT DISTINCT FROM OLD.destination_station_id THEN
    RETURN NEW;
  END IF;

  IF NEW.delivery_basis_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_text := compose_delivery_basis(NEW.delivery_basis_id, NEW.destination_station_id, NEW.delivery_basis_note);
  IF v_text IS NOT NULL THEN
    NEW.delivery_basis := v_text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE: правим NEW.delivery_basis до записи, чтобы существующий
-- AFTER-триггер зеркалирования из 00055 отдал в deals уже готовый текст.
DROP TRIGGER IF EXISTS trg_supplier_line_delivery_basis ON deal_supplier_lines;
CREATE TRIGGER trg_supplier_line_delivery_basis
  BEFORE INSERT OR UPDATE ON deal_supplier_lines
  FOR EACH ROW EXECUTE FUNCTION sync_supplier_line_delivery_basis();

DROP TRIGGER IF EXISTS trg_buyer_line_delivery_basis ON deal_buyer_lines;
CREATE TRIGGER trg_buyer_line_delivery_basis
  BEFORE INSERT OR UPDATE ON deal_buyer_lines
  FOR EACH ROW EXECUTE FUNCTION sync_buyer_line_delivery_basis();

-- Бэкфила нет намеренно: исторические строки остаются с прежним текстом
-- и пустым delivery_basis_id. Откат — DROP TRIGGER + DROP COLUMN, текст
-- базиса при этом не пострадает, он всё это время лежит в delivery_basis.

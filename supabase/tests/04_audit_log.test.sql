-- Test: audit_trigger logs every meaningful change (migration 00036)
--
-- Считаем записи ПО ОПЕРАЦИЯМ, а не абсолютным итогом. Один INSERT в
-- deals порождает больше одной строки аудита, и это верно: триггеры
-- 00055 заводят строки-варианты по умолчанию, а те через 00092
-- поднимают deals.supplier_lines_count / buyer_lines_count — два
-- настоящих UPDATE, которые аудит обязан записать. Прежние жёсткие
-- ожидания (1 / 2 / 3 записи) были написаны до этих миграций и падали
-- на корректном поведении; переведены на счёт по op 2026-08-05.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000301', 'supplier', 'T-AuditSupplier');

DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_count   INT;
  v_before  INT;
  v_entry   audit_log%ROWTYPE;
BEGIN
  -- INSERT пишет ровно одну запись с op = 'INSERT'
  -- Объём задаём, чтобы supplier_contracted_amount был вычислен: без
  -- него производное поле остаётся NULL, при правке цены не меняется,
  -- и проверка «производные тоже попали в changed_fields» ниже теряет
  -- смысл (именно на этом тест и падал).
  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, supplier_contracted_volume, supplier_price)
  VALUES (v_deal_id, 'KG', 9904, 2099, 'январь',
          '00000000-0000-0000-0000-000000000301', 100, 10);

  SELECT COUNT(*) INTO v_count
  FROM audit_log WHERE table_name = 'deals' AND row_id = v_deal_id AND op = 'INSERT';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'INSERT: expected exactly 1 INSERT entry, got %', v_count;
  END IF;

  -- Сопутствующие UPDATE от автосоздания вариантов трогают только
  -- счётчики строк — ничего другого при вставке меняться не должно.
  IF EXISTS (
    SELECT 1 FROM audit_log
     WHERE table_name = 'deals' AND row_id = v_deal_id AND op = 'UPDATE'
       AND NOT (changed_fields <@ ARRAY['supplier_lines_count','buyer_lines_count'])
  ) THEN
    RAISE EXCEPTION 'INSERT: побочные UPDATE должны трогать только счётчики строк';
  END IF;

  -- Осмысленный UPDATE добавляет запись с заполненным changed_fields
  SELECT COUNT(*) INTO v_count
  FROM audit_log WHERE table_name = 'deals' AND row_id = v_deal_id;

  UPDATE deals SET supplier_price = 20 WHERE id = v_deal_id;

  SELECT COUNT(*) INTO v_before
  FROM audit_log WHERE table_name = 'deals' AND row_id = v_deal_id;
  IF v_before <> v_count + 1 THEN
    RAISE EXCEPTION 'UPDATE: expected exactly 1 new entry, got %', v_before - v_count;
  END IF;

  -- Именно запись про цену: UPDATE-строк у сделки несколько (счётчики
  -- вариантов), голый op='UPDATE' цеплял произвольную из них.
  SELECT * INTO v_entry
  FROM audit_log
  WHERE table_name = 'deals' AND row_id = v_deal_id AND op = 'UPDATE'
    AND 'supplier_price' = ANY (changed_fields);
  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'UPDATE: нет записи аудита с supplier_price в changed_fields';
  END IF;
  -- Производное supplier_contracted_amount (100 × 10 → 100 × 20) тоже
  -- изменилось — триггер обязан записать не только буквальную правку.
  IF NOT ('supplier_contracted_amount' = ANY (v_entry.changed_fields)) THEN
    RAISE EXCEPTION 'UPDATE: expected derived fields also tracked, got %', v_entry.changed_fields;
  END IF;

  -- Правка одного updated_at не должна порождать запись
  UPDATE deals SET updated_at = now() WHERE id = v_deal_id;
  SELECT COUNT(*) INTO v_count
  FROM audit_log WHERE table_name = 'deals' AND row_id = v_deal_id;
  IF v_count <> v_before THEN
    RAISE EXCEPTION 'updated_at-only update should not log, got % new entries', v_count - v_before;
  END IF;

  -- DELETE пишет ровно одну запись с op = 'DELETE'
  DELETE FROM deals WHERE id = v_deal_id;
  SELECT COUNT(*) INTO v_count
  FROM audit_log WHERE table_name = 'deals' AND row_id = v_deal_id AND op = 'DELETE';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'DELETE: expected exactly 1 DELETE entry, got %', v_count;
  END IF;

  SELECT * INTO v_entry
  FROM audit_log
  WHERE table_name = 'deals' AND row_id = v_deal_id AND op = 'DELETE';
  IF v_entry.old_row IS NULL OR v_entry.new_row IS NOT NULL THEN
    RAISE EXCEPTION 'DELETE: old_row should be set and new_row null';
  END IF;
END $$;

ROLLBACK;

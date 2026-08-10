-- Отдельное поле «Договор» на сделке (клиент 2026-08-04).
--
-- Контекст. Колонки deals.supplier_contract / buyer_contract исторически
-- назывались «Договор», но фактически хранят НОМЕР ПРИЛОЖЕНИЯ («допика»)
-- — это видно по реестру, где row.supplier_appendix падает обратно на
-- deal.supplier_contract (src/lib/hooks/use-registry.ts), и по фильтру
-- паспорта «Все приложения», который строится из этих же колонок.
-- Подписи в UI и в Excel-паспортах переименованы в «Номер приложения».
--
-- Клиент: «нужно добавить договор отдельно, но договор не нужно выводить
-- в обои паспорт, это для формальности». То есть настоящий номер договора
-- живёт рядом, только в карточке сделки: ни в табличный паспорт, ни в
-- passport-excel / passport-detail-excel он не попадает.
--
-- Пер-сторонние колонки, а не одна на сделку: вся договорная модель в
-- системе пер-сторонняя (00003_deals.sql), а 00053 фиксирует правило
-- клиента «контрагент, № договора и объём — один на сторону».
--
-- НИКАКОГО бэкфила из supplier_contract / buyer_contract: там лежат
-- приложения, а не договоры. Существующие сделки остаются с NULL.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_contract_number TEXT,
  ADD COLUMN IF NOT EXISTS buyer_contract_number TEXT;

COMMENT ON COLUMN deals.supplier_contract IS
  'Номер приложения (допика) со стороны поставщика. Историческое имя колонки — «contract», в UI подписано «Номер приложения».';
COMMENT ON COLUMN deals.buyer_contract IS
  'Номер приложения (допика) со стороны покупателя. Историческое имя колонки — «contract», в UI подписано «Номер приложения».';
COMMENT ON COLUMN deals.supplier_contract_number IS
  'Номер договора с поставщиком. Только карточка сделки, в паспорта не выгружается.';
COMMENT ON COLUMN deals.buyer_contract_number IS
  'Номер договора с покупателем. Только карточка сделки, в паспорта не выгружается.';

-- Логирование в чат сделки.
--
-- Отдельная функция, а не CREATE OR REPLACE большого
-- log_deal_field_changes() из 00088: переписывать 200 строк ради двух
-- новых полей — лишний риск опечатки в уже работающих ветках. Тот же
-- контракт метаданных (field/old/new), тот же пропуск черновиков.
CREATE OR REPLACE FUNCTION log_deal_contract_number_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF COALESCE(NEW.is_draft, FALSE) OR COALESCE(OLD.is_draft, FALSE) THEN
    RETURN NEW;
  END IF;

  IF OLD.supplier_contract_number IS DISTINCT FROM NEW.supplier_contract_number THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Договор поставщика изменён',
      jsonb_build_object('field','supplier_contract_number',
                         'old',OLD.supplier_contract_number,
                         'new',NEW.supplier_contract_number));
  END IF;

  IF OLD.buyer_contract_number IS DISTINCT FROM NEW.buyer_contract_number THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Договор покупателя изменён',
      jsonb_build_object('field','buyer_contract_number',
                         'old',OLD.buyer_contract_number,
                         'new',NEW.buyer_contract_number));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Имя триггера алфавитно после trg_deal_field_changes — оба AFTER UPDATE,
-- порядок нужен только для предсказуемости чтения ленты.
DROP TRIGGER IF EXISTS trg_deal_contract_number_changes ON deals;
CREATE TRIGGER trg_deal_contract_number_changes
  AFTER UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION log_deal_contract_number_changes();

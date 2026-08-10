-- Test: отдельное поле «Договор» на сделке (migration 00135)
--
-- Проверяем ровно три вещи:
--   1. supplier_contract_number / buyer_contract_number пишутся и читаются
--      независимо от supplier_contract / buyer_contract (номер приложения);
--   2. изменение договора логируется в чат сделки с корректным metadata.field;
--   3. черновики (is_draft) в чат не пишутся — как и у логгера 00088.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000501', 'supplier', 'T-ContractSupplier'),
  ('00000000-0000-0000-0000-000000000502', 'buyer',    'T-ContractBuyer');

DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_count   INT;
  v_meta    JSONB;
  v_appendix TEXT;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month,
                     supplier_id, buyer_id,
                     supplier_contract, buyer_contract, is_draft)
  VALUES (v_deal_id, 'KZ', 9951, 2099, 'январь',
          '00000000-0000-0000-0000-000000000501',
          '00000000-0000-0000-0000-000000000502',
          '4 от 02.06.2026', '20 от 12.12.2024', FALSE);

  -- 1. Договор пишется и не задевает номер приложения ------------------
  UPDATE deals
     SET supplier_contract_number = 'Д-114/2026 от 15.01.2026',
         buyer_contract_number    = 'Д-77/2026'
   WHERE id = v_deal_id;

  SELECT supplier_contract INTO v_appendix FROM deals WHERE id = v_deal_id;
  IF v_appendix IS DISTINCT FROM '4 от 02.06.2026' THEN
    RAISE EXCEPTION 'номер приложения поставщика не должен меняться, стало %', v_appendix;
  END IF;

  SELECT COUNT(*) INTO v_count FROM deals
   WHERE id = v_deal_id
     AND supplier_contract_number = 'Д-114/2026 от 15.01.2026'
     AND buyer_contract_number    = 'Д-77/2026';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'договор не сохранился';
  END IF;

  -- 2. Логирование в чат сделки ----------------------------------------
  SELECT COUNT(*) INTO v_count FROM deal_activity
   WHERE deal_id = v_deal_id
     AND metadata->>'field' = 'supplier_contract_number';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ожидали 1 событие по договору поставщика, получили %', v_count;
  END IF;

  SELECT metadata INTO v_meta FROM deal_activity
   WHERE deal_id = v_deal_id AND metadata->>'field' = 'buyer_contract_number';
  IF v_meta->>'old' IS NOT NULL OR v_meta->>'new' <> 'Д-77/2026' THEN
    RAISE EXCEPTION 'metadata договора покупателя неверна: %', v_meta;
  END IF;

  -- Повторная запись того же значения событий не плодит.
  UPDATE deals SET supplier_contract_number = 'Д-114/2026 от 15.01.2026'
   WHERE id = v_deal_id;
  SELECT COUNT(*) INTO v_count FROM deal_activity
   WHERE deal_id = v_deal_id AND metadata->>'field' = 'supplier_contract_number';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'запись того же значения не должна создавать событие, стало %', v_count;
  END IF;

  -- 3. Черновики не логируются -----------------------------------------
  UPDATE deals SET is_draft = TRUE WHERE id = v_deal_id;
  UPDATE deals SET supplier_contract_number = 'Д-999' WHERE id = v_deal_id;
  SELECT COUNT(*) INTO v_count FROM deal_activity
   WHERE deal_id = v_deal_id AND metadata->>'field' = 'supplier_contract_number';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'черновик не должен логироваться, событий стало %', v_count;
  END IF;

  RAISE NOTICE '05_deal_contract_number: OK';
END $$;

ROLLBACK;

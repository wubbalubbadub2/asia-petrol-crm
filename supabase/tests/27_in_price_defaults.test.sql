-- Test: обе галочки «в цене» подняты у новой сделки (00170).
--
-- Клиент 2026-09-23: «по умолчанию ЖД тариф и грузоотправление должны
-- быть с галочкой». Галочки решают, входят ли Сумма 1 (ЖД) и Сумма 3
-- (грузоотправление) в баланс поставщика, поэтому проверяем и сам
-- умолчательный флаг, и что баланс их учитывает.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000cb01', 'supplier', 'T-INP Поставщик'),
  ('00000000-0000-0000-0000-00000000cb02', 'buyer',    'T-INP Покупатель');

DO $$
DECLARE
  v_deal UUID := gen_random_uuid();
  v_rail BOOLEAN;
  v_ship BOOLEAN;
BEGIN
  -- Вставка БЕЗ упоминания флагов — значения берутся из умолчаний колонок.
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal, 'KG', 9998, 2099, 'август',
          '00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-00000000cb02');

  SELECT railway_in_price, additional_expenses_in_price INTO v_rail, v_ship
    FROM deals WHERE id = v_deal;

  IF v_rail IS NOT TRUE THEN
    RAISE EXCEPTION '«ЖД в цене» у новой сделки должна быть поднята, получили %', v_rail;
  END IF;
  IF v_ship IS NOT TRUE THEN
    RAISE EXCEPTION '«Грузоотправление в цене» у новой сделки должно быть поднято, получили %', v_ship;
  END IF;

  -- Явно снятая галочка остаётся снятой: умолчание не перебивает выбор.
  UPDATE deals SET railway_in_price = FALSE WHERE id = v_deal;
  SELECT railway_in_price INTO v_rail FROM deals WHERE id = v_deal;
  IF v_rail IS NOT FALSE THEN
    RAISE EXCEPTION 'снятая вручную галочка не должна подниматься обратно';
  END IF;

  RAISE NOTICE 'OK: обе галочки «в цене» подняты по умолчанию, ручной выбор сохраняется';
END $$;

ROLLBACK;

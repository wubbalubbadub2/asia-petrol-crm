-- Test: галочка «ЖД поставщика в цене» — Сумма 2 входит в баланс (00176).
--
-- Клиент 2026-09-28, сделка KZ/26/201: «ж/д тариф не плюсуется на
-- сальдо». Тариф там введён как «ЖД поставщика» (Сумма 2, 00150), а она
-- по 00150 в баланс не входила. Выбран вариант 1: отдельная галочка,
-- по умолчанию снята — ни один существующий баланс не меняется, пока её
-- не поднимут. Условие валют — как у двух других галочек (00120).

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000ab01', 'supplier', 'T-SRIP Поставщик'),
  ('00000000-0000-0000-0000-00000000ab02', 'buyer',    'T-SRIP Покупатель');

DO $$
DECLARE
  v_deal   UUID := gen_random_uuid();
  v_amount NUMERIC;
  v_base   NUMERIC;
  v_bal    NUMERIC;
  v_snap   NUMERIC;
  v_def    TEXT;
BEGIN
  SELECT column_default INTO v_def FROM information_schema.columns
   WHERE table_name = 'deals' AND column_name = 'supplier_railway_in_price';
  IF v_def IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'умолчание supplier_railway_in_price: %, ожидали false', v_def;
  END IF;

  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id,
                     supplier_currency, logistics_currency,
                     railway_in_price, additional_expenses_in_price)
  VALUES (v_deal, 'KZ', 9976, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-00000000ab02',
          'KZT', 'KZT', TRUE, TRUE);

  -- Как на KZ/26/201: одна строка, налив 119,6 т, тариф ЖД поставщика 23 316,2598.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, loading_date, supplier_railway_tariff)
  VALUES (v_deal, 'KZ', 'SRIP-01', 119.6, DATE '2099-06-01', 23316.2598);

  SELECT supplier_railway_amount, supplier_balance INTO v_amount, v_base FROM deals WHERE id = v_deal;
  IF COALESCE(v_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'фикстура: Сумма 2 не посчиталась (%)', v_amount;
  END IF;

  -- 1. Галочка снята (умолчание): Сумма 2 в баланс не входит.
  IF (SELECT supplier_railway_in_price FROM deals WHERE id = v_deal) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'новая сделка: галочка должна быть снята';
  END IF;

  -- 2. Подняли — баланс вырос ровно на Сумму 2.
  UPDATE deals SET supplier_railway_in_price = TRUE WHERE id = v_deal;
  SELECT supplier_balance INTO v_bal FROM deals WHERE id = v_deal;
  IF v_bal IS DISTINCT FROM v_base + v_amount THEN
    RAISE EXCEPTION 'с галочкой: баланс %, ожидали % + % = %', v_bal, v_base, v_amount, v_base + v_amount;
  END IF;

  -- 3. Паспорт на дату после всех событий совпадает с паспортом.
  SELECT supplier_balance INTO v_snap FROM passport_snapshot_as_of(DATE '2099-12-31', ARRAY[v_deal]);
  IF v_snap IS DISTINCT FROM v_bal THEN
    RAISE EXCEPTION 'паспорт на дату: баланс %, в паспорте %', v_snap, v_bal;
  END IF;
  -- До налива Суммы 2 ещё нет — и в срезе её нет.
  SELECT supplier_balance INTO v_snap FROM passport_snapshot_as_of(DATE '2099-05-31', ARRAY[v_deal]);
  IF v_snap IS DISTINCT FROM 0::NUMERIC THEN
    RAISE EXCEPTION 'паспорт на 31.05: баланс %, ожидали 0', v_snap;
  END IF;

  -- 4. Валюты разные — не прибавляем, как и у двух других галочек.
  UPDATE deals SET logistics_currency = 'USD' WHERE id = v_deal;
  SELECT supplier_balance INTO v_bal FROM deals WHERE id = v_deal;
  IF v_bal IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION 'валюты разные: баланс %, ожидали %', v_bal, v_base;
  END IF;

  RAISE NOTICE 'OK: «ЖД поставщика в цене» плюсует Сумму 2, по умолчанию снята, паспорт на дату совпадает';
END $$;

ROLLBACK;

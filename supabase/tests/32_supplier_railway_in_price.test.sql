-- Test: какие суммы входят в баланс поставщика по галочкам (00176 → 00179).
--
-- Владелец 2026-09-29: «ЖД в цене — это сумма ЖД; сумма логисты — отдельная
-- галочка, по умолчанию не влияет на баланс; ЖД поставщика в цене — убрать».
--   «ЖД в цене»             → Сумма ЖД (поставщик)   supplier_railway_amount
--   «Грузоотпр. в цене»     → Сумма грузоотправления additional_expenses_amount
--   «Сумма логистов в цене» → Сумма (логисты)        invoice_amount
-- Условие валют у всех трёх: валюта поставщика = валюте логистики.
-- Повод — KZ/26/201: тариф введён как ЖД поставщика, в баланс не шёл.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000ab01', 'supplier', 'T-SRIP Поставщик'),
  ('00000000-0000-0000-0000-00000000ab02', 'buyer',    'T-SRIP Покупатель');

DO $$
DECLARE
  v_deal   UUID := gen_random_uuid();
  v_s1     NUMERIC;
  v_s2     NUMERIC;
  v_ship   NUMERIC;
  v_base   NUMERIC;
  v_bal    NUMERIC;
  v_snap   NUMERIC;
  r        RECORD;
BEGIN
  -- Умолчания новой сделки: ЖД и грузоотправление подняты, логисты — нет.
  SELECT
    (SELECT column_default FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'railway_in_price') AS rail,
    (SELECT column_default FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'additional_expenses_in_price') AS ship,
    (SELECT column_default FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'logistics_amount_in_price') AS logi
  INTO r;
  IF r.rail IS DISTINCT FROM 'true' OR r.ship IS DISTINCT FROM 'true' OR r.logi IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'умолчания: ЖД %, грузоотпр. %, логисты % — ждали true/true/false', r.rail, r.ship, r.logi;
  END IF;

  -- Как KZ/26/201, плюс тарифы логистов и грузоотправления, чтобы все три
  -- суммы были ненулевыми. Все галочки сняты — считаем базу.
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id,
                     supplier_currency, logistics_currency,
                     railway_in_price, additional_expenses_in_price, logistics_amount_in_price)
  VALUES (v_deal, 'KZ', 9976, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-00000000ab02',
          'KZT', 'KZT', FALSE, FALSE, FALSE);

  -- Обе даты: Сумма (логисты) в паспорте на дату идёт по исходящей (00160).
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, loading_volume, loading_date, date,
                                 supplier_railway_tariff, railway_tariff, railway_tariff_override, manager_tariff)
  VALUES (v_deal, 'KZ', 'SRIP-01', 119.6, DATE '2099-06-01', DATE '2099-06-01', 23316.2598, 1000, TRUE, 500);

  SELECT invoice_amount, supplier_railway_amount, additional_expenses_amount, supplier_balance
    INTO v_s1, v_s2, v_ship, v_base FROM deals WHERE id = v_deal;
  IF COALESCE(v_s1, 0) <= 0 OR COALESCE(v_s2, 0) <= 0 OR COALESCE(v_ship, 0) <= 0 THEN
    RAISE EXCEPTION 'фикстура: суммы не посчитались: логисты %, ЖД %, грузоотпр. %', v_s1, v_s2, v_ship;
  END IF;

  -- 1. «ЖД в цене» плюсует Сумму ЖД поставщика — и только её.
  UPDATE deals SET railway_in_price = TRUE WHERE id = v_deal;
  SELECT supplier_balance INTO v_bal FROM deals WHERE id = v_deal;
  IF v_bal IS DISTINCT FROM v_base + v_s2 THEN
    RAISE EXCEPTION '«ЖД в цене»: баланс %, ждали % + ЖД %', v_bal, v_base, v_s2;
  END IF;

  -- 2. «Сумма логистов в цене» плюсует Сумму (логисты).
  UPDATE deals SET logistics_amount_in_price = TRUE WHERE id = v_deal;
  SELECT supplier_balance INTO v_bal FROM deals WHERE id = v_deal;
  IF v_bal IS DISTINCT FROM v_base + v_s2 + v_s1 THEN
    RAISE EXCEPTION '«Сумма логистов в цене»: баланс %, ждали %', v_bal, v_base + v_s2 + v_s1;
  END IF;

  -- 3. Грузоотправление — как было.
  UPDATE deals SET additional_expenses_in_price = TRUE WHERE id = v_deal;
  SELECT supplier_balance INTO v_bal FROM deals WHERE id = v_deal;
  IF v_bal IS DISTINCT FROM v_base + v_s2 + v_s1 + v_ship THEN
    RAISE EXCEPTION 'грузоотправление: баланс %, ждали %', v_bal, v_base + v_s2 + v_s1 + v_ship;
  END IF;

  -- 4. Старая галочка «ЖД поставщика в цене» на баланс больше не влияет.
  UPDATE deals SET supplier_railway_in_price = NOT COALESCE(supplier_railway_in_price, FALSE) WHERE id = v_deal;
  IF (SELECT supplier_balance FROM deals WHERE id = v_deal) IS DISTINCT FROM v_bal THEN
    RAISE EXCEPTION 'устаревшая галочка всё ещё влияет на баланс';
  END IF;

  -- 5. Паспорт на дату после всех событий совпадает с паспортом.
  SELECT supplier_balance INTO v_snap FROM passport_snapshot_as_of(DATE '2099-12-31', ARRAY[v_deal]);
  IF v_snap IS DISTINCT FROM v_bal THEN
    RAISE EXCEPTION 'паспорт на дату: баланс %, в паспорте %', v_snap, v_bal;
  END IF;

  -- 6. Валюты разные — ни одна из трёх сумм не прибавляется.
  UPDATE deals SET logistics_currency = 'USD' WHERE id = v_deal;
  SELECT supplier_balance INTO v_bal FROM deals WHERE id = v_deal;
  IF v_bal IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION 'валюты разные: баланс %, ждали %', v_bal, v_base;
  END IF;

  RAISE NOTICE 'OK: ЖД в цене → Сумма ЖД поставщика, логисты — своя галочка (по умолчанию выкл.), грузоотправление без изменений';
END $$;

ROLLBACK;

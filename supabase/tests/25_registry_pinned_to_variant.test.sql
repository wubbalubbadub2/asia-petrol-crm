-- Test: строка реестра всегда привязана к варианту цены (00168).
--
-- Клиент 2026-09-23: логист должен выбирать, на какую цену («домик»,
-- приложение) сажать отгрузку — 1000 т по одной цене, 500 т по другой
-- в одной сделке.
--
-- Привязку ставил триггер 00059, но каждую сторону — только если объём
-- этой стороны уже был при ВСТАВКЕ (00059:109 и :127). Строку заводят
-- наливом, исходящее проставляют позже, и buyer_line_id оставался
-- пустым навсегда: на UPDATE привязку не ставил никто. Такая строка
-- выпадает из пересчёта «Окончательной» (00164:272-278 идёт циклом по
-- buyer_line_id) — это KZ/26/276, «цена не села со стороны покупателя».

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000aa01', 'supplier', 'T-PIN Поставщик'),
  ('00000000-0000-0000-0000-00000000aa02', 'buyer',    'T-PIN Покупатель');

DO $$
DECLARE
  v_deal    UUID := gen_random_uuid();
  v_def_buy UUID;
  v_def_sup UUID;
  v_var2    UUID;
  v_row     UUID;
  v_row2    UUID;
  v_row3    UUID;
  v_line    UUID;
  v_price   NUMERIC;
  v_amount  NUMERIC;
  v_apx     TEXT;
  v_pinned  INT;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal, 'KZ', 9276, 2099, 'август',
          '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aa02');

  -- Основные варианты заводит триггер вместе со сделкой.
  SELECT id INTO v_def_sup FROM deal_supplier_lines WHERE deal_id = v_deal AND is_default;
  SELECT id INTO v_def_buy FROM deal_buyer_lines   WHERE deal_id = v_deal AND is_default;
  UPDATE deal_supplier_lines SET price = 300.000, price_stage = 'final' WHERE id = v_def_sup;
  UPDATE deal_buyer_lines
     SET price = 390.000, price_stage = 'final', appendix = '25 от 20.01.2026'
   WHERE id = v_def_buy;

  -- Второй «домик» покупателя: та же сделка, другая цена.
  INSERT INTO deal_buyer_lines (deal_id, position, is_default, price, price_stage, appendix)
  VALUES (v_deal, 2, FALSE, 380.000, 'final', '26 от 01.02.2026')
  RETURNING id INTO v_var2;

  -- ── 1. Вставка без выбранного варианта → основной ──────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_volume, date)
  VALUES (v_deal, 'KZ', 'PIN-0001', 1000, DATE '2099-08-11')
  RETURNING id INTO v_row;

  SELECT buyer_line_id, buyer_appendix INTO v_line, v_apx
    FROM shipment_registry WHERE id = v_row;
  IF v_line IS DISTINCT FROM v_def_buy THEN
    RAISE EXCEPTION '1. строка без выбора должна привязаться к основному варианту';
  END IF;
  IF v_apx IS DISTINCT FROM '25 от 20.01.2026' THEN
    RAISE EXCEPTION '1. подпись приложения должна подтянуться с варианта, получили %', v_apx;
  END IF;

  SELECT calculated_price, amount INTO v_price, v_amount
    FROM deal_shipment_prices WHERE shipment_registry_id = v_row AND side = 'buyer';
  IF v_price IS DISTINCT FROM 390.000 THEN
    RAISE EXCEPTION '1. цена отгрузки по основному варианту 390, получили %', v_price;
  END IF;
  IF v_amount IS DISTINCT FROM 390000.00 THEN
    RAISE EXCEPTION '1. сумма 1000 × 390 = 390000, получили %', v_amount;
  END IF;

  -- ── 2. Вставка со ВТОРЫМ вариантом — он и остаётся ─────────────────
  -- Ровно клиентский сценарий: 1000 т по одной цене, 500 т по другой.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_volume, date,
                                 buyer_line_id)
  VALUES (v_deal, 'KZ', 'PIN-0002', 500, DATE '2099-08-19', v_var2)
  RETURNING id INTO v_row2;

  SELECT buyer_line_id, buyer_appendix INTO v_line, v_apx
    FROM shipment_registry WHERE id = v_row2;
  IF v_line IS DISTINCT FROM v_var2 THEN
    RAISE EXCEPTION '2. выбранный вариант не должен подменяться основным';
  END IF;
  IF v_apx IS DISTINCT FROM '26 от 01.02.2026' THEN
    RAISE EXCEPTION '2. подпись приложения второго варианта, получили %', v_apx;
  END IF;

  SELECT calculated_price, amount INTO v_price, v_amount
    FROM deal_shipment_prices WHERE shipment_registry_id = v_row2 AND side = 'buyer';
  IF v_price IS DISTINCT FROM 380.000 THEN
    RAISE EXCEPTION '2. цена по второму варианту 380, получили %', v_price;
  END IF;
  IF v_amount IS DISTINCT FROM 190000.00 THEN
    RAISE EXCEPTION '2. сумма 500 × 380 = 190000, получили %', v_amount;
  END IF;

  -- ── 3. Строку завели наливом, исходящее проставили позже ───────────
  -- Дыра 00059: сторона покупателя привязывалась только если объём
  -- исходящего был УЖЕ при вставке. Это и есть KZ/26/276.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, loading_volume, date)
  VALUES (v_deal, 'KZ', 'PIN-0003', 700, DATE '2099-08-20')
  RETURNING id INTO v_row3;

  UPDATE shipment_registry SET buyer_line_id = NULL WHERE id = v_row3;  -- как было до 00168
  UPDATE shipment_registry SET shipment_volume = 700 WHERE id = v_row3;

  SELECT buyer_line_id INTO v_line FROM shipment_registry WHERE id = v_row3;
  IF v_line IS DISTINCT FROM v_def_buy THEN
    RAISE EXCEPTION '3. при появлении исходящего объёма строка обязана привязаться к варианту покупателя';
  END IF;

  SELECT calculated_price, amount INTO v_price, v_amount
    FROM deal_shipment_prices WHERE shipment_registry_id = v_row3 AND side = 'buyer';
  IF v_price IS DISTINCT FROM 390.000 THEN
    RAISE EXCEPTION '3. цена покупателя обязана сесть, получили %', v_price;
  END IF;
  IF v_amount IS DISTINCT FROM 273000.00 THEN
    RAISE EXCEPTION '3. сумма 700 × 390 = 273000, получили %', v_amount;
  END IF;

  -- ── 4. Починка строки, у которой привязки нет ──────────────────────
  -- Так выглядят все строки, созданные до 00168: цена по ним не села.
  UPDATE shipment_registry SET buyer_line_id = NULL, supplier_line_id = NULL WHERE id = v_row;
  UPDATE deal_shipment_prices SET calculated_price = NULL, amount = NULL
   WHERE shipment_registry_id = v_row AND side = 'buyer';

  SELECT pin_registry_lines((SELECT deal_code FROM deals WHERE id = v_deal)) INTO v_pinned;
  IF v_pinned <> 1 THEN
    RAISE EXCEPTION '4. ожидали привязку одной строки, получили %', v_pinned;
  END IF;

  SELECT buyer_line_id INTO v_line FROM shipment_registry WHERE id = v_row;
  IF v_line IS DISTINCT FROM v_def_buy THEN
    RAISE EXCEPTION '4. после починки строка должна смотреть на основной вариант';
  END IF;

  -- Привязка поднимает пересчёт 00057 — цена и сумма возвращаются.
  SELECT calculated_price, amount INTO v_price, v_amount
    FROM deal_shipment_prices WHERE shipment_registry_id = v_row AND side = 'buyer';
  IF v_price IS DISTINCT FROM 390.000 THEN
    RAISE EXCEPTION '4. цена обязана сесть после привязки, получили %', v_price;
  END IF;
  IF v_amount IS DISTINCT FROM 390000.00 THEN
    RAISE EXCEPTION '4. сумма обязана пересчитаться, получили %', v_amount;
  END IF;

  -- ── 5. Массовая привязка без кода сделки запрещена ─────────────────
  BEGIN
    PERFORM pin_registry_lines(NULL);
    RAISE EXCEPTION '5. привязка по всей базе должна быть запрещена';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '5.%' THEN RAISE; END IF; -- это наше же сообщение выше
  END;

  RAISE NOTICE 'OK: отгрузка всегда привязана к варианту цены, выбранный вариант держится, починка возвращает цену';
END $$;

ROLLBACK;

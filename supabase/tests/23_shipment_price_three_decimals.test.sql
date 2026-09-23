-- Test: цена отгрузки — три знака, сумма = объём × цена (00166).
--
-- Клиент 2026-09-22: цена на экране 226,156, а суммы отгрузок считались
-- от 226,15625 — итог по сделке не сходился с «цена × объём» в Excel.
-- Здесь проверяется, что любой путь записи в deal_shipment_prices даёт
-- цену с тремя знаками и сумму ровно по ней, а роллап сделки — сумму
-- этих сумм.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000bc01', 'supplier', 'T-3DP Поставщик'),
  ('00000000-0000-0000-0000-00000000bc02', 'buyer',    'T-3DP Покупатель');

DO $$
DECLARE
  v_deal UUID := gen_random_uuid();
  v_row  UUID;
  v_row2 UUID;
  v_price NUMERIC;
  v_amount NUMERIC;
  v_total NUMERIC;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id, buyer_price)
  VALUES (v_deal, 'KG', 9990, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000bc01', '00000000-0000-0000-0000-00000000bc02',
          226.15625);

  -- ── 1. Ручная цена с пятью знаками → три знака, сумма по ним ──────
  INSERT INTO deal_shipment_prices (deal_id, side, volume, calculated_price, amount)
  VALUES (v_deal, 'buyer', 58.000, 226.15625, 999)
  RETURNING id INTO v_row;

  SELECT calculated_price, amount INTO v_price, v_amount
    FROM deal_shipment_prices WHERE id = v_row;
  IF v_price IS DISTINCT FROM 226.156 THEN
    RAISE EXCEPTION '1. ожидали цену 226.156, получили %', v_price;
  END IF;
  IF v_amount IS DISTINCT FROM 13117.048 THEN
    RAISE EXCEPTION '1. ожидали сумму 13117.048 (58 × 226.156), получили % — сумму «999» из вставки триггер обязан переписать', v_amount;
  END IF;

  -- ── 2. Правка объёма — сумма пересчитывается по той же цене ───────
  UPDATE deal_shipment_prices SET volume = 57.950 WHERE id = v_row;
  SELECT amount INTO v_amount FROM deal_shipment_prices WHERE id = v_row;
  IF v_amount IS DISTINCT FROM 13105.7402 THEN
    RAISE EXCEPTION '2. ожидали 13105.7402 (57.95 × 226.156), получили %', v_amount;
  END IF;

  -- ── 3. Ровная половинка на 4-м знаке округляется от нуля ──────────
  UPDATE deal_shipment_prices SET calculated_price = 100.0005 WHERE id = v_row;
  SELECT calculated_price INTO v_price FROM deal_shipment_prices WHERE id = v_row;
  IF v_price IS DISTINCT FROM 100.001 THEN
    RAISE EXCEPTION '3. ожидали 100.001, получили %', v_price;
  END IF;

  -- ── 4. Строка без цены: сумму не трогаем ──────────────────────────
  INSERT INTO deal_shipment_prices (deal_id, side, volume, calculated_price, amount)
  VALUES (v_deal, 'buyer', 10, NULL, 500)
  RETURNING id INTO v_row2;
  SELECT amount INTO v_amount FROM deal_shipment_prices WHERE id = v_row2;
  IF v_amount IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION '4. без цены сумма должна остаться 500, получили %', v_amount;
  END IF;
  DELETE FROM deal_shipment_prices WHERE id = v_row2;

  -- ── 5. Формула: три знака на выходе ────────────────────────────────
  IF apply_price_formula(90.83725, 0, NULL, 7.6) IS DISTINCT FROM 690.363 THEN
    RAISE EXCEPTION '5. 90.83725 × 7.6 = 690.3631 → ожидали 690.363, получили %',
      apply_price_formula(90.83725, 0, NULL, 7.6);
  END IF;
  IF apply_price_formula(236.15625, 10, NULL, NULL) IS DISTINCT FROM 226.156 THEN
    RAISE EXCEPTION '5. 236.15625 − 10 → ожидали 226.156, получили %',
      apply_price_formula(236.15625, 10, NULL, NULL);
  END IF;

  -- ── 6. Автоцена при вставке в реестр идёт через тот же инвариант ──
  -- Ручной режим цены: calculated_price = deals.buyer_price (226.15625)
  -- → в строке 226.156, сумма 59 × 226.156.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, date, shipment_volume)
  VALUES (v_deal, 'KG', '3DP-0001', DATE '2099-06-10', 59.000)
  RETURNING id INTO v_row2;

  SELECT calculated_price, amount INTO v_price, v_amount
    FROM deal_shipment_prices WHERE shipment_registry_id = v_row2 AND side = 'buyer';
  IF v_price IS DISTINCT FROM 226.156 THEN
    RAISE EXCEPTION '6. автоцена: ожидали 226.156, получили %', v_price;
  END IF;
  IF v_amount IS DISTINCT FROM 13343.204 THEN
    RAISE EXCEPTION '6. автоцена: ожидали сумму 13343.204 (59 × 226.156), получили %', v_amount;
  END IF;

  -- Правка объёма в реестре (00037) — сумма по округлённой цене.
  UPDATE shipment_registry SET shipment_volume = 60 WHERE id = v_row2;
  SELECT amount INTO v_amount
    FROM deal_shipment_prices WHERE shipment_registry_id = v_row2 AND side = 'buyer';
  IF v_amount IS DISTINCT FROM 13569.36 THEN
    RAISE EXCEPTION '6. после правки объёма ожидали 13569.36 (60 × 226.156), получили %', v_amount;
  END IF;

  -- ── 7. Роллап сделки — сумма строк по округлённым ценам ───────────
  SELECT buyer_shipped_amount INTO v_total FROM deals WHERE id = v_deal;
  IF v_total IS DISTINCT FROM (5795.05795 + 13569.36) THEN
    -- строка 1: 57.95 × 100.001 = 5795.05795 → в колонке 5795.0580
    SELECT SUM(amount) INTO v_amount FROM deal_shipment_prices WHERE deal_id = v_deal AND side = 'buyer';
    IF v_total IS DISTINCT FROM v_amount THEN
      RAISE EXCEPTION '7. роллап % не равен сумме строк %', v_total, v_amount;
    END IF;
  END IF;

  RAISE NOTICE 'OK: цена отгрузки — три знака, сумма = объём × цена на всех путях записи, роллап сходится';
END $$;

ROLLBACK;

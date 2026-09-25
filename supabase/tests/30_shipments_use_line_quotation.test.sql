-- Test: отгрузки «Среднего месяца» берут котировку варианта (00173).
--
-- Клиент 2026-09-25, КГ/26/346: «в отгрузках должна быть котировка,
-- которая идёт в сделке, и она должна браться с месяца расчёта. Если
-- введена вручную — это остаётся, но если меняется месяц или другие
-- поля — пересчитывается». Живые числа 346: «Месяц расчёта» июнь,
-- котировка вписана 591,587 (средняя июля FOB Rotterdam), скидка 215,
-- отгрузки 26–30.06; было 360,977 (июнь по датам), должно 376,587.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000ca01', 'supplier', 'T-LQ Поставщик'),
  ('00000000-0000-0000-0000-00000000ca02', 'buyer',    'T-LQ Покупатель');
INSERT INTO quotation_product_types (id, name, sub_name, basis)
VALUES ('00000000-0000-0000-0000-00000000ca03', 'T-LQ FOB', 'тест', '');

-- Июнь: только колонка FOB Rotterdam (575.98); июль: 591.59.
-- Основная колонка price — другие числа, чтобы поймать не ту колонку.
INSERT INTO quotations (product_type_id, date, price, price_fob_rotterdam) VALUES
  ('00000000-0000-0000-0000-00000000ca03', DATE '2099-06-10', 700, 575.96),
  ('00000000-0000-0000-0000-00000000ca03', DATE '2099-06-11', 700, 576.00),
  ('00000000-0000-0000-0000-00000000ca03', DATE '2099-07-10', 800, 591.58),
  ('00000000-0000-0000-0000-00000000ca03', DATE '2099-07-11', 800, 591.60);

DO $$
DECLARE
  v_deal  UUID := gen_random_uuid();
  v_line  UUID;
  v_reg   UUID;
  v_price NUMERIC;
  v_q     NUMERIC;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal, 'KG', 9973, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca02');

  -- ── 1. КГ/26/346: котировка вписана вручную → отгрузки по ней ──────
  UPDATE deal_supplier_lines
     SET price_condition = 'average_month', calc_mode = 'avg_month', price_stage = 'final',
         quotation_type_id = '00000000-0000-0000-0000-00000000ca03',
         price_source = 'price_fob_rotterdam', selected_month = 'июнь',
         quotation = 591.587, discount = 215, price = 376.587
   WHERE deal_id = v_deal AND is_default = TRUE
  RETURNING id INTO v_line;

  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date,
                                 loading_volume, supplier_line_id)
  VALUES (v_deal, 'KG', 'LQ-0001', 'июнь', DATE '2099-06-26', 63.26, v_line)
  RETURNING id INTO v_reg;

  SELECT calculated_price, quotation_avg INTO v_price, v_q
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 376.587 OR v_q IS DISTINCT FROM 591.587 THEN
    RAISE EXCEPTION '1. КГ/26/346: котировка варианта 591.587 → 376.587, получили цену % и котировку %', v_price, v_q;
  END IF;

  PERFORM recompute_line_shipment_prices(v_line, 'supplier');
  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 376.587 THEN
    RAISE EXCEPTION '2. фиксация/пересчёт не должны возвращать июнь по дате: ждали 376.587, получили %', v_price;
  END IF;

  -- ── 2. Котировку очистили → средняя за «Месяц расчёта» по подкотировке ─
  UPDATE deal_supplier_lines SET quotation = NULL WHERE id = v_line;
  PERFORM recompute_line_shipment_prices(v_line, 'supplier');
  SELECT calculated_price, quotation_avg INTO v_price, v_q
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 360.980 THEN
    RAISE EXCEPTION '3. июнь FOB Rotterdam 575.98 − 215 = 360.980, получили % (котировка %); 485 — взяли не ту колонку', v_price, v_q;
  END IF;

  -- ── 3. «Месяц расчёта» → июль: июльская котировка и для июньских отгрузок
  UPDATE deal_supplier_lines SET selected_month = 'июль' WHERE id = v_line;
  PERFORM recompute_line_shipment_prices(v_line, 'supplier');
  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 376.590 THEN
    RAISE EXCEPTION '4. месяц расчёта июль: 591.59 − 215 = 376.590, получили %', v_price;
  END IF;

  -- ── 4. Режим «на дату» ──────────────────────────────────────────────
  UPDATE deal_supplier_lines SET calc_mode = 'on_date', selected_date = DATE '2099-06-11' WHERE id = v_line;
  PERFORM recompute_line_shipment_prices(v_line, 'supplier');
  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 361.000 THEN
    RAISE EXCEPTION '5. на 11.06: 576.00 − 215 = 361.000, получили %', v_price;
  END IF;

  -- ── 5. Новая отгрузка встаёт по котировке варианта ───────────────────
  UPDATE deal_supplier_lines SET calc_mode = 'avg_month', selected_date = NULL, quotation = 591.587 WHERE id = v_line;
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date,
                                 loading_volume, supplier_line_id)
  VALUES (v_deal, 'KG', 'LQ-0002', 'июнь', DATE '2099-06-30', 60, v_line);
  SELECT p.calculated_price INTO v_price
    FROM deal_shipment_prices p JOIN shipment_registry r ON r.id = p.shipment_registry_id
   WHERE r.wagon_number = 'LQ-0002' AND p.side = 'supplier';
  IF v_price IS DISTINCT FROM 376.587 THEN
    RAISE EXCEPTION '6. новая отгрузка: ждали 376.587, получили %', v_price;
  END IF;

  -- ── 6. Ручная «Цена» (00171) главнее ────────────────────────────────
  UPDATE deal_supplier_lines SET price = 380 WHERE id = v_line;
  PERFORM recompute_line_shipment_prices(v_line, 'supplier');
  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 380.000 THEN
    RAISE EXCEPTION '7. ручная цена 380 главнее, получили %', v_price;
  END IF;

  RAISE NOTICE 'OK: отгрузки «Среднего месяца» — по котировке варианта (месяц расчёта, подкотировка, «на дату»), ручная цена главнее';
END $$;

ROLLBACK;

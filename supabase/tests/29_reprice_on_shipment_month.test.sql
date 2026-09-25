-- Test: смена даты или месяца отгрузки пересчитывает цену по формуле (00172),
-- а котировку «Среднего месяца» берёт из варианта (00173).
--
-- 00173 (клиент 2026-09-25, тем же днём): котировка отгрузок — котировка
-- варианта («Месяц расчёта»), месяц отгрузки на неё не влияет. Поэтому
-- ниже перенос даты на июль цену НЕ меняет: у варианта июньская 575.98.
--
-- Клиент 2026-09-25: «если тип цены формульная, то мы должны брать по
-- формуле, и если мы меняем данные, например месяц отгрузки, цена должна
-- пересчитаться». Согласовано 2026-09-25: каждая отгрузка берёт среднюю
-- котировку за месяц своей даты (без даты — за «Месяц отгрузки» и год
-- сделки); ручная «Цена» (00171) — исключение, пока не тронули формулу.
--
-- До 00172 смена даты только переписывала shipment_date у цены отгрузки
-- (00046), а смену месяца не отслеживал никто — отгрузка, перенесённая
-- с июня на июль, оставалась по июньской котировке.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000c901', 'supplier', 'T-RPM Поставщик'),
  ('00000000-0000-0000-0000-00000000c902', 'buyer',    'T-RPM Покупатель');
INSERT INTO quotation_product_types (id, name, sub_name, basis)
VALUES ('00000000-0000-0000-0000-00000000c903', 'T-RPM FOB', 'тест', '');

DO $$
DECLARE
  v_deal  UUID := gen_random_uuid();
  v_line  UUID;
  v_reg   UUID;  -- строка с датой
  v_reg2  UUID;  -- строка без даты, только «Месяц отгрузки»
  v_price NUMERIC;
  v_q     NUMERIC;
  v_amount NUMERIC;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal, 'KG', 9972, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000c902');

  -- Средняя июня = 575.98, июля = 591.59 (как у FOB Rotterdam, КГ/26/346).
  INSERT INTO quotations (product_type_id, date, price) VALUES
    ('00000000-0000-0000-0000-00000000c903', DATE '2099-06-10', 575.96),
    ('00000000-0000-0000-0000-00000000c903', DATE '2099-06-11', 576.00),
    ('00000000-0000-0000-0000-00000000c903', DATE '2099-07-10', 591.58),
    ('00000000-0000-0000-0000-00000000c903', DATE '2099-07-11', 591.60);

  UPDATE deal_supplier_lines
     SET price_condition = 'average_month', calc_mode = 'avg_month', price_stage = 'final',
         quotation_type_id = '00000000-0000-0000-0000-00000000c903',
         quotation = 575.98, discount = 215, selected_month = 'июнь', price = 360.98
   WHERE deal_id = v_deal AND is_default = TRUE
  RETURNING id INTO v_line;

  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date,
                                 loading_volume, supplier_line_id)
  VALUES (v_deal, 'KG', 'RPM-0001', 'июнь', DATE '2099-06-26', 60, v_line)
  RETURNING id INTO v_reg;

  SELECT calculated_price, quotation_avg INTO v_price, v_q
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 360.980 THEN
    RAISE EXCEPTION '1. июньская отгрузка: 575.98 − 215 = 360.980, получили % (котировка %)', v_price, v_q;
  END IF;

  -- ── 1. Дату перенесли на июль → июльская котировка ─────────────────
  UPDATE shipment_registry SET date = DATE '2099-07-02' WHERE id = v_reg;
  SELECT calculated_price, quotation_avg, amount INTO v_price, v_q, v_amount
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 360.980 THEN
    RAISE EXCEPTION '2. 00173: котировка варианта 575.98 → 360.980 и в июле, получили % (котировка %)', v_price, v_q;
  END IF;
  IF v_amount IS DISTINCT FROM 60 * 360.980 THEN
    RAISE EXCEPTION '2. сумма должна быть 60 × 360.980, получили %', v_amount;
  END IF;

  -- ── 2. Строка без даты: решает «Месяц отгрузки» ────────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date,
                                 loading_volume, supplier_line_id)
  VALUES (v_deal, 'KG', 'RPM-0002', 'июнь', NULL, 50, v_line)
  RETURNING id INTO v_reg2;
  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg2 AND side = 'supplier';
  IF v_price IS DISTINCT FROM 360.980 THEN
    RAISE EXCEPTION '3. без даты, месяц июнь: ждали 360.980, получили %', v_price;
  END IF;

  UPDATE shipment_registry SET shipment_month = 'июль' WHERE id = v_reg2;
  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg2 AND side = 'supplier';
  IF v_price IS DISTINCT FROM 360.980 THEN
    RAISE EXCEPTION '4. 00173: месяц отгрузки котировку варианта не меняет, ждали 360.980, получили %', v_price;
  END IF;

  -- ── 3. При заполненной дате «Месяц отгрузки» цену не двигает ───────
  UPDATE shipment_registry SET shipment_month = 'июнь' WHERE id = v_reg;
  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 360.980 THEN
    RAISE EXCEPTION '5. ждали 360.980, получили %', v_price;
  END IF;

  -- ── 4. Ручная «Цена» (00171) — исключение ──────────────────────────
  UPDATE deal_supplier_lines SET price = 370 WHERE id = v_line;
  UPDATE shipment_registry SET date = DATE '2099-06-20' WHERE id = v_reg;
  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 370.000 THEN
    RAISE EXCEPTION '6. при ручной «Цене» смена даты её не сбивает: ждали 370, получили %', v_price;
  END IF;

  -- ── 5. Предварительная стадия: отгрузки по «Цене» варианта ─────────
  UPDATE deal_supplier_lines SET price_stage = 'preliminary', price = 400 WHERE id = v_line;
  UPDATE shipment_registry SET date = DATE '2099-07-05' WHERE id = v_reg;
  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 400.000 THEN
    RAISE EXCEPTION '7. предварительная стадия: цена варианта 400, получили %', v_price;
  END IF;

  RAISE NOTICE 'OK: смена даты или месяца отгрузки пересчитывает строку, котировка — варианта; ручная и предварительная не сбиваются';
END $$;

ROLLBACK;

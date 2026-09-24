-- Test: цена, введённая вручную в «Цене» варианта, главнее формулы (00171).
--
-- Клиент 2026-09-24, КГ/26/502: «Формула котировки идёт верная, но
-- покупатель поменял вручную. Мы сделали как покупатель. Нужно, чтобы
-- формула считала на ту цену, которая указана в разделе цена».
-- На живой сделке: «Цена» поставщика 540,119 (окончательная, «Средний
-- месяц»), у отгрузки 20 000 т цена по формуле 540,12 — «Приход, сумма»
-- 10 802 400 вместо 20 000 × 540,119 = 10 802 380. Проверяются оба пути:
-- строка реестра и ручная строка «Окончательной цены» без реестра.
--
-- Правило (согласовано 2026-09-24):
--   • правка одной «Цены» варианта = цена введена вручную
--     (price_is_manual = TRUE);
--   • пока так — каждая отгрузка этой стороны считается по «Цене»:
--     строки реестра этого варианта и ручные строки без реестра
--     (их вариант — вариант по умолчанию);
--   • правка котировки, скидки, курса, коэффициента, условия, стадии —
--     снова формула (price_is_manual = FALSE).

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000c801', 'supplier', 'T-MAN Поставщик'),
  ('00000000-0000-0000-0000-00000000c802', 'buyer',    'T-MAN Покупатель');
INSERT INTO quotation_product_types (id, name, sub_name, basis)
VALUES ('00000000-0000-0000-0000-00000000c803', 'T-MAN BRENT', 'тест', '');

DO $$
DECLARE
  v_deal   UUID := gen_random_uuid();
  v_line   UUID;
  v_line2  UUID;
  v_manual UUID;  -- строка «Окончательной цены» без реестра
  v_reg    UUID;  -- строка реестра на варианте по умолчанию
  v_reg2   UUID;  -- строка реестра на втором варианте
  v_price  NUMERIC;
  v_amount NUMERIC;
  v_flag   BOOLEAN;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal, 'KG', 9971, 2099, 'август',
          '00000000-0000-0000-0000-00000000c801', '00000000-0000-0000-0000-00000000c802');

  -- Средняя котировка августа = 540.12 → формула даёт 540.12.
  INSERT INTO quotations (product_type_id, date, price) VALUES
    ('00000000-0000-0000-0000-00000000c803', DATE '2099-08-03', 540.10),
    ('00000000-0000-0000-0000-00000000c803', DATE '2099-08-04', 540.14);

  UPDATE deal_supplier_lines
     SET price_condition = 'average_month', calc_mode = 'avg_month', price_stage = 'final',
         quotation_type_id = '00000000-0000-0000-0000-00000000c803',
         quotation = 540.12, discount = 0, selected_month = 'август', price = 540.12
   WHERE deal_id = v_deal AND is_default = TRUE
  RETURNING id, price_is_manual INTO v_line, v_flag;

  IF v_flag IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION '0. цена посчитана вместе с котировкой — это формула, флаг должен быть FALSE, получили %', v_flag;
  END IF;

  -- Отгрузка из реестра — по формуле.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date,
                                 loading_volume, supplier_line_id)
  VALUES (v_deal, 'KG', 'MAN-0001', 'август', DATE '2099-08-10', 60, v_line)
  RETURNING id INTO v_reg;

  -- Ручная строка «Окончательной цены», как её вставляет интерфейс:
  -- цена = котировка − скидка.
  INSERT INTO deal_shipment_prices (deal_id, side, volume, quotation_avg, discount, calculated_price, amount)
  VALUES (v_deal, 'supplier', 20000, 540.12, 0, 540.12, 20000 * 540.12)
  RETURNING id INTO v_manual;

  SELECT calculated_price INTO v_price FROM deal_shipment_prices WHERE id = v_manual;
  IF v_price IS DISTINCT FROM 540.12 THEN
    RAISE EXCEPTION '1. без ручной цены строка держит формулу 540.12, получили %', v_price;
  END IF;

  -- ── 1. Менеджер правит только «Цену» → ручная, все отгрузки по ней ──
  UPDATE deal_supplier_lines SET price = 540.119 WHERE id = v_line;

  SELECT price_is_manual INTO v_flag FROM deal_supplier_lines WHERE id = v_line;
  IF v_flag IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION '2. правка одной «Цены» должна поднять price_is_manual, получили %', v_flag;
  END IF;

  SELECT calculated_price, amount INTO v_price, v_amount FROM deal_shipment_prices WHERE id = v_manual;
  IF v_price IS DISTINCT FROM 540.119 THEN
    RAISE EXCEPTION '3. КГ/26/502: ручная строка должна взять «Цену» 540.119, получили %', v_price;
  END IF;
  IF v_amount IS DISTINCT FROM 10802380 THEN
    RAISE EXCEPTION '3. КГ/26/502: 20 000 × 540.119 = 10 802 380, получили %', v_amount;
  END IF;

  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 540.119 THEN
    RAISE EXCEPTION '4. строка реестра должна взять «Цену» 540.119, получили %', v_price;
  END IF;

  -- ── 2. Пересчёт по формуле (кнопка / фиксация) ручную цену не трогает ─
  PERFORM recompute_line_shipment_prices(v_line, 'supplier');
  SELECT calculated_price, amount INTO v_price, v_amount
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 540.119 OR v_amount IS DISTINCT FROM 60 * 540.119 THEN
    RAISE EXCEPTION '5. пересчёт вернул формулу: цена %, сумма % (ждали 540.119 и %)',
      v_price, v_amount, 60 * 540.119;
  END IF;

  -- ── 3. Новая строка реестра встаёт сразу по «Цене» ──────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date,
                                 loading_volume, supplier_line_id)
  VALUES (v_deal, 'KG', 'MAN-0002', 'август', DATE '2099-08-12', 61, v_line);
  SELECT p.calculated_price INTO v_price
    FROM deal_shipment_prices p JOIN shipment_registry r ON r.id = p.shipment_registry_id
   WHERE r.wagon_number = 'MAN-0002' AND p.side = 'supplier';
  IF v_price IS DISTINCT FROM 540.119 THEN
    RAISE EXCEPTION '6. новая строка реестра должна встать по 540.119, получили %', v_price;
  END IF;

  -- ── 4. Правка ручной строки в таблице (интерфейс шлёт формулу) ──────
  UPDATE deal_shipment_prices SET volume = 19999, calculated_price = 540.12 WHERE id = v_manual;
  SELECT calculated_price, amount INTO v_price, v_amount FROM deal_shipment_prices WHERE id = v_manual;
  IF v_price IS DISTINCT FROM 540.119 OR v_amount IS DISTINCT FROM 19999 * 540.119 THEN
    RAISE EXCEPTION '7. правка строки вернула формулу: цена %, сумма %', v_price, v_amount;
  END IF;
  UPDATE deal_shipment_prices SET volume = 20000 WHERE id = v_manual;

  -- ── 5. «Приход, сумма» сделки = сумма строк по ручной цене ──────────
  SELECT supplier_shipped_amount INTO v_amount FROM deals WHERE id = v_deal;
  IF v_amount IS DISTINCT FROM (20000 + 60 + 61) * 540.119 THEN
    RAISE EXCEPTION '8. приход сделки должен быть % , получили %', (20000 + 60 + 61) * 540.119, v_amount;
  END IF;

  -- ── 6. Второй вариант с ручной ценой ручные строки не трогает ───────
  INSERT INTO deal_supplier_lines (deal_id, position, is_default, price_condition, price_stage, price)
  VALUES (v_deal, 2, FALSE, 'average_month', 'final', 500)
  RETURNING id INTO v_line2;
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date,
                                 loading_volume, supplier_line_id)
  VALUES (v_deal, 'KG', 'MAN-0003', 'август', DATE '2099-08-14', 10, v_line2)
  RETURNING id INTO v_reg2;
  UPDATE deal_supplier_lines SET price = 501.5 WHERE id = v_line2;

  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg2 AND side = 'supplier';
  IF v_price IS DISTINCT FROM 501.5 THEN
    RAISE EXCEPTION '9. строка второго варианта должна взять его «Цену» 501.5, получили %', v_price;
  END IF;
  SELECT calculated_price INTO v_price FROM deal_shipment_prices WHERE id = v_manual;
  IF v_price IS DISTINCT FROM 540.119 THEN
    RAISE EXCEPTION '9. ручная строка принадлежит варианту по умолчанию, осталась бы 540.119, получили %', v_price;
  END IF;

  -- ── 7. Правка скидки → снова формула ────────────────────────────────
  -- Интерфейс шлёт скидку вместе с ценой по формуле, затем пересчёт.
  UPDATE deal_supplier_lines SET discount = 0.02, price = 540.10 WHERE id = v_line;
  PERFORM recompute_line_shipment_prices(v_line, 'supplier');

  SELECT price_is_manual INTO v_flag FROM deal_supplier_lines WHERE id = v_line;
  IF v_flag IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION '10. правка скидки должна вернуть формулу (флаг FALSE), получили %', v_flag;
  END IF;
  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_reg AND side = 'supplier';
  IF v_price IS DISTINCT FROM 540.100 THEN
    RAISE EXCEPTION '11. строка реестра по формуле 540.12 − 0.02 = 540.100, получили %', v_price;
  END IF;
  -- Ручная строка возвращается к своей формуле: её котировка − её скидка.
  SELECT calculated_price INTO v_price FROM deal_shipment_prices WHERE id = v_manual;
  IF v_price IS DISTINCT FROM 540.12 THEN
    RAISE EXCEPTION '12. ручная строка должна вернуться к своей формуле 540.12, получили %', v_price;
  END IF;

  -- ── 8. Разметка существующей сделки: флаг ставят явно, цена та же ──
  -- Так размечается КГ/26/502 после применения 00171.
  UPDATE deal_supplier_lines SET price = 540.119, price_is_manual = FALSE WHERE id = v_line;
  UPDATE deal_shipment_prices SET calculated_price = 540.12 WHERE id = v_manual;
  UPDATE deal_supplier_lines SET price_is_manual = TRUE WHERE id = v_line;

  SELECT calculated_price, amount INTO v_price, v_amount FROM deal_shipment_prices WHERE id = v_manual;
  IF v_price IS DISTINCT FROM 540.119 OR v_amount IS DISTINCT FROM 10802380 THEN
    RAISE EXCEPTION '13. явная разметка должна пересчитать ручную строку: цена %, сумма %', v_price, v_amount;
  END IF;

  RAISE NOTICE 'OK: ручная «Цена» варианта главнее формулы, правка формулы её снимает';
END $$;

ROLLBACK;

-- Test: коэффициент барелизации (миграция 00164).
--
-- Клиент (WhatsApp, 2026-09-18/19): «Цена нефти долл/тонна = (Котировка
-- Brent долл/баррель (среднемесячная или на дату, как по договору) минус
-- скидка в долл/баррель) * коэффициент барелизации».
--
-- Согласовано 2026-09-19: коэффициент на строке-варианте, скидка в
-- долл/баррель (вычитается ДО умножения), пустой коэффициент = прежняя
-- формула.
--
-- Числа взяты из живого случая КГ/26/502: средняя Brent за август
-- 90,83725 $/барр. При коэффициенте 7,6 цена выходит 690,3631 $/т — это
-- та самая цена приложения 690,362, которую менеджер до сих пор вбивал
-- руками, потому что система считала по 90,8373.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000ba01', 'supplier', 'T-BBL Поставщик'),
  ('00000000-0000-0000-0000-00000000ba02', 'buyer',    'T-BBL Покупатель');
INSERT INTO quotation_product_types (id, name, sub_name, basis)
VALUES ('00000000-0000-0000-0000-00000000ba03', 'T-BBL BRENT', 'тест', '');

-- ── 1. Сама формула ──────────────────────────────────────────────────
DO $$
DECLARE v NUMERIC;
BEGIN
  -- Скидка в долл/барр вычитается ДО умножения.
  v := apply_price_formula(90.83725, 0, NULL, 7.6);
  IF v IS DISTINCT FROM 690.363 THEN
    RAISE EXCEPTION '1. (90.83725 − 0) × 7.6 = 690.3631 → с тремя знаками (00166) должно дать 690.363, получили %', v;
  END IF;

  v := apply_price_formula(90, 2, NULL, 7.6);
  IF round(v, 4) IS DISTINCT FROM 668.8000 THEN
    RAISE EXCEPTION '1. (90 − 2) × 7.6 должно дать 668.80, получили %', v;
  END IF;
  IF round(v, 4) = 682.0000 THEN
    RAISE EXCEPTION '1. скидка вычтена ПОСЛЕ умножения — это другая формула';
  END IF;

  -- Пустой коэффициент — прежнее поведение.
  v := apply_price_formula(525.98, 20.5, NULL, NULL);
  IF round(v, 4) IS DISTINCT FROM 505.4800 THEN
    RAISE EXCEPTION '2. без коэффициента ожидали 505.48 (525.98 − 20.5), получили %', v;
  END IF;

  -- «Формульная вручную»: курс и коэффициент перемножаются оба.
  v := apply_price_formula(100, 10, 2, 7.6);
  IF round(v, 4) IS DISTINCT FROM 1368.0000 THEN
    RAISE EXCEPTION '3. (100 − 10) × 2 × 7.6 должно дать 1368.00, получили %', v;
  END IF;

  -- Нет котировки — нет цены.
  IF apply_price_formula(NULL, 5, NULL, 7.6) IS NOT NULL THEN
    RAISE EXCEPTION '4. без котировки цена обязана быть пустой';
  END IF;
END $$;

-- ── 2. Коэффициент доходит до цены отгрузки ──────────────────────────
DO $$
DECLARE
  v_deal UUID := gen_random_uuid();
  v_line UUID;
  v_row  UUID;
  v_price NUMERIC;
  v_amount NUMERIC;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal, 'KG', 9980, 2099, 'август',
          '00000000-0000-0000-0000-00000000ba01', '00000000-0000-0000-0000-00000000ba02');

  -- Котировки августа: среднее = 90.83725, как у Brent в августе 2026.
  INSERT INTO quotations (product_type_id, date, price) VALUES
    ('00000000-0000-0000-0000-00000000ba03', DATE '2099-08-03', 90.8000),
    ('00000000-0000-0000-0000-00000000ba03', DATE '2099-08-04', 90.8745);
  IF round(compute_monthly_quotation_avg('00000000-0000-0000-0000-00000000ba03', 2099, 8), 5)
     IS DISTINCT FROM 90.83725 THEN
    RAISE EXCEPTION '5. среднее за месяц должно быть 90.83725, получили %',
      compute_monthly_quotation_avg('00000000-0000-0000-0000-00000000ba03', 2099, 8);
  END IF;

  -- Строку-вариант по умолчанию заводит триггер вместе со сделкой —
  -- правим её, а не вставляем вторую (уникальность одного default).
  UPDATE deal_buyer_lines
     SET price_condition = 'average_month', calc_mode = 'avg_month', price_stage = 'final',
         quotation_type_id = '00000000-0000-0000-0000-00000000ba03',
         discount = 0, barrel_ratio = 7.6, selected_month = 'август', price = 690.363
   WHERE deal_id = v_deal AND is_default = TRUE
  RETURNING id INTO v_line;

  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_month, date,
                                 shipment_volume, buyer_line_id)
  VALUES (v_deal, 'KG', 'BBL-0001', 'август', DATE '2099-08-10', 60, v_line)
  RETURNING id INTO v_row;

  SELECT calculated_price, amount INTO v_price, v_amount
    FROM deal_shipment_prices WHERE shipment_registry_id = v_row AND side = 'buyer';

  IF v_price IS DISTINCT FROM 690.363 THEN
    RAISE EXCEPTION '6. цена отгрузки должна быть 690.363 (90.83725 × 7.6, три знака), получили %', v_price;
  END IF;
  IF round(v_price, 4) = 90.8373 THEN
    RAISE EXCEPTION '6. коэффициент не применился — цена осталась котировкой в долларах за баррель';
  END IF;
  IF v_amount IS DISTINCT FROM 60 * 690.363 THEN
    RAISE EXCEPTION '6. сумма должна быть объём × цена, получили %', v_amount;
  END IF;

  -- ── 3. Пересчёт по кнопке «Окончательная» ──────────────────────────
  -- Клиент выбрал ручной пересчёт: правим коэффициент и зовём тот же
  -- путь, что и фиксация цены.
  UPDATE deal_buyer_lines SET barrel_ratio = 7.4 WHERE id = v_line;
  PERFORM recompute_line_shipment_prices(v_line, 'buyer');

  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_row AND side = 'buyer';
  IF v_price IS DISTINCT FROM round(90.83725 * 7.4, 3) THEN
    RAISE EXCEPTION '7. после пересчёта ожидали % (90.83725 × 7.4, три знака), получили %',
      round(90.83725 * 7.4, 3), v_price;
  END IF;

  -- ── 4. Без коэффициента — прежняя цена ─────────────────────────────
  UPDATE deal_buyer_lines SET barrel_ratio = NULL WHERE id = v_line;
  PERFORM recompute_line_shipment_prices(v_line, 'buyer');

  SELECT calculated_price INTO v_price
    FROM deal_shipment_prices WHERE shipment_registry_id = v_row AND side = 'buyer';
  IF v_price IS DISTINCT FROM 90.837 THEN
    RAISE EXCEPTION '8. без коэффициента цена обязана вернуться к котировке 90.837 (три знака), получили %', v_price;
  END IF;

  RAISE NOTICE 'OK: коэффициент барелизации доходит до цены отгрузки и пересчёта, пустой коэффициент ничего не меняет';
END $$;

-- ── 5. Ноль и минус запрещены ────────────────────────────────────────
DO $$
DECLARE v_deal UUID := gen_random_uuid(); v_ok BOOLEAN := FALSE;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal, 'KG', 9981, 2099, 'август',
          '00000000-0000-0000-0000-00000000ba01', '00000000-0000-0000-0000-00000000ba02');
  BEGIN
    UPDATE deal_supplier_lines SET barrel_ratio = 0 WHERE deal_id = v_deal;
  EXCEPTION WHEN check_violation THEN v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '9. нулевой коэффициент обнулил бы цену — он должен быть запрещён';
  END IF;

  v_ok := FALSE;
  BEGIN
    UPDATE deal_supplier_lines SET barrel_ratio = -1 WHERE deal_id = v_deal;
  EXCEPTION WHEN check_violation THEN v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '9. отрицательный коэффициент должен быть запрещён';
  END IF;
END $$;

ROLLBACK;

-- Test: предпросмотр пересчёта по новой котировке (миграция 00149)
--
-- Клиент 2026-08-13: внесли среднюю за месяц — паспорт должен показать,
-- что пересчитается, менеджер подтверждает. Окончательные цены не
-- трогаем.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-0000000009c1', 'supplier', 'T-QR Поставщик'),
  ('00000000-0000-0000-0000-0000000009c2', 'buyer',    'T-QR Покупатель');
INSERT INTO fuel_types (id, name) VALUES
  ('00000000-0000-0000-0000-0000000009d1', 'T-QR Мазут');
INSERT INTO quotation_product_types (id, fuel_type_id, name) VALUES
  ('00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009d1', 'T-QR Котировка');

DO $$
DECLARE
  v_deal  UUID := gen_random_uuid();
  v_line  UUID;
  v_cnt   INT;
  v_new   NUMERIC;
  v_old   NUMERIC;
BEGIN
  -- Котировки за июль: 100 и 120 → среднее 110.
  INSERT INTO quotations (product_type_id, date, price) VALUES
    ('00000000-0000-0000-0000-0000000009e1', DATE '2099-07-10', 100),
    ('00000000-0000-0000-0000-0000000009e1', DATE '2099-07-20', 120);

  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal, 'KZ', 9950, 2099, 'июль',
          '00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009c2');

  SELECT id INTO v_line FROM deal_supplier_lines WHERE deal_id = v_deal AND is_default;

  -- Строка в режиме «Средний месяц» со скидкой 5 и устаревшей ценой.
  UPDATE deal_supplier_lines
     SET quotation_type_id = '00000000-0000-0000-0000-0000000009e1',
         price_condition = 'average_month', calc_mode = 'avg_month',
         price_source = 'price', discount = 5, quotation = 90, price = 85,
         price_stage = 'preliminary'
   WHERE id = v_line;

  -- ── 1. Строка попадает в предпросмотр с новой ценой ────────────────
  -- Среднее 110 минус скидка 5 = 105.
  SELECT count(*), MAX(new_quotation), MAX(new_price), MAX(old_price)
    INTO v_cnt, v_new, v_new, v_old
  FROM quotation_repricing_preview('00000000-0000-0000-0000-0000000009e1', DATE '2099-07-15');

  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'ожидали одну строку в предпросмотре, получили %', v_cnt;
  END IF;

  SELECT new_quotation, new_price, old_price INTO v_new, v_new, v_old
  FROM quotation_repricing_preview('00000000-0000-0000-0000-0000000009e1', DATE '2099-07-15');

  SELECT new_price INTO v_new
  FROM quotation_repricing_preview('00000000-0000-0000-0000-0000000009e1', DATE '2099-07-15');
  IF v_new <> 105 THEN
    RAISE EXCEPTION 'новая цена ожидалась 105 (среднее 110 − скидка 5), получили %', v_new;
  END IF;
  IF v_old <> 85 THEN
    RAISE EXCEPTION 'старая цена должна остаться 85, получили %', v_old;
  END IF;

  -- ── 2. Предпросмотр ничего не меняет ───────────────────────────────
  SELECT price INTO v_old FROM deal_supplier_lines WHERE id = v_line;
  IF v_old <> 85 THEN
    RAISE EXCEPTION 'предпросмотр не должен менять цену, в строке стало %', v_old;
  END IF;

  -- ── 3. Окончательная цена в пересчёт не попадает ───────────────────
  UPDATE deal_supplier_lines SET price_stage = 'final' WHERE id = v_line;
  SELECT count(*) INTO v_cnt
  FROM quotation_repricing_preview('00000000-0000-0000-0000-0000000009e1', DATE '2099-07-15');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'окончательные строки трогать нельзя, в предпросмотре их %', v_cnt;
  END IF;
  UPDATE deal_supplier_lines SET price_stage = 'preliminary' WHERE id = v_line;

  -- ── 4. Чужой месяц не затрагивается ────────────────────────────────
  SELECT count(*) INTO v_cnt
  FROM quotation_repricing_preview('00000000-0000-0000-0000-0000000009e1', DATE '2099-06-15');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'котировка за июнь не должна трогать июльские строки, получили %', v_cnt;
  END IF;

  -- ── 5. Совпадающая цена в списке не показывается ───────────────────
  UPDATE deal_supplier_lines SET price = 105 WHERE id = v_line;
  SELECT count(*) INTO v_cnt
  FROM quotation_repricing_preview('00000000-0000-0000-0000-0000000009e1', DATE '2099-07-15');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'строка с уже верной ценой не должна попадать в список, получили %', v_cnt;
  END IF;

  -- ── 6. Ручной режим котировкой не пересчитывается ──────────────────
  UPDATE deal_supplier_lines SET price = 85, price_condition = 'manual' WHERE id = v_line;
  SELECT count(*) INTO v_cnt
  FROM quotation_repricing_preview('00000000-0000-0000-0000-0000000009e1', DATE '2099-07-15');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'фикс-цена пересчёту не подлежит, получили %', v_cnt;
  END IF;
END $$;

ROLLBACK;

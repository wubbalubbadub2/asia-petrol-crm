-- Test: разделение базиса поставки (migration 00136)
--
-- Правила, которые проверяем:
--   1. тип + станция склеиваются в «FCA Текесу» (служебный префикс
--      «ст.» из названия станции не попадает в базис);
--   2. уточнение добавляется через запятую;
--   3. смена станции пересобирает текст;
--   4. исторические строки (delivery_basis_id IS NULL) не трогаются;
--   5. ручная правка текста базиса не затирается, пока структурные
--      поля не изменились;
--   6. текст доезжает до зеркала deals.supplier_delivery_basis.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000601', 'supplier', 'T-BasisSupplier');
INSERT INTO stations (id, name, type) VALUES
  ('00000000-0000-0000-0000-000000000611', 'ст. Текесу', 'both'),
  ('00000000-0000-0000-0000-000000000612', 'ст. Пойма', 'both');

DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_line_id UUID := gen_random_uuid();
  v_old_id  UUID := gen_random_uuid();
  v_fca     UUID;
  v_exw     UUID;
  v_text    TEXT;
BEGIN
  SELECT id INTO v_fca FROM delivery_bases WHERE name = 'FCA';
  SELECT id INTO v_exw FROM delivery_bases WHERE name = 'EXW';
  IF v_fca IS NULL OR v_exw IS NULL THEN
    RAISE EXCEPTION 'справочник базисов не засеян';
  END IF;

  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id)
  VALUES (v_deal_id, 'KZ', 9961, 2099, 'январь',
          '00000000-0000-0000-0000-000000000601');

  -- Дефолтная строка варианта создаётся триггером вместе со сделкой.
  SELECT id INTO v_line_id
    FROM deal_supplier_lines WHERE deal_id = v_deal_id AND is_default;
  IF v_line_id IS NULL THEN
    RAISE EXCEPTION 'дефолтная строка поставщика не создалась';
  END IF;

  -- 1 + 2. Склейка типа, станции и уточнения ---------------------------
  UPDATE deal_supplier_lines
     SET delivery_basis_id = v_fca,
         departure_station_id = '00000000-0000-0000-0000-000000000611'
   WHERE id = v_line_id;

  SELECT delivery_basis INTO v_text FROM deal_supplier_lines WHERE id = v_line_id;
  IF v_text <> 'FCA Текесу' THEN
    RAISE EXCEPTION 'ожидали «FCA Текесу», получили «%»', v_text;
  END IF;

  UPDATE deal_supplier_lines
     SET delivery_basis_note = 'нефтебаза ТОО «ШМО»'
   WHERE id = v_line_id;
  SELECT delivery_basis INTO v_text FROM deal_supplier_lines WHERE id = v_line_id;
  IF v_text <> 'FCA Текесу, нефтебаза ТОО «ШМО»' THEN
    RAISE EXCEPTION 'уточнение не приклеилось: «%»', v_text;
  END IF;

  -- 3. Смена станции пересобирает текст --------------------------------
  UPDATE deal_supplier_lines
     SET departure_station_id = '00000000-0000-0000-0000-000000000612'
   WHERE id = v_line_id;
  SELECT delivery_basis INTO v_text FROM deal_supplier_lines WHERE id = v_line_id;
  IF v_text <> 'FCA Пойма, нефтебаза ТОО «ШМО»' THEN
    RAISE EXCEPTION 'смена станции не пересобрала базис: «%»', v_text;
  END IF;

  -- 6. Зеркало на сделке -----------------------------------------------
  SELECT supplier_delivery_basis INTO v_text FROM deals WHERE id = v_deal_id;
  IF v_text <> 'FCA Пойма, нефтебаза ТОО «ШМО»' THEN
    RAISE EXCEPTION 'зеркало deals.supplier_delivery_basis = «%»', v_text;
  END IF;

  -- 5. Ручная правка текста не затирается ------------------------------
  UPDATE deal_supplier_lines SET delivery_basis = 'FCA Пойма (по допнику)' WHERE id = v_line_id;
  UPDATE deal_supplier_lines SET price = 100 WHERE id = v_line_id;
  SELECT delivery_basis INTO v_text FROM deal_supplier_lines WHERE id = v_line_id;
  IF v_text <> 'FCA Пойма (по допнику)' THEN
    RAISE EXCEPTION 'ручной текст затёрт при правке цены: «%»', v_text;
  END IF;

  -- 4. Историческая строка без типа не трогается ------------------------
  INSERT INTO deal_supplier_lines (id, deal_id, position, delivery_basis)
  VALUES (v_old_id, v_deal_id, 2, 'EXW франко-резервуар');
  UPDATE deal_supplier_lines SET price = 55 WHERE id = v_old_id;
  SELECT delivery_basis INTO v_text FROM deal_supplier_lines WHERE id = v_old_id;
  IF v_text <> 'EXW франко-резервуар' THEN
    RAISE EXCEPTION 'исторический базис изменился: «%»', v_text;
  END IF;

  -- Базис без станции (типичный EXW) ------------------------------------
  UPDATE deal_supplier_lines
     SET delivery_basis_id = v_exw, delivery_basis_note = 'франко-резервуар'
   WHERE id = v_old_id;
  SELECT delivery_basis INTO v_text FROM deal_supplier_lines WHERE id = v_old_id;
  IF v_text <> 'EXW, франко-резервуар' THEN
    RAISE EXCEPTION 'EXW без станции собрался как «%»', v_text;
  END IF;

  -- 7. Путь формы создания сделки: строки вариантов удаляются и
  -- вставляются заново, поэтому текст обязан собираться и на INSERT,
  -- и доезжать до зеркала на сделке (форма его больше не пишет сама).
  DELETE FROM deal_supplier_lines WHERE deal_id = v_deal_id;
  INSERT INTO deal_supplier_lines (deal_id, position, is_default,
                                   delivery_basis_id, departure_station_id)
  VALUES (v_deal_id, 1, TRUE, v_fca, '00000000-0000-0000-0000-000000000611');

  SELECT delivery_basis INTO v_text
    FROM deal_supplier_lines WHERE deal_id = v_deal_id AND is_default;
  IF v_text <> 'FCA Текесу' THEN
    RAISE EXCEPTION 'INSERT не собрал базис: «%»', v_text;
  END IF;

  SELECT supplier_delivery_basis INTO v_text FROM deals WHERE id = v_deal_id;
  IF v_text <> 'FCA Текесу' THEN
    RAISE EXCEPTION 'INSERT не отзеркалился в сделку: «%»', v_text;
  END IF;

  RAISE NOTICE '06_delivery_basis_split: OK';
END $$;

ROLLBACK;

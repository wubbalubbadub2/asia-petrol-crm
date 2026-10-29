-- Test: варианты цены группы компаний (00183), только KG.
--
-- Клиент 2026-10-29 (пример KG/26/736): у цены группы компаний в цепочке —
-- варианты «цена + объём». Вариант привязывается к варианту покупателя, и
-- объём идёт сам: отгружено по этому варианту покупателя (Σ shipment_volume
-- его строк реестра, как «Отгружено по этому варианту» у покупателя).
-- «Цены не постоянные, отгруженный объём фиксируется на цену»: две цены на
-- один вариант покупателя делятся по дате отгрузки — у цены «действует с»,
-- строка без даты идёт в первую цену. Вариант без привязки — объём вручную.
-- Удалили вариант покупателя — привязка, дата и объём обнуляются, цена
-- остаётся. «Основной» вариант зеркалится в deal_company_groups (цена,
-- котировка, скидка, тип) в обе стороны — паспорт и выгрузки не меняются.
--
-- Числа: 450 $ к «Варианту 3» покупателя, отгружено 956,007 т →
-- 450 × 956,007 = 430 203,15.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000c901', 'supplier', 'T-CGL Поставщик'),
  ('00000000-0000-0000-0000-00000000c902', 'buyer',    'T-CGL Покупатель');
INSERT INTO company_groups (id, name) VALUES
  ('00000000-0000-0000-0000-00000000c903', 'T-CGL Группа');

DO $$
DECLARE
  v_cg   UUID := '00000000-0000-0000-0000-00000000c903';
  v_kg   UUID := gen_random_uuid();
  v_kz   UUID := gen_random_uuid();
  v_b2   UUID;
  v_b3   UUID;
  v_dcg  UUID;
  v_kzg  UUID;
  v_main UUID;
  v_450  UUID;
  v_460  UUID;
  v_440  UUID;
  v_late UUID;
  v_n    INT;
  r      RECORD;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_kg, 'KG', 9984, 2099, 'июнь', '00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000c902'),
         (v_kz, 'KZ', 9985, 2099, 'июнь', '00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000c902');
  INSERT INTO deal_buyer_lines (deal_id, position, is_default, price) VALUES (v_kg, 2, FALSE, 600.25) RETURNING id INTO v_b2;
  INSERT INTO deal_buyer_lines (deal_id, position, is_default, price) VALUES (v_kg, 3, FALSE, 616.75) RETURNING id INTO v_b3;

  -- отгружено по «Варианту 3»: 300 + 356,007 + 300 = 956,007 т
  INSERT INTO shipment_registry (deal_id, registry_type, date, shipment_volume, buyer_line_id) VALUES
    (v_kg, 'KG', '2099-06-01', 300.000, v_b3),
    (v_kg, 'KG', '2099-06-10', 356.007, v_b3),
    (v_kg, 'KG', '2099-06-20', 300.000, v_b3);
  IF (SELECT SUM(shipment_volume) FROM shipment_registry WHERE buyer_line_id = v_b3) IS DISTINCT FROM 956.007 THEN
    RAISE EXCEPTION 'фикстура: строки должны остаться на «Варианте 3»';
  END IF;

  -- ── 1. Группа в цепочке KG → «Основной» вариант с её ценой ──────────
  INSERT INTO deal_company_groups (deal_id, company_group_id, position, price, quotation, discount)
  VALUES (v_kg, v_cg, 1, 455, 460, 5) RETURNING id INTO v_dcg;
  SELECT * INTO r FROM deal_company_group_lines WHERE deal_company_group_id = v_dcg AND is_default;
  IF r.id IS NULL OR r.price IS DISTINCT FROM 455 OR r.quotation IS DISTINCT FROM 460 OR r.discount IS DISTINCT FROM 5
     OR r.price_kind <> 'preliminary' THEN
    RAISE EXCEPTION '1. «Основной» должен повторить цену группы 455 (460 − 5), получили %', row_to_json(r);
  END IF;
  v_main := r.id;

  -- правка цены группы (паспорт, ячейка) → «Основной»; и наоборот
  UPDATE deal_company_groups SET price = 457 WHERE id = v_dcg;
  IF (SELECT price FROM deal_company_group_lines WHERE id = v_main) IS DISTINCT FROM 457 THEN
    RAISE EXCEPTION '1. цена группы 457 должна дойти до «Основного»';
  END IF;
  UPDATE deal_company_group_lines SET price = 458, price_kind = 'final' WHERE id = v_main;
  SELECT * INTO r FROM deal_company_groups WHERE id = v_dcg;
  IF r.price IS DISTINCT FROM 458 OR r.price_kind <> 'final' THEN
    RAISE EXCEPTION '1. «Основной» 458 фин. должен дойти до цены группы, получили % %', r.price, r.price_kind;
  END IF;

  -- ── 2. 450 $ к «Варианту 3» → 956,007 т, 430 203,15 ─────────────────
  INSERT INTO deal_company_group_lines (deal_company_group_id, position, price, buyer_line_id)
  VALUES (v_dcg, 2, 450, v_b3) RETURNING id INTO v_450;
  SELECT * INTO r FROM deal_company_group_line_volumes WHERE line_id = v_450;
  IF r.volume IS DISTINCT FROM 956.007 OR r.amount IS DISTINCT FROM 430203.15 THEN
    RAISE EXCEPTION '2. ожидали 956,007 т на 430 203,15, получили % т на %', r.volume, r.amount;
  END IF;
  IF (SELECT price FROM deal_company_groups WHERE id = v_dcg) IS DISTINCT FROM 458 THEN
    RAISE EXCEPTION '2. не «Основной» вариант цену группы не трогает';
  END IF;

  -- ── 3. Новая отгрузка 50 т на «Вариант 3» → 1 006,007 т сама ────────
  INSERT INTO shipment_registry (deal_id, registry_type, date, shipment_volume, buyer_line_id)
  VALUES (v_kg, 'KG', '2099-06-25', 50.000, v_b3) RETURNING id INTO v_late;
  IF (SELECT volume FROM deal_company_group_line_volumes WHERE line_id = v_450) IS DISTINCT FROM 1006.007 THEN
    RAISE EXCEPTION '3. после отгрузки 50 т ожидали 1 006,007 т';
  END IF;

  -- ── 4. Вторая цена 460 к тому же «Варианту 3» с 15.06 ───────────────
  --    до 15.06: 300 + 356,007 = 656,007 т по 450 = 295 203,15;
  --    с 15.06: 300 + 50 = 350 т по 460 = 161 000,00.
  INSERT INTO deal_company_group_lines (deal_company_group_id, position, price, buyer_line_id, valid_from)
  VALUES (v_dcg, 3, 460, v_b3, '2099-06-15') RETURNING id INTO v_460;
  SELECT * INTO r FROM deal_company_group_line_volumes WHERE line_id = v_450;
  IF r.volume IS DISTINCT FROM 656.007 OR r.amount IS DISTINCT FROM 295203.15 THEN
    RAISE EXCEPTION '4. 450: ожидали 656,007 т на 295 203,15, получили % т на %', r.volume, r.amount;
  END IF;
  SELECT * INTO r FROM deal_company_group_line_volumes WHERE line_id = v_460;
  IF r.volume IS DISTINCT FROM 350.000 OR r.amount IS DISTINCT FROM 161000.00 THEN
    RAISE EXCEPTION '4. 460: ожидали 350 т на 161 000,00, получили % т на %', r.volume, r.amount;
  END IF;
  --    строка без даты — в первую цену
  INSERT INTO shipment_registry (deal_id, registry_type, shipment_volume, buyer_line_id) VALUES (v_kg, 'KG', 10.000, v_b3);
  IF (SELECT volume FROM deal_company_group_line_volumes WHERE line_id = v_450) IS DISTINCT FROM 666.007
     OR (SELECT volume FROM deal_company_group_line_volumes WHERE line_id = v_460) IS DISTINCT FROM 350.000 THEN
    RAISE EXCEPTION '4. отгрузка без даты должна уйти в первую цену (450)';
  END IF;
  --    дата у первой цены позже ранних отгрузок — они всё равно в первой (не теряются)
  UPDATE deal_company_group_lines SET valid_from = '2099-06-05' WHERE id = v_450;
  IF (SELECT volume FROM deal_company_group_line_volumes WHERE line_id = v_450) IS DISTINCT FROM 666.007 THEN
    RAISE EXCEPTION '4. отгрузка 01.06 раньше «действует с» 05.06 первой цены должна остаться в ней';
  END IF;
  UPDATE deal_company_group_lines SET valid_from = NULL WHERE id = v_450;
  --    вторая цена без даты к тому же варианту покупателя — нельзя (нужна дата)
  BEGIN
    UPDATE deal_company_group_lines SET valid_from = NULL WHERE id = v_460;
    RAISE EXCEPTION '4. две цены без даты на один вариант покупателя должны быть отклонены';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  --    та же дата у второй цены того же варианта покупателя — нельзя
  BEGIN
    INSERT INTO deal_company_group_lines (deal_company_group_id, position, price, buyer_line_id, valid_from)
    VALUES (v_dcg, 9, 470, v_b3, '2099-06-15');
    RAISE EXCEPTION '4. дубль даты должен быть отклонён';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- ── 5. Строку перенесли на «Вариант 2» → у 460 остаётся 300 т ───────
  UPDATE shipment_registry SET buyer_line_id = v_b2 WHERE id = v_late;
  IF (SELECT volume FROM deal_company_group_line_volumes WHERE line_id = v_460) IS DISTINCT FROM 300.000 THEN
    RAISE EXCEPTION '5. после переноса 50 т ожидали 300 т у 460';
  END IF;

  -- ── 6. Без привязки — объём вручную: 440 × 1 000 = 440 000,00 ───────
  INSERT INTO deal_company_group_lines (deal_company_group_id, position, price, manual_volume)
  VALUES (v_dcg, 4, 440, 1000) RETURNING id INTO v_440;
  SELECT * INTO r FROM deal_company_group_line_volumes WHERE line_id = v_440;
  IF r.volume IS DISTINCT FROM 1000.000 OR r.amount IS DISTINCT FROM 440000.00 OR r.is_linked THEN
    RAISE EXCEPTION '6. ожидали 1 000 т на 440 000,00 без привязки, получили % т на %', r.volume, r.amount;
  END IF;
  --    объём вручную при привязке — нельзя (объём идёт из отгрузок)
  BEGIN
    UPDATE deal_company_group_lines SET manual_volume = 5 WHERE id = v_450;
    RAISE EXCEPTION '6. ручной объём у привязанного варианта должен быть отклонён';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── 7. Удалили «Вариант 3» покупателя → обнулить всё, кроме цен ─────
  DELETE FROM shipment_registry WHERE buyer_line_id = v_b3;
  DELETE FROM deal_buyer_lines WHERE id = v_b3;
  SELECT count(*) INTO v_n FROM deal_company_group_lines
   WHERE id IN (v_450, v_460) AND buyer_line_id IS NULL AND valid_from IS NULL AND manual_volume IS NULL;
  IF v_n <> 2 THEN RAISE EXCEPTION '7. привязка и дата должны обнулиться у обоих вариантов'; END IF;
  IF (SELECT price FROM deal_company_group_lines WHERE id = v_450) IS DISTINCT FROM 450
     OR (SELECT price FROM deal_company_group_lines WHERE id = v_460) IS DISTINCT FROM 460 THEN
    RAISE EXCEPTION '7. цены остаются';
  END IF;
  IF (SELECT volume FROM deal_company_group_line_volumes WHERE line_id = v_450) IS NOT NULL THEN
    RAISE EXCEPTION '7. объём пустой';
  END IF;

  -- ── 8. Только KG: у KZ «Основной» не создаётся, варианты не пишутся ─
  INSERT INTO deal_company_groups (deal_id, company_group_id, position, price)
  VALUES (v_kz, v_cg, 1, 300) RETURNING id INTO v_kzg;
  IF EXISTS (SELECT 1 FROM deal_company_group_lines WHERE deal_company_group_id = v_kzg) THEN
    RAISE EXCEPTION '8. у KZ вариантов цены группы нет';
  END IF;
  BEGIN
    INSERT INTO deal_company_group_lines (deal_company_group_id, position, price) VALUES (v_kzg, 2, 310);
    RAISE EXCEPTION '8. вариант в KZ-сделке должен быть отклонён';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%только для KG%' THEN RAISE; END IF;
  END;
  UPDATE deal_company_groups SET price = 305 WHERE id = v_kzg;  -- цена KZ-группы правится как раньше

  -- ── 9. Вариант покупателя из другой сделки — нельзя ─────────────────
  BEGIN
    INSERT INTO deal_company_group_lines (deal_company_group_id, position, price, buyer_line_id)
    VALUES (v_dcg, 5, 451, (SELECT id FROM deal_buyer_lines WHERE deal_id = v_kz AND is_default));
    RAISE EXCEPTION '9. чужой вариант покупателя должен быть отклонён';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%другой сделки%' THEN RAISE; END IF;
  END;

  -- ── 10. Журнал: добавление варианта и смена привязки записаны ───────
  SELECT count(*) INTO v_n FROM deal_activity
   WHERE deal_id = v_kg AND content LIKE 'Добавлен вариант цены группы%';
  IF v_n < 3 THEN RAISE EXCEPTION '10. ожидали ≥ 3 записи о вариантах цены группы, получили %', v_n; END IF;

  -- ── 11. Удаление KG-сделки с привязанными вариантами проходит ────────
  INSERT INTO deal_buyer_lines (deal_id, position, is_default, price) VALUES (v_kg, 5, FALSE, 650.75) RETURNING id INTO v_b3;
  UPDATE deal_company_group_lines SET buyer_line_id = v_b3, manual_volume = NULL WHERE id = v_440;
  DELETE FROM shipment_registry WHERE deal_id = v_kg;
  DELETE FROM deals WHERE id = v_kg;
  IF EXISTS (SELECT 1 FROM deal_company_group_lines WHERE id IN (v_main, v_450, v_460, v_440)) THEN
    RAISE EXCEPTION '11. варианты уходят вместе со сделкой';
  END IF;

  RAISE NOTICE 'company group lines: all cases passed';
END $$;

ROLLBACK;

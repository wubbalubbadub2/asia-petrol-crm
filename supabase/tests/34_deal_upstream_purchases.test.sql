-- Test: «Закупка» — у кого наша компания купила товар под сделку KG (00180).
--
-- Правила владельца 2026-10-05: одна закупка → несколько сделок, у сделки
-- не больше одной закупки; завод и продукт совпадают; только KG; продавец —
-- поставщик, но не наша компания; продано = сумма объёмов поставщика
-- привязанных сделок (без архива / черновиков / скрытых), остаток может
-- уйти в минус; без цены — балансы не меняются.

BEGIN;

INSERT INTO counterparties (id, type, full_name, short_name, is_own_supplier) VALUES
  ('00000000-0000-0000-0000-0000000c0a01', 'supplier', 'T-UP Taur', 'T-UP Taur', TRUE),
  ('00000000-0000-0000-0000-0000000c0a02', 'supplier', 'T-UP НАЗС', 'T-UP НАЗС', TRUE),
  ('00000000-0000-0000-0000-0000000c0a03', 'supplier', 'T-UP Daulealy', 'T-UP Daulealy', FALSE),
  ('00000000-0000-0000-0000-0000000c0a04', 'buyer',    'T-UP Покупатель', 'T-UP Покупатель', FALSE);
INSERT INTO factories (id, name) VALUES
  ('00000000-0000-0000-0000-0000000c0b01', 'T-UP Meeras'),
  ('00000000-0000-0000-0000-0000000c0b02', 'T-UP Другой завод');
INSERT INTO fuel_types (id, name) VALUES
  ('00000000-0000-0000-0000-0000000c0c01', 'T-UP Судовое'),
  ('00000000-0000-0000-0000-0000000c0c02', 'T-UP АИ-92');

DO $$
DECLARE
  c_taur   CONSTANT UUID := '00000000-0000-0000-0000-0000000c0a01';
  c_nazs   CONSTANT UUID := '00000000-0000-0000-0000-0000000c0a02';
  c_seller CONSTANT UUID := '00000000-0000-0000-0000-0000000c0a03';
  c_buyer  CONSTANT UUID := '00000000-0000-0000-0000-0000000c0a04';
  f_meeras CONSTANT UUID := '00000000-0000-0000-0000-0000000c0b01';
  f_other  CONSTANT UUID := '00000000-0000-0000-0000-0000000c0b02';
  t_ship   CONSTANT UUID := '00000000-0000-0000-0000-0000000c0c01';
  t_ai92   CONSTANT UUID := '00000000-0000-0000-0000-0000000c0c02';
  v_p      UUID := gen_random_uuid();
  v_d1     UUID := gen_random_uuid();
  v_d2     UUID := gen_random_uuid();
  v_d3     UUID := gen_random_uuid();
  v_bal    NUMERIC;
  v_bal2   NUMERIC;
  r        RECORD;
  v_ok     BOOLEAN;
  v_n      INT;
BEGIN
  -- Закупка как в примере клиента: Daulealy, «1 от 15.09.2026», 1040 т.
  INSERT INTO deal_upstream_purchases (id, our_company_id, seller_id, factory_id, fuel_type_id, appendix, volume_tons)
  VALUES (v_p, c_taur, c_seller, f_meeras, t_ship, '1 от 15.09.2026', 1040);

  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id, factory_id, fuel_type_id,
                     supplier_contracted_volume, supplier_currency, logistics_currency)
  VALUES (v_d1, 'KG', 9981, 2099, 'сентябрь', c_taur, c_buyer, f_meeras, t_ship, 520, 'USD', 'USD'),
         (v_d2, 'KG', 9982, 2099, 'сентябрь', c_taur, c_buyer, f_meeras, t_ship, 520, 'USD', 'USD'),
         (v_d3, 'KG', 9983, 2099, 'сентябрь', c_taur, c_buyer, f_meeras, t_ship, 100, 'USD', 'USD');
  UPDATE deals SET is_draft = FALSE WHERE id IN (v_d1, v_d2, v_d3);

  -- 1. Привязка одной сделки: продано 520, остаток 520; баланс не тронут.
  SELECT supplier_balance INTO v_bal FROM deals WHERE id = v_d1;
  UPDATE deals SET upstream_purchase_id = v_p WHERE id = v_d1;
  SELECT * INTO r FROM deal_upstream_purchase_totals WHERE purchase_id = v_p;
  IF r.deal_count <> 1 OR r.sold_tons <> 520 OR r.remaining_tons <> 520 THEN
    RAISE EXCEPTION '1 сделка: ждали 1 / 520 / 520, получили % / % / %', r.deal_count, r.sold_tons, r.remaining_tons;
  END IF;
  SELECT supplier_balance INTO v_bal2 FROM deals WHERE id = v_d1;
  IF v_bal IS DISTINCT FROM v_bal2 THEN
    RAISE EXCEPTION 'привязка закупки изменила баланс поставщика: % → %', v_bal, v_bal2;
  END IF;

  -- Лента сделки: «Закупка привязана» с подписью продавца и приложения.
  SELECT count(*) INTO v_n FROM deal_activity
   WHERE deal_id = v_d1 AND content = 'Закупка привязана'
     AND metadata->>'new_label' = 'T-UP Daulealy, прил. 1 от 15.09.2026';
  IF v_n <> 1 THEN RAISE EXCEPTION 'в ленте нет «Закупка привязана» (найдено %)', v_n; END IF;

  -- 2. Вторая сделка → остаток 0; третья → −100, но сохраняется (предупреждение, не запрет).
  UPDATE deals SET upstream_purchase_id = v_p WHERE id IN (v_d2, v_d3);
  SELECT * INTO r FROM deal_upstream_purchase_totals WHERE purchase_id = v_p;
  IF r.deal_count <> 3 OR r.sold_tons <> 1140 OR r.remaining_tons <> -100 THEN
    RAISE EXCEPTION '3 сделки: ждали 3 / 1140 / -100, получили % / % / %', r.deal_count, r.sold_tons, r.remaining_tons;
  END IF;

  -- 3. Архивная сделка в «продано» не входит.
  UPDATE deals SET is_archived = TRUE WHERE id = v_d3;
  SELECT * INTO r FROM deal_upstream_purchase_totals WHERE purchase_id = v_p;
  IF r.sold_tons <> 1040 OR r.remaining_tons <> 0 THEN
    RAISE EXCEPTION 'архив: ждали 1040 / 0, получили % / %', r.sold_tons, r.remaining_tons;
  END IF;
  UPDATE deals SET is_archived = FALSE, upstream_purchase_id = NULL WHERE id = v_d3;

  -- 4. Нельзя: другой продукт, другой завод, другая наша компания, не KG.
  UPDATE deals SET fuel_type_id = t_ai92 WHERE id = v_d3;
  v_ok := FALSE;
  BEGIN UPDATE deals SET upstream_purchase_id = v_p WHERE id = v_d3;
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'привязалась сделка с другим продуктом'; END IF;

  UPDATE deals SET fuel_type_id = t_ship, factory_id = f_other WHERE id = v_d3;
  v_ok := FALSE;
  BEGIN UPDATE deals SET upstream_purchase_id = v_p WHERE id = v_d3;
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'привязалась сделка с другим заводом'; END IF;

  UPDATE deals SET factory_id = f_meeras, supplier_id = c_nazs WHERE id = v_d3;
  v_ok := FALSE;
  BEGIN UPDATE deals SET upstream_purchase_id = v_p WHERE id = v_d3;
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'привязалась сделка другой нашей компании'; END IF;

  -- 5. У привязанной сделки нельзя сменить поставщика / завод / продукт.
  v_ok := FALSE;
  BEGIN UPDATE deals SET supplier_id = c_nazs WHERE id = v_d1;
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'у привязанной сделки сменился поставщик'; END IF;
  v_ok := FALSE;
  BEGIN UPDATE deals SET fuel_type_id = t_ai92 WHERE id = v_d1;
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'у привязанной сделки сменился продукт'; END IF;
  -- Объём и прочее править можно.
  UPDATE deals SET supplier_contracted_volume = 500 WHERE id = v_d1;

  -- 6. Закупку нельзя перевести на другой продукт, пока к ней привязаны сделки.
  v_ok := FALSE;
  BEGIN UPDATE deal_upstream_purchases SET fuel_type_id = t_ai92 WHERE id = v_p;
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'закупка сменила продукт при привязанных сделках'; END IF;
  -- Приложение и объём править можно.
  UPDATE deal_upstream_purchases SET appendix = '1/1 от 15.09.2026', volume_tons = 1100 WHERE id = v_p;

  -- 7. Продавец — не наша компания; наша компания — с галочкой.
  v_ok := FALSE;
  BEGIN INSERT INTO deal_upstream_purchases (our_company_id, seller_id, factory_id, fuel_type_id, appendix, volume_tons)
        VALUES (c_taur, c_nazs, f_meeras, t_ship, 'x', 1);
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'продавцом стала наша компания'; END IF;
  v_ok := FALSE;
  BEGIN INSERT INTO deal_upstream_purchases (our_company_id, seller_id, factory_id, fuel_type_id, appendix, volume_tons)
        VALUES (c_seller, c_taur, f_meeras, t_ship, 'x', 1);
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'закупку завела не наша компания'; END IF;
  v_ok := FALSE;
  BEGIN INSERT INTO deal_upstream_purchases (our_company_id, seller_id, factory_id, fuel_type_id, appendix, volume_tons)
        VALUES (c_taur, c_seller, f_meeras, t_ship, 'x', 0);
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'сохранился нулевой объём выкупа'; END IF;

  -- 8. Закупку с привязанными сделками удалить нельзя; без сделок — можно.
  v_ok := FALSE;
  BEGIN DELETE FROM deal_upstream_purchases WHERE id = v_p;
  EXCEPTION WHEN foreign_key_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'удалилась закупка с привязанными сделками'; END IF;

  -- 9. Отвязка — в ленте «Закупка отвязана».
  UPDATE deals SET upstream_purchase_id = NULL WHERE id IN (v_d1, v_d2);
  SELECT count(*) INTO v_n FROM deal_activity WHERE deal_id = v_d1 AND content = 'Закупка отвязана';
  IF v_n <> 1 THEN RAISE EXCEPTION 'в ленте нет «Закупка отвязана» (найдено %)', v_n; END IF;
  DELETE FROM deal_upstream_purchases WHERE id = v_p;

  -- 10. Правка закупки попадает в audit_log.
  SELECT count(*) INTO v_n FROM audit_log WHERE table_name = 'deal_upstream_purchases' AND row_id = v_p;
  IF v_n < 3 THEN RAISE EXCEPTION 'audit_log: ждали ≥3 записи (создание, правка, удаление), есть %', v_n; END IF;

  RAISE NOTICE 'OK: закупка — продано / остаток, проверки привязки, лента и аудит';
END $$;

-- 11. RLS: читать — любой вошедший, писать — is_writable_role(), удалять —
-- только is_admin(). Проверяем сами политики: в CI is_writable_role(),
-- is_admin() и auth.uid() заглушены, поэтому прогон под ролью там
-- ничего не доказал бы.
DO $$
DECLARE r RECORD; v_n INT := 0;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'deal_upstream_purchases'::regclass) THEN
    RAISE EXCEPTION 'RLS: на deal_upstream_purchases не включён';
  END IF;
  FOR r IN SELECT cmd, coalesce(qual, '') AS q, coalesce(with_check, '') AS w
             FROM pg_policies WHERE tablename = 'deal_upstream_purchases' LOOP
    v_n := v_n + 1;
    IF r.cmd = 'SELECT' AND r.q NOT LIKE '%auth.uid() IS NOT NULL%' THEN
      RAISE EXCEPTION 'RLS SELECT: ждали auth.uid() IS NOT NULL, есть %', r.q;
    ELSIF r.cmd = 'INSERT' AND r.w NOT LIKE '%is_writable_role()%' THEN
      RAISE EXCEPTION 'RLS INSERT: ждали is_writable_role(), есть %', r.w;
    ELSIF r.cmd = 'UPDATE' AND (r.q NOT LIKE '%is_writable_role()%' OR r.w NOT LIKE '%is_writable_role()%') THEN
      RAISE EXCEPTION 'RLS UPDATE: ждали is_writable_role(), есть % / %', r.q, r.w;
    ELSIF r.cmd = 'DELETE' AND r.q NOT LIKE '%is_admin()%' THEN
      RAISE EXCEPTION 'RLS DELETE: ждали is_admin(), есть %', r.q;
    ELSIF r.cmd = 'ALL' THEN
      RAISE EXCEPTION 'RLS: политика FOR ALL на закупках не ожидалась';
    END IF;
  END LOOP;
  IF v_n <> 4 THEN RAISE EXCEPTION 'RLS: ждали 4 политики, есть %', v_n; END IF;
  RAISE NOTICE 'OK: RLS — читать вошедшим, писать is_writable_role(), удалять is_admin()';
END $$;

ROLLBACK;

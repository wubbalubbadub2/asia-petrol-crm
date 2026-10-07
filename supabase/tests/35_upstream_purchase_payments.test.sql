-- Test: оплаты по закупке первичному поставщику (00181).
--
-- Правила владельца 2026-10-07: оплат по закупке может быть несколько,
-- итог — по валюте (сумма, последняя дата); валюта у каждой оплаты, без
-- пересчёта; на балансы не влияет; закупку с оплатами удалить нельзя.

BEGIN;

INSERT INTO counterparties (id, type, full_name, short_name, is_own_supplier) VALUES
  ('00000000-0000-0000-0000-0000000d0a01', 'supplier', 'T-UPP Taur', 'T-UPP Taur', TRUE),
  ('00000000-0000-0000-0000-0000000d0a02', 'supplier', 'T-UPP Daulealy', 'T-UPP Daulealy', FALSE),
  ('00000000-0000-0000-0000-0000000d0a03', 'buyer',    'T-UPP Покупатель', 'T-UPP Покупатель', FALSE);
INSERT INTO factories (id, name) VALUES ('00000000-0000-0000-0000-0000000d0b01', 'T-UPP Meeras');
INSERT INTO fuel_types (id, name) VALUES ('00000000-0000-0000-0000-0000000d0c01', 'T-UPP Судовое');

DO $$
DECLARE
  v_p    UUID := gen_random_uuid();
  v_d    UUID := gen_random_uuid();
  v_bal  NUMERIC;
  v_bal2 NUMERIC;
  r      RECORD;
  v_ok   BOOLEAN;
  v_n    INT;
BEGIN
  INSERT INTO deal_upstream_purchases (id, our_company_id, seller_id, factory_id, fuel_type_id, appendix, volume_tons)
  VALUES (v_p, '00000000-0000-0000-0000-0000000d0a01', '00000000-0000-0000-0000-0000000d0a02',
          '00000000-0000-0000-0000-0000000d0b01', '00000000-0000-0000-0000-0000000d0c01', '1 от 15.09.2026', 1040);
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id, factory_id, fuel_type_id,
                     supplier_contracted_volume, supplier_currency, logistics_currency, upstream_purchase_id)
  VALUES (v_d, 'KG', 9991, 2099, 'сентябрь', '00000000-0000-0000-0000-0000000d0a01', '00000000-0000-0000-0000-0000000d0a03',
          '00000000-0000-0000-0000-0000000d0b01', '00000000-0000-0000-0000-0000000d0c01', 520, 'USD', 'USD', v_p);
  SELECT supplier_balance INTO v_bal FROM deals WHERE id = v_d;

  -- 1. Две оплаты в USD и одна в KZT: итог по валюте, последняя дата.
  INSERT INTO deal_upstream_purchase_payments (purchase_id, amount, currency, payment_date) VALUES
    (v_p, 100000.50, 'USD', DATE '2026-09-16'),
    (v_p,  50000.25, 'USD', DATE '2026-09-20'),
    (v_p, 9000000,   'KZT', DATE '2026-09-18');
  SELECT * INTO r FROM deal_upstream_purchase_payment_totals WHERE purchase_id = v_p AND currency = 'USD';
  IF r.payment_count <> 2 OR r.paid_amount <> 150000.75 OR r.last_payment_date <> DATE '2026-09-20' THEN
    RAISE EXCEPTION 'USD: ждали 2 / 150000.75 / 2026-09-20, получили % / % / %', r.payment_count, r.paid_amount, r.last_payment_date;
  END IF;
  SELECT * INTO r FROM deal_upstream_purchase_payment_totals WHERE purchase_id = v_p AND currency = 'KZT';
  IF r.payment_count <> 1 OR r.paid_amount <> 9000000 OR r.last_payment_date <> DATE '2026-09-18' THEN
    RAISE EXCEPTION 'KZT: ждали 1 / 9000000 / 2026-09-18, получили % / % / %', r.payment_count, r.paid_amount, r.last_payment_date;
  END IF;

  -- 2. На баланс сделки оплаты закупки не влияют.
  SELECT supplier_balance INTO v_bal2 FROM deals WHERE id = v_d;
  IF v_bal IS DISTINCT FROM v_bal2 THEN
    RAISE EXCEPTION 'оплата закупки изменила баланс сделки: % → %', v_bal, v_bal2;
  END IF;

  -- 3. Нельзя: ноль, неизвестная валюта, без даты.
  v_ok := FALSE;
  BEGIN INSERT INTO deal_upstream_purchase_payments (purchase_id, amount, currency, payment_date) VALUES (v_p, 0, 'USD', DATE '2026-09-21');
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'сохранилась оплата 0'; END IF;
  v_ok := FALSE;
  BEGIN INSERT INTO deal_upstream_purchase_payments (purchase_id, amount, currency, payment_date) VALUES (v_p, 1, 'EUR', DATE '2026-09-21');
  EXCEPTION WHEN check_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'сохранилась оплата в EUR'; END IF;
  v_ok := FALSE;
  BEGIN INSERT INTO deal_upstream_purchase_payments (purchase_id, amount, currency, payment_date) VALUES (v_p, 1, 'USD', NULL);
  EXCEPTION WHEN not_null_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'сохранилась оплата без даты'; END IF;

  -- 4. Закупку с оплатами удалить нельзя, даже без сделок.
  UPDATE deals SET upstream_purchase_id = NULL WHERE id = v_d;
  v_ok := FALSE;
  BEGIN DELETE FROM deal_upstream_purchases WHERE id = v_p;
  EXCEPTION WHEN foreign_key_violation THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'удалилась закупка с оплатами'; END IF;

  -- 5. Аудит: каждая оплата — запись в audit_log.
  SELECT count(*) INTO v_n FROM audit_log a
    JOIN deal_upstream_purchase_payments p ON p.id = a.row_id
   WHERE a.table_name = 'deal_upstream_purchase_payments' AND p.purchase_id = v_p;
  IF v_n <> 3 THEN RAISE EXCEPTION 'audit_log: ждали 3 записи об оплатах, есть %', v_n; END IF;

  RAISE NOTICE 'OK: оплаты закупки — итог по валюте, проверки, удаление и аудит';
END $$;

-- 6. RLS — те же правила, что у закупок. Проверяем сами политики: в CI
-- is_writable_role(), is_admin() и auth.uid() заглушены.
DO $$
DECLARE r RECORD; v_n INT := 0;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'deal_upstream_purchase_payments'::regclass) THEN
    RAISE EXCEPTION 'RLS: на deal_upstream_purchase_payments не включён';
  END IF;
  FOR r IN SELECT cmd, coalesce(qual, '') AS q, coalesce(with_check, '') AS w
             FROM pg_policies WHERE tablename = 'deal_upstream_purchase_payments' LOOP
    v_n := v_n + 1;
    IF r.cmd = 'SELECT' AND r.q NOT LIKE '%auth.uid() IS NOT NULL%' THEN
      RAISE EXCEPTION 'RLS SELECT: %', r.q;
    ELSIF r.cmd = 'INSERT' AND r.w NOT LIKE '%is_writable_role()%' THEN
      RAISE EXCEPTION 'RLS INSERT: %', r.w;
    ELSIF r.cmd = 'UPDATE' AND (r.q NOT LIKE '%is_writable_role()%' OR r.w NOT LIKE '%is_writable_role()%') THEN
      RAISE EXCEPTION 'RLS UPDATE: % / %', r.q, r.w;
    ELSIF r.cmd = 'DELETE' AND r.q NOT LIKE '%is_admin()%' THEN
      RAISE EXCEPTION 'RLS DELETE: %', r.q;
    ELSIF r.cmd = 'ALL' THEN
      RAISE EXCEPTION 'RLS: политика FOR ALL не ожидалась';
    END IF;
  END LOOP;
  IF v_n <> 4 THEN RAISE EXCEPTION 'RLS: ждали 4 политики, есть %', v_n; END IF;
  RAISE NOTICE 'OK: RLS оплат закупки';
END $$;

ROLLBACK;

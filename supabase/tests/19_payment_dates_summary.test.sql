-- Test: вью deal_payment_dates_summary (миграция 00159)
--
-- Клиент 2026-09-14: даты оплат должны быть видны в паспорте по обеим
-- сторонам. Сводка обязана отбирать ровно те же строки, что и сумма в
-- соседней колонке (refresh_deal_payment_totals, 00145) — иначе дата
-- будет говорить об одной оплате, а сумма о другой.
--
-- Проверяем: обе стороны видны; взаимозачёт в даты не попадает; чужая
-- валюта отсекается так же, как в сумме; минусовая оплата (бывший
-- возврат, 00147) считается оплатой и дату даёт; порядок дат в массиве
-- по возрастанию; сделка без оплат строк не даёт.

BEGIN;

INSERT INTO counterparties (id, type, full_name)
VALUES
  ('00000000-0000-0000-0000-000000001901', 'supplier', 'T19-Supplier'),
  ('00000000-0000-0000-0000-000000001902', 'buyer',    'T19-Buyer');

DO $$
DECLARE
  v_deal    UUID := gen_random_uuid();
  v_empty   UUID := gen_random_uuid();
  v_cnt     INT;
  v_last    DATE;
  v_first   DATE;
  v_dates   DATE[];
  v_gross   NUMERIC;
BEGIN
  INSERT INTO deals (
    id, deal_type, deal_number, year, month,
    supplier_id, supplier_currency,
    buyer_id, buyer_currency
  ) VALUES (
    v_deal, 'KG', 9901, 2099, 'январь',
    '00000000-0000-0000-0000-000000001901', 'USD',
    '00000000-0000-0000-0000-000000001902', 'KZT'
  );

  INSERT INTO deals (
    id, deal_type, deal_number, year, month,
    supplier_id, supplier_currency, buyer_id, buyer_currency
  ) VALUES (
    v_empty, 'KG', 9902, 2099, 'январь',
    '00000000-0000-0000-0000-000000001901', 'USD',
    '00000000-0000-0000-0000-000000001902', 'KZT'
  );

  INSERT INTO deal_payments (deal_id, side, amount, payment_date, payment_type, currency) VALUES
    -- Поставщик: две оплаты в валюте стороны + одна минусовая (бывший
    -- возврат, 00147) — все три считаются оплатами.
    (v_deal, 'supplier', 100, '2099-03-11', 'payment', 'USD'),
    (v_deal, 'supplier', 200, '2099-03-09', 'payment', NULL),
    (v_deal, 'supplier', -50, '2099-03-20', 'payment', 'USD'),
    -- Взаимозачёт: в «Оплату» не входит, значит и в даты не должен.
    (v_deal, 'supplier', -20, '2099-03-25', 'offset',  'USD'),
    -- Чужая валюта: сумма её не берёт (00145), даты тоже не должны.
    (v_deal, 'supplier', 999, '2099-03-28', 'payment', 'KZT'),
    -- Покупатель: одна оплата.
    (v_deal, 'buyer',    500, '2099-04-02', 'payment', 'KZT');

  -- ── Поставщик: 3 оплаты, взаимозачёт и чужая валюта отсечены ──────
  SELECT payment_count, first_date, last_date, dates
    INTO v_cnt, v_first, v_last, v_dates
    FROM deal_payment_dates_summary
   WHERE deal_id = v_deal AND side = 'supplier';

  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'поставщик: ожидали 3 оплаты, получили %', v_cnt;
  END IF;
  IF v_first <> DATE '2099-03-09' THEN
    RAISE EXCEPTION 'поставщик: первая дата ожидалась 09.03.2099, получили %', v_first;
  END IF;
  IF v_last <> DATE '2099-03-20' THEN
    RAISE EXCEPTION 'поставщик: последняя дата ожидалась 20.03.2099, получили %', v_last;
  END IF;
  IF v_dates <> ARRAY[DATE '2099-03-09', DATE '2099-03-11', DATE '2099-03-20'] THEN
    RAISE EXCEPTION 'поставщик: даты должны идти по возрастанию, получили %', v_dates;
  END IF;

  -- Тот же отбор, что и у суммы: 100 + 200 − 50 = 250, без взаимозачёта
  -- и без KZT-строки.
  SELECT supplier_payment_gross INTO v_gross FROM deals WHERE id = v_deal;
  IF v_gross <> 250 THEN
    RAISE EXCEPTION 'сумма и даты разошлись: supplier_payment_gross = %, ожидали 250', v_gross;
  END IF;

  -- ── Покупатель: своя строка, своя валюта ─────────────────────────
  SELECT payment_count, last_date INTO v_cnt, v_last
    FROM deal_payment_dates_summary
   WHERE deal_id = v_deal AND side = 'buyer';

  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'покупатель: ожидали 1 оплату, получили %', v_cnt;
  END IF;
  IF v_last <> DATE '2099-04-02' THEN
    RAISE EXCEPTION 'покупатель: дата ожидалась 02.04.2099, получили %', v_last;
  END IF;

  -- ── Сделка без оплат: строк нет вовсе, а не нули ─────────────────
  SELECT COUNT(*) INTO v_cnt FROM deal_payment_dates_summary WHERE deal_id = v_empty;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'сделка без оплат должна давать 0 строк, получили %', v_cnt;
  END IF;

  RAISE NOTICE '19_payment_dates_summary: OK';
END $$;

ROLLBACK;

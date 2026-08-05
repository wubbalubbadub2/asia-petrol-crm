-- Test: refresh_deal_payment_totals (миграция 00137)
-- «Оплата» = брутто (payment_type='payment'), «Возврат/Перезачет» =
-- refund+offset ПОЛОЖИТЕЛЬНЫМ числом, нетто = брутто − возвраты.
-- Баланс читает нетто и численно не меняется относительно 00062.

BEGIN;

INSERT INTO counterparties (id, type, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000701', 'supplier', 'T7-Supplier'),
  ('00000000-0000-0000-0000-000000000702', 'buyer',    'T7-Buyer');

-- ── Случай 1: норма — 2 оплаты + возврат + перезачёт ──────────────
DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  INSERT INTO deals (
    id, deal_type, deal_number, year, month,
    supplier_id, supplier_shipped_amount, supplier_currency,
    buyer_id, buyer_shipped_amount, buyer_currency
  ) VALUES (
    v_deal_id, 'KG', 9701, 2099, 'январь',
    '00000000-0000-0000-0000-000000000701', 1000, 'USD',
    '00000000-0000-0000-0000-000000000702', 2000, 'USD'
  );

  INSERT INTO deal_payments (deal_id, side, amount, payment_date, payment_type) VALUES
    (v_deal_id, 'supplier', 100, '2099-01-10', 'payment'),
    (v_deal_id, 'supplier', 200, '2099-01-11', 'payment'),
    (v_deal_id, 'supplier',  30, '2099-01-12', 'refund'),
    (v_deal_id, 'supplier',  20, '2099-01-13', 'offset');

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;

  IF v_row.supplier_payment_gross <> 300 THEN
    RAISE EXCEPTION 'supplier_payment_gross expected 300, got %', v_row.supplier_payment_gross;
  END IF;
  IF v_row.supplier_refund_total <> 50 THEN
    RAISE EXCEPTION 'supplier_refund_total expected 50 (положительное), got %', v_row.supplier_refund_total;
  END IF;
  IF v_row.supplier_payment <> 250 THEN
    RAISE EXCEPTION 'supplier_payment (нетто) expected 250, got %', v_row.supplier_payment;
  END IF;
  -- Баланс = приход − нетто. Ровно то же число, что давал 00062.
  IF v_row.supplier_balance <> 1000 - 250 THEN
    RAISE EXCEPTION 'supplier_balance expected 750, got %', v_row.supplier_balance;
  END IF;

  -- ── Случай 3: реверс — удаляем возврат 30 ──────────────────────
  DELETE FROM deal_payments
   WHERE deal_id = v_deal_id AND payment_type = 'refund';
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.supplier_payment_gross <> 300 OR v_row.supplier_refund_total <> 20
     OR v_row.supplier_payment <> 280 THEN
    RAISE EXCEPTION 'после удаления возврата ожидалось 300/20/280, got %/%/%',
      v_row.supplier_payment_gross, v_row.supplier_refund_total, v_row.supplier_payment;
  END IF;

  -- ── Случай 4: смена типа payment → refund у строки на 200 ──────
  UPDATE deal_payments SET payment_type = 'refund'
   WHERE deal_id = v_deal_id AND amount = 200;
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.supplier_payment_gross <> 100 OR v_row.supplier_refund_total <> 220
     OR v_row.supplier_payment <> -120 THEN
    RAISE EXCEPTION 'после смены типа ожидалось 100/220/-120, got %/%/%',
      v_row.supplier_payment_gross, v_row.supplier_refund_total, v_row.supplier_payment;
  END IF;
END $$;

-- ── Случай 2: граница — только возврат, оплат нет ─────────────────
DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  INSERT INTO deals (
    id, deal_type, deal_number, year, month,
    supplier_id, supplier_shipped_amount, supplier_currency
  ) VALUES (
    v_deal_id, 'KG', 9702, 2099, 'январь',
    '00000000-0000-0000-0000-000000000701', 1000, 'USD'
  );

  INSERT INTO deal_payments (deal_id, side, amount, payment_date, payment_type)
  VALUES (v_deal_id, 'supplier', 40, '2099-01-10', 'refund');

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.supplier_payment_gross <> 0 THEN
    RAISE EXCEPTION 'только возврат: gross expected 0, got %', v_row.supplier_payment_gross;
  END IF;
  IF v_row.supplier_refund_total <> 40 THEN
    RAISE EXCEPTION 'только возврат: refund expected 40, got %', v_row.supplier_refund_total;
  END IF;
  IF v_row.supplier_payment <> -40 THEN
    RAISE EXCEPTION 'только возврат: нетто expected -40, got %', v_row.supplier_payment;
  END IF;
  IF v_row.supplier_balance <> 1000 + 40 THEN
    RAISE EXCEPTION 'только возврат: баланс expected 1040, got %', v_row.supplier_balance;
  END IF;
END $$;

-- ── Случай 5: валюта платежа ≠ валюты стороны — не учитывается ────
DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  INSERT INTO deals (
    id, deal_type, deal_number, year, month,
    supplier_id, supplier_shipped_amount, supplier_currency
  ) VALUES (
    v_deal_id, 'KG', 9703, 2099, 'январь',
    '00000000-0000-0000-0000-000000000701', 1000, 'USD'
  );

  INSERT INTO deal_payments (deal_id, side, amount, payment_date, payment_type, currency) VALUES
    (v_deal_id, 'supplier', 700, '2099-01-10', 'payment', 'KZT'),
    (v_deal_id, 'supplier',  90, '2099-01-11', 'refund',  'KZT');

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.supplier_payment_gross <> 0 OR v_row.supplier_refund_total <> 0
     OR v_row.supplier_payment <> 0 THEN
    RAISE EXCEPTION 'чужая валюта не должна попасть ни в одну колонку, got %/%/%',
      v_row.supplier_payment_gross, v_row.supplier_refund_total, v_row.supplier_payment;
  END IF;
END $$;

-- ── Случай 6: сделка без оплат — все шесть колонок нули ───────────
DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  INSERT INTO deals (
    id, deal_type, deal_number, year, month,
    supplier_id, supplier_currency, buyer_id, buyer_currency
  ) VALUES (
    v_deal_id, 'KG', 9704, 2099, 'январь',
    '00000000-0000-0000-0000-000000000701', 'USD',
    '00000000-0000-0000-0000-000000000702', 'USD'
  );

  -- Строка появилась и сразу удалена: rollup обязан вернуть нули,
  -- а не оставить прошлые значения (ветка IF NOT FOUND).
  INSERT INTO deal_payments (deal_id, side, amount, payment_date, payment_type)
  VALUES (v_deal_id, 'buyer', 500, '2099-01-10', 'payment');
  DELETE FROM deal_payments WHERE deal_id = v_deal_id;

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF COALESCE(v_row.supplier_payment_gross, -1) <> 0
     OR COALESCE(v_row.supplier_refund_total, -1) <> 0
     OR COALESCE(v_row.supplier_payment, -1) <> 0
     OR COALESCE(v_row.buyer_payment_gross, -1) <> 0
     OR COALESCE(v_row.buyer_refund_total, -1) <> 0
     OR COALESCE(v_row.buyer_payment, -1) <> 0 THEN
    RAISE EXCEPTION 'сделка без оплат: ожидались нули, got %/%/% и %/%/%',
      v_row.supplier_payment_gross, v_row.supplier_refund_total, v_row.supplier_payment,
      v_row.buyer_payment_gross, v_row.buyer_refund_total, v_row.buyer_payment;
  END IF;
END $$;

ROLLBACK;

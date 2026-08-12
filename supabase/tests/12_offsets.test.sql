-- Test: взаимозачёты (миграция 00145)
--
-- Правила клиента 2026-08-12:
--   • «Оплата» одна, возврат пишется той же оплатой со знаком минус;
--   • взаимозачёт со своим знаком, в «Оплате» не участвует, в баланс
--     прибавляется к оплате: оплата 100 + взаимозачёт −10 → 90;
--   • двусторонний создаёт зеркало в встречной сделке с противоположным
--     знаком; правка одной стороны меняет другую; удаление уносит обе;
--   • у трёхстороннего зеркала нет.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-0000000007a1', 'supplier', 'T-OFS Поставщик'),
  ('00000000-0000-0000-0000-0000000007a2', 'buyer',    'T-OFS Покупатель');

DO $$
DECLARE
  v_a       UUID := gen_random_uuid();
  v_b       UUID := gen_random_uuid();
  v_pay     UUID;
  v_offset  UUID;
  v_mirror  deal_payments%ROWTYPE;
  v_row     deals%ROWTYPE;
  v_cnt     INT;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id,
                     supplier_contracted_volume, supplier_price)
  VALUES (v_a, 'KZ', 9930, 2099, 'январь',
          '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007a2', 10, 100),
         (v_b, 'KZ', 9931, 2099, 'январь',
          '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007a2', 10, 100);

  -- ── 1. Оплата и взаимозачёт живут в разных колонках ────────────────
  INSERT INTO deal_payments (deal_id, side, payment_type, amount, payment_date)
  VALUES (v_a, 'supplier', 'payment', 100, DATE '2026-01-10')
  RETURNING id INTO v_pay;

  INSERT INTO deal_payments (deal_id, side, payment_type, amount, offset_kind)
  VALUES (v_a, 'supplier', 'offset', -10, 'trilateral')
  RETURNING id INTO v_offset;

  SELECT * INTO v_row FROM deals WHERE id = v_a;
  IF v_row.supplier_payment_gross <> 100 THEN
    RAISE EXCEPTION '«Оплата» должна остаться 100, получили %', v_row.supplier_payment_gross;
  END IF;
  IF v_row.supplier_offset_total <> -10 THEN
    RAISE EXCEPTION 'взаимозачёт должен лежать со своим знаком (−10), получили %', v_row.supplier_offset_total;
  END IF;
  -- Нетто, которое читает баланс: 100 + (−10).
  IF v_row.supplier_payment <> 90 THEN
    RAISE EXCEPTION 'нетто должно быть 90, получили %', v_row.supplier_payment;
  END IF;

  -- ── 2. Возврат — это минусовая оплата ──────────────────────────────
  INSERT INTO deal_payments (deal_id, side, payment_type, amount, payment_date)
  VALUES (v_a, 'supplier', 'payment', -30, DATE '2026-01-20');

  SELECT * INTO v_row FROM deals WHERE id = v_a;
  IF v_row.supplier_payment_gross <> 70 THEN
    RAISE EXCEPTION 'минусовая оплата должна уменьшить «Оплату» до 70, получили %', v_row.supplier_payment_gross;
  END IF;
  IF v_row.supplier_payment <> 60 THEN
    RAISE EXCEPTION 'нетто должно быть 60 (70 − 10), получили %', v_row.supplier_payment;
  END IF;

  -- ── 3. Трёхсторонний зеркала не порождает ──────────────────────────
  SELECT COUNT(*) INTO v_cnt FROM deal_payments WHERE deal_id = v_b;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'трёхсторонний не должен создавать зеркало, во встречной сделке строк: %', v_cnt;
  END IF;

  -- ── 4. Двусторонний создаёт зеркало с противоположным знаком ───────
  UPDATE deal_payments
     SET offset_kind = 'bilateral', counterparty_deal_id = v_b
   WHERE id = v_offset;

  SELECT * INTO v_mirror FROM deal_payments WHERE mirror_of = v_offset;
  IF v_mirror.id IS NULL THEN
    RAISE EXCEPTION 'зеркало не создано';
  END IF;
  IF v_mirror.deal_id <> v_b THEN
    RAISE EXCEPTION 'зеркало должно лежать во встречной сделке';
  END IF;
  IF v_mirror.amount <> 10 THEN
    RAISE EXCEPTION 'у зеркала ожидали +10, получили %', v_mirror.amount;
  END IF;
  IF v_mirror.counterparty_deal_id <> v_a THEN
    RAISE EXCEPTION 'зеркало должно ссылаться обратно на исходную сделку';
  END IF;

  SELECT * INTO v_row FROM deals WHERE id = v_b;
  IF v_row.supplier_offset_total <> 10 THEN
    RAISE EXCEPTION 'итог встречной сделки ожидали +10, получили %', v_row.supplier_offset_total;
  END IF;

  -- ── 5. Правка одной стороны меняет другую ──────────────────────────
  UPDATE deal_payments SET amount = -25 WHERE id = v_offset;

  SELECT * INTO v_mirror FROM deal_payments WHERE mirror_of = v_offset;
  IF v_mirror.amount <> 25 THEN
    RAISE EXCEPTION 'после правки у зеркала ожидали +25, получили %', v_mirror.amount;
  END IF;
  SELECT * INTO v_row FROM deals WHERE id = v_b;
  IF v_row.supplier_offset_total <> 25 THEN
    RAISE EXCEPTION 'итог встречной сделки после правки ожидали +25, получили %', v_row.supplier_offset_total;
  END IF;

  -- ── 6. Зеркало не плодит зеркал ────────────────────────────────────
  SELECT COUNT(*) INTO v_cnt FROM deal_payments WHERE mirror_of IS NOT NULL;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'зеркал должно быть ровно одно, получили %', v_cnt;
  END IF;

  -- ── 7. Снятие встречной сделки убирает зеркало ─────────────────────
  UPDATE deal_payments SET offset_kind = 'trilateral', counterparty_deal_id = NULL WHERE id = v_offset;
  SELECT COUNT(*) INTO v_cnt FROM deal_payments WHERE deal_id = v_b;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'после снятия встречной сделки зеркало должно исчезнуть, осталось строк: %', v_cnt;
  END IF;

  -- ── 8. Удаление оригинала уносит зеркало ───────────────────────────
  UPDATE deal_payments SET offset_kind = 'bilateral', counterparty_deal_id = v_b WHERE id = v_offset;
  SELECT COUNT(*) INTO v_cnt FROM deal_payments WHERE deal_id = v_b;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'зеркало должно вернуться, строк: %', v_cnt;
  END IF;

  DELETE FROM deal_payments WHERE id = v_offset;
  SELECT COUNT(*) INTO v_cnt FROM deal_payments WHERE deal_id = v_b;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'после удаления оригинала зеркало должно уйти, осталось строк: %', v_cnt;
  END IF;

  -- ── 9. Сделка не зачитывается сама с собой ─────────────────────────
  BEGIN
    INSERT INTO deal_payments (deal_id, side, payment_type, amount, offset_kind, counterparty_deal_id)
    VALUES (v_a, 'supplier', 'offset', -5, 'bilateral', v_a);
    RAISE EXCEPTION 'зачёт сделки с самой собой должен быть запрещён';
  EXCEPTION WHEN check_violation THEN
    NULL; -- ожидаемо
  END;
END $$;

ROLLBACK;

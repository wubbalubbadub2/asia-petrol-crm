-- 00147_refunds_become_negative_payments.sql
--
-- Клиент 2026-08-12: «возврат клиенты будут писать в оплату только со
-- знаком минус» и «если до этого был добавлен возврат, то он уходит в
-- оплату». Перезачёты уже стали взаимозачётами в 00145.
--
-- Возврат лежал ПОЛОЖИТЕЛЬНЫМ и вычитался из нетто. Минусовая оплата
-- вычитается сама, поэтому перенос — это смена знака и типа:
--     refund +30  →  payment −30
-- Нетто и баланс не меняются.
--
-- После этой миграции в базе остаются два вида записей: 'payment' и
-- 'offset'. Колонки *_refund_total сохраняем — они обнулятся сами и
-- перестанут показываться, удалять их отдельной задачей.
--
-- Перенос со сверкой, как в 00145: клиент отдельно просил, чтобы при
-- переносе ничего не потерялось.

DO $$
DECLARE
  v_id      UUID;
  v_bad     INT;
  v_touched INT;
BEGIN
  CREATE TEMP TABLE _refund_before ON COMMIT DROP AS
    SELECT d.id, d.supplier_balance, d.buyer_debt, d.supplier_payment, d.buyer_payment
      FROM deals d
     WHERE d.id IN (SELECT DISTINCT deal_id FROM deal_payments WHERE payment_type = 'refund');

  SELECT COUNT(*) INTO v_touched FROM _refund_before;

  UPDATE deal_payments
     SET amount = -amount, payment_type = 'payment'
   WHERE payment_type = 'refund';

  FOR v_id IN SELECT id FROM _refund_before LOOP
    PERFORM refresh_deal_payment_totals(v_id);
  END LOOP;

  SELECT COUNT(*) INTO v_bad
    FROM _refund_before b
    JOIN deals d ON d.id = b.id
   WHERE COALESCE(d.supplier_balance, 0)  IS DISTINCT FROM COALESCE(b.supplier_balance, 0)
      OR COALESCE(d.buyer_debt, 0)        IS DISTINCT FROM COALESCE(b.buyer_debt, 0)
      OR COALESCE(d.supplier_payment, 0)  IS DISTINCT FROM COALESCE(b.supplier_payment, 0)
      OR COALESCE(d.buyer_payment, 0)     IS DISTINCT FROM COALESCE(b.buyer_payment, 0);

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'перенос возвратов сдвинул итоги у % сделок из % — миграция отменена', v_bad, v_touched;
  END IF;

  RAISE NOTICE 'возвраты перенесены в оплаты, итоги сошлись у всех % сделок', v_touched;
END $$;

-- Дата у оплаты обязательна, у взаимозачёта нет. Возвраты дату имели,
-- так что ограничение из 00145 остаётся выполнимым — проверяем явно.
DO $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n FROM deal_payments WHERE payment_type = 'payment' AND payment_date IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'после переноса % оплат осталось без даты', v_n;
  END IF;
END $$;

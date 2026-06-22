-- 00094_activity_log_payment_author.sql
--
-- Capture `user_id` (= auth.uid() of the operator who triggered the
-- write) on every payment-change row that the 00087 trigger emits
-- into deal_activity. The original migration omitted the column, so
-- /deals/{id} активность panel renders «Оплата поставщику: X» without
-- an author — operator screenshot 2026-06-22.
--
-- The function is SECURITY DEFINER (so it can INSERT into deal_activity
-- past RLS), but auth.uid() still returns the CALLING user inside a
-- SECURITY DEFINER body — that's the value we want. Anonymous /
-- service-role writes (e.g. admin scripts) end up with NULL, which is
-- correct: the UI hides ФИО when it's NULL.
--
-- This migration only re-CREATEs the function. The trigger object
-- itself stays — it's already bound to AFTER UPDATE on deals.

CREATE OR REPLACE FUNCTION log_deal_payment_change()
RETURNS TRIGGER AS $$
DECLARE
  v_delta NUMERIC;
  v_user UUID := auth.uid();
BEGIN
  IF OLD.supplier_payment IS DISTINCT FROM NEW.supplier_payment THEN
    v_delta := COALESCE(NEW.supplier_payment, 0) - COALESCE(OLD.supplier_payment, 0);
    IF v_delta <> 0 THEN
      INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
      VALUES (NEW.id, v_user, 'payment',
        'Оплата поставщику: ' || v_delta::TEXT,
        jsonb_build_object(
          'field', 'supplier_payment',
          'old', OLD.supplier_payment,
          'new', NEW.supplier_payment,
          'delta', v_delta,
          'currency', NEW.supplier_currency
        ));
    END IF;
  END IF;
  IF OLD.buyer_payment IS DISTINCT FROM NEW.buyer_payment THEN
    v_delta := COALESCE(NEW.buyer_payment, 0) - COALESCE(OLD.buyer_payment, 0);
    IF v_delta <> 0 THEN
      INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
      VALUES (NEW.id, v_user, 'payment',
        'Оплата покупателя: ' || v_delta::TEXT,
        jsonb_build_object(
          'field', 'buyer_payment',
          'old', OLD.buyer_payment,
          'new', NEW.buyer_payment,
          'delta', v_delta,
          'currency', NEW.buyer_currency
        ));
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

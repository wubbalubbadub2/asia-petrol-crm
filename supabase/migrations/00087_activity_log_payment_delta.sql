-- Fix payment activity log: store delta (not cumulative running total).
--
-- The original 00016 trigger wrote `NEW.supplier_payment::TEXT` into
-- the chat — i.e. the entire rolled-up sum after a payment was added.
-- Operators expect to see "Оплата поставщику: 7 000 000" matching the
-- single payment they just entered, not the cumulative 141 050 000.
--
-- Now we log the DELTA (NEW - OLD) and stash it in metadata along with
-- the section currency so the front-end can pretty-print with thousand
-- separators and currency symbol. Content keeps a plain raw delta for
-- environments where metadata isn't available.

CREATE OR REPLACE FUNCTION log_deal_payment_change()
RETURNS TRIGGER AS $$
DECLARE
  v_delta NUMERIC;
BEGIN
  IF OLD.supplier_payment IS DISTINCT FROM NEW.supplier_payment THEN
    v_delta := COALESCE(NEW.supplier_payment, 0) - COALESCE(OLD.supplier_payment, 0);
    IF v_delta <> 0 THEN
      INSERT INTO deal_activity (deal_id, type, content, metadata)
      VALUES (NEW.id, 'payment',
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
      INSERT INTO deal_activity (deal_id, type, content, metadata)
      VALUES (NEW.id, 'payment',
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

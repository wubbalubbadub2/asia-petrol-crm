-- Roll up deal_payments sums into deals.supplier_payment / deals.buyer_payment
-- This fixes: "Я внес оплаты в сделку, в основной не подвязываются"

CREATE OR REPLACE FUNCTION refresh_deal_payment_totals(p_deal_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE deals SET
    supplier_payment = COALESCE(sub.supplier_total, 0),
    buyer_payment = COALESCE(sub.buyer_total, 0)
  FROM (
    SELECT
      deal_id,
      SUM(CASE WHEN side = 'supplier' THEN amount ELSE 0 END) AS supplier_total,
      SUM(CASE WHEN side = 'buyer' THEN amount ELSE 0 END) AS buyer_total
    FROM deal_payments
    WHERE deal_id = p_deal_id
    GROUP BY deal_id
  ) sub
  WHERE deals.id = sub.deal_id;

  -- Handle case where all payments are deleted
  IF NOT FOUND THEN
    UPDATE deals SET supplier_payment = 0, buyer_payment = 0
    WHERE id = p_deal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_refresh_deal_on_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_deal_payment_totals(OLD.deal_id);
    RETURN OLD;
  ELSE
    PERFORM refresh_deal_payment_totals(NEW.deal_id);
    IF TG_OP = 'UPDATE' AND OLD.deal_id IS DISTINCT FROM NEW.deal_id THEN
      PERFORM refresh_deal_payment_totals(OLD.deal_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_refresh_deal
  AFTER INSERT OR UPDATE OR DELETE ON deal_payments
  FOR EACH ROW EXECUTE FUNCTION trg_refresh_deal_on_payment();

-- Backfill existing payment data
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_payments LOOP
    PERFORM refresh_deal_payment_totals(r.deal_id);
  END LOOP;
END $$;

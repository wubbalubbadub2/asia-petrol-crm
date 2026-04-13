-- Auto-aggregate ESF documents into deal invoice fields
-- Mirrors the pattern from refresh_deal_shipment_totals (migration 00011)

CREATE OR REPLACE FUNCTION refresh_deal_esf_totals(p_deal_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE deals SET
    invoice_volume = sub.total_qty,
    invoice_amount = sub.total_amount
  FROM (
    SELECT
      deal_id,
      COALESCE(SUM(quantity), 0) AS total_qty,
      COALESCE(SUM(total_with_tax), 0) AS total_amount
    FROM esf_documents
    WHERE deal_id = p_deal_id
    GROUP BY deal_id
  ) sub
  WHERE deals.id = sub.deal_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_refresh_deal_on_esf()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.deal_id IS NOT NULL THEN
      PERFORM refresh_deal_esf_totals(OLD.deal_id);
    END IF;
    RETURN OLD;
  ELSE
    IF NEW.deal_id IS NOT NULL THEN
      PERFORM refresh_deal_esf_totals(NEW.deal_id);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.deal_id IS DISTINCT FROM NEW.deal_id AND OLD.deal_id IS NOT NULL THEN
      PERFORM refresh_deal_esf_totals(OLD.deal_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_esf_refresh_deal
  AFTER INSERT OR UPDATE OR DELETE ON esf_documents
  FOR EACH ROW EXECUTE FUNCTION trg_refresh_deal_on_esf();

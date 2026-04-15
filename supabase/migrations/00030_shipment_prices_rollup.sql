-- Roll up deal_shipment_prices amounts into deals.supplier_shipped_amount / buyer_shipped_amount
-- Per user: "Сумма отгрузки = общая сумма из секции триггер"

CREATE OR REPLACE FUNCTION refresh_deal_price_totals(p_deal_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE deals SET
    supplier_shipped_amount = COALESCE(sub.supplier_total, 0),
    buyer_shipped_amount = COALESCE(sub.buyer_total, 0)
  FROM (
    SELECT
      deal_id,
      SUM(CASE WHEN side = 'supplier' THEN amount ELSE 0 END) AS supplier_total,
      SUM(CASE WHEN side = 'buyer' THEN amount ELSE 0 END) AS buyer_total
    FROM deal_shipment_prices
    WHERE deal_id = p_deal_id
    GROUP BY deal_id
  ) sub
  WHERE deals.id = sub.deal_id;

  -- Handle case where all prices deleted
  IF NOT FOUND THEN
    UPDATE deals SET supplier_shipped_amount = 0, buyer_shipped_amount = 0
    WHERE id = p_deal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_refresh_deal_on_prices()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_deal_price_totals(OLD.deal_id);
    RETURN OLD;
  ELSE
    PERFORM refresh_deal_price_totals(NEW.deal_id);
    IF TG_OP = 'UPDATE' AND OLD.deal_id IS DISTINCT FROM NEW.deal_id THEN
      PERFORM refresh_deal_price_totals(OLD.deal_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prices_refresh_deal
  AFTER INSERT OR UPDATE OR DELETE ON deal_shipment_prices
  FOR EACH ROW EXECUTE FUNCTION trg_refresh_deal_on_prices();

-- Backfill
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_shipment_prices LOOP
    PERFORM refresh_deal_price_totals(r.deal_id);
  END LOOP;
END $$;

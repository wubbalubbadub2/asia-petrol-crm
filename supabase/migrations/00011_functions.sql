-- Asia Petrol CRM: Database Functions

-- Auto-generate deal number
CREATE OR REPLACE FUNCTION generate_deal_number(p_type deal_type, p_year INT)
RETURNS INT AS $$
DECLARE
  v_number INT;
BEGIN
  INSERT INTO deal_sequences (deal_type, year, last_number)
  VALUES (p_type, p_year, 1)
  ON CONFLICT (deal_type, year)
  DO UPDATE SET last_number = deal_sequences.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

-- Refresh monthly quotation averages
CREATE OR REPLACE FUNCTION refresh_quotation_averages(p_product_type_id UUID, p_year INT, p_month INT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO quotation_monthly_averages (product_type_id, year, month, avg_price, avg_fob_med, avg_fob_rotterdam, avg_cif_nwe, avg_combined)
  SELECT
    product_type_id, p_year, p_month,
    AVG(price),
    AVG(price_fob_med),
    AVG(price_fob_rotterdam),
    AVG(price_cif_nwe),
    AVG(COALESCE(price_cif_nwe, price) + COALESCE(price_fob_rotterdam, price)) / 2
  FROM quotations
  WHERE product_type_id = p_product_type_id
    AND EXTRACT(YEAR FROM date) = p_year
    AND EXTRACT(MONTH FROM date) = p_month
    AND price IS NOT NULL
  GROUP BY product_type_id
  ON CONFLICT (product_type_id, year, month)
  DO UPDATE SET
    avg_price = EXCLUDED.avg_price,
    avg_fob_med = EXCLUDED.avg_fob_med,
    avg_fob_rotterdam = EXCLUDED.avg_fob_rotterdam,
    avg_cif_nwe = EXCLUDED.avg_cif_nwe,
    avg_combined = EXCLUDED.avg_combined,
    updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- Aggregate shipment data into deal passport
CREATE OR REPLACE FUNCTION refresh_deal_shipment_totals(p_deal_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE deals SET
    buyer_shipped_volume = sub.total_volume,
    buyer_shipped_amount = sub.total_amount,
    supplier_shipped_amount = sub.total_amount
  FROM (
    SELECT
      deal_id,
      COALESCE(SUM(shipment_volume), 0) as total_volume,
      COALESCE(SUM(shipped_tonnage_amount), 0) as total_amount
    FROM shipment_registry
    WHERE deal_id = p_deal_id
    GROUP BY deal_id
  ) sub
  WHERE deals.id = sub.deal_id;
END;
$$ LANGUAGE plpgsql;

-- Auto-refresh deal totals when shipment_registry changes
CREATE OR REPLACE FUNCTION trg_refresh_deal_on_shipment()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.deal_id IS NOT NULL THEN
      PERFORM refresh_deal_shipment_totals(OLD.deal_id);
    END IF;
    RETURN OLD;
  ELSE
    IF NEW.deal_id IS NOT NULL THEN
      PERFORM refresh_deal_shipment_totals(NEW.deal_id);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.deal_id IS DISTINCT FROM NEW.deal_id AND OLD.deal_id IS NOT NULL THEN
      PERFORM refresh_deal_shipment_totals(OLD.deal_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shipment_refresh_deal
  AFTER INSERT OR UPDATE OR DELETE ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION trg_refresh_deal_on_shipment();

-- Compute DT-KT balance
CREATE OR REPLACE FUNCTION compute_dt_kt_balance(
  p_forwarder_id UUID,
  p_company_group_id UUID,
  p_year INT
) RETURNS DECIMAL AS $$
DECLARE
  v_record dt_kt_logistics%ROWTYPE;
  v_shipped_amount DECIMAL;
BEGIN
  SELECT * INTO v_record FROM dt_kt_logistics
  WHERE forwarder_id = p_forwarder_id
    AND company_group_id = p_company_group_id
    AND year = p_year;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(shipped_tonnage_amount), 0)
  INTO v_shipped_amount
  FROM shipment_registry sr
  JOIN deals d ON sr.deal_id = d.id
  JOIN deal_company_groups dcg ON dcg.deal_id = d.id
  WHERE sr.forwarder_id = p_forwarder_id
    AND dcg.company_group_id = p_company_group_id
    AND EXTRACT(YEAR FROM sr.date) = p_year;

  RETURN v_record.opening_balance
    + v_shipped_amount
    - v_record.payment
    - v_record.refund
    + v_record.fines
    + v_record.surcharge_preliminary
    + v_record.ogem;
END;
$$ LANGUAGE plpgsql;

-- Lookup planned tariff by criteria
CREATE OR REPLACE FUNCTION lookup_tariff(
  p_dest_station_id UUID,
  p_dep_station_id UUID,
  p_forwarder_id UUID,
  p_fuel_type_id UUID,
  p_month TEXT,
  p_year INT
) RETURNS DECIMAL AS $$
DECLARE
  v_tariff DECIMAL;
BEGIN
  SELECT planned_tariff INTO v_tariff
  FROM tariffs
  WHERE destination_station_id = p_dest_station_id
    AND departure_station_id = p_dep_station_id
    AND forwarder_id = p_forwarder_id
    AND fuel_type_id = p_fuel_type_id
    AND month = p_month
    AND year = p_year
  LIMIT 1;

  RETURN v_tariff;
END;
$$ LANGUAGE plpgsql;

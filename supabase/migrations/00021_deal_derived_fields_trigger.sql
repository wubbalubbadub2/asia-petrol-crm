-- Auto-compute derived deal fields:
-- supplier_contracted_amount = volume * price
-- supplier_balance = shipped_amount - payment
-- buyer_contracted_amount = volume * price
-- buyer_debt = shipped_amount - payment
-- preliminary_amount = planned_tariff * preliminary_tonnage

CREATE OR REPLACE FUNCTION compute_deal_derived_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Supplier contracted amount
  IF NEW.supplier_contracted_volume IS NOT NULL AND NEW.supplier_price IS NOT NULL THEN
    NEW.supplier_contracted_amount := NEW.supplier_contracted_volume * NEW.supplier_price;
  END IF;

  -- Buyer contracted amount
  IF NEW.buyer_contracted_volume IS NOT NULL AND NEW.buyer_price IS NOT NULL THEN
    NEW.buyer_contracted_amount := NEW.buyer_contracted_volume * NEW.buyer_price;
  END IF;

  -- Supplier balance = shipped - payment
  NEW.supplier_balance := COALESCE(NEW.supplier_shipped_amount, 0) - COALESCE(NEW.supplier_payment, 0);

  -- Buyer debt = shipped - payment
  NEW.buyer_debt := COALESCE(NEW.buyer_shipped_amount, 0) - COALESCE(NEW.buyer_payment, 0);

  -- Preliminary logistics amount
  IF NEW.planned_tariff IS NOT NULL AND NEW.preliminary_tonnage IS NOT NULL THEN
    NEW.preliminary_amount := NEW.planned_tariff * NEW.preliminary_tonnage;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deal_derived_fields
  BEFORE INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION compute_deal_derived_fields();

-- Backfill existing deals
UPDATE deals SET updated_at = now()
WHERE supplier_contracted_volume IS NOT NULL
   OR buyer_contracted_volume IS NOT NULL
   OR supplier_payment IS NOT NULL
   OR buyer_payment IS NOT NULL
   OR planned_tariff IS NOT NULL;

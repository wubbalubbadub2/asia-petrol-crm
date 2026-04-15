-- Auto-compute shipped_tonnage_amount = CEILING(shipment_volume) * railway_tariff
-- on every INSERT/UPDATE of shipment_registry

CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.shipment_volume IS NOT NULL AND NEW.railway_tariff IS NOT NULL THEN
    NEW.shipped_tonnage_amount := CEIL(NEW.shipment_volume) * NEW.railway_tariff;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_registry_compute_amount
  BEFORE INSERT OR UPDATE ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION compute_registry_amount();

-- Backfill existing records
UPDATE shipment_registry
SET shipped_tonnage_amount = CEIL(shipment_volume) * railway_tariff
WHERE shipment_volume IS NOT NULL AND railway_tariff IS NOT NULL;

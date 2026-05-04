-- Allow manual editing of shipment_registry.shipped_tonnage_amount.
--
-- compute_registry_amount (00031) recomputes the amount from
-- CEIL(shipment_volume) * railway_tariff on every INSERT/UPDATE. That's
-- right by default, but the operations team needs to override it for
-- inter-company transfers where the booked amount diverges from the
-- formula (negotiated rate, volume adjustment, reinvoiced surcharge,
-- etc.). Without an override flag, the trigger blasts the user's value
-- the next time any other column on the row is edited.
--
-- New flag: shipped_tonnage_amount_override BOOLEAN.
--   FALSE (default) → trigger keeps amount = CEIL(volume) * tariff.
--   TRUE            → trigger leaves amount alone; the UI controls it.
-- Frontend sets it to TRUE on manual edit, FALSE on clear (so the next
-- volume/tariff change re-fills automatically).

ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS shipped_tonnage_amount_override BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.shipped_tonnage_amount_override THEN
    RETURN NEW;
  END IF;
  IF NEW.shipment_volume IS NOT NULL AND NEW.railway_tariff IS NOT NULL THEN
    NEW.shipped_tonnage_amount := CEIL(NEW.shipment_volume) * NEW.railway_tariff;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

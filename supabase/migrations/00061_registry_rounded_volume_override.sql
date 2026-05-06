-- Allow manual override of the rounded shipment volume («округл»).
--
-- The registry table stores `shipment_volume` (raw tonnage from the SNT).
-- The «округл» column on the UI displays CEIL(shipment_volume) and feeds
-- the amount formula in compute_registry_amount (00031, 00050):
--     shipped_tonnage_amount = CEIL(shipment_volume) * railway_tariff
--
-- Operations occasionally need to override the rounded value itself —
-- e.g. partial shipments, mixed cargo, or a negotiated billed tonnage that
-- diverges from CEIL of the raw volume. Without an override field the
-- only way to do this was to also override the amount, which loses the
-- ⌈volume⌉ × tariff feedback loop.
--
-- New column: rounded_volume_override DECIMAL(14, 4).
--   NULL  → trigger keeps the formula CEIL(shipment_volume).
--   value → trigger uses the override directly.
-- Frontend writes the value on inline edit, NULL on clear.

ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS rounded_volume_override DECIMAL(14, 4);

CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.shipped_tonnage_amount_override THEN
    RETURN NEW;
  END IF;
  IF NEW.railway_tariff IS NOT NULL THEN
    IF NEW.rounded_volume_override IS NOT NULL THEN
      NEW.shipped_tonnage_amount := NEW.rounded_volume_override * NEW.railway_tariff;
    ELSIF NEW.shipment_volume IS NOT NULL THEN
      NEW.shipped_tonnage_amount := CEIL(NEW.shipment_volume) * NEW.railway_tariff;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- No bulk re-fire needed: rounded_volume_override is NULL for all
-- existing rows, so the trigger's output is identical to before this
-- migration. Touching every row would fan out into 4+ secondary
-- triggers per row (autoprice, deal totals, line reassignment) for no
-- functional change — cheaper to skip.

-- KZ tariff basis + per-row rounding toggle.
--
-- Two client-driven changes (2026-06-02):
--
--  1. KZ registry rows must compute tariff against loading_volume
--     (налив), not shipment_volume (отгрузка). For KZ deals the
--     factory bills what was loaded; transit losses are internal
--     and not relevant to the railway invoice. KG flow keeps using
--     shipment_volume — accountants there charge by border tonnage.
--
--  2. Operations want to disable the CEIL on selected rows when the
--     billed tonnage equals the exact tonnage. The existing
--     rounded_volume_override already lets them type a value
--     directly, but a stateful "не округлять" toggle is needed so
--     the row keeps auto-tracking volume changes WITHOUT rounding.
--
-- New column: round_volume BOOLEAN NOT NULL DEFAULT TRUE
--   TRUE  → CEIL(base_volume)  — current behavior
--   FALSE → base_volume as-is
--   rounded_volume_override still trumps both when set.
--
-- The trigger now picks base_volume from registry_type (no DB join
-- needed — registry_type is already per-row).

ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS round_volume BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_base NUMERIC;
BEGIN
  IF NEW.shipped_tonnage_amount_override THEN
    RETURN NEW;
  END IF;

  IF NEW.railway_tariff IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.registry_type = 'KZ' THEN
    v_base := NEW.loading_volume;
  ELSE
    v_base := NEW.shipment_volume;
  END IF;

  IF NEW.rounded_volume_override IS NOT NULL THEN
    NEW.shipped_tonnage_amount := NEW.rounded_volume_override * NEW.railway_tariff;
  ELSIF v_base IS NOT NULL THEN
    IF NEW.round_volume THEN
      NEW.shipped_tonnage_amount := CEIL(v_base) * NEW.railway_tariff;
    ELSE
      NEW.shipped_tonnage_amount := v_base * NEW.railway_tariff;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill KZ rows so existing amounts switch over to loading_volume.
-- A no-op self-update fires the BEFORE trigger; non-KZ rows skipped
-- since their formula is unchanged.
UPDATE shipment_registry
  SET railway_tariff = railway_tariff
WHERE registry_type = 'KZ'
  AND COALESCE(shipped_tonnage_amount_override, FALSE) = FALSE
  AND railway_tariff IS NOT NULL;

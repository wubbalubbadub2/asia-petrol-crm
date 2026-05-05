-- Auto-reassign shipment_registry rows to the buyer/supplier variant whose
-- station matches the row's destination/departure station.
--
-- Why: 00054 backfilled buyer_line_id / supplier_line_id to the deal's
-- default variant for every existing registry row. For multi-variant deals
-- where some shipments go to a non-default station, that's wrong — those
-- rows still report the default variant's price after 00056 re-priced
-- everything by line.
--
-- This migration:
--   1. Adds a BEFORE UPDATE trigger on shipment_registry: when the user
--      changes a row's destination/departure station inline, look up the
--      matching variant and re-pin line_id automatically.
--   2. Adds an AFTER UPDATE trigger: when line_id changes (auto or manual),
--      recompute calculated_price + amount on the linked deal_shipment_prices
--      row using the new line's price. Self-heals (INSERT) if no matching
--      price row exists yet.
--   3. One-shot backfill: for every registry row whose station matches a
--      variant on the same deal, set line_id to that variant. The AFTER
--      UPDATE trigger fires and re-prices. Final refresh_deal_price_totals
--      pass picks up the corrected sums.

-- ─── 1. BEFORE UPDATE trigger: auto-pick line by station ───────────────────

CREATE OR REPLACE FUNCTION reassign_registry_line_on_station_change()
RETURNS TRIGGER AS $$
DECLARE
  v_buyer_line_id UUID;
  v_supplier_line_id UUID;
BEGIN
  -- Buyer side: if the destination station was changed (or deal_id changed)
  -- and a variant exists for the new station, reassign.
  IF (NEW.destination_station_id IS DISTINCT FROM OLD.destination_station_id
      OR NEW.deal_id IS DISTINCT FROM OLD.deal_id)
     AND NEW.destination_station_id IS NOT NULL
     AND NEW.deal_id IS NOT NULL THEN
    SELECT l.id INTO v_buyer_line_id
    FROM deal_buyer_lines l
    WHERE l.deal_id = NEW.deal_id
      AND l.destination_station_id = NEW.destination_station_id
    ORDER BY l.position
    LIMIT 1;
    IF v_buyer_line_id IS NOT NULL THEN
      NEW.buyer_line_id := v_buyer_line_id;
    END IF;
  END IF;

  -- Supplier side: same logic with departure station.
  IF (NEW.departure_station_id IS DISTINCT FROM OLD.departure_station_id
      OR NEW.deal_id IS DISTINCT FROM OLD.deal_id)
     AND NEW.departure_station_id IS NOT NULL
     AND NEW.deal_id IS NOT NULL THEN
    SELECT l.id INTO v_supplier_line_id
    FROM deal_supplier_lines l
    WHERE l.deal_id = NEW.deal_id
      AND l.departure_station_id = NEW.departure_station_id
    ORDER BY l.position
    LIMIT 1;
    IF v_supplier_line_id IS NOT NULL THEN
      NEW.supplier_line_id := v_supplier_line_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reassign_registry_line_on_station
  BEFORE UPDATE ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION reassign_registry_line_on_station_change();

-- ─── 2. AFTER UPDATE trigger: re-price when line_id changes ────────────────

CREATE OR REPLACE FUNCTION reprice_registry_on_line_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_line_id IS DISTINCT FROM OLD.supplier_line_id THEN
    UPDATE deal_shipment_prices p
    SET calculated_price = l.price,
        amount           = COALESCE(p.volume, 0) * COALESCE(l.price, 0),
        discount         = COALESCE(l.discount, p.discount)
    FROM deal_supplier_lines l
    WHERE p.shipment_registry_id = NEW.id
      AND p.side = 'supplier'
      AND l.id = NEW.supplier_line_id;

    -- Self-heal: insert if no row existed but the new line carries a price.
    IF NEW.supplier_line_id IS NOT NULL
       AND NEW.loading_volume IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      )
      SELECT NEW.deal_id, 'supplier', NEW.id,
             NEW.date, NEW.loading_volume, l.price,
             NEW.loading_volume * l.price, COALESCE(l.discount, 0)
      FROM deal_supplier_lines l
      WHERE l.id = NEW.supplier_line_id
        AND l.price IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM deal_shipment_prices p
          WHERE p.shipment_registry_id = NEW.id AND p.side = 'supplier'
        );
    END IF;
  END IF;

  IF NEW.buyer_line_id IS DISTINCT FROM OLD.buyer_line_id THEN
    UPDATE deal_shipment_prices p
    SET calculated_price = l.price,
        amount           = COALESCE(p.volume, 0) * COALESCE(l.price, 0),
        discount         = COALESCE(l.discount, p.discount)
    FROM deal_buyer_lines l
    WHERE p.shipment_registry_id = NEW.id
      AND p.side = 'buyer'
      AND l.id = NEW.buyer_line_id;

    IF NEW.buyer_line_id IS NOT NULL
       AND NEW.shipment_volume IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      )
      SELECT NEW.deal_id, 'buyer', NEW.id,
             NEW.date, NEW.shipment_volume, l.price,
             NEW.shipment_volume * l.price, COALESCE(l.discount, 0)
      FROM deal_buyer_lines l
      WHERE l.id = NEW.buyer_line_id
        AND l.price IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM deal_shipment_prices p
          WHERE p.shipment_registry_id = NEW.id AND p.side = 'buyer'
        );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reprice_registry_on_line_change
  AFTER UPDATE ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION reprice_registry_on_line_change();

-- ─── 3. One-shot backfill: reassign rows by station match ──────────────────

WITH buyer_match AS (
  SELECT
    r.id AS registry_id,
    (SELECT l.id FROM deal_buyer_lines l
     WHERE l.deal_id = r.deal_id
       AND l.destination_station_id = r.destination_station_id
     ORDER BY l.position
     LIMIT 1) AS new_line_id
  FROM shipment_registry r
  WHERE r.deal_id IS NOT NULL
    AND r.destination_station_id IS NOT NULL
)
UPDATE shipment_registry r
SET buyer_line_id = m.new_line_id
FROM buyer_match m
WHERE r.id = m.registry_id
  AND m.new_line_id IS NOT NULL
  AND r.buyer_line_id IS DISTINCT FROM m.new_line_id;

WITH supplier_match AS (
  SELECT
    r.id AS registry_id,
    (SELECT l.id FROM deal_supplier_lines l
     WHERE l.deal_id = r.deal_id
       AND l.departure_station_id = r.departure_station_id
     ORDER BY l.position
     LIMIT 1) AS new_line_id
  FROM shipment_registry r
  WHERE r.deal_id IS NOT NULL
    AND r.departure_station_id IS NOT NULL
)
UPDATE shipment_registry r
SET supplier_line_id = m.new_line_id
FROM supplier_match m
WHERE r.id = m.registry_id
  AND m.new_line_id IS NOT NULL
  AND r.supplier_line_id IS DISTINCT FROM m.new_line_id;

-- ─── 4. Refresh price totals across all touched deals ──────────────────────

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_shipment_prices WHERE deal_id IS NOT NULL LOOP
    PERFORM refresh_deal_price_totals(r.deal_id);
  END LOOP;
END $$;

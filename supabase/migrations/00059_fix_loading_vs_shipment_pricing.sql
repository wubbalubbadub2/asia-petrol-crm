-- Налив и отгрузка — разные события. Каждое получает свою price-row:
--   row with loading_volume (налив)  → side='supplier', volume = loading_volume
--   row with shipment_volume (отгр.) → side='buyer',    volume = shipment_volume
--
-- 00037/00054's autoprice_registry_insert was wrong: it used shipment_volume
-- for BOTH sides and bailed out entirely if shipment_volume was NULL. So for
-- a налив-only row no prices got created at all (until 00046 self-healed),
-- and for an отгрузка-only row a phantom supplier-price was created using
-- shipment_volume — that's what doubled KZ/26/013's supplier_shipped_amount.
--
-- This migration:
--   1. Replaces autoprice_registry_insert with the correct per-side volume.
--   2. Adds a BEFORE INSERT trigger that auto-pins line_id (by station, then
--      default variant) — keeps the new налив-only / отгрузка-only rows
--      pinned without UI changes.
--   3. Cleans up phantom price rows from the old logic.
--   4. Pins remaining line_id NULLs to default variant (per-side, only when
--      the relevant volume is set).
--   5. Self-heals missing prices for newly-pinned rows.
--   6. Refreshes price totals.

-- ─── 1. Corrected autoprice on INSERT ──────────────────────────────────────

CREATE OR REPLACE FUNCTION autoprice_registry_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_supplier_price NUMERIC;
  v_supplier_discount NUMERIC;
  v_buyer_price    NUMERIC;
  v_buyer_discount NUMERIC;
BEGIN
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Supplier side fires only on налив (loading_volume).
  IF NEW.loading_volume IS NOT NULL THEN
    IF NEW.supplier_line_id IS NOT NULL THEN
      SELECT price, COALESCE(discount, 0)
        INTO v_supplier_price, v_supplier_discount
      FROM deal_supplier_lines
      WHERE id = NEW.supplier_line_id;
    ELSE
      SELECT price, COALESCE(discount, 0)
        INTO v_supplier_price, v_supplier_discount
      FROM deal_supplier_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    IF v_supplier_price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      ) VALUES (
        NEW.deal_id, 'supplier', NEW.id,
        NEW.date, NEW.loading_volume, v_supplier_price,
        NEW.loading_volume * v_supplier_price,
        v_supplier_discount
      );
    END IF;
  END IF;

  -- Buyer side fires only on отгрузка (shipment_volume).
  IF NEW.shipment_volume IS NOT NULL THEN
    IF NEW.buyer_line_id IS NOT NULL THEN
      SELECT price, COALESCE(discount, 0)
        INTO v_buyer_price, v_buyer_discount
      FROM deal_buyer_lines
      WHERE id = NEW.buyer_line_id;
    ELSE
      SELECT price, COALESCE(discount, 0)
        INTO v_buyer_price, v_buyer_discount
      FROM deal_buyer_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    IF v_buyer_price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      ) VALUES (
        NEW.deal_id, 'buyer', NEW.id,
        NEW.date, NEW.shipment_volume, v_buyer_price,
        NEW.shipment_volume * v_buyer_price,
        v_buyer_discount
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 2. BEFORE INSERT: auto-pin line_id by station or default variant ──────
-- Inline-add row in the registry-page groups view and the BulkAddDialog
-- don't have a line picker. Without this trigger, those rows land with
-- NULL line_ids and the per-variant rollup misses them. The trigger pins
-- only the side whose volume is set so налив-only rows don't grow a
-- buyer line and vice versa.

CREATE OR REPLACE FUNCTION pin_registry_line_on_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_supplier_line_id UUID;
  v_buyer_line_id UUID;
BEGIN
  IF NEW.deal_id IS NULL THEN RETURN NEW; END IF;

  -- Supplier налив
  IF NEW.loading_volume IS NOT NULL AND NEW.supplier_line_id IS NULL THEN
    IF NEW.departure_station_id IS NOT NULL THEN
      SELECT l.id INTO v_supplier_line_id
      FROM deal_supplier_lines l
      WHERE l.deal_id = NEW.deal_id
        AND l.departure_station_id = NEW.departure_station_id
      ORDER BY l.position
      LIMIT 1;
    END IF;
    IF v_supplier_line_id IS NULL THEN
      SELECT l.id INTO v_supplier_line_id
      FROM deal_supplier_lines l
      WHERE l.deal_id = NEW.deal_id AND l.is_default = TRUE
      LIMIT 1;
    END IF;
    NEW.supplier_line_id := v_supplier_line_id;
  END IF;

  -- Buyer отгрузка
  IF NEW.shipment_volume IS NOT NULL AND NEW.buyer_line_id IS NULL THEN
    IF NEW.destination_station_id IS NOT NULL THEN
      SELECT l.id INTO v_buyer_line_id
      FROM deal_buyer_lines l
      WHERE l.deal_id = NEW.deal_id
        AND l.destination_station_id = NEW.destination_station_id
      ORDER BY l.position
      LIMIT 1;
    END IF;
    IF v_buyer_line_id IS NULL THEN
      SELECT l.id INTO v_buyer_line_id
      FROM deal_buyer_lines l
      WHERE l.deal_id = NEW.deal_id AND l.is_default = TRUE
      LIMIT 1;
    END IF;
    NEW.buyer_line_id := v_buyer_line_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pin_registry_line_on_insert
  BEFORE INSERT ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION pin_registry_line_on_insert();

-- ─── 3. Cleanup wrong-side price rows from the old autoprice ───────────────

-- Phantom supplier prices on rows with no налив (created by 00037/00054
-- using shipment_volume on отгрузка-only rows).
DELETE FROM deal_shipment_prices p
USING shipment_registry r
WHERE p.shipment_registry_id = r.id
  AND p.side = 'supplier'
  AND r.loading_volume IS NULL;

-- Phantom buyer prices on rows with no отгрузка (would be the symmetric
-- case if 00037 had done the inverse mistake; keep this as a safety net).
DELETE FROM deal_shipment_prices p
USING shipment_registry r
WHERE p.shipment_registry_id = r.id
  AND p.side = 'buyer'
  AND r.shipment_volume IS NULL;

-- ─── 4. Drop irrelevant line_ids on registry rows ──────────────────────────
-- A налив-only row shouldn't have buyer_line_id (no buyer-side data); same
-- for отгрузка-only rows on the supplier side. Cleans up leftovers from the
-- 00054 backfill that pinned both sides indiscriminately.

UPDATE shipment_registry SET supplier_line_id = NULL
WHERE loading_volume  IS NULL AND supplier_line_id IS NOT NULL;

UPDATE shipment_registry SET buyer_line_id = NULL
WHERE shipment_volume IS NULL AND buyer_line_id IS NOT NULL;

-- ─── 5. Pin missing line_ids to station match → default variant fallback ───

UPDATE shipment_registry r
SET supplier_line_id = (
  SELECT l.id FROM deal_supplier_lines l
  WHERE l.deal_id = r.deal_id
    AND (l.departure_station_id = r.departure_station_id OR l.is_default = TRUE)
  ORDER BY (l.departure_station_id = r.departure_station_id) DESC NULLS LAST,
           l.is_default DESC,
           l.position
  LIMIT 1
)
WHERE r.deal_id IS NOT NULL
  AND r.loading_volume IS NOT NULL
  AND r.supplier_line_id IS NULL;

UPDATE shipment_registry r
SET buyer_line_id = (
  SELECT l.id FROM deal_buyer_lines l
  WHERE l.deal_id = r.deal_id
    AND (l.destination_station_id = r.destination_station_id OR l.is_default = TRUE)
  ORDER BY (l.destination_station_id = r.destination_station_id) DESC NULLS LAST,
           l.is_default DESC,
           l.position
  LIMIT 1
)
WHERE r.deal_id IS NOT NULL
  AND r.shipment_volume IS NOT NULL
  AND r.buyer_line_id IS NULL;

-- ─── 6. Self-heal: insert missing prices for line-pinned rows ──────────────

INSERT INTO deal_shipment_prices (
  deal_id, side, shipment_registry_id,
  shipment_date, volume, calculated_price, amount, discount
)
SELECT r.deal_id, 'supplier', r.id, r.date,
       r.loading_volume, l.price,
       r.loading_volume * l.price, COALESCE(l.discount, 0)
FROM shipment_registry r
JOIN deal_supplier_lines l ON l.id = r.supplier_line_id
WHERE r.deal_id IS NOT NULL
  AND r.loading_volume IS NOT NULL
  AND l.price IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deal_shipment_prices p
    WHERE p.shipment_registry_id = r.id AND p.side = 'supplier'
  );

INSERT INTO deal_shipment_prices (
  deal_id, side, shipment_registry_id,
  shipment_date, volume, calculated_price, amount, discount
)
SELECT r.deal_id, 'buyer', r.id, r.date,
       r.shipment_volume, l.price,
       r.shipment_volume * l.price, COALESCE(l.discount, 0)
FROM shipment_registry r
JOIN deal_buyer_lines l ON l.id = r.buyer_line_id
WHERE r.deal_id IS NOT NULL
  AND r.shipment_volume IS NOT NULL
  AND l.price IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deal_shipment_prices p
    WHERE p.shipment_registry_id = r.id AND p.side = 'buyer'
  );

-- ─── 7. Force volume on existing prices to match per-side semantics ────────
-- Old rows might still carry shipment_volume on the supplier side from the
-- 00037 mistake. Reset volume + recompute amount.

UPDATE deal_shipment_prices p
SET volume = r.loading_volume,
    amount = r.loading_volume * COALESCE(p.calculated_price, 0)
FROM shipment_registry r
WHERE p.shipment_registry_id = r.id
  AND p.side = 'supplier'
  AND r.loading_volume IS NOT NULL
  AND p.volume IS DISTINCT FROM r.loading_volume;

UPDATE deal_shipment_prices p
SET volume = r.shipment_volume,
    amount = r.shipment_volume * COALESCE(p.calculated_price, 0)
FROM shipment_registry r
WHERE p.shipment_registry_id = r.id
  AND p.side = 'buyer'
  AND r.shipment_volume IS NOT NULL
  AND p.volume IS DISTINCT FROM r.shipment_volume;

-- ─── 8. Refresh price totals ───────────────────────────────────────────────

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_shipment_prices WHERE deal_id IS NOT NULL LOOP
    PERFORM refresh_deal_price_totals(r.deal_id);
  END LOOP;
END $$;

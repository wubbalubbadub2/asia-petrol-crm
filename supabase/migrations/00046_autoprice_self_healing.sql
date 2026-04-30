-- supplier_shipped_amount and buyer_shipped_amount roll up
-- deal_shipment_prices.amount per side (00030). The autoprice trigger
-- (00037, refined in 00045) only INSERTS a pricing row for a side when
-- the registry row had the relevant volume AND the deal already carried
-- the corresponding price at insert time. Many existing registry rows
-- were committed before supplier_price (or before loading_volume) was
-- set, so no pricing row was ever created. autoprice_registry_update
-- and propagate_deal_price_to_autorows only ever UPDATE existing rows,
-- so neither flow ever recovers from that initial gap.
--
-- This migration:
-- 1. Backfills missing supplier- and buyer-side pricing rows for every
--    registry row that now satisfies the prerequisites.
-- 2. Makes autoprice_registry_update self-healing: if the UPDATE finds
--    no row (because none existed) and the prerequisites are met, INSERT
--    the missing row.
-- 3. Makes propagate_deal_price_to_autorows self-healing: when a deal
--    price goes from NULL → value (or any change), insert pricing rows
--    for previously-orphaned registry rows on that side.
-- 4. Re-runs refresh_deal_price_totals across all touched deals so the
--    rollups land immediately.

-- ─── 1. Backfill missing supplier-side rows ───────────────────────────────
INSERT INTO deal_shipment_prices (
  deal_id, side, shipment_registry_id,
  shipment_date, volume, calculated_price, amount, discount
)
SELECT
  sr.deal_id, 'supplier', sr.id,
  sr.date,
  sr.loading_volume,
  d.supplier_price,
  sr.loading_volume * d.supplier_price,
  COALESCE(d.supplier_discount, 0)
FROM shipment_registry sr
JOIN deals d ON d.id = sr.deal_id
WHERE sr.deal_id IS NOT NULL
  AND sr.loading_volume IS NOT NULL
  AND d.supplier_price IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deal_shipment_prices p
    WHERE p.shipment_registry_id = sr.id AND p.side = 'supplier'
  );

-- ─── 2. Backfill missing buyer-side rows ──────────────────────────────────
INSERT INTO deal_shipment_prices (
  deal_id, side, shipment_registry_id,
  shipment_date, volume, calculated_price, amount, discount
)
SELECT
  sr.deal_id, 'buyer', sr.id,
  sr.date,
  sr.shipment_volume,
  d.buyer_price,
  sr.shipment_volume * d.buyer_price,
  COALESCE(d.buyer_discount, 0)
FROM shipment_registry sr
JOIN deals d ON d.id = sr.deal_id
WHERE sr.deal_id IS NOT NULL
  AND sr.shipment_volume IS NOT NULL
  AND d.buyer_price IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deal_shipment_prices p
    WHERE p.shipment_registry_id = sr.id AND p.side = 'buyer'
  );

-- ─── 3. Self-healing autoprice_registry_update ────────────────────────────
CREATE OR REPLACE FUNCTION autoprice_registry_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Supplier-side: tracks loading_volume.
  IF NEW.loading_volume IS DISTINCT FROM OLD.loading_volume THEN
    UPDATE deal_shipment_prices
    SET volume = NEW.loading_volume,
        amount = NEW.loading_volume * COALESCE(calculated_price, 0)
    WHERE shipment_registry_id = NEW.id AND side = 'supplier';

    -- No supplier-side row existed (registry row predates supplier_price).
    -- Create one now if we have everything we need.
    IF NOT FOUND
       AND NEW.loading_volume IS NOT NULL
       AND NEW.deal_id IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      )
      SELECT
        NEW.deal_id, 'supplier', NEW.id,
        NEW.date, NEW.loading_volume, d.supplier_price,
        NEW.loading_volume * d.supplier_price,
        COALESCE(d.supplier_discount, 0)
      FROM deals d
      WHERE d.id = NEW.deal_id AND d.supplier_price IS NOT NULL;
    END IF;
  END IF;

  -- Buyer-side: tracks shipment_volume.
  IF NEW.shipment_volume IS DISTINCT FROM OLD.shipment_volume THEN
    UPDATE deal_shipment_prices
    SET volume = NEW.shipment_volume,
        amount = NEW.shipment_volume * COALESCE(calculated_price, 0)
    WHERE shipment_registry_id = NEW.id AND side = 'buyer';

    IF NOT FOUND
       AND NEW.shipment_volume IS NOT NULL
       AND NEW.deal_id IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      )
      SELECT
        NEW.deal_id, 'buyer', NEW.id,
        NEW.date, NEW.shipment_volume, d.buyer_price,
        NEW.shipment_volume * d.buyer_price,
        COALESCE(d.buyer_discount, 0)
      FROM deals d
      WHERE d.id = NEW.deal_id AND d.buyer_price IS NOT NULL;
    END IF;
  END IF;

  IF NEW.date IS DISTINCT FROM OLD.date THEN
    UPDATE deal_shipment_prices
    SET shipment_date = NEW.date
    WHERE shipment_registry_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 4. Self-healing propagate_deal_price_to_autorows ─────────────────────
CREATE OR REPLACE FUNCTION propagate_deal_price_to_autorows()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_price IS DISTINCT FROM OLD.supplier_price THEN
    UPDATE deal_shipment_prices
    SET calculated_price = NEW.supplier_price,
        amount           = volume * NEW.supplier_price
    WHERE deal_id = NEW.id
      AND side = 'supplier'
      AND shipment_registry_id IS NOT NULL;

    -- Insert supplier-side rows for any linked registry rows that don't
    -- already have one (price is being set for the first time, etc.).
    IF NEW.supplier_price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      )
      SELECT
        NEW.id, 'supplier', sr.id,
        sr.date, sr.loading_volume, NEW.supplier_price,
        sr.loading_volume * NEW.supplier_price,
        COALESCE(NEW.supplier_discount, 0)
      FROM shipment_registry sr
      WHERE sr.deal_id = NEW.id
        AND sr.loading_volume IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM deal_shipment_prices p
          WHERE p.shipment_registry_id = sr.id AND p.side = 'supplier'
        );
    END IF;
  END IF;

  IF NEW.buyer_price IS DISTINCT FROM OLD.buyer_price THEN
    UPDATE deal_shipment_prices
    SET calculated_price = NEW.buyer_price,
        amount           = volume * NEW.buyer_price
    WHERE deal_id = NEW.id
      AND side = 'buyer'
      AND shipment_registry_id IS NOT NULL;

    IF NEW.buyer_price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      )
      SELECT
        NEW.id, 'buyer', sr.id,
        sr.date, sr.shipment_volume, NEW.buyer_price,
        sr.shipment_volume * NEW.buyer_price,
        COALESCE(NEW.buyer_discount, 0)
      FROM shipment_registry sr
      WHERE sr.deal_id = NEW.id
        AND sr.shipment_volume IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM deal_shipment_prices p
          WHERE p.shipment_registry_id = sr.id AND p.side = 'buyer'
        );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 5. Refresh rollups across all touched deals ──────────────────────────
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_shipment_prices WHERE deal_id IS NOT NULL LOOP
    PERFORM refresh_deal_price_totals(r.deal_id);
  END LOOP;
END $$;

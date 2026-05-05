-- Multi-line aware pricing flow.
--
-- Migration 00046 self-heals deal_shipment_prices when deals.supplier_price
-- or deals.buyer_price changes. Now that registry rows can pin to a
-- specific variant line (00054), that legacy flow has two gaps:
--
--   1. propagate_deal_price_to_autorows clobbers prices on rows pinned
--      to a NON-default line. If line 2 charges 81940 and the deal scalar
--      is 80477 (mirrored from default line), the legacy flow rewrites
--      every linked price to 80477.
--   2. When a non-default line's price changes, nothing fires — prices on
--      registry rows pinned to that line stay stale.
--
-- This migration:
--   • Adds propagate_supplier_line_price_to_autorows / buyer counterpart.
--     They mirror the legacy self-heal but key off `r.{side}_line_id`.
--   • Restricts propagate_deal_price_to_autorows to rows where the
--     registry row has NO line_id (legacy bucket only).
--   • Backfills: for every registry row that's now pinned to a line,
--     recompute the matching deal_shipment_prices row(s) using line price.
--     If the price row is missing (e.g. created before any auto-price
--     trigger ran), insert it now.
--
-- After this lands, refresh_deal_price_totals re-runs across every deal
-- so deals.{supplier|buyer}_shipped_amount reflect the corrected sums
-- immediately.

-- ─── 1. Restrict the deal-level propagate to legacy (line_id IS NULL) rows ───

CREATE OR REPLACE FUNCTION propagate_deal_price_to_autorows()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_price IS DISTINCT FROM OLD.supplier_price THEN
    UPDATE deal_shipment_prices p
    SET calculated_price = NEW.supplier_price,
        amount           = COALESCE(p.volume, 0) * COALESCE(NEW.supplier_price, 0)
    FROM shipment_registry r
    WHERE p.shipment_registry_id = r.id
      AND p.deal_id = NEW.id
      AND p.side    = 'supplier'
      AND r.supplier_line_id IS NULL;

    IF NEW.supplier_price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      )
      SELECT NEW.id, 'supplier', sr.id, sr.date, sr.loading_volume,
             NEW.supplier_price,
             sr.loading_volume * NEW.supplier_price,
             COALESCE(NEW.supplier_discount, 0)
      FROM shipment_registry sr
      WHERE sr.deal_id = NEW.id
        AND sr.loading_volume IS NOT NULL
        AND sr.supplier_line_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM deal_shipment_prices p
          WHERE p.shipment_registry_id = sr.id AND p.side = 'supplier'
        );
    END IF;
  END IF;

  IF NEW.buyer_price IS DISTINCT FROM OLD.buyer_price THEN
    UPDATE deal_shipment_prices p
    SET calculated_price = NEW.buyer_price,
        amount           = COALESCE(p.volume, 0) * COALESCE(NEW.buyer_price, 0)
    FROM shipment_registry r
    WHERE p.shipment_registry_id = r.id
      AND p.deal_id = NEW.id
      AND p.side    = 'buyer'
      AND r.buyer_line_id IS NULL;

    IF NEW.buyer_price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      )
      SELECT NEW.id, 'buyer', sr.id, sr.date, sr.shipment_volume,
             NEW.buyer_price,
             sr.shipment_volume * NEW.buyer_price,
             COALESCE(NEW.buyer_discount, 0)
      FROM shipment_registry sr
      WHERE sr.deal_id = NEW.id
        AND sr.shipment_volume IS NOT NULL
        AND sr.buyer_line_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM deal_shipment_prices p
          WHERE p.shipment_registry_id = sr.id AND p.side = 'buyer'
        );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 2. New triggers: propagate price changes from each line ────────────────

CREATE OR REPLACE FUNCTION propagate_supplier_line_price_to_autorows()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.price    IS DISTINCT FROM OLD.price
     OR NEW.discount IS DISTINCT FROM OLD.discount THEN

    UPDATE deal_shipment_prices p
    SET calculated_price = NEW.price,
        amount           = COALESCE(p.volume, 0) * COALESCE(NEW.price, 0),
        discount         = COALESCE(NEW.discount, p.discount)
    FROM shipment_registry r
    WHERE p.shipment_registry_id = r.id
      AND r.supplier_line_id = NEW.id
      AND p.side = 'supplier';

    IF NEW.price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      )
      SELECT r.deal_id, 'supplier', r.id, r.date,
             r.loading_volume, NEW.price,
             r.loading_volume * NEW.price, COALESCE(NEW.discount, 0)
      FROM shipment_registry r
      WHERE r.supplier_line_id = NEW.id
        AND r.loading_volume IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM deal_shipment_prices p
          WHERE p.shipment_registry_id = r.id AND p.side = 'supplier'
        );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION propagate_buyer_line_price_to_autorows()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.price    IS DISTINCT FROM OLD.price
     OR NEW.discount IS DISTINCT FROM OLD.discount THEN

    UPDATE deal_shipment_prices p
    SET calculated_price = NEW.price,
        amount           = COALESCE(p.volume, 0) * COALESCE(NEW.price, 0),
        discount         = COALESCE(NEW.discount, p.discount)
    FROM shipment_registry r
    WHERE p.shipment_registry_id = r.id
      AND r.buyer_line_id = NEW.id
      AND p.side = 'buyer';

    IF NEW.price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, calculated_price, amount, discount
      )
      SELECT r.deal_id, 'buyer', r.id, r.date,
             r.shipment_volume, NEW.price,
             r.shipment_volume * NEW.price, COALESCE(NEW.discount, 0)
      FROM shipment_registry r
      WHERE r.buyer_line_id = NEW.id
        AND r.shipment_volume IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM deal_shipment_prices p
          WHERE p.shipment_registry_id = r.id AND p.side = 'buyer'
        );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_propagate_supplier_line_price
  AFTER UPDATE ON deal_supplier_lines
  FOR EACH ROW EXECUTE FUNCTION propagate_supplier_line_price_to_autorows();

CREATE TRIGGER trg_propagate_buyer_line_price
  AFTER UPDATE ON deal_buyer_lines
  FOR EACH ROW EXECUTE FUNCTION propagate_buyer_line_price_to_autorows();

-- ─── 3. One-time backfill: re-price line-pinned rows + insert missing ───────

UPDATE deal_shipment_prices p
SET calculated_price = l.price,
    amount           = COALESCE(p.volume, 0) * COALESCE(l.price, 0),
    discount         = COALESCE(l.discount, p.discount)
FROM shipment_registry r, deal_supplier_lines l
WHERE p.shipment_registry_id = r.id
  AND p.side = 'supplier'
  AND r.supplier_line_id = l.id
  AND l.price IS NOT NULL;

UPDATE deal_shipment_prices p
SET calculated_price = l.price,
    amount           = COALESCE(p.volume, 0) * COALESCE(l.price, 0),
    discount         = COALESCE(l.discount, p.discount)
FROM shipment_registry r, deal_buyer_lines l
WHERE p.shipment_registry_id = r.id
  AND p.side = 'buyer'
  AND r.buyer_line_id = l.id
  AND l.price IS NOT NULL;

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

-- ─── 4. Refresh rollups across every touched deal ───────────────────────────

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_shipment_prices WHERE deal_id IS NOT NULL LOOP
    PERFORM refresh_deal_price_totals(r.deal_id);
  END LOOP;
END $$;

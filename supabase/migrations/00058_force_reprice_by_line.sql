-- Defensive re-fix: brute-force update every linked deal_shipment_prices
-- row using its variant's current price. Doesn't rely on the AFTER UPDATE
-- trigger from 00057 firing — explicit UPDATE that hits the data directly.
--
-- Why we need this even though 00057 has triggers + backfill:
--   • The trigger only fires when buyer_line_id IS DISTINCT FROM the old
--     value. If the line_id on a registry row was already correct (set by
--     00054 default backfill, then matched by station after 00057),
--     no trigger fires and any stale calculated_price stays put.
--   • This migration runs the UPDATE directly so the data converges on
--     "calculated_price = whatever the linked line currently charges"
--     regardless of trigger history.
--
-- Also re-runs station-match reassignment for rows added since 00057
-- (e.g. via bulk-add / inline-add which don't pick a line themselves).

-- ─── 1. Re-run reassignment so any rows added after 00057 catch up ─────────

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

-- ─── 2. Force-update calculated_price + amount on every linked row ─────────

UPDATE deal_shipment_prices p
SET calculated_price = l.price,
    amount           = COALESCE(p.volume, 0) * COALESCE(l.price, 0),
    discount         = COALESCE(l.discount, p.discount)
FROM shipment_registry r
JOIN deal_buyer_lines l ON l.id = r.buyer_line_id
WHERE p.shipment_registry_id = r.id
  AND p.side = 'buyer'
  AND l.price IS NOT NULL;

UPDATE deal_shipment_prices p
SET calculated_price = l.price,
    amount           = COALESCE(p.volume, 0) * COALESCE(l.price, 0),
    discount         = COALESCE(l.discount, p.discount)
FROM shipment_registry r
JOIN deal_supplier_lines l ON l.id = r.supplier_line_id
WHERE p.shipment_registry_id = r.id
  AND p.side = 'supplier'
  AND l.price IS NOT NULL;

-- ─── 3. Insert missing rows for line-pinned registry entries ───────────────

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

-- ─── 4. Drop any duplicate side+registry rows (keep newest) ────────────────
-- The autoprice/propagate flows have changed shape several times. Belt-and-
-- suspenders dedup so the rollup totals don't double-count if duplicates
-- somehow exist.

DELETE FROM deal_shipment_prices p
USING deal_shipment_prices p2
WHERE p.shipment_registry_id IS NOT NULL
  AND p.shipment_registry_id = p2.shipment_registry_id
  AND p.side = p2.side
  AND p.id < p2.id;

-- ─── 5. Refresh price totals across every deal ─────────────────────────────

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_shipment_prices WHERE deal_id IS NOT NULL LOOP
    PERFORM refresh_deal_price_totals(r.deal_id);
  END LOOP;
END $$;

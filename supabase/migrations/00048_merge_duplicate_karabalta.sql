-- Two rows in `stations` with display name "ст. Карабалта " (with a
-- trailing space, on both rows). Different IDs:
--   b5459853-c587-45e5-89c5-fd25f2d6d030  — tariffs reference data uses this
--   0d06bf04-e047-4afb-b60c-a05308ef11ef  — deals + shipment_registry use this
--
-- Identical display name but distinct primary keys, so the inline /
-- bulk auto-lookup of railway_tariff never matched for the deals
-- pointing at 0d06bf04 — every wagon for those deals committed with
-- railway_tariff = NULL, which cascaded into empty сумма on the
-- registry, missing rollups in DT-KT, etc.
--
-- Verified before this migration:
--   - 54 tariffs rows touch the dupe; merging into the canonical id
--     produces ZERO UNIQUE(dep, dest, fuel, fw, month, year) collisions.
--   - surcharges and applications have NO references to either id.
--   - Only tariffs / deals / shipment_registry need re-pointing.
--
-- Plan: pick 0d06bf04 as canonical (it carries the operational data),
-- re-point everything that referenced the dupe, drop the dupe row,
-- trim the trailing whitespace cosmetically, then re-run the same
-- backfill from migration 00047 to fill empty registry tariffs.

-- ─── Re-point tariffs ─────────────────────────────────────────────────────
UPDATE tariffs
SET destination_station_id = '0d06bf04-e047-4afb-b60c-a05308ef11ef'
WHERE destination_station_id = 'b5459853-c587-45e5-89c5-fd25f2d6d030';

UPDATE tariffs
SET departure_station_id = '0d06bf04-e047-4afb-b60c-a05308ef11ef'
WHERE departure_station_id = 'b5459853-c587-45e5-89c5-fd25f2d6d030';

-- ─── Re-point deals ───────────────────────────────────────────────────────
UPDATE deals
SET buyer_destination_station_id = '0d06bf04-e047-4afb-b60c-a05308ef11ef'
WHERE buyer_destination_station_id = 'b5459853-c587-45e5-89c5-fd25f2d6d030';

UPDATE deals
SET supplier_departure_station_id = '0d06bf04-e047-4afb-b60c-a05308ef11ef'
WHERE supplier_departure_station_id = 'b5459853-c587-45e5-89c5-fd25f2d6d030';

-- ─── Re-point shipment_registry ───────────────────────────────────────────
UPDATE shipment_registry
SET destination_station_id = '0d06bf04-e047-4afb-b60c-a05308ef11ef'
WHERE destination_station_id = 'b5459853-c587-45e5-89c5-fd25f2d6d030';

UPDATE shipment_registry
SET departure_station_id = '0d06bf04-e047-4afb-b60c-a05308ef11ef'
WHERE departure_station_id = 'b5459853-c587-45e5-89c5-fd25f2d6d030';

-- ─── Delete the dupe (any remaining FK reference will surface here) ──────
DELETE FROM stations
WHERE id = 'b5459853-c587-45e5-89c5-fd25f2d6d030';

-- ─── Cosmetic: trim trailing whitespace from the canonical name ───────────
UPDATE stations
SET name = TRIM(name)
WHERE id = '0d06bf04-e047-4afb-b60c-a05308ef11ef'
  AND name <> TRIM(name);

-- ─── Re-run the empty-tariff backfill from 00047 with the merged data ────
UPDATE shipment_registry sr
SET railway_tariff = t.planned_tariff
FROM deals d, tariffs t
WHERE sr.deal_id          = d.id
  AND sr.railway_tariff   IS NULL
  AND t.departure_station_id   = COALESCE(sr.departure_station_id,  d.supplier_departure_station_id)
  AND t.destination_station_id = COALESCE(sr.destination_station_id, d.buyer_destination_station_id)
  AND t.fuel_type_id      = COALESCE(sr.fuel_type_id, d.fuel_type_id)
  AND t.forwarder_id      = COALESCE(sr.forwarder_id, d.forwarder_id)
  AND t.month             = COALESCE(sr.shipment_month, d.month)
  AND t.year              = d.year
  AND t.planned_tariff    IS NOT NULL;

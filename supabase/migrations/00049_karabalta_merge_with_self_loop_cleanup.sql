-- Supersedes 00048 which failed on a UNIQUE clash. Two tariff rows
-- (UE-LOGISTIC / АИ-92 / январь 2026) both encode "ст. Карабалта →
-- ст. Карабалта" — a self-loop that only existed because the two
-- duplicate Карабалта station rows let users pick different IDs for
-- departure vs destination of the same physical station. After the
-- merge they'd collapse to identical UNIQUE keys, so they have to go
-- before the merge runs.
--
-- The user confirmed (option A) to delete both since neither route is
-- real. Real Карабалта tariffs (Аса → Карабалта, Карабалта → Мерке,
-- Карабалта → Жанатас, …) are untouched.
--
-- After the cleanup this migration runs the same station merge +
-- registry-tariff backfill that 00048 attempted.

-- ─── Drop the bogus self-loop tariffs ─────────────────────────────────────
DELETE FROM tariffs
WHERE id IN (
  '67d98ab6-eccd-48ab-8235-cdd23419245e',  -- 16.30 (dep=DUPE, dest=DUPE)
  '491e01de-8a5f-484c-8e0d-2f469241f35b'   -- 16.87 (dep=CANON, dest=DUPE)
);

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

-- ─── Drop the dupe station ────────────────────────────────────────────────
DELETE FROM stations
WHERE id = 'b5459853-c587-45e5-89c5-fd25f2d6d030';

-- ─── Cosmetic: trim trailing whitespace on the canonical name ─────────────
UPDATE stations
SET name = TRIM(name)
WHERE id = '0d06bf04-e047-4afb-b60c-a05308ef11ef'
  AND name <> TRIM(name);

-- ─── Backfill empty railway_tariff in registry from the merged reference ─
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

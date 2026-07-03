-- 00104_dedupe_registry_wagon_waybill.sql
--
-- Client 2026-07-03 (сделка 084): «есть дубли — для одинаковых
-- вагонов и жд накладных одинаковые входящее СНТ. Одной отгрузкой
-- добавили входящее и исходящее СНТ, но ниже ещё один раз добавили
-- входящее СНТ».
--
-- Root cause traced across the 7 write paths to shipment_registry:
--
--   • /import (СНТ / ЭСФ tab) → handleImportSntEsf() writes rows with
--     ONLY loading_volume (when the operator's toggle = «Входящее»)
--     OR ONLY shipment_volume — no dedup vs existing rows.
--   • /import (Реестр tab) → handleImportRegistry() can write rows
--     with both volumes.
--   • /registry AddDialog + BulkAddDialog write ONE volume in the
--     dupShipment=false path.
--   • None of the paths do a SELECT-existing-first or ON CONFLICT.
--
-- So a shipment can pick up its «Входящее СНТ» and «Исходящее СНТ»
-- from separate imports, and the second one lands as a NEW row
-- because (wagon_number, waybill_number) had no uniqueness enforced.
--
-- Fix comes in three parts:
--
--   1. Merge existing duplicates. For every (registry_type,
--      wagon_number, waybill_number) that has ≥2 rows we keep the
--      row with the most data (both volumes filled, then only-load,
--      then only-ship) and fold the other row's non-null values
--      onto it, then delete the losing row.
--
--   2. Add a partial UNIQUE index on (registry_type, wagon_number,
--      waybill_number) — partial because early legacy rows have both
--      keys NULL and we don't want to collide on those.
--
--   3. The /import page already now (same commit) checks existing
--      rows and UPDATEs instead of INSERTing when a match exists.
--      Without this DB-side belt-and-braces, a concurrent bulk insert
--      could still slip a duplicate past the app-level guard.

-- ────────────────────────────────────────────────────────────────
-- 1. Merge duplicates.
-- ────────────────────────────────────────────────────────────────

WITH ranked AS (
  SELECT
    id,
    registry_type,
    wagon_number,
    waybill_number,
    loading_volume,
    shipment_volume,
    date,
    ROW_NUMBER() OVER (
      PARTITION BY registry_type, wagon_number, waybill_number
      -- Winner = row that carries the most information. Prefer rows
      -- with BOTH volumes, then either one, then neither. Break ties
      -- by earliest created_at (keep the original entry, delete the
      -- copies).
      ORDER BY
        (CASE WHEN loading_volume IS NOT NULL AND shipment_volume IS NOT NULL THEN 0
              WHEN loading_volume IS NOT NULL OR shipment_volume IS NOT NULL THEN 1
              ELSE 2 END),
        created_at ASC
    ) AS rn
  FROM shipment_registry
  WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL
),
survivors AS (
  SELECT * FROM ranked WHERE rn = 1
),
losers AS (
  SELECT * FROM ranked WHERE rn > 1
),
-- Fold each loser's non-null volumes onto its group's survivor
-- before deleting. Uses the winner's registry_type + wagon +
-- waybill as the join key.
merges AS (
  SELECT
    s.id AS survivor_id,
    -- If survivor already has a value, keep it. Otherwise take from
    -- the earliest loser that has one.
    COALESCE(s.loading_volume,  (SELECT l.loading_volume  FROM losers l
        WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number
          AND l.loading_volume IS NOT NULL ORDER BY l.rn LIMIT 1)) AS new_loading_volume,
    COALESCE(s.shipment_volume, (SELECT l.shipment_volume FROM losers l
        WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number
          AND l.shipment_volume IS NOT NULL ORDER BY l.rn LIMIT 1)) AS new_shipment_volume
  FROM survivors s
)
UPDATE shipment_registry sr
SET loading_volume  = m.new_loading_volume,
    shipment_volume = m.new_shipment_volume
FROM merges m
WHERE sr.id = m.survivor_id
  AND (sr.loading_volume  IS DISTINCT FROM m.new_loading_volume
    OR sr.shipment_volume IS DISTINCT FROM m.new_shipment_volume);

-- Now drop the duplicate rows themselves. Re-select losers instead
-- of reusing the CTE because CTEs don't persist across statements.
DELETE FROM shipment_registry
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY registry_type, wagon_number, waybill_number
             ORDER BY
               (CASE WHEN loading_volume IS NOT NULL AND shipment_volume IS NOT NULL THEN 0
                     WHEN loading_volume IS NOT NULL OR shipment_volume IS NOT NULL THEN 1
                     ELSE 2 END),
               created_at ASC
           ) AS rn
    FROM shipment_registry
    WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL
  ) r
  WHERE r.rn > 1
);

-- ────────────────────────────────────────────────────────────────
-- 2. Partial UNIQUE index — one row per (type, wagon, waybill).
-- ────────────────────────────────────────────────────────────────

-- Partial so historical rows with either key NULL don't collide
-- against each other; they simply escape the constraint. Nothing
-- with both keys set should ever duplicate again after this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_registry_unique_wagon_waybill
  ON shipment_registry (registry_type, wagon_number, waybill_number)
  WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 3. Sanity: report what we did (surfaces in the migration log
--    Beken watches when he applies the file).
-- ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_total INT;
  v_full  INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM shipment_registry;
  SELECT COUNT(*) INTO v_full  FROM shipment_registry
   WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL;
  RAISE NOTICE 'shipment_registry: % rows total, % with wagon+waybill (now uniquely-indexed)', v_total, v_full;
END $$;

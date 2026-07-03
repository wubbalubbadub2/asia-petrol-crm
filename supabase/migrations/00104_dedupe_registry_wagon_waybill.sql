-- 00104_dedupe_registry_wagon_waybill.sql
--
-- Client 2026-07-03 (сделка 084): «есть дубли — для одинаковых
-- вагонов и жд накладных одинаковые входящее СНТ. Одной отгрузкой
-- добавили входящее и исходящее СНТ, но ниже ещё один раз добавили
-- входящее СНТ».
--
-- Root cause (agent trace, 7 write paths into shipment_registry):
--   • /import (СНТ / ЭСФ) → handleImportSntEsf() writes rows with
--     ONLY loading_volume (or only shipment_volume) — no dedup vs
--     existing rows.
--   • /import (Реестр), AddDialog, BulkAddDialog — no ON CONFLICT.
--   • DB has no UNIQUE index on (wagon_number, waybill_number).
--
-- Client asked: «уверен что миграцией мы ничего лишнего не удалим?».
-- Answer: I DO NOT want to delete anything without an operator
-- reviewing it first. This file is deliberately structured as:
--
--   PHASE 1 — dry-run report (default, always runs)
--             emits NOTICEs with per-cluster counts + a sample list
--             of the rows that WOULD be merged. Zero writes.
--             Operator reads the Supabase Dashboard SQL log, checks
--             the sample, and only then unlocks phase 2.
--
--   PHASE 2 — actual dedupe (guarded by an explicit sentinel row)
--             merges non-null columns from losers onto the survivor,
--             then deletes the losers. FKs on shipment_registry.id
--             CASCADE to deal_shipment_prices — the survivor keeps
--             its own price rows, only the losers' price rows are
--             dropped (they represented the same physical shipment).
--
--   PHASE 3 — partial UNIQUE index on (registry_type, wagon_number,
--             waybill_number) WHERE both keys NOT NULL. Prevents a
--             future bulk insert from slipping past the new
--             app-side guard in /import.
--
-- What COUNTS as a duplicate — deliberately narrow:
--     same registry_type
--   + same wagon_number
--   + same waybill_number
--   + same date (nullable; NULL matches NULL)
--   + same deal_id (nullable; NULL matches NULL)
--
-- If any of date / deal_id differ the rows stay put — could be
-- two legitimately separate shipments (wagon reused, waybill re-
-- issued). The narrow filter means we may miss a real duplicate,
-- but we will never merge two legitimately-distinct shipments.

-- ────────────────────────────────────────────────────────────────
-- PHASE 1 — DRY-RUN REPORT (always runs; zero writes).
-- ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_clusters INT;
  v_extra_rows INT;
  v_sample TEXT;
BEGIN
  WITH clustered AS (
    SELECT
      registry_type,
      wagon_number,
      waybill_number,
      date,
      deal_id,
      COUNT(*)             AS n,
      MIN(created_at)      AS earliest,
      MAX(created_at)      AS latest,
      ARRAY_AGG(id ORDER BY created_at) AS ids
    FROM shipment_registry
    WHERE wagon_number  IS NOT NULL
      AND waybill_number IS NOT NULL
    GROUP BY registry_type, wagon_number, waybill_number, date, deal_id
    HAVING COUNT(*) > 1
  )
  SELECT
    COUNT(*),
    COALESCE(SUM(n - 1), 0)
  INTO v_clusters, v_extra_rows
  FROM clustered;

  RAISE NOTICE '========================================================';
  RAISE NOTICE 'shipment_registry dedupe DRY RUN';
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Кластеров дубликатов: %', v_clusters;
  RAISE NOTICE 'Строк, которые были бы удалены: %', v_extra_rows;
  RAISE NOTICE '(строки НЕ удалены — фаза 2 закомментирована ниже)';

  IF v_clusters > 0 THEN
    SELECT string_agg(
             format(
               '  тип=% вагон=% накл=% дата=% сделка=% × %',
               registry_type,
               wagon_number,
               waybill_number,
               COALESCE(date::TEXT, 'NULL'),
               COALESCE(deal_id::TEXT, 'NULL'),
               n
             ),
             E'\n'
           )
    INTO v_sample
    FROM (
      SELECT registry_type, wagon_number, waybill_number, date, deal_id, COUNT(*) AS n
      FROM shipment_registry
      WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL
      GROUP BY registry_type, wagon_number, waybill_number, date, deal_id
      HAVING COUNT(*) > 1
      ORDER BY n DESC, wagon_number, waybill_number
      LIMIT 20
    ) sample;
    RAISE NOTICE 'Первые до 20 кластеров:';
    RAISE NOTICE E'%', v_sample;
  END IF;
  RAISE NOTICE '========================================================';
END $$;

-- ────────────────────────────────────────────────────────────────
-- PHASE 2 — ACTUAL DEDUPE.
--
-- Раскомментируйте блок ниже (три строки — BEGIN / END $$; +
-- удалите обе строки со стрелками ⇩⇩⇩ и ⇧⇧⇧) и запустите файл
-- ещё раз, ТОЛЬКО после того как проверили список кластеров из
-- фазы 1.
-- ────────────────────────────────────────────────────────────────

-- ⇩⇩⇩ УДАЛИТЬ ЭТУ СТРОКУ + СТРОКУ /* внизу, ЧТОБЫ ВКЛЮЧИТЬ УДАЛЕНИЕ ⇩⇩⇩
/*

DO $$
DECLARE
  v_merges INT;
  v_deletes INT;
BEGIN
  -- 2a. Merge non-null values from losers onto their group's survivor.
  --     Survivor = row with the most data (both volumes > one volume >
  --     none), tie-broken by earliest created_at. We fold the following
  --     columns because they carry per-shipment metadata operators
  --     enter piecemeal across the paired imports:
  --       loading_volume, shipment_volume, railway_tariff,
  --       shipment_month, invoice_number, comment, forwarder_id,
  --       factory_id, company_group_id, supplier_id, buyer_id,
  --       fuel_type_id, destination_station_id, departure_station_id,
  --       additional_month, quarter, month, rounded_tonnage_from_forwarder,
  --       shipped_tonnage_amount.

  WITH ranked AS (
    SELECT
      id,
      registry_type,
      wagon_number,
      waybill_number,
      date,
      deal_id,
      loading_volume,
      shipment_volume,
      railway_tariff,
      shipment_month,
      invoice_number,
      comment,
      forwarder_id,
      factory_id,
      company_group_id,
      supplier_id,
      buyer_id,
      fuel_type_id,
      destination_station_id,
      departure_station_id,
      additional_month,
      quarter,
      month,
      rounded_tonnage_from_forwarder,
      shipped_tonnage_amount,
      ROW_NUMBER() OVER (
        PARTITION BY registry_type, wagon_number, waybill_number, date, deal_id
        ORDER BY
          (CASE WHEN loading_volume IS NOT NULL AND shipment_volume IS NOT NULL THEN 0
                WHEN loading_volume IS NOT NULL OR  shipment_volume IS NOT NULL THEN 1
                ELSE 2 END),
          created_at ASC
      ) AS rn
    FROM shipment_registry
    WHERE wagon_number  IS NOT NULL
      AND waybill_number IS NOT NULL
  ),
  survivors AS (SELECT * FROM ranked WHERE rn = 1),
  losers    AS (SELECT * FROM ranked WHERE rn > 1),
  fold_pick AS (
    -- For each survivor, pick the earliest non-null value across its
    -- losers for every mergeable column. COALESCE with the survivor's
    -- own value first — never overwrite something the operator has
    -- explicitly set on the winning row.
    SELECT
      s.id AS survivor_id,
      COALESCE(s.loading_volume,                  (SELECT loading_volume                  FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND loading_volume IS NOT NULL ORDER BY rn LIMIT 1)) AS loading_volume,
      COALESCE(s.shipment_volume,                 (SELECT shipment_volume                 FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND shipment_volume IS NOT NULL ORDER BY rn LIMIT 1)) AS shipment_volume,
      COALESCE(s.railway_tariff,                  (SELECT railway_tariff                  FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND railway_tariff IS NOT NULL ORDER BY rn LIMIT 1)) AS railway_tariff,
      COALESCE(s.shipment_month,                  (SELECT shipment_month                  FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND shipment_month IS NOT NULL ORDER BY rn LIMIT 1)) AS shipment_month,
      COALESCE(s.invoice_number,                  (SELECT invoice_number                  FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND invoice_number IS NOT NULL ORDER BY rn LIMIT 1)) AS invoice_number,
      COALESCE(s.comment,                         (SELECT comment                         FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND comment IS NOT NULL ORDER BY rn LIMIT 1)) AS comment,
      COALESCE(s.forwarder_id,                    (SELECT forwarder_id                    FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND forwarder_id IS NOT NULL ORDER BY rn LIMIT 1)) AS forwarder_id,
      COALESCE(s.factory_id,                      (SELECT factory_id                      FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND factory_id IS NOT NULL ORDER BY rn LIMIT 1)) AS factory_id,
      COALESCE(s.company_group_id,                (SELECT company_group_id                FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND company_group_id IS NOT NULL ORDER BY rn LIMIT 1)) AS company_group_id,
      COALESCE(s.supplier_id,                     (SELECT supplier_id                     FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND supplier_id IS NOT NULL ORDER BY rn LIMIT 1)) AS supplier_id,
      COALESCE(s.buyer_id,                        (SELECT buyer_id                        FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND buyer_id IS NOT NULL ORDER BY rn LIMIT 1)) AS buyer_id,
      COALESCE(s.fuel_type_id,                    (SELECT fuel_type_id                    FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND fuel_type_id IS NOT NULL ORDER BY rn LIMIT 1)) AS fuel_type_id,
      COALESCE(s.destination_station_id,          (SELECT destination_station_id          FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND destination_station_id IS NOT NULL ORDER BY rn LIMIT 1)) AS destination_station_id,
      COALESCE(s.departure_station_id,            (SELECT departure_station_id            FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND departure_station_id IS NOT NULL ORDER BY rn LIMIT 1)) AS departure_station_id,
      COALESCE(s.additional_month,                (SELECT additional_month                FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND additional_month IS NOT NULL ORDER BY rn LIMIT 1)) AS additional_month,
      COALESCE(s.quarter,                         (SELECT quarter                         FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND quarter IS NOT NULL ORDER BY rn LIMIT 1)) AS quarter,
      COALESCE(s.month,                           (SELECT month                           FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND month IS NOT NULL ORDER BY rn LIMIT 1)) AS month,
      COALESCE(s.rounded_tonnage_from_forwarder,  (SELECT rounded_tonnage_from_forwarder  FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND rounded_tonnage_from_forwarder IS NOT NULL ORDER BY rn LIMIT 1)) AS rounded_tonnage_from_forwarder,
      COALESCE(s.shipped_tonnage_amount,          (SELECT shipped_tonnage_amount          FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND l.deal_id IS NOT DISTINCT FROM s.deal_id AND shipped_tonnage_amount IS NOT NULL ORDER BY rn LIMIT 1)) AS shipped_tonnage_amount
    FROM survivors s
  )
  UPDATE shipment_registry sr
  SET loading_volume                 = fp.loading_volume,
      shipment_volume                = fp.shipment_volume,
      railway_tariff                 = fp.railway_tariff,
      shipment_month                 = fp.shipment_month,
      invoice_number                 = fp.invoice_number,
      comment                        = fp.comment,
      forwarder_id                   = fp.forwarder_id,
      factory_id                     = fp.factory_id,
      company_group_id               = fp.company_group_id,
      supplier_id                    = fp.supplier_id,
      buyer_id                       = fp.buyer_id,
      fuel_type_id                   = fp.fuel_type_id,
      destination_station_id         = fp.destination_station_id,
      departure_station_id           = fp.departure_station_id,
      additional_month               = fp.additional_month,
      quarter                        = fp.quarter,
      month                          = fp.month,
      rounded_tonnage_from_forwarder = fp.rounded_tonnage_from_forwarder,
      shipped_tonnage_amount         = fp.shipped_tonnage_amount
  FROM fold_pick fp
  WHERE sr.id = fp.survivor_id;
  GET DIAGNOSTICS v_merges = ROW_COUNT;

  -- 2b. Delete the losers.
  DELETE FROM shipment_registry
  WHERE id IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY registry_type, wagon_number, waybill_number, date, deal_id
               ORDER BY
                 (CASE WHEN loading_volume IS NOT NULL AND shipment_volume IS NOT NULL THEN 0
                       WHEN loading_volume IS NOT NULL OR  shipment_volume IS NOT NULL THEN 1
                       ELSE 2 END),
                 created_at ASC
             ) AS rn
      FROM shipment_registry
      WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL
    ) r
    WHERE r.rn > 1
  );
  GET DIAGNOSTICS v_deletes = ROW_COUNT;

  RAISE NOTICE '========================================================';
  RAISE NOTICE 'dedupe applied: % survivors merged, % losers deleted', v_merges, v_deletes;
  RAISE NOTICE '========================================================';
END $$;

*/
-- ⇧⇧⇧ УДАЛИТЬ СТРОКУ ВЫШЕ (*/) И */ ПОД `END $$;` — ЧТОБЫ ВКЛЮЧИТЬ УДАЛЕНИЕ ⇧⇧⇧

-- ────────────────────────────────────────────────────────────────
-- PHASE 3 — partial UNIQUE index.
--   Ставится только если строгих дубликатов (по narrow filter выше)
--   не осталось. Иначе просто NOTICE — файл можно перезапустить
--   после ручного разбора. RAISE не используем, чтобы применение
--   миграции не откатывало Phase 1's diagnostic NOTICEs.
-- ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_dupes INT;
BEGIN
  SELECT COUNT(*) INTO v_dupes
  FROM (
    SELECT 1
    FROM shipment_registry
    WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL
    GROUP BY registry_type, wagon_number, waybill_number
    HAVING COUNT(*) > 1
  ) x;

  IF v_dupes > 0 THEN
    RAISE NOTICE 'Пропускаю CREATE UNIQUE INDEX — осталось % кластеров дубликатов. Сначала прогоните Phase 2, потом перезапустите файл.', v_dupes;
  ELSE
    EXECUTE $ix$
      CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_registry_unique_wagon_waybill
        ON shipment_registry (registry_type, wagon_number, waybill_number)
        WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL
    $ix$;
    RAISE NOTICE 'UNIQUE INDEX создан (или уже был) — будущие вставки под защитой.';
  END IF;
END $$;

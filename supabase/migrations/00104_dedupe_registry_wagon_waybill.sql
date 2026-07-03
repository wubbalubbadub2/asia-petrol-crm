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
-- What COUNTS as a duplicate — physical shipment identity:
--     same registry_type
--   + same wagon_number
--   + same waybill_number
--   + same date (nullable; NULL matches NULL)
--
-- Client 2026-07-03: «дубли смотрим внутри одной сделки, верно?».
-- Half-yes: the physical (wagon+waybill+date) IS the shipment, but
-- deal_id is NOT part of the key. Reason: the SNT import path (the
-- primary duplicate source) writes rows with deal_id=NULL — if we
-- partitioned by deal_id, NULL and '084' would end up in different
-- groups and never merge. The whole point of this file is to fix
-- those NULL-deal SNT rows.
--
-- Ambiguity guard: if a cluster contains ≥2 rows with DIFFERENT
-- non-null deal_ids, that's an operator error (same shipment
-- posted against two deals) — Phase 2 leaves that cluster
-- alone and phase 1 lists it separately so someone can decide
-- which deal_id is correct.

-- ────────────────────────────────────────────────────────────────
-- PHASE 1 — DRY-RUN REPORT (always runs; zero writes).
-- ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_clusters INT;
  v_safe_clusters INT;
  v_ambiguous_clusters INT;
  v_safe_extra INT;
  v_ambiguous_extra INT;
  v_sample TEXT;
BEGIN
  WITH clustered AS (
    SELECT
      registry_type,
      wagon_number,
      waybill_number,
      date,
      COUNT(*)                            AS n,
      COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL) AS distinct_deals,
      ARRAY_AGG(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL) AS deal_ids
    FROM shipment_registry
    WHERE wagon_number  IS NOT NULL
      AND waybill_number IS NOT NULL
    GROUP BY registry_type, wagon_number, waybill_number, date
    HAVING COUNT(*) > 1
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE distinct_deals <= 1),
    COUNT(*) FILTER (WHERE distinct_deals >  1),
    COALESCE(SUM(n - 1) FILTER (WHERE distinct_deals <= 1), 0),
    COALESCE(SUM(n - 1) FILTER (WHERE distinct_deals >  1), 0)
  INTO v_clusters, v_safe_clusters, v_ambiguous_clusters, v_safe_extra, v_ambiguous_extra
  FROM clustered;

  RAISE NOTICE '========================================================';
  RAISE NOTICE 'shipment_registry dedupe DRY RUN';
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Всего кластеров дубликатов: %', v_clusters;
  RAISE NOTICE '  безопасных (deal_id совпадает или NULL): %  → -% строк', v_safe_clusters, v_safe_extra;
  RAISE NOTICE '  неоднозначных (deal_id разные и оба не-NULL): % → % строк', v_ambiguous_clusters, v_ambiguous_extra;
  RAISE NOTICE '(Phase 2 сольёт только «безопасные». «Неоднозначные»';
  RAISE NOTICE ' пропустит — надо разбирать вручную, кому принадлежит';
  RAISE NOTICE ' физическая отгрузка.)';
  RAISE NOTICE 'Ничего сейчас НЕ удалено — фаза 2 закомментирована ниже.';

  IF v_safe_clusters > 0 THEN
    SELECT string_agg(
             format(
               '  тип=%s вагон=%s накл=%s дата=%s × %s (deal_id: %s)',
               registry_type,
               wagon_number,
               waybill_number,
               COALESCE(date::TEXT, 'NULL'),
               n,
               COALESCE(array_to_string(deal_ids, ','), 'NULL')
             ),
             E'\n'
           )
    INTO v_sample
    FROM (
      SELECT registry_type, wagon_number, waybill_number, date,
             COUNT(*) AS n,
             ARRAY_AGG(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL) AS deal_ids,
             COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL) AS distinct_deals
      FROM shipment_registry
      WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL
      GROUP BY registry_type, wagon_number, waybill_number, date
      HAVING COUNT(*) > 1 AND COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL) <= 1
      ORDER BY n DESC, wagon_number, waybill_number
      LIMIT 20
    ) sample;
    RAISE NOTICE '--- Первые до 20 БЕЗОПАСНЫХ кластеров (будут слиты Phase 2) ---';
    RAISE NOTICE E'%', v_sample;
  END IF;

  IF v_ambiguous_clusters > 0 THEN
    SELECT string_agg(
             format(
               '  тип=%s вагон=%s накл=%s дата=%s × %s → deal_ids: %s',
               registry_type,
               wagon_number,
               waybill_number,
               COALESCE(date::TEXT, 'NULL'),
               n,
               array_to_string(deal_ids, ',')
             ),
             E'\n'
           )
    INTO v_sample
    FROM (
      SELECT registry_type, wagon_number, waybill_number, date,
             COUNT(*) AS n,
             ARRAY_AGG(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL) AS deal_ids
      FROM shipment_registry
      WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL
      GROUP BY registry_type, wagon_number, waybill_number, date
      HAVING COUNT(*) > 1 AND COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL) > 1
      ORDER BY n DESC, wagon_number, waybill_number
      LIMIT 20
    ) sample;
    RAISE NOTICE '--- НЕОДНОЗНАЧНЫЕ кластеры (Phase 2 их не тронет) ---';
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
  --     Partition = physical shipment (type + wagon + waybill + date).
  --     Ambiguity guard (subquery below) EXCLUDES clusters that have
  --     ≥2 distinct non-null deal_ids — those need manual resolution
  --     because we can't know which deal_id is correct.
  --     Survivor = row with the most data (both volumes > one volume >
  --     none), tie-broken by earliest created_at.

  WITH safe_clusters AS (
    -- Only clusters where at most one non-null deal_id appears. If
    -- there are two, that's an operator error (same shipment posted
    -- against two deals) and Phase 2 leaves them alone.
    SELECT registry_type, wagon_number, waybill_number, date
    FROM shipment_registry
    WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL
    GROUP BY registry_type, wagon_number, waybill_number, date
    HAVING COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL) <= 1
       AND COUNT(*) > 1
  ),
  ranked AS (
    SELECT
      sr.id,
      sr.registry_type,
      sr.wagon_number,
      sr.waybill_number,
      sr.date,
      sr.deal_id,
      sr.loading_volume,
      sr.shipment_volume,
      sr.railway_tariff,
      sr.shipment_month,
      sr.invoice_number,
      sr.comment,
      sr.forwarder_id,
      sr.factory_id,
      sr.company_group_id,
      sr.supplier_id,
      sr.buyer_id,
      sr.fuel_type_id,
      sr.destination_station_id,
      sr.departure_station_id,
      sr.additional_month,
      sr.quarter,
      sr.month,
      sr.rounded_tonnage_from_forwarder,
      sr.shipped_tonnage_amount,
      ROW_NUMBER() OVER (
        PARTITION BY sr.registry_type, sr.wagon_number, sr.waybill_number, sr.date
        ORDER BY
          (CASE WHEN sr.loading_volume IS NOT NULL AND sr.shipment_volume IS NOT NULL THEN 0
                WHEN sr.loading_volume IS NOT NULL OR  sr.shipment_volume IS NOT NULL THEN 1
                ELSE 2 END),
          sr.created_at ASC
      ) AS rn
    FROM shipment_registry sr
    JOIN safe_clusters sc
      ON sc.registry_type   = sr.registry_type
     AND sc.wagon_number    = sr.wagon_number
     AND sc.waybill_number  = sr.waybill_number
     AND sc.date            IS NOT DISTINCT FROM sr.date
  ),
  survivors AS (SELECT * FROM ranked WHERE rn = 1),
  losers    AS (SELECT * FROM ranked WHERE rn > 1),
  fold_pick AS (
    -- For each survivor, pick the earliest non-null value across its
    -- losers for every mergeable column. COALESCE with the survivor's
    -- own value first — never overwrite something the operator has
    -- explicitly set on the winning row. Partition matches without
    -- deal_id (already guarded by safe_clusters above).
    -- deal_id itself is folded too: if the survivor came from the
    -- SNT/ЭСФ import path with deal_id=NULL, promoting the loser's
    -- non-null deal_id is the whole point of the migration.
    SELECT
      s.id AS survivor_id,
      COALESCE(s.deal_id,                         (SELECT deal_id                         FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND deal_id IS NOT NULL ORDER BY rn LIMIT 1)) AS deal_id,
      COALESCE(s.loading_volume,                  (SELECT loading_volume                  FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND loading_volume IS NOT NULL ORDER BY rn LIMIT 1)) AS loading_volume,
      COALESCE(s.shipment_volume,                 (SELECT shipment_volume                 FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND shipment_volume IS NOT NULL ORDER BY rn LIMIT 1)) AS shipment_volume,
      COALESCE(s.railway_tariff,                  (SELECT railway_tariff                  FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND railway_tariff IS NOT NULL ORDER BY rn LIMIT 1)) AS railway_tariff,
      COALESCE(s.shipment_month,                  (SELECT shipment_month                  FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND shipment_month IS NOT NULL ORDER BY rn LIMIT 1)) AS shipment_month,
      COALESCE(s.invoice_number,                  (SELECT invoice_number                  FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND invoice_number IS NOT NULL ORDER BY rn LIMIT 1)) AS invoice_number,
      COALESCE(s.comment,                         (SELECT comment                         FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND comment IS NOT NULL ORDER BY rn LIMIT 1)) AS comment,
      COALESCE(s.forwarder_id,                    (SELECT forwarder_id                    FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND forwarder_id IS NOT NULL ORDER BY rn LIMIT 1)) AS forwarder_id,
      COALESCE(s.factory_id,                      (SELECT factory_id                      FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND factory_id IS NOT NULL ORDER BY rn LIMIT 1)) AS factory_id,
      COALESCE(s.company_group_id,                (SELECT company_group_id                FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND company_group_id IS NOT NULL ORDER BY rn LIMIT 1)) AS company_group_id,
      COALESCE(s.supplier_id,                     (SELECT supplier_id                     FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND supplier_id IS NOT NULL ORDER BY rn LIMIT 1)) AS supplier_id,
      COALESCE(s.buyer_id,                        (SELECT buyer_id                        FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND buyer_id IS NOT NULL ORDER BY rn LIMIT 1)) AS buyer_id,
      COALESCE(s.fuel_type_id,                    (SELECT fuel_type_id                    FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND fuel_type_id IS NOT NULL ORDER BY rn LIMIT 1)) AS fuel_type_id,
      COALESCE(s.destination_station_id,          (SELECT destination_station_id          FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND destination_station_id IS NOT NULL ORDER BY rn LIMIT 1)) AS destination_station_id,
      COALESCE(s.departure_station_id,            (SELECT departure_station_id            FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND departure_station_id IS NOT NULL ORDER BY rn LIMIT 1)) AS departure_station_id,
      COALESCE(s.additional_month,                (SELECT additional_month                FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND additional_month IS NOT NULL ORDER BY rn LIMIT 1)) AS additional_month,
      COALESCE(s.quarter,                         (SELECT quarter                         FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND quarter IS NOT NULL ORDER BY rn LIMIT 1)) AS quarter,
      COALESCE(s.month,                           (SELECT month                           FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND month IS NOT NULL ORDER BY rn LIMIT 1)) AS month,
      COALESCE(s.rounded_tonnage_from_forwarder,  (SELECT rounded_tonnage_from_forwarder  FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND rounded_tonnage_from_forwarder IS NOT NULL ORDER BY rn LIMIT 1)) AS rounded_tonnage_from_forwarder,
      COALESCE(s.shipped_tonnage_amount,          (SELECT shipped_tonnage_amount          FROM losers l WHERE l.registry_type = s.registry_type AND l.wagon_number = s.wagon_number AND l.waybill_number = s.waybill_number AND l.date IS NOT DISTINCT FROM s.date AND shipped_tonnage_amount IS NOT NULL ORDER BY rn LIMIT 1)) AS shipped_tonnage_amount
    FROM survivors s
  )
  UPDATE shipment_registry sr
  SET deal_id                        = fp.deal_id,
      loading_volume                 = fp.loading_volume,
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

  -- 2b. Delete the losers. Restrict to safe clusters via the same
  --     guard subquery, so ambiguous (multi-deal) clusters keep every
  --     one of their rows for manual review.
  WITH safe_clusters2 AS (
    SELECT registry_type, wagon_number, waybill_number, date
    FROM shipment_registry
    WHERE wagon_number IS NOT NULL AND waybill_number IS NOT NULL
    GROUP BY registry_type, wagon_number, waybill_number, date
    HAVING COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL) <= 1
       AND COUNT(*) > 1
  ),
  ranked2 AS (
    SELECT sr.id,
           ROW_NUMBER() OVER (
             PARTITION BY sr.registry_type, sr.wagon_number, sr.waybill_number, sr.date
             ORDER BY
               (CASE WHEN sr.loading_volume IS NOT NULL AND sr.shipment_volume IS NOT NULL THEN 0
                     WHEN sr.loading_volume IS NOT NULL OR  sr.shipment_volume IS NOT NULL THEN 1
                     ELSE 2 END),
               sr.created_at ASC
           ) AS rn
    FROM shipment_registry sr
    JOIN safe_clusters2 sc
      ON sc.registry_type   = sr.registry_type
     AND sc.wagon_number    = sr.wagon_number
     AND sc.waybill_number  = sr.waybill_number
     AND sc.date            IS NOT DISTINCT FROM sr.date
  )
  DELETE FROM shipment_registry
  WHERE id IN (SELECT id FROM ranked2 WHERE rn > 1);
  GET DIAGNOSTICS v_deletes = ROW_COUNT;

  RAISE NOTICE '========================================================';
  RAISE NOTICE 'dedupe applied: % выживших смерджено, % лузеров удалено', v_merges, v_deletes;
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

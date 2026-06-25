-- 00099_merge_chain_duplicates.sql
--
-- Historical cleanup: merge ~1358 pairs of shipment_registry rows that
-- represent the SAME physical shipment but were entered as two separate
-- rows (one with loading_volume, one with shipment_volume). Operator
-- request 2026-06-25.
--
-- WHICH PAIRS ARE MERGED
--
-- A pair = two shipment_registry rows that share:
--   (deal_id, wagon_number, waybill_number, date)
-- with one row carrying only loading_volume (other side NULL), and the
-- other carrying only shipment_volume — AND the volumes are equal.
--
-- The pair must additionally belong to a deal whose deal_company_groups
-- chain satisfies BOTH conditions:
--   (1) position 1 has a company that matches the operator-defined set:
--         «ОсОО» / «Singularity» (case-insensitive)
--         OR one of the 12 whitelist names below (substring match on a
--         normalized form: lower-case with whitespace/hyphens/underscores/
--         dots stripped).
--   (2) position 2 either matches the same set OR has no entry at all.
--       A non-empty position-2 with a non-matching company DISQUALIFIES
--       the pair (operator clarification 2026-06-25 — «точно не должны
--       включать если есть компании не из whitelist или ОсОО»).
--
-- WHITELIST (12 names, exactly as the operator provided; no aliases for
-- DB typos — client will fix the spravochnik themselves):
--   CAODL, Fuel Supply Company, Geowax, Kernel Trade GmbH,
--   Singularity Trading GmbH, TENGRI WEY FZCO, АБ Линк, Бетта,
--   Брент Трейдинг, Дот-Трейдинг, Ойл Ресурс Трейдинг, Ордо Мунай Импекс.
--
-- WHAT'S NOT TOUCHED
--   • Pairs whose chain doesn't satisfy the rule above (e.g. Progressive
--     oil trading, TIEN-SHAN OIL, Арқа Проф, TENGRI WAY without «FZCO»).
--   • Pairs where the two volumes differ (could be a real two-stage
--     physical shipment with a reservoir in between — operator confirmed
--     this is a legitimate pattern to keep).
--   • Single shipment rows (one row per shipment — nothing to merge).
--   • Any row inserted by a user through the UI that doesn't fit the
--     pair pattern.
--
-- SAFETY NETS
--   • Full backups before any mutation:
--       - shipment_registry_00099_backup        (rows targeted by merge)
--       - deal_shipment_prices_00099_backup     (their attached prices)
--   • Only TWO triggers are disabled during the merge — the activity-feed
--     trigger (so we don't flood every deal's chat) and the autoprice
--     trigger (so a no-op UPDATE doesn't re-insert duplicate
--     deal_shipment_prices rows — the lesson from 00097).
--   • The audit_log trigger STAYS enabled — every change in this
--     migration is traceable.
--   • Rollup totals are refreshed afterwards via explicit calls to
--     refresh_deal_shipment_totals + refresh_deal_price_totals on every
--     affected deal — no reliance on triggers fluttering after the fact.
--   • IF NOT EXISTS on the backup tables — re-running the migration
--     preserves the backup; the second pass will find 0 pairs (since
--     the duplicates are gone) and effectively no-op.

DO $$
DECLARE
  v_qualifying_deals  INT;
  v_pair_count        INT;
  v_moved_prices      INT;
  v_updated_keep      INT;
  v_deleted_drop      INT;
  v_refresh_count     INT;
BEGIN
  -- =========================================================
  -- 0. Normalisation + matching helpers (TEMP, dropped at end)
  -- =========================================================
  -- We can't rely on plpgsql-only matching in WHERE clauses cleanly,
  -- so define stable helpers in pg_temp for this migration only.
  CREATE OR REPLACE FUNCTION pg_temp._norm99(s text) RETURNS text AS $f$
    SELECT regexp_replace(lower(COALESCE(s, '')), '[\s\-_\.]+', '', 'g')
  $f$ LANGUAGE sql IMMUTABLE;

  CREATE OR REPLACE FUNCTION pg_temp._match99(g_name text, g_full_name text) RETURNS boolean AS $f$
  DECLARE
    raw text := lower(COALESCE(g_full_name, '') || ' ' || COALESCE(g_name, ''));
    h   text := pg_temp._norm99(COALESCE(g_full_name, '') || COALESCE(g_name, ''));
  BEGIN
    -- ОсОО / Singularity branch (raw substring, no normalisation needed —
    -- these tokens never contain whitespace/punctuation in the wild).
    IF raw LIKE '%осоо%' OR raw LIKE '%osoo%' OR raw LIKE '%singularity%' OR raw LIKE '%сингулярити%' THEN
      RETURN true;
    END IF;
    -- Whitelist branch (substring on normalised form).
    IF h LIKE '%caodl%'
       OR h LIKE '%fuelsupplycompany%'
       OR h LIKE '%geowax%'
       OR h LIKE '%kerneltradegmbh%'
       OR h LIKE '%singularitytradinggmbh%'
       OR h LIKE '%tengriweyfzco%'
       OR h LIKE '%аблинк%'
       OR h LIKE '%бетта%'
       OR h LIKE '%бренттрейдинг%'
       OR h LIKE '%доттрейдинг%'
       OR h LIKE '%ойлресурстрейдинг%'
       OR h LIKE '%ордомунайимпекс%'
    THEN
      RETURN true;
    END IF;
    RETURN false;
  END;
  $f$ LANGUAGE plpgsql IMMUTABLE;

  -- =========================================================
  -- 1. Find qualifying deals (chain rule)
  -- =========================================================
  CREATE TEMPORARY TABLE qualifying_deals_99 ON COMMIT DROP AS
  WITH chain_data AS (
    SELECT dcg.deal_id,
      bool_or(dcg.position = 1 AND pg_temp._match99(cg.name, cg.full_name)) AS pos1_match,
      bool_or(dcg.position = 2 AND pg_temp._match99(cg.name, cg.full_name)) AS pos2_match,
      bool_or(dcg.position = 2) AS pos2_exists
    FROM deal_company_groups dcg
    JOIN company_groups cg ON cg.id = dcg.company_group_id
    WHERE dcg.position IN (1, 2)
    GROUP BY dcg.deal_id
  )
  SELECT deal_id
  FROM chain_data
  WHERE pos1_match AND (NOT pos2_exists OR pos2_match);

  SELECT COUNT(*) INTO v_qualifying_deals FROM qualifying_deals_99;
  RAISE NOTICE '[00099] Qualifying deals: %', v_qualifying_deals;

  -- =========================================================
  -- 2. Find pair candidates inside those deals
  -- =========================================================
  CREATE TEMPORARY TABLE merge_pairs_99 ON COMMIT DROP AS
  SELECT
    a.id          AS keep_id,
    b.id          AS drop_id,
    a.deal_id     AS deal_id,
    -- Volumes (one side from each row — verified equal by the WHERE clause)
    COALESCE(a.loading_volume,  b.loading_volume)  AS merged_loading,
    COALESCE(a.shipment_volume, b.shipment_volume) AS merged_shipment
  FROM shipment_registry a
  JOIN shipment_registry b
    ON  a.deal_id        = b.deal_id
    AND a.wagon_number   = b.wagon_number
    AND a.waybill_number = b.waybill_number
    AND a.date           = b.date
    AND a.id < b.id
  WHERE a.deal_id IN (SELECT deal_id FROM qualifying_deals_99)
    AND (
      -- one row loading-only, other shipment-only (either order)
      (a.loading_volume  IS NOT NULL AND a.shipment_volume IS NULL
       AND b.loading_volume IS NULL AND b.shipment_volume IS NOT NULL)
      OR
      (a.shipment_volume IS NOT NULL AND a.loading_volume IS NULL
       AND b.shipment_volume IS NULL AND b.loading_volume IS NOT NULL)
    )
    -- volumes must match
    AND COALESCE(a.loading_volume, a.shipment_volume)
      = COALESCE(b.loading_volume, b.shipment_volume);

  SELECT COUNT(*) INTO v_pair_count FROM merge_pairs_99;
  RAISE NOTICE '[00099] Pairs identified for merge: %', v_pair_count;

  IF v_pair_count = 0 THEN
    RAISE NOTICE '[00099] No pairs to merge — nothing to do.';
    RETURN;
  END IF;

  -- =========================================================
  -- 3. Backup (idempotent — preserves history if re-run)
  -- =========================================================
  CREATE TABLE IF NOT EXISTS shipment_registry_00099_backup AS
  SELECT sr.* FROM shipment_registry sr
  WHERE sr.id IN (SELECT keep_id FROM merge_pairs_99
                  UNION
                  SELECT drop_id FROM merge_pairs_99);

  CREATE TABLE IF NOT EXISTS deal_shipment_prices_00099_backup AS
  SELECT dsp.* FROM deal_shipment_prices dsp
  WHERE dsp.shipment_registry_id IN (SELECT keep_id FROM merge_pairs_99
                                     UNION
                                     SELECT drop_id FROM merge_pairs_99);

  RAISE NOTICE '[00099] Backups: shipment_registry_00099_backup, deal_shipment_prices_00099_backup';

  -- =========================================================
  -- 4. Disable ONLY the chat/activity + autoprice triggers
  --    (audit_log + updated_at + rollup STAY enabled)
  -- =========================================================
  ALTER TABLE shipment_registry  DISABLE TRIGGER trg_shipment_registry_activity;
  ALTER TABLE shipment_registry  DISABLE TRIGGER trg_autoprice_registry_insert;
  ALTER TABLE shipment_registry  DISABLE TRIGGER trg_autoprice_registry_update;

  -- =========================================================
  -- 5. Move deal_shipment_prices from drop → keep
  --    (so both sides of СНТ pricing stay attached to the merged row)
  -- =========================================================
  UPDATE deal_shipment_prices dsp
  SET shipment_registry_id = mp.keep_id
  FROM merge_pairs_99 mp
  WHERE dsp.shipment_registry_id = mp.drop_id;

  GET DIAGNOSTICS v_moved_prices = ROW_COUNT;
  RAISE NOTICE '[00099] Moved % deal_shipment_prices rows', v_moved_prices;

  -- =========================================================
  -- 6. Merge keep row: COALESCE every potentially-conflicting field.
  --    Pre-analysis confirmed 0 conflicts on invoice/comment/appendix/
  --    amount in production, so COALESCE is loss-free.
  -- =========================================================
  UPDATE shipment_registry kr
  SET
    loading_volume                  = COALESCE(kr.loading_volume,                  dr.loading_volume),
    shipment_volume                 = COALESCE(kr.shipment_volume,                 dr.shipment_volume),
    invoice_number                  = COALESCE(kr.invoice_number,                  dr.invoice_number),
    comment                         = COALESCE(kr.comment,                         dr.comment),
    supplier_appendix               = COALESCE(kr.supplier_appendix,               dr.supplier_appendix),
    buyer_appendix                  = COALESCE(kr.buyer_appendix,                  dr.buyer_appendix),
    shipped_tonnage_amount          = COALESCE(kr.shipped_tonnage_amount,          dr.shipped_tonnage_amount),
    shipped_tonnage_amount_override = COALESCE(kr.shipped_tonnage_amount_override, dr.shipped_tonnage_amount_override),
    railway_tariff                  = COALESCE(kr.railway_tariff,                  dr.railway_tariff),
    rounded_tonnage_from_forwarder  = COALESCE(kr.rounded_tonnage_from_forwarder,  dr.rounded_tonnage_from_forwarder),
    rounded_volume_override         = COALESCE(kr.rounded_volume_override,         dr.rounded_volume_override),
    round_volume                    = COALESCE(kr.round_volume,                    dr.round_volume),
    fuel_type_id                    = COALESCE(kr.fuel_type_id,                    dr.fuel_type_id),
    factory_id                      = COALESCE(kr.factory_id,                      dr.factory_id),
    supplier_id                     = COALESCE(kr.supplier_id,                     dr.supplier_id),
    buyer_id                        = COALESCE(kr.buyer_id,                        dr.buyer_id),
    forwarder_id                    = COALESCE(kr.forwarder_id,                    dr.forwarder_id),
    company_group_id                = COALESCE(kr.company_group_id,                dr.company_group_id),
    destination_station_id          = COALESCE(kr.destination_station_id,          dr.destination_station_id),
    departure_station_id            = COALESCE(kr.departure_station_id,            dr.departure_station_id),
    additional_month                = COALESCE(kr.additional_month,                dr.additional_month),
    shipment_month                  = COALESCE(kr.shipment_month,                  dr.shipment_month),
    currency                        = COALESCE(kr.currency,                        dr.currency)
  FROM merge_pairs_99 mp
  JOIN shipment_registry dr ON dr.id = mp.drop_id
  WHERE kr.id = mp.keep_id;

  GET DIAGNOSTICS v_updated_keep = ROW_COUNT;
  RAISE NOTICE '[00099] Merged into % keep rows', v_updated_keep;

  -- =========================================================
  -- 7. Delete drop rows
  -- =========================================================
  DELETE FROM shipment_registry sr
  USING merge_pairs_99 mp
  WHERE sr.id = mp.drop_id;

  GET DIAGNOSTICS v_deleted_drop = ROW_COUNT;
  RAISE NOTICE '[00099] Deleted % drop rows', v_deleted_drop;

  -- =========================================================
  -- 8. Re-enable triggers
  -- =========================================================
  ALTER TABLE shipment_registry  ENABLE TRIGGER trg_shipment_registry_activity;
  ALTER TABLE shipment_registry  ENABLE TRIGGER trg_autoprice_registry_insert;
  ALTER TABLE shipment_registry  ENABLE TRIGGER trg_autoprice_registry_update;

  -- =========================================================
  -- 9. Refresh rollups manually for every affected deal.
  --    refresh_deal_shipment_totals  →  deals.{buyer,supplier}_shipped_*
  --    refresh_deal_price_totals     →  deal_shipment_prices side sums
  --    (defined in 00027/00044 and 00030 respectively).
  -- =========================================================
  DECLARE
    rec RECORD;
    v_count INT := 0;
  BEGIN
    FOR rec IN SELECT DISTINCT deal_id FROM merge_pairs_99 LOOP
      PERFORM refresh_deal_shipment_totals(rec.deal_id);
      PERFORM refresh_deal_price_totals(rec.deal_id);
      v_count := v_count + 1;
    END LOOP;
    v_refresh_count := v_count;
    RAISE NOTICE '[00099] Refreshed rollups on % deals', v_refresh_count;
  END;

  RAISE NOTICE '[00099] DONE: pairs=% moved_prices=% updated=% deleted=% rollup_refreshed=%',
    v_pair_count, v_moved_prices, v_updated_keep, v_deleted_drop, v_refresh_count;
END $$;

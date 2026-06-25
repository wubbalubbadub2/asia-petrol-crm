-- 00098_revert_00097_autoprice_duplicates.sql
--
-- Migration 00097 backfilled shipment_registry.loading_volume on
-- ~1216 historical rows. It disabled trg_shipment_registry_activity
-- to keep the chat clean, but left the autoprice triggers ENABLED.
-- As a side effect, each UPDATE fired an autoprice trigger that
-- INSERTed a new supplier-side row into deal_shipment_prices.
-- Net result: deals.supplier_shipped_amount roughly doubled on ~80
-- deals — отгр. сумма стала вдвое больше оплаты.
--
-- This migration reverts ONLY that side effect. It identifies the
-- offending rows via audit_log (the only place where service-role
-- INSERTs are distinguishable from user UI activity) and deletes
-- them. It does NOT touch anything a user added.
--
-- Identification criteria (intersection — all must hold):
--   • audit_log.table_name = 'deal_shipment_prices'
--   • audit_log.op         = 'INSERT'
--   • audit_log.user_id   IS NULL                 ← only service role
--   • audit_log.changed_at ∈ [2026-06-24 16:23:00Z, 16:24:00Z)
--                                                 ← the exact minute
--                                                   00097 ran (a single
--                                                   transactional burst)
--
-- Verified before writing this migration:
--   • Total matching audit_log rows: 1216
--   • All 1216 are side='supplier' (no buyer-side rows touched)
--   • All 1216 row_ids unique
--
-- Safety rails:
--   • Backup table deal_shipment_prices_00098_backup is created
--     with full row copies BEFORE the DELETE. To roll back manually:
--       INSERT INTO deal_shipment_prices SELECT * FROM
--       deal_shipment_prices_00098_backup
--       WHERE id NOT IN (SELECT id FROM deal_shipment_prices);
--   • Rollup trigger refresh_deal_price_totals stays ENABLED so
--     deals.supplier_shipped_amount/_volume recompute automatically
--     after the DELETE → balance returns to its pre-00097 value.
--   • The audit_log trigger stays ENABLED — the DELETE itself is
--     auditable (you'll see 1216 DELETE rows in audit_log with the
--     migration timestamp and user_id IS NULL).
--   • IF NOT EXISTS on the backup table makes the migration safe to
--     re-run: backup is preserved, second DELETE finds 0 rows.

DO $$
DECLARE
  v_backed_up INTEGER;
  v_deleted   INTEGER;
BEGIN
  -- 1. Backup: snapshot the rows we are about to delete.
  CREATE TABLE IF NOT EXISTS deal_shipment_prices_00098_backup AS
  SELECT dsp.*
  FROM deal_shipment_prices dsp
  WHERE dsp.id IN (
    SELECT row_id
    FROM audit_log
    WHERE table_name = 'deal_shipment_prices'
      AND op         = 'INSERT'
      AND user_id   IS NULL
      AND changed_at >= '2026-06-24 16:23:00+00'::timestamptz
      AND changed_at <  '2026-06-24 16:24:00+00'::timestamptz
  );

  GET DIAGNOSTICS v_backed_up = ROW_COUNT;
  RAISE NOTICE '[00098] Backed up % rows into deal_shipment_prices_00098_backup', v_backed_up;

  -- 2. Delete the duplicates. Rollup trigger fires per row and
  --    refreshes deals.supplier_shipped_amount/_volume.
  DELETE FROM deal_shipment_prices
  WHERE id IN (
    SELECT row_id
    FROM audit_log
    WHERE table_name = 'deal_shipment_prices'
      AND op         = 'INSERT'
      AND user_id   IS NULL
      AND changed_at >= '2026-06-24 16:23:00+00'::timestamptz
      AND changed_at <  '2026-06-24 16:24:00+00'::timestamptz
  );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE '[00098] Deleted % duplicate supplier-side deal_shipment_prices rows', v_deleted;
END $$;

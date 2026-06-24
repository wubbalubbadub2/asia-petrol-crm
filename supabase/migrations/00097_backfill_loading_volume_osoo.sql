-- 00097_backfill_loading_volume_osoo.sql
--
-- One-shot backfill: copy shipment_volume → loading_volume on every
-- existing shipment_registry row whose parent deal has BOTH chain
-- position 1 AND position 2 occupied by an «ОсОО»- or
-- «Singularity»-flavoured company. Operator request 2026-06-24: the
-- bulk-add dialog now has a «Продублировать отгрузку» checkbox; this
-- migration retroactively applies the same rule to all historical
-- data so the registry isn't full of one-sided rows for those deals.
--
-- Match criterion (per position):
--   company_groups.full_name (case-insensitive) contains any of
--     • «ОсОО»          (Cyrillic — most common in legal-form prefix)
--     • «OsOO»          (Latin transliteration, defensive)
--     • «Singularity»   (Latin — Singularity Trading GmbH)
--     • «Сингулярити»   (Cyrillic transliteration, defensive)
--   Also checked against company_groups.name as a fallback in case
--   the legal-form prefix lives there instead. Operator confirmed
--   the spravochnik уже хранит full_name with the «ОсОО» prefix —
--   matching both columns is paranoid but cheap.
--
-- Behaviour:
--   • Only rows with loading_volume IS NULL are touched (we never
--     overwrite a value the operator has already typed).
--   • shipment_volume must be NOT NULL (nothing to copy otherwise).
--   • The shipment-activity trigger from 00096 is disabled around
--     the UPDATE — otherwise this migration would flood every
--     affected deal's chat with «Изменена отгрузка» events for what
--     is really a one-time admin operation. Rollup triggers
--     (refresh_deal_shipment_totals etc) STAY active so
--     supplier_shipped_volume gets recomputed correctly.
--   • The audit_log trigger stays active too — the change IS
--     auditable; we just don't want it as conversational chat noise.

DO $$
DECLARE
  v_affected INTEGER;
BEGIN
  -- Pre-count to surface in the migration log
  SELECT COUNT(*)
    INTO v_affected
  FROM shipment_registry sr
  WHERE sr.loading_volume IS NULL
    AND sr.shipment_volume IS NOT NULL
    AND sr.deal_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM deal_company_groups dcg1
      JOIN company_groups cg1 ON cg1.id = dcg1.company_group_id
      WHERE dcg1.deal_id = sr.deal_id
        AND dcg1.position = 1
        AND (
          COALESCE(cg1.full_name, '') ILIKE '%ОсОО%'
          OR COALESCE(cg1.full_name, '') ILIKE '%OsOO%'
          OR COALESCE(cg1.full_name, '') ILIKE '%Singularity%'
          OR COALESCE(cg1.full_name, '') ILIKE '%Сингулярити%'
          OR COALESCE(cg1.name, '') ILIKE '%ОсОО%'
          OR COALESCE(cg1.name, '') ILIKE '%OsOO%'
          OR COALESCE(cg1.name, '') ILIKE '%Singularity%'
          OR COALESCE(cg1.name, '') ILIKE '%Сингулярити%'
        )
    )
    AND EXISTS (
      SELECT 1
      FROM deal_company_groups dcg2
      JOIN company_groups cg2 ON cg2.id = dcg2.company_group_id
      WHERE dcg2.deal_id = sr.deal_id
        AND dcg2.position = 2
        AND (
          COALESCE(cg2.full_name, '') ILIKE '%ОсОО%'
          OR COALESCE(cg2.full_name, '') ILIKE '%OsOO%'
          OR COALESCE(cg2.full_name, '') ILIKE '%Singularity%'
          OR COALESCE(cg2.full_name, '') ILIKE '%Сингулярити%'
          OR COALESCE(cg2.name, '') ILIKE '%ОсОО%'
          OR COALESCE(cg2.name, '') ILIKE '%OsOO%'
          OR COALESCE(cg2.name, '') ILIKE '%Singularity%'
          OR COALESCE(cg2.name, '') ILIKE '%Сингулярити%'
        )
    );

  RAISE NOTICE '[00097] About to backfill loading_volume on % shipment_registry rows', v_affected;

  -- Mute the activity-chat trigger only — keep audit + rollups live.
  ALTER TABLE shipment_registry DISABLE TRIGGER trg_shipment_registry_activity;

  UPDATE shipment_registry sr
  SET loading_volume = sr.shipment_volume
  WHERE sr.loading_volume IS NULL
    AND sr.shipment_volume IS NOT NULL
    AND sr.deal_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM deal_company_groups dcg1
      JOIN company_groups cg1 ON cg1.id = dcg1.company_group_id
      WHERE dcg1.deal_id = sr.deal_id
        AND dcg1.position = 1
        AND (
          COALESCE(cg1.full_name, '') ILIKE '%ОсОО%'
          OR COALESCE(cg1.full_name, '') ILIKE '%OsOO%'
          OR COALESCE(cg1.full_name, '') ILIKE '%Singularity%'
          OR COALESCE(cg1.full_name, '') ILIKE '%Сингулярити%'
          OR COALESCE(cg1.name, '') ILIKE '%ОсОО%'
          OR COALESCE(cg1.name, '') ILIKE '%OsOO%'
          OR COALESCE(cg1.name, '') ILIKE '%Singularity%'
          OR COALESCE(cg1.name, '') ILIKE '%Сингулярити%'
        )
    )
    AND EXISTS (
      SELECT 1
      FROM deal_company_groups dcg2
      JOIN company_groups cg2 ON cg2.id = dcg2.company_group_id
      WHERE dcg2.deal_id = sr.deal_id
        AND dcg2.position = 2
        AND (
          COALESCE(cg2.full_name, '') ILIKE '%ОсОО%'
          OR COALESCE(cg2.full_name, '') ILIKE '%OsOO%'
          OR COALESCE(cg2.full_name, '') ILIKE '%Singularity%'
          OR COALESCE(cg2.full_name, '') ILIKE '%Сингулярити%'
          OR COALESCE(cg2.name, '') ILIKE '%ОсОО%'
          OR COALESCE(cg2.name, '') ILIKE '%OsOO%'
          OR COALESCE(cg2.name, '') ILIKE '%Singularity%'
          OR COALESCE(cg2.name, '') ILIKE '%Сингулярити%'
        )
    );

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RAISE NOTICE '[00097] Backfilled loading_volume on % shipment_registry rows', v_affected;

  ALTER TABLE shipment_registry ENABLE TRIGGER trg_shipment_registry_activity;
END $$;

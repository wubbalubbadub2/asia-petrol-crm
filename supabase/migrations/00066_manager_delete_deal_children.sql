-- Allow manager / logistics roles to DELETE rows from deal-child tables.
--
-- Per client (2026-05-13): «Редактирование сделки менеджера не могут
-- делать». RLS on `deals.UPDATE` already permits manager via
-- is_writable_role(), so simple field edits work — but every DELETE
-- policy on the deal's child tables was admin-only. When a manager
-- tries to remove a variant, payment, document, or registry row, RLS
-- denies the DELETE and the UI surfaces a toast that reads to them as
-- «не могу редактировать».
--
-- This migration replaces the admin-only DELETE policy with one that
-- accepts is_writable_role() (admin + manager + logistics) on:
--   deal_supplier_lines, deal_buyer_lines, deal_payments,
--   deal_company_groups, deal_attachments, deal_shipment_prices,
--   shipment_registry, application_deals.
--
-- `deals` itself stays admin-only on DELETE — removing the whole deal
-- cascades through every child row + storage objects + audit log and
-- is intentionally locked behind admin. Managers can still edit every
-- field and remove individual children.

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'deal_supplier_lines',
    'deal_buyer_lines',
    'deal_payments',
    'deal_company_groups',
    'deal_attachments',
    'deal_shipment_prices',
    'shipment_registry',
    'application_deals'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "admin_delete_%s" ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "writable_delete_%s" ON %I FOR DELETE USING (is_writable_role())',
      tbl, tbl
    );
  END LOOP;
END $$;

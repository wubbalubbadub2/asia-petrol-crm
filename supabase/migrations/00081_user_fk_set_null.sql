-- Make user deletion possible without breaking historical records.
--
-- ROOT CAUSE
-- ──────────
-- Supabase's `auth.admin.deleteUser` issues DELETE FROM auth.users,
-- which cascades to profiles via the ON DELETE CASCADE on profiles.id.
-- But ~17 other FKs reference `profiles(id)` (and one references
-- `auth.users(id)` directly) without any ON DELETE clause — meaning
-- Postgres defaults to NO ACTION and refuses the delete whenever the
-- target user has touched any deal / application / payment / document.
--
-- That surfaced in the admin UI as a generic
-- «Database error deleting user».
--
-- FIX
-- ───
-- Rewrite every user-pointing FK as ON DELETE SET NULL. Historical
-- rows (the deals the user created, the documents they imported, the
-- audit-log entries they generated) all stay intact; only the
-- created_by / manager_id / user_id pointer is nulled out when the
-- user is gone. The only exception is `profiles.id → auth.users.id`
-- itself, which keeps its ON DELETE CASCADE (that's how the profile
-- row disappears when the auth user is deleted in the first place).
--
-- IDEMPOTENT — dropping with IF EXISTS, then re-adding is safe to
-- re-run; if a future migration adds a new user-pointing FK, append
-- it here.

BEGIN;

-- ── References to profiles(id) ─────────────────────────────────────

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_supplier_manager_id_fkey;
ALTER TABLE deals ADD CONSTRAINT deals_supplier_manager_id_fkey
  FOREIGN KEY (supplier_manager_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_buyer_manager_id_fkey;
ALTER TABLE deals ADD CONSTRAINT deals_buyer_manager_id_fkey
  FOREIGN KEY (buyer_manager_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_trader_id_fkey;
ALTER TABLE deals ADD CONSTRAINT deals_trader_id_fkey
  FOREIGN KEY (trader_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_created_by_fkey;
ALTER TABLE deals ADD CONSTRAINT deals_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_assigned_manager_id_fkey;
ALTER TABLE applications ADD CONSTRAINT applications_assigned_manager_id_fkey
  FOREIGN KEY (assigned_manager_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_assigned_by_fkey;
ALTER TABLE applications ADD CONSTRAINT applications_assigned_by_fkey
  FOREIGN KEY (assigned_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_created_by_fkey;
ALTER TABLE quotations ADD CONSTRAINT quotations_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE shipment_registry DROP CONSTRAINT IF EXISTS shipment_registry_created_by_fkey;
ALTER TABLE shipment_registry ADD CONSTRAINT shipment_registry_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE snt_documents DROP CONSTRAINT IF EXISTS snt_documents_imported_by_fkey;
ALTER TABLE snt_documents ADD CONSTRAINT snt_documents_imported_by_fkey
  FOREIGN KEY (imported_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE esf_documents DROP CONSTRAINT IF EXISTS esf_documents_imported_by_fkey;
ALTER TABLE esf_documents ADD CONSTRAINT esf_documents_imported_by_fkey
  FOREIGN KEY (imported_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE deal_attachments DROP CONSTRAINT IF EXISTS deal_attachments_uploaded_by_fkey;
ALTER TABLE deal_attachments ADD CONSTRAINT deal_attachments_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE archive DROP CONSTRAINT IF EXISTS archive_archived_by_fkey;
ALTER TABLE archive ADD CONSTRAINT archive_archived_by_fkey
  FOREIGN KEY (archived_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE dt_kt_payments DROP CONSTRAINT IF EXISTS dt_kt_payments_created_by_fkey;
ALTER TABLE dt_kt_payments ADD CONSTRAINT dt_kt_payments_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE deal_activity_feed DROP CONSTRAINT IF EXISTS deal_activity_feed_user_id_fkey;
ALTER TABLE deal_activity_feed ADD CONSTRAINT deal_activity_feed_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE deal_payments DROP CONSTRAINT IF EXISTS deal_payments_created_by_fkey;
ALTER TABLE deal_payments ADD CONSTRAINT deal_payments_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE deal_shipment_prices DROP CONSTRAINT IF EXISTS deal_shipment_prices_created_by_fkey;
ALTER TABLE deal_shipment_prices ADD CONSTRAINT deal_shipment_prices_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- ── References to auth.users(id) ───────────────────────────────────

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;

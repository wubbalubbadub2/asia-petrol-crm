-- Fix latent bug caught by the TypeScript type generator: `deal_activity` was
-- originally scoped to deals (`deal_id` NOT NULL), but 00017 added
-- `application_id` so the feed could be reused for applications. The original
-- NOT NULL was never relaxed, so application-scoped inserts would fail at the
-- DB level. Make `deal_id` nullable and add a CHECK so at least one is set.

ALTER TABLE deal_activity ALTER COLUMN deal_id DROP NOT NULL;

ALTER TABLE deal_activity
  ADD CONSTRAINT deal_activity_scope_check
  CHECK (deal_id IS NOT NULL OR application_id IS NOT NULL);

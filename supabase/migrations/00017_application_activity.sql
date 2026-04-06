-- Add application_id to deal_activity for application-level chat
-- Makes the activity feed reusable for both deals and applications
ALTER TABLE deal_activity ADD COLUMN IF NOT EXISTS application_id UUID REFERENCES applications(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_deal_activity_application ON deal_activity(application_id);

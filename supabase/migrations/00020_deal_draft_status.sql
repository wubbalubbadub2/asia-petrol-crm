-- Add draft status to deals for auto-save before full creation
ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT false;

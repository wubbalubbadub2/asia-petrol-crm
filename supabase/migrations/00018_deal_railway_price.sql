-- Add railway-in-price flag to deals
ALTER TABLE deals ADD COLUMN IF NOT EXISTS railway_in_price BOOLEAN DEFAULT false;

-- Add explicit currency field to deals
-- Previously derived from deal_type (KG=USD, KZ=KZT) but need KGS, RUB too
ALTER TABLE deals ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';

-- Set defaults based on existing deal_type
UPDATE deals SET currency = 'KZT' WHERE deal_type = 'KZ' AND (currency IS NULL OR currency = 'USD');
UPDATE deals SET currency = 'USD' WHERE deal_type = 'KG' AND currency IS NULL;

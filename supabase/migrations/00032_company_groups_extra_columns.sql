-- Add counterparty-style columns to company_groups
ALTER TABLE company_groups ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE company_groups ADD COLUMN IF NOT EXISTS short_name TEXT;
ALTER TABLE company_groups ADD COLUMN IF NOT EXISTS legal_address TEXT;

-- Copy existing name to full_name where full_name is null
UPDATE company_groups SET full_name = name WHERE full_name IS NULL;

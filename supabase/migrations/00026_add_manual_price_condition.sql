-- Add 'manual' to price_condition enum
-- The UI has "Вручную" option but the DB enum only had 3 values
ALTER TYPE price_condition ADD VALUE IF NOT EXISTS 'manual';

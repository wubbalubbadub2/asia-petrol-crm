-- Per-payment currency.
-- Payments arrive in different currencies — NULL falls back to the deal's currency.
ALTER TABLE deal_payments   ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE dt_kt_payments  ADD COLUMN IF NOT EXISTS currency TEXT;

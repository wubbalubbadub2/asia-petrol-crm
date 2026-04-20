-- Client request (2026-04-20): deal codes should follow the 1C format
-- TYPE/YY/NNN — pipeline code, two-digit year, zero-padded three-digit
-- number. Examples: KG/26/006, KZ/26/012.
--
-- Previous format from migration 00003 was TYPE/NUMBER/YY
-- (e.g. KG/7/26). Same data, different ordering and padding.

CREATE OR REPLACE FUNCTION compute_deal_code()
RETURNS TRIGGER AS $$
BEGIN
  NEW.deal_code := NEW.deal_type::TEXT
    || '/' || LPAD((NEW.year % 100)::TEXT, 2, '0')
    || '/' || LPAD(NEW.deal_number::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill existing deal_codes. The BEFORE UPDATE trigger fires on any
-- update of the deals row — nudging updated_at forces recomputation
-- without changing any business field. audit_trigger explicitly skips
-- rows whose only diff is updated_at, so this backfill doesn't flood
-- the audit log (it still records the one real change: deal_code
-- moving from old format to new, which is exactly the trail we want).
UPDATE deals SET updated_at = now();

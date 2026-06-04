-- 1. Align KZ/2026 deal-number sequence to 190.
--
-- Operator imported deals from the legacy system up to KZ/26/190 and
-- wants the next generated deal number to be 191. `generate_deal_number`
-- does ON CONFLICT DO UPDATE SET last_number = last_number + 1, so
-- forcing last_number to 190 makes the very next call return 191.
-- GREATEST guards against the sequence already being ahead — never
-- move it backwards.

INSERT INTO deal_sequences (deal_type, year, last_number)
VALUES ('KZ', 2026, 190)
ON CONFLICT (deal_type, year)
DO UPDATE SET last_number = GREATEST(deal_sequences.last_number, EXCLUDED.last_number);

-- 2. Quotation + discount on per-deal company group rows.
--
-- Mirrors the supplier/buyer price shape: котировка → скидка → цена.
-- price_kind (preliminary/final) already exists from 00084; the new
-- columns let the operator capture how the price was derived. Nullable
-- so existing rows stay untouched.

ALTER TABLE deal_company_groups
  ADD COLUMN IF NOT EXISTS quotation NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS quotation_comment TEXT,
  ADD COLUMN IF NOT EXISTS discount NUMERIC(14,4);

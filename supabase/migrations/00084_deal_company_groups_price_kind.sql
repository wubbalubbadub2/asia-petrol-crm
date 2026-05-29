-- Add «предварительная / окончательная» kind to per-deal company-group price.
--
-- Each `deal_company_groups` row currently has a single nullable `price`
-- column. The client wants the manager to flag whether that figure is the
-- preliminary number (locked in at deal time) or the final settled price.
--
-- One column + dropdown — chosen over two separate price columns because
-- there's typically only one «live» price at a time and the manager just
-- replaces the value when it transitions from предв. → оконч.
--
-- Default 'preliminary' so existing rows are interpreted correctly without
-- a backfill — every legacy entry was effectively a предварительная цена.

ALTER TABLE deal_company_groups
  ADD COLUMN IF NOT EXISTS price_kind TEXT NOT NULL DEFAULT 'preliminary'
    CHECK (price_kind IN ('preliminary', 'final'));

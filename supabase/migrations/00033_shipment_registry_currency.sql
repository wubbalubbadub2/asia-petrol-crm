-- Per-shipment currency override.
-- NULL means "inherit from deal.currency" so existing rows stay valid.
ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS currency TEXT;

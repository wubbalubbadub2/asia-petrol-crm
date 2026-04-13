-- Add missing registry columns from Excel:
-- "Налив тонн" (loading volume), "группа компании" per shipment, "месяц доп"

ALTER TABLE shipment_registry ADD COLUMN IF NOT EXISTS loading_volume DECIMAL(14,6);
ALTER TABLE shipment_registry ADD COLUMN IF NOT EXISTS company_group_id UUID REFERENCES company_groups(id);
ALTER TABLE shipment_registry ADD COLUMN IF NOT EXISTS additional_month TEXT;

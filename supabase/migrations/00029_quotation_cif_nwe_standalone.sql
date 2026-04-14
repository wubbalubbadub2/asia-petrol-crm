-- Add standalone CIF NWE column for products like ГАЗОЙЛЬ
-- Excel has separate "CIF NWE" column distinct from "CIF NWE/Basis ARA"
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS price_cif_nwe_standalone DECIMAL(12,4);

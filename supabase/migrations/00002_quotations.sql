-- Asia Petrol CRM: Quotation Tables (Котировки)

-- Quotation product types (more granular than fuel types)
CREATE TABLE quotation_product_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_type_id UUID REFERENCES fuel_types(id),
  name TEXT NOT NULL,
  sub_name TEXT,
  basis TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_quotation_product_types_updated BEFORE UPDATE ON quotation_product_types FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Daily quotation prices
CREATE TABLE quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type_id UUID NOT NULL REFERENCES quotation_product_types(id),
  date DATE NOT NULL,
  price DECIMAL(12,4),
  price_fob_med DECIMAL(12,4),
  price_fob_rotterdam DECIMAL(12,4),
  price_cif_nwe DECIMAL(12,4),
  comment TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(product_type_id, date)
);

CREATE INDEX idx_quotations_date ON quotations(date);
CREATE INDEX idx_quotations_product ON quotations(product_type_id);
CREATE TRIGGER trg_quotations_updated BEFORE UPDATE ON quotations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Monthly quotation averages
CREATE TABLE quotation_monthly_averages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type_id UUID NOT NULL REFERENCES quotation_product_types(id),
  year INT NOT NULL,
  month INT NOT NULL,
  avg_price DECIMAL(12,4),
  avg_fob_med DECIMAL(12,4),
  avg_fob_rotterdam DECIMAL(12,4),
  avg_cif_nwe DECIMAL(12,4),
  avg_combined DECIMAL(12,4),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(product_type_id, year, month)
);

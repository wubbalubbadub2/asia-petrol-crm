-- Asia Petrol CRM: Applications (Заявки)

CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_number TEXT,
  date DATE NOT NULL,

  -- From buyer PDF
  fuel_type_id UUID REFERENCES fuel_types(id),
  product_name TEXT,
  tonnage DECIMAL(14,4),
  destination_station_id UUID REFERENCES stations(id),
  station_code TEXT,
  siding TEXT,

  -- Consignee details
  consignee_name TEXT,
  consignee_bin TEXT,
  consignee_code_4 TEXT,
  consignee_code_12 TEXT,
  consignee_legal_address TEXT,
  consignee_postal_address TEXT,

  -- Consignor / Carrier
  consignor TEXT,
  carrier TEXT,
  wagon_operator TEXT,
  tariff_payer TEXT,

  -- Buyer for SNT
  buyer_name_for_snt TEXT,
  buyer_bin_for_snt TEXT,
  delivery_address_for_snt TEXT,
  tax_authority_code TEXT,
  virtual_warehouse_id TEXT,
  virtual_warehouse_name TEXT,

  -- Status
  is_ordered BOOLEAN DEFAULT false,

  -- Assignment
  assigned_manager_id UUID REFERENCES profiles(id),
  assigned_by UUID REFERENCES profiles(id),

  -- PDF source
  pdf_file_path TEXT,
  source_email TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_applications_ordered ON applications(is_ordered);
CREATE INDEX idx_applications_manager ON applications(assigned_manager_id);
CREATE TRIGGER trg_applications_updated BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Application <-> Deal mapping (M:N)
CREATE TABLE application_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  allocated_volume DECIMAL(14,4),
  UNIQUE(application_id, deal_id)
);

CREATE INDEX idx_application_deals_app ON application_deals(application_id);
CREATE INDEX idx_application_deals_deal ON application_deals(deal_id);

-- Asia Petrol CRM: SNT/ESF Documents + Attachments

-- SNT documents (imported from 1C)
CREATE TABLE snt_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id),
  snt_number TEXT,
  registration_number TEXT,
  shipment_date DATE,
  registration_datetime TIMESTAMPTZ,
  supplier_bin TEXT,
  supplier_name TEXT,
  receiver_bin TEXT,
  receiver_name TEXT,
  goods_description TEXT,
  quantity DECIMAL(14,4),
  unit TEXT,
  price_per_unit DECIMAL(14,4),
  total_amount DECIMAL(14,4),
  source_file_path TEXT,
  imported_at TIMESTAMPTZ DEFAULT now(),
  imported_by UUID REFERENCES profiles(id),
  raw_data JSONB
);

CREATE INDEX idx_snt_deal ON snt_documents(deal_id);
CREATE INDEX idx_snt_supplier_bin ON snt_documents(supplier_bin);

-- ESF documents (imported from 1C)
CREATE TABLE esf_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id),
  registration_number TEXT,
  account_system_number TEXT,
  issue_date DATE,
  turnover_date DATE,
  supplier_bin TEXT,
  supplier_name TEXT,
  supplier_address TEXT,
  receiver_bin TEXT,
  receiver_name TEXT,
  goods_description TEXT,
  quantity DECIMAL(14,4),
  price_per_unit DECIMAL(14,4),
  total_without_tax DECIMAL(14,4),
  tax_amount DECIMAL(14,4),
  total_with_tax DECIMAL(14,4),
  source_file_path TEXT,
  imported_at TIMESTAMPTZ DEFAULT now(),
  imported_by UUID REFERENCES profiles(id),
  raw_data JSONB
);

CREATE INDEX idx_esf_deal ON esf_documents(deal_id);
CREATE INDEX idx_esf_supplier_bin ON esf_documents(supplier_bin);

-- Deal attachments (file uploads)
CREATE TABLE deal_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'application', 'contract', 'appendix', 'snt', 'esf',
    'waybill', 'act_completed_works', 'invoice', 'quality_cert',
    'reconciliation_act', 'other'
  )),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INT,
  mime_type TEXT,
  uploaded_by UUID REFERENCES profiles(id),
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_deal_attachments_deal ON deal_attachments(deal_id);

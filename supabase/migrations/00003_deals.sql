-- Asia Petrol CRM: Deal Passport (Паспорт сделок) - THE CORE

-- Sequence counters per deal type per year
CREATE TABLE deal_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_type deal_type NOT NULL,
  year INT NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  UNIQUE(deal_type, year)
);

-- Main deal table
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  deal_type deal_type NOT NULL,
  deal_number INT NOT NULL,
  year INT NOT NULL,
  deal_code TEXT,  -- computed by trigger: "KG/1/25"

  -- Period
  quarter TEXT,
  month TEXT NOT NULL,

  -- Core references
  factory_id UUID REFERENCES factories(id),
  fuel_type_id UUID REFERENCES fuel_types(id),
  sulfur_percent TEXT,

  -- SUPPLIER SIDE
  supplier_id UUID REFERENCES counterparties(id),
  supplier_contract TEXT,
  supplier_contracted_volume DECIMAL(14,4),
  supplier_contracted_amount DECIMAL(14,4),
  supplier_delivery_basis TEXT,
  supplier_quotation_comment TEXT,
  supplier_quotation DECIMAL(14,4),
  supplier_discount DECIMAL(14,4),
  supplier_price DECIMAL(14,4),
  supplier_price_condition price_condition,
  supplier_shipped_amount DECIMAL(14,4) DEFAULT 0,
  supplier_payment DECIMAL(14,4) DEFAULT 0,
  supplier_payment_date TEXT,
  supplier_balance DECIMAL(14,4) DEFAULT 0,

  -- BUYER SIDE
  buyer_id UUID REFERENCES counterparties(id),
  buyer_contract TEXT,
  buyer_delivery_basis TEXT,
  buyer_destination_station_id UUID REFERENCES stations(id),
  buyer_contracted_volume DECIMAL(14,4),
  buyer_contracted_amount DECIMAL(14,4),
  buyer_quotation_comment TEXT,
  buyer_quotation DECIMAL(14,4),
  buyer_discount DECIMAL(14,4),
  buyer_price DECIMAL(14,4),
  buyer_price_condition price_condition,
  buyer_ordered_volume DECIMAL(14,4),
  buyer_remaining DECIMAL(14,4),
  buyer_shipped_volume DECIMAL(14,4) DEFAULT 0,
  buyer_ship_date TEXT,
  buyer_shipped_amount DECIMAL(14,4) DEFAULT 0,
  buyer_payment DECIMAL(14,4) DEFAULT 0,
  buyer_payment_date TEXT,
  buyer_debt DECIMAL(14,4) DEFAULT 0,
  buyer_multi_deal_payments TEXT,
  buyer_snt_written TEXT,

  -- LOGISTICS
  forwarder_id UUID REFERENCES forwarders(id),
  logistics_company_group_id UUID REFERENCES company_groups(id),
  planned_tariff DECIMAL(10,4),
  preliminary_tonnage DECIMAL(14,4),
  preliminary_amount DECIMAL(14,4),
  actual_tariff DECIMAL(10,4),
  actual_shipped_volume DECIMAL(14,4),
  invoice_volume DECIMAL(14,4),
  invoice_amount DECIMAL(14,4),
  logistics_notes TEXT,

  -- SURCHARGES
  surcharge_amount DECIMAL(14,4),
  surcharge_reinvoiced_to TEXT,

  -- MANAGERS
  supplier_manager_id UUID REFERENCES profiles(id),
  buyer_manager_id UUID REFERENCES profiles(id),
  trader_id UUID REFERENCES profiles(id),

  -- Archive
  is_archived BOOLEAN DEFAULT false,
  archived_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id),

  UNIQUE(deal_type, deal_number, year)
);

CREATE INDEX idx_deals_type ON deals(deal_type);
CREATE INDEX idx_deals_year ON deals(year);
CREATE INDEX idx_deals_month ON deals(month);
CREATE INDEX idx_deals_supplier ON deals(supplier_id);
CREATE INDEX idx_deals_buyer ON deals(buyer_id);
CREATE INDEX idx_deals_archived ON deals(is_archived);
CREATE TRIGGER trg_deals_updated BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-compute deal_code
CREATE OR REPLACE FUNCTION compute_deal_code()
RETURNS TRIGGER AS $$
BEGIN
  NEW.deal_code := NEW.deal_type::TEXT || '/' || NEW.deal_number || '/' || (NEW.year % 100);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deals_code BEFORE INSERT OR UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION compute_deal_code();

-- Deal <-> Company Groups (up to 6 per deal)
CREATE TABLE deal_company_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  company_group_id UUID NOT NULL REFERENCES company_groups(id),
  position INT NOT NULL CHECK (position BETWEEN 1 AND 6),
  price DECIMAL(14,4),
  contract_ref TEXT,
  UNIQUE(deal_id, position)
);

CREATE INDEX idx_deal_company_groups_deal ON deal_company_groups(deal_id);

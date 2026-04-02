-- Cleanup any partial tables from previous attempt
DROP TABLE IF EXISTS deal_attachments CASCADE;
DROP TABLE IF EXISTS esf_documents CASCADE;
DROP TABLE IF EXISTS snt_documents CASCADE;
DROP TABLE IF EXISTS archive_years CASCADE;
DROP TABLE IF EXISTS surcharges CASCADE;
DROP TABLE IF EXISTS tariffs CASCADE;
DROP TABLE IF EXISTS dt_kt_logistics CASCADE;
DROP TABLE IF EXISTS shipment_registry CASCADE;
DROP TABLE IF EXISTS application_deals CASCADE;
DROP TABLE IF EXISTS applications CASCADE;
DROP TABLE IF EXISTS deal_company_groups CASCADE;
DROP TABLE IF EXISTS deals CASCADE;
DROP TABLE IF EXISTS deal_sequences CASCADE;
DROP TABLE IF EXISTS quotation_monthly_averages CASCADE;
DROP TABLE IF EXISTS quotations CASCADE;
DROP TABLE IF EXISTS quotation_product_types CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS regions CASCADE;
DROP TABLE IF EXISTS fuel_types CASCADE;
DROP TABLE IF EXISTS stations CASCADE;
DROP TABLE IF EXISTS forwarders CASCADE;
DROP TABLE IF EXISTS factories CASCADE;
DROP TABLE IF EXISTS company_groups CASCADE;
DROP TABLE IF EXISTS counterparties CASCADE;
DROP TYPE IF EXISTS deal_type CASCADE;
DROP TYPE IF EXISTS price_condition CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;
DROP FUNCTION IF EXISTS update_updated_at CASCADE;
DROP FUNCTION IF EXISTS handle_new_user CASCADE;
DROP FUNCTION IF EXISTS compute_deal_code CASCADE;

-- Asia Petrol CRM: Reference Data Tables (Справочник)

-- ENUM types
CREATE TYPE deal_type AS ENUM ('KG', 'KZ', 'OIL');
CREATE TYPE price_condition AS ENUM ('average_month', 'fixed', 'trigger');
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'logistics', 'accounting', 'readonly');

-- Counterparties (suppliers & buyers)
CREATE TABLE counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('supplier', 'buyer')),
  full_name TEXT NOT NULL,
  short_name TEXT,
  bin_iin TEXT,
  legal_address TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_counterparties_type ON counterparties(type);
CREATE INDEX idx_counterparties_bin ON counterparties(bin_iin);

-- Company groups (up to 6 per deal)
CREATE TABLE company_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  bin_iin TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Factories (Заводы)
CREATE TABLE factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Forwarders (Экспедиторы)
CREATE TABLE forwarders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  bin_iin TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Stations (ст. назначения / ст. отправления)
CREATE TABLE stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  type TEXT NOT NULL CHECK (type IN ('departure', 'destination', 'both')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_stations_type ON stations(type);

-- Fuel types (Вид ГСМ) with color coding
CREATE TABLE fuel_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sulfur_percent TEXT,
  color TEXT DEFAULT '#6B7280',
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Regions
CREATE TABLE regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Profiles (extends auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'readonly',
  region_id UUID REFERENCES regions(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'readonly')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER trg_counterparties_updated BEFORE UPDATE ON counterparties FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_company_groups_updated BEFORE UPDATE ON company_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_factories_updated BEFORE UPDATE ON factories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_forwarders_updated BEFORE UPDATE ON forwarders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_stations_updated BEFORE UPDATE ON stations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_fuel_types_updated BEFORE UPDATE ON fuel_types FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
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
-- Asia Petrol CRM: Shipment Registry (Реестр отгрузки)

CREATE TABLE shipment_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  registry_type deal_type NOT NULL,
  row_number INT,
  quarter TEXT,
  month TEXT,
  date DATE,
  waybill_number TEXT,
  wagon_number TEXT,
  shipment_volume DECIMAL(14,6),
  destination_station_id UUID REFERENCES stations(id),
  departure_station_id UUID REFERENCES stations(id),
  fuel_type_id UUID REFERENCES fuel_types(id),
  deal_id UUID REFERENCES deals(id),
  factory_id UUID REFERENCES factories(id),
  supplier_id UUID REFERENCES counterparties(id),
  forwarder_id UUID REFERENCES forwarders(id),
  shipment_month TEXT,
  railway_tariff DECIMAL(10,4),
  buyer_id UUID REFERENCES counterparties(id),
  rounded_tonnage_from_forwarder DECIMAL(14,4),
  shipped_tonnage_amount DECIMAL(14,4),
  invoice_number TEXT,
  comment TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_shipment_registry_deal ON shipment_registry(deal_id);
CREATE INDEX idx_shipment_registry_date ON shipment_registry(date);
CREATE INDEX idx_shipment_registry_type ON shipment_registry(registry_type);
CREATE INDEX idx_shipment_registry_forwarder ON shipment_registry(forwarder_id);
CREATE TRIGGER trg_shipment_registry_updated BEFORE UPDATE ON shipment_registry FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- Asia Petrol CRM: DT-KT Logistics + Tariffs

-- DT-KT Logistics (per forwarder, per company group, per year)
CREATE TABLE dt_kt_logistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forwarder_id UUID NOT NULL REFERENCES forwarders(id),
  company_group_id UUID NOT NULL REFERENCES company_groups(id),
  year INT NOT NULL,

  opening_balance DECIMAL(14,4) DEFAULT 0,
  payment DECIMAL(14,4) DEFAULT 0,
  refund DECIMAL(14,4) DEFAULT 0,
  fines DECIMAL(14,4) DEFAULT 0,
  surcharge_preliminary DECIMAL(14,4) DEFAULT 0,
  ogem DECIMAL(14,4) DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(forwarder_id, company_group_id, year)
);

CREATE TRIGGER trg_dt_kt_updated BEFORE UPDATE ON dt_kt_logistics FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Tariffs (Тарифы)
CREATE TABLE tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_station_id UUID REFERENCES stations(id),
  departure_station_id UUID REFERENCES stations(id),
  forwarder_id UUID REFERENCES forwarders(id),
  fuel_type_id UUID REFERENCES fuel_types(id),
  factory_id UUID REFERENCES factories(id),
  month TEXT NOT NULL,
  year INT NOT NULL,
  planned_tariff DECIMAL(10,4),
  norm_days INT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(destination_station_id, departure_station_id, forwarder_id, fuel_type_id, month, year)
);

CREATE TRIGGER trg_tariffs_updated BEFORE UPDATE ON tariffs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- Asia Petrol CRM: Surcharges/Fines (Сверхнормативы/Штрафы)

CREATE TABLE surcharges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id),
  surcharge_code TEXT,
  reason TEXT NOT NULL,
  amount DECIMAL(14,4),
  period TEXT,
  accounted_quarter INT,
  accounted_amount_quarter DECIMAL(14,4),
  departure_station_id UUID REFERENCES stations(id),
  destination_station_id UUID REFERENCES stations(id),
  supplier_contract TEXT,
  buyer_contract TEXT,
  fuel_type_id UUID REFERENCES fuel_types(id),
  shipped_volume DECIMAL(14,4),

  -- Claim tracking
  claim_number TEXT,
  deal_passport_number TEXT,
  issued_by_name TEXT,
  issued_to_name TEXT,
  issue_date DATE,
  claimed_amount DECIMAL(14,4),
  accepted_amount DECIMAL(14,4),
  approval_status TEXT,
  paid_amount DECIMAL(14,4),
  payment_date DATE,
  remaining_debt DECIMAL(14,4),
  comment TEXT,

  -- Re-invoicing
  reinvoice_code TEXT,
  reinvoiced_to TEXT,
  reinvoice_letter TEXT,
  reinvoiced_from TEXT,
  reinvoice_date DATE,
  reinvoice_amount DECIMAL(14,4),
  reinvoice_accepted_amount DECIMAL(14,4),
  reinvoice_response_date DATE,
  reinvoice_acceptance_status TEXT,
  reinvoice_paid_amount DECIMAL(14,4),
  reinvoice_payment_date DATE,
  reinvoice_remaining_debt DECIMAL(14,4),
  reinvoice_comment TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_surcharges_deal ON surcharges(deal_id);
CREATE TRIGGER trg_surcharges_updated BEFORE UPDATE ON surcharges FOR EACH ROW EXECUTE FUNCTION update_updated_at();
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
-- Asia Petrol CRM: Year Archive

CREATE TABLE archive_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INT NOT NULL UNIQUE,
  archived_at TIMESTAMPTZ DEFAULT now(),
  archived_by UUID REFERENCES profiles(id),
  is_locked BOOLEAN DEFAULT true
);

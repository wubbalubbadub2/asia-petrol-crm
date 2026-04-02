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

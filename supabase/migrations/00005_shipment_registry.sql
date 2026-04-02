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

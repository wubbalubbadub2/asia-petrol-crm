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

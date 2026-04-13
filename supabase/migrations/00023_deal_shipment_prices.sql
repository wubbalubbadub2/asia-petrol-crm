-- Per-shipment trigger pricing
-- Each shipment batch gets its own price calculated from quotation average
-- over a trigger window (typically 35-40 days from shipment or border crossing date)

CREATE TYPE trigger_basis AS ENUM ('shipment_date', 'border_crossing_date');

-- Deal-level default trigger basis
ALTER TABLE deals ADD COLUMN IF NOT EXISTS trigger_basis trigger_basis DEFAULT 'shipment_date';

CREATE TABLE deal_shipment_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('supplier', 'buyer')),

  -- Dates
  shipment_date DATE,
  border_crossing_date DATE,
  trigger_start_date DATE,
  trigger_days INT NOT NULL DEFAULT 35,
  trigger_basis trigger_basis NOT NULL DEFAULT 'shipment_date',

  -- Pricing
  quotation_product_type_id UUID REFERENCES quotation_product_types(id),
  quotation_avg DECIMAL(14,4),
  discount DECIMAL(14,4) DEFAULT 0,
  calculated_price DECIMAL(14,4),

  -- Volume & amount
  volume DECIMAL(14,6),
  amount DECIMAL(14,4),

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_deal_shipment_prices_deal ON deal_shipment_prices(deal_id);
CREATE INDEX idx_deal_shipment_prices_side ON deal_shipment_prices(deal_id, side);

CREATE TRIGGER trg_deal_shipment_prices_updated
  BEFORE UPDATE ON deal_shipment_prices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE deal_shipment_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_deal_shipment_prices"
  ON deal_shipment_prices FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "writable_insert_deal_shipment_prices"
  ON deal_shipment_prices FOR INSERT
  WITH CHECK (is_writable_role());

CREATE POLICY "writable_update_deal_shipment_prices"
  ON deal_shipment_prices FOR UPDATE
  USING (is_writable_role());

CREATE POLICY "admin_delete_deal_shipment_prices"
  ON deal_shipment_prices FOR DELETE
  USING (is_admin());

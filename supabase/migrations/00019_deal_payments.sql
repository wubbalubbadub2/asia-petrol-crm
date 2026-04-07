-- Multiple payment entries per deal (supplier + buyer sides)
-- Replaces single supplier_payment/buyer_payment fields
CREATE TABLE IF NOT EXISTS deal_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('supplier', 'buyer')),
  amount DECIMAL(14,4) NOT NULL,
  payment_date DATE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_deal_payments_deal ON deal_payments(deal_id);
CREATE INDEX idx_deal_payments_side ON deal_payments(deal_id, side);

ALTER TABLE deal_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_deal_payments" ON deal_payments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_deal_payments" ON deal_payments FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_deal_payments" ON deal_payments FOR UPDATE USING (is_writable_role());
CREATE POLICY "admin_delete_deal_payments" ON deal_payments FOR DELETE USING (is_admin());

-- DT-KT payment entries per forwarder
CREATE TABLE IF NOT EXISTS dt_kt_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dt_kt_id UUID REFERENCES dt_kt_logistics(id) ON DELETE CASCADE,
  forwarder_id UUID NOT NULL REFERENCES forwarders(id),
  company_group_id UUID NOT NULL REFERENCES company_groups(id),
  payment_date DATE NOT NULL,
  amount DECIMAL(14,4) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_dt_kt_payments_forwarder ON dt_kt_payments(forwarder_id);

ALTER TABLE dt_kt_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_dt_kt_payments" ON dt_kt_payments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_dt_kt_payments" ON dt_kt_payments FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_dt_kt_payments" ON dt_kt_payments FOR UPDATE USING (is_writable_role());
CREATE POLICY "admin_delete_dt_kt_payments" ON dt_kt_payments FOR DELETE USING (is_admin());

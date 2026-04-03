-- Deal activity feed / chat per deal
-- Supports both user comments and system-generated events

CREATE TABLE deal_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),
  type TEXT NOT NULL DEFAULT 'comment' CHECK (type IN ('comment', 'system', 'status_change', 'payment', 'shipment', 'attachment')),
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_deal_activity_deal ON deal_activity(deal_id);
CREATE INDEX idx_deal_activity_created ON deal_activity(created_at);

-- RLS
ALTER TABLE deal_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_deal_activity" ON deal_activity FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_deal_activity" ON deal_activity FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "admin_delete_deal_activity" ON deal_activity FOR DELETE USING (is_admin());

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE deal_activity;

-- Auto-log payment changes on deals
CREATE OR REPLACE FUNCTION log_deal_payment_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.supplier_payment IS DISTINCT FROM NEW.supplier_payment AND NEW.supplier_payment IS NOT NULL THEN
    INSERT INTO deal_activity (deal_id, type, content, metadata)
    VALUES (NEW.id, 'payment',
      'Оплата поставщику: ' || NEW.supplier_payment::TEXT,
      jsonb_build_object('field', 'supplier_payment', 'old', OLD.supplier_payment, 'new', NEW.supplier_payment));
  END IF;
  IF OLD.buyer_payment IS DISTINCT FROM NEW.buyer_payment AND NEW.buyer_payment IS NOT NULL THEN
    INSERT INTO deal_activity (deal_id, type, content, metadata)
    VALUES (NEW.id, 'payment',
      'Оплата покупателя: ' || NEW.buyer_payment::TEXT,
      jsonb_build_object('field', 'buyer_payment', 'old', OLD.buyer_payment, 'new', NEW.buyer_payment));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_deal_payment_log
  AFTER UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION log_deal_payment_change();

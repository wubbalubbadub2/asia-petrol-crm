-- Audit log: trigger-based change history for money-relevant tables.
-- One row per INSERT/UPDATE/DELETE, with diff of changed columns.
-- Source of truth for "who changed what, when".

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  row_id UUID NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
  user_id UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_row JSONB,
  new_row JSONB,
  changed_fields TEXT[]
);

-- Two indexes: one for "show me the history of this particular row",
-- the other for "show me everything this user did lately" (future feature).
CREATE INDEX idx_audit_log_row ON audit_log (table_name, row_id, changed_at DESC);
CREATE INDEX idx_audit_log_user ON audit_log (user_id, changed_at DESC);

-- Generic trigger function. Works for any table that has `id UUID PRIMARY KEY`.
-- Stores full before/after snapshots as JSONB + extracts the list of columns
-- that actually changed on UPDATE (cheap string array, easy to display).
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_changed TEXT[] := NULL;
  v_old     JSONB  := NULL;
  v_new     JSONB  := NULL;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := to_jsonb(OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new := to_jsonb(NEW);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Direct assignment avoids SELECT…INTO ambiguity with SQL CREATE TABLE AS.
    v_changed := ARRAY(
      SELECT n.key
      FROM jsonb_each(v_new) n
      WHERE n.value IS DISTINCT FROM (v_old -> n.key)
        -- ignore cosmetic updated_at bumps — they'd flood the log
        AND n.key <> 'updated_at'
      ORDER BY n.key
    );
    -- If nothing meaningful changed, skip logging entirely.
    IF v_changed IS NULL OR array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO audit_log (table_name, row_id, op, user_id, old_row, new_row, changed_fields)
  VALUES (
    TG_TABLE_NAME,
    COALESCE((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid),
    TG_OP,
    auth.uid(),
    v_old,
    v_new,
    v_changed
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach to the tables that carry money/volume semantics.
-- Reference data (factories, fuel_types, ...) is intentionally not audited.
CREATE TRIGGER trg_audit_deals
  AFTER INSERT OR UPDATE OR DELETE ON deals
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_deal_payments
  AFTER INSERT OR UPDATE OR DELETE ON deal_payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_deal_shipment_prices
  AFTER INSERT OR UPDATE OR DELETE ON deal_shipment_prices
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_shipment_registry
  AFTER INSERT OR UPDATE OR DELETE ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_dt_kt_logistics
  AFTER INSERT OR UPDATE OR DELETE ON dt_kt_logistics
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_dt_kt_payments
  AFTER INSERT OR UPDATE OR DELETE ON dt_kt_payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- RLS: any authenticated user can read the log.
-- No one can INSERT/UPDATE/DELETE directly — only the trigger can write
-- (the function runs as SECURITY DEFINER so it bypasses RLS).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_audit_log"
  ON audit_log FOR SELECT
  USING (auth.uid() IS NOT NULL);
-- No INSERT/UPDATE/DELETE policies → those are denied by default.

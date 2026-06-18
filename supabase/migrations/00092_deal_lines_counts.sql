-- Counters denormalized onto deals so the passport list query doesn't
-- need the deal_supplier_lines / deal_buyer_lines embeds. Maintained
-- by triggers on those tables.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_lines_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_lines_count    INT NOT NULL DEFAULT 0;

-- Backfill
UPDATE deals d SET
  supplier_lines_count = (SELECT count(*) FROM deal_supplier_lines WHERE deal_id = d.id),
  buyer_lines_count    = (SELECT count(*) FROM deal_buyer_lines    WHERE deal_id = d.id);

-- Trigger functions
CREATE OR REPLACE FUNCTION sync_supplier_lines_count() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE deals SET supplier_lines_count = supplier_lines_count + 1 WHERE id = NEW.deal_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE deals SET supplier_lines_count = GREATEST(0, supplier_lines_count - 1) WHERE id = OLD.deal_id;
  ELSIF (TG_OP = 'UPDATE' AND OLD.deal_id IS DISTINCT FROM NEW.deal_id) THEN
    UPDATE deals SET supplier_lines_count = GREATEST(0, supplier_lines_count - 1) WHERE id = OLD.deal_id;
    UPDATE deals SET supplier_lines_count = supplier_lines_count + 1 WHERE id = NEW.deal_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_buyer_lines_count() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE deals SET buyer_lines_count = buyer_lines_count + 1 WHERE id = NEW.deal_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE deals SET buyer_lines_count = GREATEST(0, buyer_lines_count - 1) WHERE id = OLD.deal_id;
  ELSIF (TG_OP = 'UPDATE' AND OLD.deal_id IS DISTINCT FROM NEW.deal_id) THEN
    UPDATE deals SET buyer_lines_count = GREATEST(0, buyer_lines_count - 1) WHERE id = OLD.deal_id;
    UPDATE deals SET buyer_lines_count = buyer_lines_count + 1 WHERE id = NEW.deal_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_supplier_lines_count ON deal_supplier_lines;
CREATE TRIGGER trg_sync_supplier_lines_count
  AFTER INSERT OR UPDATE OR DELETE ON deal_supplier_lines
  FOR EACH ROW EXECUTE FUNCTION sync_supplier_lines_count();

DROP TRIGGER IF EXISTS trg_sync_buyer_lines_count ON deal_buyer_lines;
CREATE TRIGGER trg_sync_buyer_lines_count
  AFTER INSERT OR UPDATE OR DELETE ON deal_buyer_lines
  FOR EACH ROW EXECUTE FUNCTION sync_buyer_lines_count();

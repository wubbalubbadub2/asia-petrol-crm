-- Multi-line pricing variants per side. Per client (2026-05-05):
--   "у поставщика и у покупателя нужно добавлять несколько полей по
--    ст. отправления (Условия фиксации, котировка, цена, базис поставки)
--    и ст. назначения. Контрагент, № договора и объём — один на сторону."
--
-- Constraints from the client's answers:
--   1. Volume stays single per side (one contracted volume).
--   2. All variants share one currency per side.
--   3. Each shipment_registry row uses exactly one supplier-variant
--      and one buyer-variant.
--
-- This migration is foundation only — schema + backfill. UI keeps writing
-- to the scalar columns on `deals` for now; a sync trigger keeps the
-- default line mirrored. Phase 2 will rewire the deal-create / detail UI
-- to write directly to lines, and add the FK from shipment_registry to
-- the chosen lines.
--
-- Why scalars stay on `deals`:
--   - Many readers (passport-table, dashboards, exports) still read them.
--   - Removing them now would be a big-bang refactor with no rollback.
--   - The default line is the source of truth; scalars are a read-only
--     mirror maintained by trigger (and back-filled here).

CREATE TABLE IF NOT EXISTS deal_supplier_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 1,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,

  price_condition price_condition,
  quotation_type_id UUID REFERENCES quotation_product_types(id),
  quotation NUMERIC(14,4),
  quotation_comment TEXT,
  discount NUMERIC(14,4),
  price NUMERIC(14,4),

  delivery_basis TEXT,
  departure_station_id UUID REFERENCES stations(id),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_supplier_lines_deal
  ON deal_supplier_lines(deal_id);
-- Exactly one default line per deal.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_supplier_lines_default
  ON deal_supplier_lines(deal_id) WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS deal_buyer_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 1,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,

  price_condition price_condition,
  quotation_type_id UUID REFERENCES quotation_product_types(id),
  quotation NUMERIC(14,4),
  quotation_comment TEXT,
  discount NUMERIC(14,4),
  price NUMERIC(14,4),

  delivery_basis TEXT,
  destination_station_id UUID REFERENCES stations(id),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_buyer_lines_deal
  ON deal_buyer_lines(deal_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_buyer_lines_default
  ON deal_buyer_lines(deal_id) WHERE is_default = TRUE;

-- updated_at triggers
CREATE TRIGGER trg_deal_supplier_lines_updated
  BEFORE UPDATE ON deal_supplier_lines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_deal_buyer_lines_updated
  BEFORE UPDATE ON deal_buyer_lines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS — mirror deal_shipment_prices policies.
ALTER TABLE deal_supplier_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_buyer_lines    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_deal_supplier_lines"
  ON deal_supplier_lines FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_deal_supplier_lines"
  ON deal_supplier_lines FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_deal_supplier_lines"
  ON deal_supplier_lines FOR UPDATE USING (is_writable_role());
CREATE POLICY "admin_delete_deal_supplier_lines"
  ON deal_supplier_lines FOR DELETE USING (is_admin());

CREATE POLICY "auth_select_deal_buyer_lines"
  ON deal_buyer_lines FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_deal_buyer_lines"
  ON deal_buyer_lines FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_deal_buyer_lines"
  ON deal_buyer_lines FOR UPDATE USING (is_writable_role());
CREATE POLICY "admin_delete_deal_buyer_lines"
  ON deal_buyer_lines FOR DELETE USING (is_admin());

-- ────────────────────────────────────────────────────────────────────
-- Sync: when the default line changes, mirror its values onto deals
-- scalar columns. AFTER trigger so the line write commits first; the
-- mirror write goes through the existing compute_deal_derived_fields
-- BEFORE trigger which recomputes contracted_amount / balance.
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sync_deal_from_default_supplier_line()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE deals SET
      supplier_price_condition   = NEW.price_condition,
      supplier_quotation         = NEW.quotation,
      supplier_quotation_comment = NEW.quotation_comment,
      supplier_discount          = NEW.discount,
      supplier_price             = NEW.price,
      supplier_delivery_basis    = NEW.delivery_basis,
      supplier_departure_station_id = NEW.departure_station_id
    WHERE id = NEW.deal_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_deal_from_default_supplier_line
  AFTER INSERT OR UPDATE ON deal_supplier_lines
  FOR EACH ROW EXECUTE FUNCTION sync_deal_from_default_supplier_line();

CREATE OR REPLACE FUNCTION sync_deal_from_default_buyer_line()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE deals SET
      buyer_price_condition       = NEW.price_condition,
      buyer_quotation             = NEW.quotation,
      buyer_quotation_comment     = NEW.quotation_comment,
      buyer_discount              = NEW.discount,
      buyer_price                 = NEW.price,
      buyer_delivery_basis        = NEW.delivery_basis,
      buyer_destination_station_id = NEW.destination_station_id
    WHERE id = NEW.deal_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_deal_from_default_buyer_line
  AFTER INSERT OR UPDATE ON deal_buyer_lines
  FOR EACH ROW EXECUTE FUNCTION sync_deal_from_default_buyer_line();

-- ────────────────────────────────────────────────────────────────────
-- Auto-create a default line for every NEW deal so the invariant
-- "every deal has exactly one default line" holds from now on. Existing
-- deals are seeded below.
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION seed_default_supplier_line()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO deal_supplier_lines (
    deal_id, position, is_default,
    price_condition, quotation, quotation_comment, discount, price,
    delivery_basis, departure_station_id
  ) VALUES (
    NEW.id, 1, TRUE,
    NEW.supplier_price_condition, NEW.supplier_quotation,
    NEW.supplier_quotation_comment, NEW.supplier_discount, NEW.supplier_price,
    NEW.supplier_delivery_basis, NEW.supplier_departure_station_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION seed_default_buyer_line()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO deal_buyer_lines (
    deal_id, position, is_default,
    price_condition, quotation, quotation_comment, discount, price,
    delivery_basis, destination_station_id
  ) VALUES (
    NEW.id, 1, TRUE,
    NEW.buyer_price_condition, NEW.buyer_quotation,
    NEW.buyer_quotation_comment, NEW.buyer_discount, NEW.buyer_price,
    NEW.buyer_delivery_basis, NEW.buyer_destination_station_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_seed_default_supplier_line
  AFTER INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION seed_default_supplier_line();

CREATE TRIGGER trg_seed_default_buyer_line
  AFTER INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION seed_default_buyer_line();

-- ────────────────────────────────────────────────────────────────────
-- Backfill: every existing deal gets one default line copied from
-- current scalar columns. Skip deals that already have a default
-- (idempotent re-run guard).
-- ────────────────────────────────────────────────────────────────────

INSERT INTO deal_supplier_lines (
  deal_id, position, is_default,
  price_condition, quotation, quotation_comment, discount, price,
  delivery_basis, departure_station_id
)
SELECT
  d.id, 1, TRUE,
  d.supplier_price_condition, d.supplier_quotation,
  d.supplier_quotation_comment, d.supplier_discount, d.supplier_price,
  d.supplier_delivery_basis, d.supplier_departure_station_id
FROM deals d
WHERE NOT EXISTS (
  SELECT 1 FROM deal_supplier_lines l
   WHERE l.deal_id = d.id AND l.is_default = TRUE
);

INSERT INTO deal_buyer_lines (
  deal_id, position, is_default,
  price_condition, quotation, quotation_comment, discount, price,
  delivery_basis, destination_station_id
)
SELECT
  d.id, 1, TRUE,
  d.buyer_price_condition, d.buyer_quotation,
  d.buyer_quotation_comment, d.buyer_discount, d.buyer_price,
  d.buyer_delivery_basis, d.buyer_destination_station_id
FROM deals d
WHERE NOT EXISTS (
  SELECT 1 FROM deal_buyer_lines l
   WHERE l.deal_id = d.id AND l.is_default = TRUE
);

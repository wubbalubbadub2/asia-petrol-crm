-- Phase 2 of multi-line pricing: bind every shipment_registry row to a
-- specific supplier-line and buyer-line. Per client: each registry row
-- uses exactly one variant per side.
--
-- Both columns are NULLABLE — that's the legacy bucket. autoprice and
-- pricing reads fall back to the deal's default line when NULL.

ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS supplier_line_id UUID REFERENCES deal_supplier_lines(id),
  ADD COLUMN IF NOT EXISTS buyer_line_id    UUID REFERENCES deal_buyer_lines(id);

CREATE INDEX IF NOT EXISTS idx_shipment_registry_supplier_line
  ON shipment_registry(supplier_line_id);
CREATE INDEX IF NOT EXISTS idx_shipment_registry_buyer_line
  ON shipment_registry(buyer_line_id);

-- Backfill: every existing registry row points at its deal's default
-- line. Uses subqueries (instead of a UNIQUE join) so it's safe even
-- if a deal has somehow ended up without a default line yet.
UPDATE shipment_registry r
SET supplier_line_id = (
      SELECT id FROM deal_supplier_lines l
       WHERE l.deal_id = r.deal_id AND l.is_default
       LIMIT 1
    ),
    buyer_line_id = (
      SELECT id FROM deal_buyer_lines l
       WHERE l.deal_id = r.deal_id AND l.is_default
       LIMIT 1
    )
WHERE r.deal_id IS NOT NULL
  AND (r.supplier_line_id IS NULL OR r.buyer_line_id IS NULL);

-- ────────────────────────────────────────────────────────────────────
-- Reroute autoprice: instead of always pulling from deals.supplier_price
-- / deals.buyer_price, read from whichever line the registry row was
-- created against. Falls back to the default line if the registry row
-- has no explicit line_id (legacy / bulk paste / API).
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION autoprice_registry_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_supplier_price NUMERIC;
  v_supplier_discount NUMERIC;
  v_buyer_price    NUMERIC;
  v_buyer_discount NUMERIC;
BEGIN
  IF NEW.deal_id IS NULL OR NEW.shipment_volume IS NULL THEN
    RETURN NEW;
  END IF;

  -- Supplier — explicit line if provided, else the default for this deal.
  IF NEW.supplier_line_id IS NOT NULL THEN
    SELECT price, COALESCE(discount, 0)
      INTO v_supplier_price, v_supplier_discount
    FROM deal_supplier_lines
    WHERE id = NEW.supplier_line_id;
  ELSE
    SELECT price, COALESCE(discount, 0)
      INTO v_supplier_price, v_supplier_discount
    FROM deal_supplier_lines
    WHERE deal_id = NEW.deal_id AND is_default = TRUE;
  END IF;

  IF v_supplier_price IS NOT NULL THEN
    INSERT INTO deal_shipment_prices (
      deal_id, side, shipment_registry_id,
      shipment_date, volume, calculated_price, amount, discount
    )
    VALUES (
      NEW.deal_id, 'supplier', NEW.id,
      NEW.date, NEW.shipment_volume, v_supplier_price,
      NEW.shipment_volume * v_supplier_price,
      v_supplier_discount
    );
  END IF;

  -- Buyer — same pattern.
  IF NEW.buyer_line_id IS NOT NULL THEN
    SELECT price, COALESCE(discount, 0)
      INTO v_buyer_price, v_buyer_discount
    FROM deal_buyer_lines
    WHERE id = NEW.buyer_line_id;
  ELSE
    SELECT price, COALESCE(discount, 0)
      INTO v_buyer_price, v_buyer_discount
    FROM deal_buyer_lines
    WHERE deal_id = NEW.deal_id AND is_default = TRUE;
  END IF;

  IF v_buyer_price IS NOT NULL THEN
    INSERT INTO deal_shipment_prices (
      deal_id, side, shipment_registry_id,
      shipment_date, volume, calculated_price, amount, discount
    )
    VALUES (
      NEW.deal_id, 'buyer', NEW.id,
      NEW.date, NEW.shipment_volume, v_buyer_price,
      NEW.shipment_volume * v_buyer_price,
      v_buyer_discount
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

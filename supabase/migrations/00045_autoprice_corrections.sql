-- Three connected fixes around the registry → deal_shipment_prices auto-population:
--
-- 1. Supplier side was using buyer tonnage. autoprice_registry_insert wrote
--    NEW.shipment_volume into the supplier-side pricing row, so the supplier
--    "Сумма отгружено" rolled up as shipment_volume × supplier_price instead
--    of loading_volume × supplier_price. Fix: supplier side uses налив
--    (loading_volume), buyer side keeps shipment_volume.
--
-- 2. Deal-level price edits didn't propagate. Editing deals.buyer_price (or
--    supplier_price) didn't touch the auto-populated rows, so
--    deals.buyer_shipped_amount stayed stale until each row was fixed
--    manually. Fix: AFTER UPDATE OF the per-side price on deals, sync the
--    matching auto-rows. Manually-curated rows (shipment_registry_id IS NULL)
--    are intentionally untouched — the trigger-pricing UI is for per-row
--    overrides.
--
-- 3. Backfill existing autorows so the supplier amount on every deal lines
--    up with налив × supplier_price.

-- ─── Fix 1: replace autoprice_registry_insert ─────────────────────────────
CREATE OR REPLACE FUNCTION autoprice_registry_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Supplier side — налив × supplier_price. Skip if the registry row
  -- doesn't have a налив value yet (some sources only fill in tonn first).
  INSERT INTO deal_shipment_prices (
    deal_id, side, shipment_registry_id,
    shipment_date, volume, calculated_price, amount, discount
  )
  SELECT
    NEW.deal_id, 'supplier', NEW.id,
    NEW.date,
    NEW.loading_volume,
    d.supplier_price,
    NEW.loading_volume * d.supplier_price,
    COALESCE(d.supplier_discount, 0)
  FROM deals d
  WHERE d.id = NEW.deal_id
    AND d.supplier_price IS NOT NULL
    AND NEW.loading_volume IS NOT NULL;

  -- Buyer side — отгрузка (shipment_volume) × buyer_price, unchanged.
  INSERT INTO deal_shipment_prices (
    deal_id, side, shipment_registry_id,
    shipment_date, volume, calculated_price, amount, discount
  )
  SELECT
    NEW.deal_id, 'buyer', NEW.id,
    NEW.date,
    NEW.shipment_volume,
    d.buyer_price,
    NEW.shipment_volume * d.buyer_price,
    COALESCE(d.buyer_discount, 0)
  FROM deals d
  WHERE d.id = NEW.deal_id
    AND d.buyer_price IS NOT NULL
    AND NEW.shipment_volume IS NOT NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Fix 1 (cont): autoprice_registry_update reacts to loading_volume too ─
CREATE OR REPLACE FUNCTION autoprice_registry_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Supplier-side row tracks loading_volume.
  IF NEW.loading_volume IS DISTINCT FROM OLD.loading_volume THEN
    UPDATE deal_shipment_prices
    SET volume = NEW.loading_volume,
        amount = NEW.loading_volume * COALESCE(calculated_price, 0)
    WHERE shipment_registry_id = NEW.id
      AND side = 'supplier';
  END IF;

  -- Buyer-side row tracks shipment_volume.
  IF NEW.shipment_volume IS DISTINCT FROM OLD.shipment_volume THEN
    UPDATE deal_shipment_prices
    SET volume = NEW.shipment_volume,
        amount = NEW.shipment_volume * COALESCE(calculated_price, 0)
    WHERE shipment_registry_id = NEW.id
      AND side = 'buyer';
  END IF;

  IF NEW.date IS DISTINCT FROM OLD.date THEN
    UPDATE deal_shipment_prices
    SET shipment_date = NEW.date
    WHERE shipment_registry_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Fix 3: propagate deal-level price changes to auto-populated rows ──────
CREATE OR REPLACE FUNCTION propagate_deal_price_to_autorows()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_price IS DISTINCT FROM OLD.supplier_price THEN
    UPDATE deal_shipment_prices
    SET calculated_price = NEW.supplier_price,
        amount           = volume * NEW.supplier_price
    WHERE deal_id = NEW.id
      AND side = 'supplier'
      AND shipment_registry_id IS NOT NULL;
  END IF;

  IF NEW.buyer_price IS DISTINCT FROM OLD.buyer_price THEN
    UPDATE deal_shipment_prices
    SET calculated_price = NEW.buyer_price,
        amount           = volume * NEW.buyer_price
    WHERE deal_id = NEW.id
      AND side = 'buyer'
      AND shipment_registry_id IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_propagate_deal_price ON deals;
CREATE TRIGGER trg_propagate_deal_price
  AFTER UPDATE OF supplier_price, buyer_price ON deals
  FOR EACH ROW EXECUTE FUNCTION propagate_deal_price_to_autorows();

-- ─── Backfill existing supplier-side autorows ─────────────────────────────
-- Any pricing row tied to a registry row on the supplier side should
-- track налив, not отгрузка. The UPDATE chains into trg_prices_refresh_deal
-- (00030) so deals.supplier_shipped_amount self-corrects per deal.
UPDATE deal_shipment_prices p
SET volume = sr.loading_volume,
    amount = sr.loading_volume * p.calculated_price
FROM shipment_registry sr
WHERE p.shipment_registry_id = sr.id
  AND p.side = 'supplier';

-- Auto-populate deal_shipment_prices from shipment_registry.
--
-- Client request: "когда логисты заносят отгрузку в реестр, объем
-- отгруженный автоматом насчитывался по цене". When a shipment is
-- logged in the registry, the "shipped by price" amount should auto-
-- compute using the deal's current price. This feeds
-- deals.supplier_shipped_amount / buyer_shipped_amount through the
-- existing rollup trigger (migration 00030).
--
-- The preliminary price is whatever's on the deal today
-- (supplier_price / buyer_price). Later the user can open the
-- Тригер / Фикс / Средний месяц card on the deal and edit the
-- generated row to reflect the real market price by month / trigger date.

-- Link pricing row back to its originating shipment so updates + deletes
-- stay in sync. Pre-existing rows (created manually in the pricing UI)
-- have a NULL registry_id — those stay untouched by these triggers.
ALTER TABLE deal_shipment_prices
  ADD COLUMN IF NOT EXISTS shipment_registry_id UUID
  REFERENCES shipment_registry(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_deal_shipment_prices_registry
  ON deal_shipment_prices(shipment_registry_id);

-- INSERT trigger: after a shipment row is committed, spawn up to two
-- pricing rows (supplier + buyer) using the deal's current price.
-- Uses INSERT…SELECT to avoid plpgsql's SELECT INTO ambiguity with
-- SQL CREATE TABLE AS (same quirk that tripped migration 00036).
CREATE OR REPLACE FUNCTION autoprice_registry_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deal_id IS NULL OR NEW.shipment_volume IS NULL THEN
    RETURN NEW;
  END IF;

  -- Supplier side — only when the deal has a supplier_price set.
  INSERT INTO deal_shipment_prices (
    deal_id, side, shipment_registry_id,
    shipment_date, volume, calculated_price, amount, discount
  )
  SELECT
    NEW.deal_id, 'supplier', NEW.id,
    NEW.date, NEW.shipment_volume, d.supplier_price,
    NEW.shipment_volume * d.supplier_price,
    COALESCE(d.supplier_discount, 0)
  FROM deals d
  WHERE d.id = NEW.deal_id AND d.supplier_price IS NOT NULL;

  -- Buyer side — same pattern.
  INSERT INTO deal_shipment_prices (
    deal_id, side, shipment_registry_id,
    shipment_date, volume, calculated_price, amount, discount
  )
  SELECT
    NEW.deal_id, 'buyer', NEW.id,
    NEW.date, NEW.shipment_volume, d.buyer_price,
    NEW.shipment_volume * d.buyer_price,
    COALESCE(d.buyer_discount, 0)
  FROM deals d
  WHERE d.id = NEW.deal_id AND d.buyer_price IS NOT NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_autoprice_registry_insert
  AFTER INSERT ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION autoprice_registry_insert();

-- UPDATE trigger: if the user edits the shipment's volume or date, keep
-- the linked pricing rows in sync. Do NOT touch the price — the whole
-- point of the pricing table is that the user can correct prices
-- independently of the shipment log.
CREATE OR REPLACE FUNCTION autoprice_registry_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.shipment_volume IS DISTINCT FROM OLD.shipment_volume THEN
    UPDATE deal_shipment_prices
    SET volume = NEW.shipment_volume,
        amount = NEW.shipment_volume * COALESCE(calculated_price, 0)
    WHERE shipment_registry_id = NEW.id;
  END IF;

  IF NEW.date IS DISTINCT FROM OLD.date THEN
    UPDATE deal_shipment_prices
    SET shipment_date = NEW.date
    WHERE shipment_registry_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_autoprice_registry_update
  AFTER UPDATE ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION autoprice_registry_update();

-- DELETE cascade is handled by the FK ON DELETE CASCADE — when a
-- shipment is removed the linked pricing rows go with it.

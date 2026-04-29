-- Per-section currency on deals. Cross-currency case is real:
-- покупаем в KZT, продаём в USD. The single deals.currency couldn't
-- represent that — supplier_payment, buyer_payment etc. were lumped
-- under one denomination.
--
-- Three new columns, one per section. deals.currency stays as a
-- legacy mirror of supplier_currency (dashboard, passport table,
-- and other read-only callers still rely on it for V1; they'll be
-- migrated to per-section in a follow-up).

ALTER TABLE deals
  ADD COLUMN supplier_currency  TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN buyer_currency     TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN logistics_currency TEXT NOT NULL DEFAULT 'USD';

-- Backfill from the existing single column. Every existing deal stays
-- functionally identical (all three sides match deals.currency).
UPDATE deals
   SET supplier_currency  = COALESCE(currency, 'USD'),
       buyer_currency     = COALESCE(currency, 'USD'),
       logistics_currency = COALESCE(currency, 'USD');

-- Re-bind the payment rollup to per-side currency. Previously every
-- payment matched against deals.currency; now supplier payments must
-- match supplier_currency and buyer payments match buyer_currency.
-- Legacy NULL-currency rows still inherit the side's currency.
CREATE OR REPLACE FUNCTION refresh_deal_payment_totals(p_deal_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE deals d SET
    supplier_payment = COALESCE(sub.supplier_total, 0),
    buyer_payment    = COALESCE(sub.buyer_total, 0)
  FROM (
    SELECT
      p.deal_id,
      SUM(CASE
            WHEN p.side = 'supplier'
             AND (p.currency IS NULL OR p.currency = d2.supplier_currency)
            THEN p.amount ELSE 0
          END) AS supplier_total,
      SUM(CASE
            WHEN p.side = 'buyer'
             AND (p.currency IS NULL OR p.currency = d2.buyer_currency)
            THEN p.amount ELSE 0
          END) AS buyer_total
    FROM deal_payments p
    JOIN deals d2 ON d2.id = p.deal_id
    WHERE p.deal_id = p_deal_id
    GROUP BY p.deal_id
  ) sub
  WHERE d.id = sub.deal_id;

  IF NOT FOUND THEN
    UPDATE deals SET supplier_payment = 0, buyer_payment = 0
    WHERE id = p_deal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Repoint the change-trigger from currency → (supplier_currency, buyer_currency).
CREATE OR REPLACE FUNCTION trg_refresh_on_currency_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_currency IS DISTINCT FROM OLD.supplier_currency
     OR NEW.buyer_currency IS DISTINCT FROM OLD.buyer_currency THEN
    PERFORM refresh_deal_payment_totals(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_currency_change ON deals;
CREATE TRIGGER trg_deal_currency_change
  AFTER UPDATE OF supplier_currency, buyer_currency ON deals
  FOR EACH ROW EXECUTE FUNCTION trg_refresh_on_currency_change();

-- Backfill existing rollups under the new function.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_payments LOOP
    PERFORM refresh_deal_payment_totals(r.deal_id);
  END LOOP;
END $$;

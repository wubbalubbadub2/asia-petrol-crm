-- Client report (2026-04-20): after changing a deal's currency, the
-- fields Оплата / Баланс / Долг-переплата still reflect sums of
-- mixed-currency payments labelled with the new symbol.
--
-- Root cause: refresh_deal_payment_totals (migration 00028) sums every
-- payment row regardless of currency, so a deal denominated in KZT
-- with a stray USD payment ends up with buyer_payment = 240 000 even
-- though only 160 000 of that is actually KZT.
--
-- Fix: the rollup only counts payments whose per-row currency matches
-- the deal's current currency. Legacy rows with NULL currency are
-- treated as deal-currency (that's the semantic the app already uses
-- in the payments table UI).
--
-- Knock-on effect: supplier_balance and buyer_debt are derived from
-- these rollups by the BEFORE trigger in migration 00021, so they
-- self-correct as soon as the rollup runs.

CREATE OR REPLACE FUNCTION refresh_deal_payment_totals(p_deal_id UUID)
RETURNS VOID AS $$
DECLARE
  v_currency TEXT;
BEGIN
  SELECT currency INTO v_currency FROM deals WHERE id = p_deal_id;

  UPDATE deals SET
    supplier_payment = COALESCE(sub.supplier_total, 0),
    buyer_payment = COALESCE(sub.buyer_total, 0)
  FROM (
    SELECT
      deal_id,
      SUM(CASE WHEN side = 'supplier' THEN amount ELSE 0 END) AS supplier_total,
      SUM(CASE WHEN side = 'buyer' THEN amount ELSE 0 END) AS buyer_total
    FROM deal_payments
    WHERE deal_id = p_deal_id
      AND (currency IS NULL OR currency = v_currency)
    GROUP BY deal_id
  ) sub
  WHERE deals.id = sub.deal_id;

  -- If no rows matched (all payments were in other currencies, or none
  -- exist at all) zero the rollup so the balance doesn't carry stale
  -- values from before the currency change.
  IF NOT FOUND THEN
    UPDATE deals SET supplier_payment = 0, buyer_payment = 0
    WHERE id = p_deal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- When the deal's currency itself changes we need to re-run the rollup
-- for that deal — the set of matching payments has shifted. Attaching
-- a dedicated trigger instead of overloading the existing derived-
-- fields trigger keeps the responsibilities separate.
CREATE OR REPLACE FUNCTION trg_refresh_on_currency_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    PERFORM refresh_deal_payment_totals(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_currency_change ON deals;
CREATE TRIGGER trg_deal_currency_change
  AFTER UPDATE OF currency ON deals
  FOR EACH ROW EXECUTE FUNCTION trg_refresh_on_currency_change();

-- Backfill: re-run the rollup across every deal that has any payment
-- rows so existing deals correct themselves immediately after this
-- migration applies.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_payments LOOP
    PERFORM refresh_deal_payment_totals(r.deal_id);
  END LOOP;
END $$;

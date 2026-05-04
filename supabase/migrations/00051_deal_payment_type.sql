-- Add a type discriminator on deal_payments so operators can mark a
-- row as either "Оплата" (default) or "Возврат". Refunds subtract from
-- the running supplier_payment / buyer_payment rollup. Use case from
-- the client: shipped one volume, paid (or got paid) a different sum,
-- and the difference is reconciled with a refund — to or from us.
--
-- Per user request: do NOT auto-flip historical negative-amount rows
-- to refund. They left those manual on purpose.

ALTER TABLE deal_payments
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'payment'
    CHECK (payment_type IN ('payment','refund'));

-- Replace the rollup so a refund subtracts. Multi-currency match
-- behavior from 00043 stays intact: payments / refunds only count when
-- their currency matches the deal's per-side currency (or is NULL).
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
            THEN p.amount * (CASE WHEN p.payment_type = 'refund' THEN -1 ELSE 1 END)
            ELSE 0
          END) AS supplier_total,
      SUM(CASE
            WHEN p.side = 'buyer'
             AND (p.currency IS NULL OR p.currency = d2.buyer_currency)
            THEN p.amount * (CASE WHEN p.payment_type = 'refund' THEN -1 ELSE 1 END)
            ELSE 0
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

-- Re-roll all existing deals so the new function reflects current state.
-- (No-op for deals with no refunds — same numbers as before.)
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_payments LOOP
    PERFORM refresh_deal_payment_totals(r.deal_id);
  END LOOP;
END $$;

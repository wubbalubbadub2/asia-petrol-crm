-- Extend deal_payments.payment_type with a third kind: 'offset' («перезачет»).
--
-- Operations needed a way to record a mutual-offset entry distinct from
-- a refund: same minus-sign rollup behaviour (it subtracts from the
-- running supplier_payment / buyer_payment), but a different label so
-- accountants can tell at a glance that the line cancels obligations
-- against another deal/counterparty rather than physically returning
-- cash. From a numeric standpoint, refund and offset are identical;
-- only the label differs.

ALTER TABLE deal_payments DROP CONSTRAINT IF EXISTS deal_payments_payment_type_check;
ALTER TABLE deal_payments
  ADD CONSTRAINT deal_payments_payment_type_check
    CHECK (payment_type IN ('payment','refund','offset'));

-- Refresh the rollup so 'offset' subtracts like 'refund'. Currency-
-- matching guard from 00043/00051 stays intact.
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
            THEN p.amount * (CASE WHEN p.payment_type IN ('refund','offset') THEN -1 ELSE 1 END)
            ELSE 0
          END) AS supplier_total,
      SUM(CASE
            WHEN p.side = 'buyer'
             AND (p.currency IS NULL OR p.currency = d2.buyer_currency)
            THEN p.amount * (CASE WHEN p.payment_type IN ('refund','offset') THEN -1 ELSE 1 END)
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

-- Bug uncovered by 02_registry_rollup.test.sql during the qa-audit
-- sweep (2026-04-20): deleting every shipment for a deal leaves the
-- rolled-up totals (buyer_shipped_volume, actual_shipped_volume,
-- invoice_amount) at their last non-zero value instead of snapping
-- back to 0.
--
-- Cause: refresh_deal_shipment_totals (migrations 00011 → 00027)
-- does an UPDATE deals … FROM (SELECT … FROM shipment_registry
-- WHERE deal_id = p_deal_id GROUP BY deal_id). Once the last row is
-- gone the subquery yields zero rows, the UPDATE's FROM has no
-- match, and the deal is left untouched.
--
-- Fix: add the same IF NOT FOUND fallback already used by the
-- payment and price rollups (migrations 00028, 00030, 00040). No
-- behaviour change when rows still exist.

CREATE OR REPLACE FUNCTION refresh_deal_shipment_totals(p_deal_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE deals SET
    buyer_shipped_volume = sub.total_volume,
    actual_shipped_volume = sub.total_volume,
    invoice_amount = sub.total_amount
  FROM (
    SELECT
      deal_id,
      COALESCE(SUM(shipment_volume), 0) as total_volume,
      COALESCE(SUM(shipped_tonnage_amount), 0) as total_amount
    FROM shipment_registry
    WHERE deal_id = p_deal_id
    GROUP BY deal_id
  ) sub
  WHERE deals.id = sub.deal_id;

  -- When the last shipment is deleted the subquery has no rows and
  -- the UPDATE above matches nothing. Snap the totals to zero so
  -- the deal's view doesn't carry stale aggregates.
  IF NOT FOUND THEN
    UPDATE deals SET
      buyer_shipped_volume = 0,
      actual_shipped_volume = 0,
      invoice_amount = 0
    WHERE id = p_deal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Backfill: any deal that currently has shipment_registry rows stays
-- the same (totals recompute from the subquery). Deals that have
-- zero registry rows but non-zero totals get corrected. Safe to run
-- even against a clean database.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM deals
    WHERE (buyer_shipped_volume IS NOT NULL AND buyer_shipped_volume <> 0)
       OR (actual_shipped_volume IS NOT NULL AND actual_shipped_volume <> 0)
       OR (invoice_amount IS NOT NULL AND invoice_amount <> 0)
  LOOP
    PERFORM refresh_deal_shipment_totals(r.id);
  END LOOP;
END $$;

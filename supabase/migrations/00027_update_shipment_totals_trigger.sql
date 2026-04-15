-- Update refresh_deal_shipment_totals to also populate actual_shipped_volume
-- Per doc: actual_shipped_volume comes from registry (АВР from forwarder)

-- Registry sums → deal fields:
-- buyer_shipped_volume, actual_shipped_volume = SUM(shipment_volume)
-- invoice_amount = SUM(shipped_tonnage_amount) — registry sum for logistics
-- NOTE: supplier_shipped_amount and buyer_shipped_amount come from deal_shipment_prices trigger (00030)
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
END;
$$ LANGUAGE plpgsql;

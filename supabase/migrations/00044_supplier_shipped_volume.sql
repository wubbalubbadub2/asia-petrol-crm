-- shipment_registry has two volumes per row:
--   loading_volume  ("Налив") — what was loaded at the supplier (factory side)
--   shipment_volume ("Тонн")  — what was shipped to the buyer (delivered side)
--
-- The deal passport table shows "Отгр. тонн" twice — once under Поставщик
-- and once under Покупатель — but until now both cells read the same field
-- (deals.buyer_shipped_volume), which is the buyer-side total. That hid the
-- налив/тонн difference at the deal level.
--
-- Add a dedicated supplier_shipped_volume column on deals and have the
-- existing rollup populate it with SUM(loading_volume). buyer_shipped_volume
-- and the rest of the registry rollup stay untouched.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_shipped_volume DECIMAL(14,4) DEFAULT 0;

CREATE OR REPLACE FUNCTION refresh_deal_shipment_totals(p_deal_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE deals SET
    supplier_shipped_volume = COALESCE(sub.loading_total,  0),
    buyer_shipped_volume    = COALESCE(sub.shipment_total, 0),
    actual_shipped_volume   = COALESCE(sub.shipment_total, 0),
    invoice_amount          = COALESCE(sub.amount_total,   0)
  FROM (
    SELECT
      deal_id,
      SUM(loading_volume)         AS loading_total,
      SUM(shipment_volume)        AS shipment_total,
      SUM(shipped_tonnage_amount) AS amount_total
    FROM shipment_registry
    WHERE deal_id = p_deal_id
    GROUP BY deal_id
  ) sub
  WHERE deals.id = sub.deal_id;

  -- If the deal has no registry rows at all, zero everything so stale
  -- totals don't survive a delete-all.
  IF NOT FOUND THEN
    UPDATE deals
       SET supplier_shipped_volume = 0,
           buyer_shipped_volume    = 0,
           actual_shipped_volume   = 0,
           invoice_amount          = 0
     WHERE id = p_deal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Backfill: re-run the rollup once across every deal that has any registry
-- rows so existing supplier_shipped_volume values populate immediately.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM shipment_registry WHERE deal_id IS NOT NULL LOOP
    PERFORM refresh_deal_shipment_totals(r.deal_id);
  END LOOP;
END $$;

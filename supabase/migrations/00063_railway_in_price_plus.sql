-- Flip the ЖД-в-цене contribution to supplier_balance.
--
-- 00052 introduced the railway_in_price clause as a SUBTRACTION:
--   supplier_balance = shipped - payment - invoice_amount (when "в цене")
-- under the rationale that the supplier collected the railway sum on
-- top of his price and we needed to recover it.
--
-- Per client (2026-05-06): the actual operational meaning is the
-- opposite — when ЖД is "в цене", the supplier's price already
-- includes the railway, so we OWE him the railway amount on top of
-- the goods value. The balance should ADD the railway, not subtract.
--   supplier_balance = shipped - payment + invoice_amount (when "в цене")
--
-- Currency-match guard from 00052 stays: only apply when supplier and
-- logistics share the same currency. Buyer side / other branches of
-- the function are untouched.

CREATE OR REPLACE FUNCTION compute_deal_derived_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_contracted_volume IS NOT NULL AND NEW.supplier_price IS NOT NULL THEN
    NEW.supplier_contracted_amount := NEW.supplier_contracted_volume * NEW.supplier_price;
  END IF;

  IF NEW.buyer_contracted_volume IS NOT NULL AND NEW.buyer_price IS NOT NULL THEN
    NEW.buyer_contracted_amount := NEW.buyer_contracted_volume * NEW.buyer_price;
  END IF;

  -- Supplier balance = shipped − payment + (ЖД when «в цене» and currency matches)
  NEW.supplier_balance :=
    COALESCE(NEW.supplier_shipped_amount, 0)
    - COALESCE(NEW.supplier_payment, 0)
    + CASE
        WHEN NEW.railway_in_price IS TRUE
         AND NEW.supplier_currency = NEW.logistics_currency
        THEN COALESCE(NEW.invoice_amount, 0)
        ELSE 0
      END;

  -- Buyer balance — flipped to payment − shipped in 00060.
  NEW.buyer_debt :=
    COALESCE(NEW.buyer_payment, 0)
    - COALESCE(NEW.buyer_shipped_amount, 0);

  NEW.buyer_remaining := COALESCE(NEW.buyer_contracted_volume, 0) - COALESCE(NEW.buyer_ordered_volume, 0);

  IF NEW.planned_tariff IS NOT NULL AND NEW.preliminary_tonnage IS NOT NULL THEN
    NEW.preliminary_amount := NEW.planned_tariff * NEW.preliminary_tonnage;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-fire the BEFORE UPDATE trigger across every deal so existing
-- balances pick up the new sign immediately. Cheap (single trigger
-- pass per row, no fan-out beyond compute_deal_derived_fields).
UPDATE deals SET updated_at = now() WHERE id IS NOT NULL;

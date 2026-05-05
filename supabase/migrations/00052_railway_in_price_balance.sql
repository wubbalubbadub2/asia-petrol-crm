-- "ЖД в цене" flag (deals.railway_in_price, added in 00018) was previously
-- only carried as metadata — the supplier_balance trigger ignored it.
--
-- Per client (2026-05-05): "Если галочка стоит ЖД в цене то пусть минусует
-- ее с баланса поставщика. Если галочки нету то стоит без изменения."
-- Meaning: when the flag is set, the buyer's price already covers the
-- railway tariff — the supplier received that money on top of his own
-- price×volume, so the equivalent ЖД sum is a debit against the supplier
-- balance.
--
-- Currency safety: invoice_amount lives in logistics_currency. We only
-- subtract when supplier_currency = logistics_currency. Mixing currencies
-- without an FX rate would silently corrupt the balance for export deals
-- (KG: USD supplier, KZT logistics) — leave those untouched.

CREATE OR REPLACE FUNCTION compute_deal_derived_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_contracted_volume IS NOT NULL AND NEW.supplier_price IS NOT NULL THEN
    NEW.supplier_contracted_amount := NEW.supplier_contracted_volume * NEW.supplier_price;
  END IF;

  IF NEW.buyer_contracted_volume IS NOT NULL AND NEW.buyer_price IS NOT NULL THEN
    NEW.buyer_contracted_amount := NEW.buyer_contracted_volume * NEW.buyer_price;
  END IF;

  -- Supplier balance = shipped - payment - (ЖД when "в цене" and currency matches)
  NEW.supplier_balance :=
    COALESCE(NEW.supplier_shipped_amount, 0)
    - COALESCE(NEW.supplier_payment, 0)
    - CASE
        WHEN NEW.railway_in_price IS TRUE
         AND NEW.supplier_currency = NEW.logistics_currency
        THEN COALESCE(NEW.invoice_amount, 0)
        ELSE 0
      END;

  NEW.buyer_debt := COALESCE(NEW.buyer_shipped_amount, 0) - COALESCE(NEW.buyer_payment, 0);
  NEW.buyer_remaining := COALESCE(NEW.buyer_contracted_volume, 0) - COALESCE(NEW.buyer_ordered_volume, 0);

  IF NEW.planned_tariff IS NOT NULL AND NEW.preliminary_tonnage IS NOT NULL THEN
    NEW.preliminary_amount := NEW.planned_tariff * NEW.preliminary_tonnage;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill: re-fire BEFORE UPDATE on every deal so balances reflect
-- the new formula immediately. Cheap (single trigger pass per row).
UPDATE deals SET updated_at = now() WHERE id IS NOT NULL;

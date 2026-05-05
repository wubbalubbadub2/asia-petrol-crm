-- Flip the buyer_debt formula. Per client:
--   «Долг / переплата» на стороне покупателя = Оплата − Отгружено
-- Не наоборот. До 00021 формула была shipped − payment, теперь
-- инвертируется так что:
--   payment > shipped → положительная переплата
--   payment < shipped → отрицательный остаточный долг
--
-- Other branches of compute_deal_derived_fields (supplier_balance, the
-- railway_in_price clause from 00052, contracted amounts, etc.) stay
-- as they were — only buyer_debt direction changes.

CREATE OR REPLACE FUNCTION compute_deal_derived_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_contracted_volume IS NOT NULL AND NEW.supplier_price IS NOT NULL THEN
    NEW.supplier_contracted_amount := NEW.supplier_contracted_volume * NEW.supplier_price;
  END IF;

  IF NEW.buyer_contracted_volume IS NOT NULL AND NEW.buyer_price IS NOT NULL THEN
    NEW.buyer_contracted_amount := NEW.buyer_contracted_volume * NEW.buyer_price;
  END IF;

  -- Supplier balance = shipped − payment − (ЖД when «в цене» and currency matches)
  NEW.supplier_balance :=
    COALESCE(NEW.supplier_shipped_amount, 0)
    - COALESCE(NEW.supplier_payment, 0)
    - CASE
        WHEN NEW.railway_in_price IS TRUE
         AND NEW.supplier_currency = NEW.logistics_currency
        THEN COALESCE(NEW.invoice_amount, 0)
        ELSE 0
      END;

  -- Buyer balance = payment − shipped (flipped from old shipped − payment)
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

-- Re-fire the BEFORE UPDATE trigger across all deals so existing
-- buyer_debt values land with the new formula immediately.
UPDATE deals SET updated_at = now() WHERE id IS NOT NULL;

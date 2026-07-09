-- 00112_additional_expenses.sql
--
-- Клиент 2026-07-09: доп расходы по ЖД в реестре отгрузок.
--   • На каждой отгрузке — money-колонка additional_expenses.
--   • На сделке — булев флаг additional_expenses_in_price (галочка
--     «доп расходы в цене»), как railway_in_price.
--   • Rollup на сделке — additional_expenses_amount = SUM по
--     shipment_registry для этой сделки.
--   • В формулу supplier_balance добавляем ПЛЮС SUM когда флаг ON
--     и валюты совпадают (по аналогии с railway_in_price / 00063).

-- ── Schema ─────────────────────────────────────────────────────
ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS additional_expenses NUMERIC(14, 4);

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS additional_expenses_amount NUMERIC(14, 4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_expenses_in_price BOOLEAN DEFAULT FALSE;

-- ── Rollup trigger (обновляет deals.additional_expenses_amount) ─
-- update_shipment_totals (00027) уже пишет invoice_amount / шипменты.
-- Не хочу его трогать чтобы не поломать. Пишу отдельный триггер
-- только под доп расходы — идёт AFTER изменений на shipment_registry.
CREATE OR REPLACE FUNCTION update_deal_additional_expenses()
RETURNS TRIGGER AS $$
DECLARE
  v_deal_id UUID;
  v_sum NUMERIC;
BEGIN
  v_deal_id := COALESCE(NEW.deal_id, OLD.deal_id);
  IF v_deal_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COALESCE(SUM(additional_expenses), 0)
    INTO v_sum
    FROM shipment_registry
   WHERE deal_id = v_deal_id;

  UPDATE deals
     SET additional_expenses_amount = v_sum
   WHERE id = v_deal_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_deal_additional_expenses ON shipment_registry;
CREATE TRIGGER trg_update_deal_additional_expenses
AFTER INSERT OR UPDATE OF additional_expenses, deal_id OR DELETE
ON shipment_registry
FOR EACH ROW
EXECUTE FUNCTION update_deal_additional_expenses();

-- ── Balance formula update ─────────────────────────────────────
-- 00063 сделал supplier_balance += invoice_amount (когда railway_in_price
-- и валюты совпадают). Добавляем ещё +additional_expenses_amount
-- по своему флагу и той же currency-match guard.
CREATE OR REPLACE FUNCTION compute_deal_derived_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_contracted_volume IS NOT NULL AND NEW.supplier_price IS NOT NULL THEN
    NEW.supplier_contracted_amount := NEW.supplier_contracted_volume * NEW.supplier_price;
  END IF;

  IF NEW.buyer_contracted_volume IS NOT NULL AND NEW.buyer_price IS NOT NULL THEN
    NEW.buyer_contracted_amount := NEW.buyer_contracted_volume * NEW.buyer_price;
  END IF;

  NEW.supplier_balance :=
    COALESCE(NEW.supplier_shipped_amount, 0)
    - COALESCE(NEW.supplier_payment, 0)
    + CASE
        WHEN NEW.railway_in_price IS TRUE
         AND NEW.supplier_currency = NEW.logistics_currency
        THEN COALESCE(NEW.invoice_amount, 0)
        ELSE 0
      END
    + CASE
        WHEN NEW.additional_expenses_in_price IS TRUE
         AND NEW.supplier_currency = NEW.logistics_currency
        THEN COALESCE(NEW.additional_expenses_amount, 0)
        ELSE 0
      END;

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

-- Backfill: считаем additional_expenses_amount для существующих
-- сделок (пока везде 0, но пусть будет консистентно).
UPDATE deals d
   SET additional_expenses_amount = COALESCE((
     SELECT SUM(additional_expenses) FROM shipment_registry WHERE deal_id = d.id
   ), 0)
 WHERE d.id IS NOT NULL;

-- Прогоняем balance-триггер по всем сделкам.
UPDATE deals SET updated_at = now() WHERE id IS NOT NULL;

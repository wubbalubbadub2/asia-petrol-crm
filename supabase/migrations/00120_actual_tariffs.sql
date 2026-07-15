-- 00120_actual_tariffs.sql
--
-- Клиент 2026-07-15: два фактических тарифа, считаются автоматом из
-- реестра, ручная правка закрепляет значение (override, та же
-- семантика, что у тарифа в реестре / суммы):
--   • «Тариф факт (логисты)» — существующая колонка deals.actual_tariff
--     становится вычисляемой: Сумма (invoice_amount) ÷ объем СНТ.
--     База как в реестре: KZ — входящее (supplier_shipped_volume =
--     SUM(loading_volume)), KG — исходящее (actual_shipped_volume =
--     SUM(shipment_volume)).
--   • «Тариф факт (грузоотпр.)» — НОВАЯ колонка shipper_actual_tariff:
--     Сумма грузоотправителя (additional_expenses_amount) ÷ входящее
--     СНТ (клиент явно: «на входящий СНТ»).
--
-- Расчёт живёт в compute_deal_derived_fields (BEFORE UPDATE на deals):
-- он видит итоговые NEW-значения rollup'ов независимо от того, какой
-- AFTER-триггер реестра их записал.
--
-- ⚠ Прошлые ручные значения actual_tariff перетираются авто-расчётом
-- (override у них FALSE) — правило клиента: «факт всегда с реестра».

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS actual_tariff_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shipper_actual_tariff NUMERIC(14, 4),
  ADD COLUMN IF NOT EXISTS shipper_actual_tariff_override BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN deals.shipper_actual_tariff IS
  'Тариф факт грузоотправителя = additional_expenses_amount / supplier_shipped_volume (входящее СНТ). Авто; override закрепляет ручной ввод.';
COMMENT ON COLUMN deals.actual_tariff_override IS
  'TRUE = «Тариф факт (логисты)» введён вручную, авто-расчёт не трогает.';

CREATE OR REPLACE FUNCTION compute_deal_derived_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_logistics_base NUMERIC;
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

  -- ── Тариф факт (логисты): Сумма ÷ объем СНТ (00120) ────────────────
  -- База как в формуле суммы реестра: KZ — входящее, KG/прочие — исходящее.
  IF COALESCE(NEW.actual_tariff_override, FALSE) = FALSE THEN
    v_logistics_base := CASE
      WHEN NEW.deal_type = 'KZ' THEN NEW.supplier_shipped_volume
      ELSE NEW.actual_shipped_volume
    END;
    IF NEW.invoice_amount IS NOT NULL AND COALESCE(v_logistics_base, 0) > 0 THEN
      NEW.actual_tariff := NEW.invoice_amount / v_logistics_base;
    ELSE
      NEW.actual_tariff := NULL;
    END IF;
  END IF;

  -- ── Тариф факт (грузоотпр.): Сумма грузоотправителя ÷ входящее СНТ ─
  IF COALESCE(NEW.shipper_actual_tariff_override, FALSE) = FALSE THEN
    IF NEW.additional_expenses_amount IS NOT NULL
       AND COALESCE(NEW.supplier_shipped_volume, 0) > 0 THEN
      NEW.shipper_actual_tariff := NEW.additional_expenses_amount / NEW.supplier_shipped_volume;
    ELSE
      NEW.shipper_actual_tariff := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill: прогнать recompute по всем сделкам (BEFORE-триггер посчитает
-- оба тарифа; guarded rollup-триггеры 00116 лишнего не делают).
UPDATE deals SET updated_at = now() WHERE id IS NOT NULL;

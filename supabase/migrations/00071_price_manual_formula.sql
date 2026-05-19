-- Manual formula price condition (product spec, 2026-05-19).
--
-- Variant of formula pricing where the manager enters all inputs by
-- hand instead of pulling from `quotations` — useful for KZ deals
-- where the upstream quotation source is offline / Argus.
--
-- Three inputs per variant (line-level):
--   • quotation   — numeric, in the source currency (e.g. USD/tn)
--   • discount    — numeric, in the same currency
--   • fx_rate     — exchange rate to the deal currency
--
-- Price = (quotation - discount) * fx_rate
--
-- Stage workflow same as the other formula modes:
--   • Preliminary — initial provisional inputs
--   • Final       — once settled, the final inputs trigger a recompute
--                   of all existing shipments under this variant.
--
-- This migration:
--   1. Adds 'manual_formula' to the price_condition enum.
--   2. Adds fx_rate + preliminary_fx_rate columns to both line tables.
--   3. Updates snapshot_preliminary_on_finalize to also snapshot
--      fx_rate when flipping to final.
--   4. Extends recompute_line_shipment_prices to handle manual_formula
--      at the final stage.
--   5. Extends autoprice_registry_insert with the same handling so
--      new shipments under a final manual_formula variant get priced
--      correctly on INSERT.

-- ── 1. Enum + columns ───────────────────────────────────────────────

ALTER TYPE price_condition ADD VALUE IF NOT EXISTS 'manual_formula';

ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(14, 6),
  ADD COLUMN IF NOT EXISTS preliminary_fx_rate NUMERIC(14, 6);

ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(14, 6),
  ADD COLUMN IF NOT EXISTS preliminary_fx_rate NUMERIC(14, 6);

-- ── 2. Snapshot trigger ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION snapshot_preliminary_on_finalize()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.price_stage = 'final' AND OLD.price_stage = 'preliminary' THEN
    IF NEW.preliminary_quotation IS NULL THEN
      NEW.preliminary_quotation := OLD.quotation;
      NEW.preliminary_price     := OLD.price;
      NEW.preliminary_fx_rate   := OLD.fx_rate;
      NEW.preliminary_set_at    := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Recompute RPC ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recompute_line_shipment_prices(
  p_line_id UUID,
  p_side    TEXT
) RETURNS INT AS $$
DECLARE
  v_price          NUMERIC;
  v_discount       NUMERIC;
  v_quotation      NUMERIC;
  v_fx             NUMERIC;
  v_condition      TEXT;
  v_quotation_type UUID;
  v_stage          TEXT;
  v_year           INT;
  v_month          INT;
  v_monthly_avg    NUMERIC;
  v_final_price    NUMERIC;
  v_final_quote    NUMERIC;
  v_volume         NUMERIC;
  r                RECORD;
  v_count          INT := 0;
BEGIN
  IF p_side NOT IN ('supplier', 'buyer') THEN
    RAISE EXCEPTION 'side must be supplier or buyer, got %', p_side;
  END IF;

  IF p_side = 'supplier' THEN
    SELECT price, COALESCE(discount, 0), quotation, fx_rate,
           price_condition::TEXT, quotation_type_id, price_stage
      INTO v_price, v_discount, v_quotation, v_fx,
           v_condition, v_quotation_type, v_stage
    FROM deal_supplier_lines WHERE id = p_line_id;
  ELSE
    SELECT price, COALESCE(discount, 0), quotation, fx_rate,
           price_condition::TEXT, quotation_type_id, price_stage
      INTO v_price, v_discount, v_quotation, v_fx,
           v_condition, v_quotation_type, v_stage
    FROM deal_buyer_lines WHERE id = p_line_id;
  END IF;

  -- manual_formula needs quotation + fx_rate; other modes need price.
  IF v_price IS NULL
     AND v_condition NOT IN ('average_month', 'manual_formula') THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT sr.id, sr.date, sr.shipment_month, sr.deal_id,
           CASE WHEN p_side = 'supplier' THEN sr.loading_volume ELSE sr.shipment_volume END AS vol
    FROM shipment_registry sr
    WHERE CASE WHEN p_side = 'supplier'
               THEN sr.supplier_line_id = p_line_id
               ELSE sr.buyer_line_id    = p_line_id END
  LOOP
    v_volume := r.vol;
    IF v_volume IS NULL THEN
      CONTINUE;
    END IF;

    SELECT y, m INTO v_year, v_month
    FROM resolve_shipment_year_month(r.date, r.shipment_month, r.deal_id);

    v_final_price := v_price;
    v_final_quote := NULL;

    IF v_stage = 'final' THEN
      IF v_condition = 'average_month'
         AND v_quotation_type IS NOT NULL
         AND v_year IS NOT NULL AND v_month IS NOT NULL THEN
        v_monthly_avg := compute_monthly_quotation_avg(v_quotation_type, v_year, v_month);
        IF v_monthly_avg IS NOT NULL THEN
          v_final_quote := v_monthly_avg;
          v_final_price := v_monthly_avg - COALESCE(v_discount, 0);
        END IF;
      ELSIF v_condition = 'manual_formula'
            AND v_quotation IS NOT NULL AND v_fx IS NOT NULL THEN
        v_final_quote := v_quotation;
        v_final_price := (v_quotation - COALESCE(v_discount, 0)) * v_fx;
      END IF;
    END IF;

    IF v_final_price IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE deal_shipment_prices
      SET quotation_avg = v_final_quote,
          calculated_price = v_final_price,
          discount = v_discount,
          volume = v_volume,
          amount = v_volume * v_final_price,
          shipment_date = r.date
    WHERE shipment_registry_id = r.id AND side = p_side;

    IF NOT FOUND THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, quotation_avg, calculated_price, amount, discount
      ) VALUES (
        r.deal_id, p_side, r.id,
        r.date, v_volume, v_final_quote, v_final_price,
        v_volume * v_final_price, v_discount
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION recompute_line_shipment_prices(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION recompute_line_shipment_prices(UUID, TEXT) TO service_role;

-- ── 4. autoprice trigger: handle manual_formula on shipment INSERT ──

CREATE OR REPLACE FUNCTION autoprice_registry_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_sup_price          NUMERIC;
  v_sup_discount       NUMERIC;
  v_sup_quotation      NUMERIC;
  v_sup_fx             NUMERIC;
  v_sup_condition      TEXT;
  v_sup_quotation_type UUID;
  v_sup_stage          TEXT;
  v_buy_price          NUMERIC;
  v_buy_discount       NUMERIC;
  v_buy_quotation      NUMERIC;
  v_buy_fx             NUMERIC;
  v_buy_condition      TEXT;
  v_buy_quotation_type UUID;
  v_buy_stage          TEXT;
  v_year               INT;
  v_month              INT;
  v_monthly_avg        NUMERIC;
  v_final_price        NUMERIC;
  v_final_quotation    NUMERIC;
BEGIN
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT y, m INTO v_year, v_month
  FROM resolve_shipment_year_month(NEW.date, NEW.shipment_month, NEW.deal_id);

  -- Supplier side: налив
  IF NEW.loading_volume IS NOT NULL THEN
    IF NEW.supplier_line_id IS NOT NULL THEN
      SELECT price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage
        INTO v_sup_price, v_sup_discount, v_sup_quotation, v_sup_fx,
             v_sup_condition, v_sup_quotation_type, v_sup_stage
      FROM deal_supplier_lines
      WHERE id = NEW.supplier_line_id;
    ELSE
      SELECT price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage
        INTO v_sup_price, v_sup_discount, v_sup_quotation, v_sup_fx,
             v_sup_condition, v_sup_quotation_type, v_sup_stage
      FROM deal_supplier_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    v_final_price     := v_sup_price;
    v_final_quotation := NULL;

    IF v_sup_stage = 'final' THEN
      IF v_sup_condition = 'average_month'
         AND v_sup_quotation_type IS NOT NULL
         AND v_year IS NOT NULL AND v_month IS NOT NULL THEN
        v_monthly_avg := compute_monthly_quotation_avg(v_sup_quotation_type, v_year, v_month);
        IF v_monthly_avg IS NOT NULL THEN
          v_final_quotation := v_monthly_avg;
          v_final_price     := v_monthly_avg - COALESCE(v_sup_discount, 0);
        END IF;
      ELSIF v_sup_condition = 'manual_formula'
            AND v_sup_quotation IS NOT NULL AND v_sup_fx IS NOT NULL THEN
        v_final_quotation := v_sup_quotation;
        v_final_price     := (v_sup_quotation - COALESCE(v_sup_discount, 0)) * v_sup_fx;
      END IF;
    END IF;

    IF v_final_price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, quotation_avg, calculated_price, amount, discount
      ) VALUES (
        NEW.deal_id, 'supplier', NEW.id,
        NEW.date, NEW.loading_volume, v_final_quotation, v_final_price,
        NEW.loading_volume * v_final_price,
        v_sup_discount
      );
    END IF;
  END IF;

  -- Buyer side: отгрузка
  IF NEW.shipment_volume IS NOT NULL THEN
    IF NEW.buyer_line_id IS NOT NULL THEN
      SELECT price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage
        INTO v_buy_price, v_buy_discount, v_buy_quotation, v_buy_fx,
             v_buy_condition, v_buy_quotation_type, v_buy_stage
      FROM deal_buyer_lines
      WHERE id = NEW.buyer_line_id;
    ELSE
      SELECT price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage
        INTO v_buy_price, v_buy_discount, v_buy_quotation, v_buy_fx,
             v_buy_condition, v_buy_quotation_type, v_buy_stage
      FROM deal_buyer_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    v_final_price     := v_buy_price;
    v_final_quotation := NULL;

    IF v_buy_stage = 'final' THEN
      IF v_buy_condition = 'average_month'
         AND v_buy_quotation_type IS NOT NULL
         AND v_year IS NOT NULL AND v_month IS NOT NULL THEN
        v_monthly_avg := compute_monthly_quotation_avg(v_buy_quotation_type, v_year, v_month);
        IF v_monthly_avg IS NOT NULL THEN
          v_final_quotation := v_monthly_avg;
          v_final_price     := v_monthly_avg - COALESCE(v_buy_discount, 0);
        END IF;
      ELSIF v_buy_condition = 'manual_formula'
            AND v_buy_quotation IS NOT NULL AND v_buy_fx IS NOT NULL THEN
        v_final_quotation := v_buy_quotation;
        v_final_price     := (v_buy_quotation - COALESCE(v_buy_discount, 0)) * v_buy_fx;
      END IF;
    END IF;

    IF v_final_price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, quotation_avg, calculated_price, amount, discount
      ) VALUES (
        NEW.deal_id, 'buyer', NEW.id,
        NEW.date, NEW.shipment_volume, v_final_quotation, v_final_price,
        NEW.shipment_volume * v_final_price,
        v_buy_discount
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

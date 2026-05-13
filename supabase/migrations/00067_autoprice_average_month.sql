-- «Средний месяц» — per-shipment monthly avg pricing
--
-- Per the product owner: when a variant has price_condition = 'average_month',
-- the final price is computed per shipment month, not as one number for the
-- whole deal. A deal that spans March + April gets one March monthly-avg
-- applied to March shipments and a separate April monthly-avg applied to
-- April shipments. One registry row → one deal_shipment_prices row, just
-- like trigger mode, but the price source is the monthly avg of `quotations`
-- for that shipment's month.
--
-- 00059 was the previous version of autoprice_registry_insert. We replace it
-- here so the trigger fork handles the new mode. All other modes keep the
-- prior behavior (variant.price × volume).
--
-- We do NOT backfill existing deal_shipment_prices rows in this migration —
-- keeping it cheap. If the user wants to backfill, they can re-fire the
-- propagate triggers (e.g. UPDATE deal_supplier_lines SET price = price
-- WHERE price_condition = 'average_month') or delete the rows and reinsert
-- the registry rows.

-- ─── 1. Helper: monthly avg from quotations (callable from trigger + RPC) ──

CREATE OR REPLACE FUNCTION compute_monthly_quotation_avg(
  p_product_type_id UUID,
  p_year INT,
  p_month INT
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg NUMERIC;
  v_start DATE;
  v_end DATE;
BEGIN
  IF p_product_type_id IS NULL OR p_year IS NULL OR p_month IS NULL THEN
    RETURN NULL;
  END IF;

  v_start := make_date(p_year, p_month, 1);
  v_end   := (v_start + INTERVAL '1 month')::DATE;

  SELECT AVG(price_val)
    INTO v_avg
  FROM (
    SELECT COALESCE(price, price_cif_nwe, price_fob_rotterdam, price_fob_med) AS price_val
    FROM quotations
    WHERE product_type_id = p_product_type_id
      AND date >= v_start
      AND date <  v_end
  ) q
  WHERE price_val IS NOT NULL;

  RETURN v_avg;
END;
$$;

GRANT EXECUTE ON FUNCTION compute_monthly_quotation_avg(UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION compute_monthly_quotation_avg(UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION compute_monthly_quotation_avg(UUID, INT, INT) TO anon;

-- ─── 2. Helper: derive (year, month) for a shipment row ────────────────────
-- Prefer the actual `date`; fall back to parsing `shipment_month` (Russian
-- month-name) against the deal's `year`. Returns NULL on either component
-- when nothing usable is found.

CREATE OR REPLACE FUNCTION resolve_shipment_year_month(
  p_date DATE,
  p_shipment_month TEXT,
  p_deal_id UUID,
  OUT y INT,
  OUT m INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_norm TEXT;
  v_deal_year INT;
BEGIN
  y := NULL;
  m := NULL;

  IF p_date IS NOT NULL THEN
    y := EXTRACT(YEAR  FROM p_date)::INT;
    m := EXTRACT(MONTH FROM p_date)::INT;
    RETURN;
  END IF;

  IF p_shipment_month IS NULL OR p_deal_id IS NULL THEN
    RETURN;
  END IF;

  v_norm := lower(trim(p_shipment_month));
  m := CASE v_norm
    WHEN 'январь'   THEN 1  WHEN 'января'   THEN 1
    WHEN 'февраль'  THEN 2  WHEN 'февраля'  THEN 2
    WHEN 'март'     THEN 3  WHEN 'марта'    THEN 3
    WHEN 'апрель'   THEN 4  WHEN 'апреля'   THEN 4
    WHEN 'май'      THEN 5  WHEN 'мая'      THEN 5
    WHEN 'июнь'     THEN 6  WHEN 'июня'     THEN 6
    WHEN 'июль'     THEN 7  WHEN 'июля'     THEN 7
    WHEN 'август'   THEN 8  WHEN 'августа'  THEN 8
    WHEN 'сентябрь' THEN 9  WHEN 'сентября' THEN 9
    WHEN 'октябрь'  THEN 10 WHEN 'октября'  THEN 10
    WHEN 'ноябрь'   THEN 11 WHEN 'ноября'   THEN 11
    WHEN 'декабрь'  THEN 12 WHEN 'декабря'  THEN 12
    ELSE NULL
  END;

  IF m IS NULL THEN
    RETURN;
  END IF;

  SELECT year INTO v_deal_year FROM deals WHERE id = p_deal_id;
  IF v_deal_year IS NULL THEN
    m := NULL;
    RETURN;
  END IF;

  y := v_deal_year;
END;
$$;

-- ─── 3. Replace autoprice_registry_insert with average_month branch ────────

CREATE OR REPLACE FUNCTION autoprice_registry_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_sup_price          NUMERIC;
  v_sup_discount       NUMERIC;
  v_sup_condition      TEXT;
  v_sup_quotation_type UUID;
  v_buy_price          NUMERIC;
  v_buy_discount       NUMERIC;
  v_buy_condition      TEXT;
  v_buy_quotation_type UUID;
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

  -- ─── Supplier side: налив (loading_volume) ──────────────────────────────
  IF NEW.loading_volume IS NOT NULL THEN
    IF NEW.supplier_line_id IS NOT NULL THEN
      SELECT price, COALESCE(discount, 0), price_condition::TEXT, quotation_type_id
        INTO v_sup_price, v_sup_discount, v_sup_condition, v_sup_quotation_type
      FROM deal_supplier_lines
      WHERE id = NEW.supplier_line_id;
    ELSE
      SELECT price, COALESCE(discount, 0), price_condition::TEXT, quotation_type_id
        INTO v_sup_price, v_sup_discount, v_sup_condition, v_sup_quotation_type
      FROM deal_supplier_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    v_final_price     := v_sup_price;
    v_final_quotation := NULL;

    IF v_sup_condition = 'average_month' AND v_sup_quotation_type IS NOT NULL
       AND v_year IS NOT NULL AND v_month IS NOT NULL THEN
      v_monthly_avg := compute_monthly_quotation_avg(v_sup_quotation_type, v_year, v_month);
      IF v_monthly_avg IS NOT NULL THEN
        v_final_quotation := v_monthly_avg;
        v_final_price     := v_monthly_avg - COALESCE(v_sup_discount, 0);
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

  -- ─── Buyer side: отгрузка (shipment_volume) ─────────────────────────────
  IF NEW.shipment_volume IS NOT NULL THEN
    IF NEW.buyer_line_id IS NOT NULL THEN
      SELECT price, COALESCE(discount, 0), price_condition::TEXT, quotation_type_id
        INTO v_buy_price, v_buy_discount, v_buy_condition, v_buy_quotation_type
      FROM deal_buyer_lines
      WHERE id = NEW.buyer_line_id;
    ELSE
      SELECT price, COALESCE(discount, 0), price_condition::TEXT, quotation_type_id
        INTO v_buy_price, v_buy_discount, v_buy_condition, v_buy_quotation_type
      FROM deal_buyer_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    v_final_price     := v_buy_price;
    v_final_quotation := NULL;

    IF v_buy_condition = 'average_month' AND v_buy_quotation_type IS NOT NULL
       AND v_year IS NOT NULL AND v_month IS NOT NULL THEN
      v_monthly_avg := compute_monthly_quotation_avg(v_buy_quotation_type, v_year, v_month);
      IF v_monthly_avg IS NOT NULL THEN
        v_final_quotation := v_monthly_avg;
        v_final_price     := v_monthly_avg - COALESCE(v_buy_discount, 0);
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

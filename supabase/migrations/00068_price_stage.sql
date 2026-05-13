-- Price stage workflow: Preliminary → Final.
--
-- Background (product spec, 2026-05-13):
-- For formula-mode variants the manager works in two phases:
--   1. Preliminary  — set at the time of signing the contract. The
--      number is a plan estimate (typed manually or pulled from
--      `quotations`). All early shipments use this number for
--      provisional invoicing.
--   2. Final       — once the quotation period closes, the manager
--      flips the variant to Final. All shipments that already happened
--      get re-priced against the actual settlement rule (monthly avg
--      / trigger window); new shipments use the Final rule too.
--
-- The preliminary number must survive the flip for audit/history.
-- That snapshot lives on the line itself in three new columns.
--
-- Also new: `selected_month` — for average_month variants the manager
-- can pick a specific month for the monthly-avg lookup that overrides
-- the deal's own month (useful when the variant is pre-priced against
-- a different month than the deal's calendar month).
--
-- This migration:
--   1. Adds columns.
--   2. Wires a BEFORE UPDATE trigger that snapshots quotation/price
--      into preliminary_* the first time stage flips to 'final'.
--   3. Adds `recompute_line_shipment_prices(line_id, side)` RPC so
--      the frontend can refire pricing for an entire variant after
--      the flip.
--   4. Updates `autoprice_registry_insert` so per-shipment monthly avg
--      runs ONLY when stage = 'final'. Preliminary stage keeps using
--      the line's literal `price` (so shipments land with the
--      preliminary number until the manager finalizes).

-- ── 1. Columns ──────────────────────────────────────────────────────

ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS price_stage TEXT NOT NULL DEFAULT 'preliminary'
    CHECK (price_stage IN ('preliminary', 'final')),
  ADD COLUMN IF NOT EXISTS preliminary_quotation NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS preliminary_price NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS preliminary_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_month TEXT;

ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS price_stage TEXT NOT NULL DEFAULT 'preliminary'
    CHECK (price_stage IN ('preliminary', 'final')),
  ADD COLUMN IF NOT EXISTS preliminary_quotation NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS preliminary_price NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS preliminary_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_month TEXT;

-- ── 2. Snapshot trigger (one per side) ──────────────────────────────

CREATE OR REPLACE FUNCTION snapshot_preliminary_on_finalize()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.price_stage = 'final' AND OLD.price_stage = 'preliminary' THEN
    IF NEW.preliminary_quotation IS NULL THEN
      NEW.preliminary_quotation := OLD.quotation;
      NEW.preliminary_price     := OLD.price;
      NEW.preliminary_set_at    := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_lines_snapshot_preliminary ON deal_supplier_lines;
CREATE TRIGGER trg_supplier_lines_snapshot_preliminary
  BEFORE UPDATE ON deal_supplier_lines
  FOR EACH ROW EXECUTE FUNCTION snapshot_preliminary_on_finalize();

DROP TRIGGER IF EXISTS trg_buyer_lines_snapshot_preliminary ON deal_buyer_lines;
CREATE TRIGGER trg_buyer_lines_snapshot_preliminary
  BEFORE UPDATE ON deal_buyer_lines
  FOR EACH ROW EXECUTE FUNCTION snapshot_preliminary_on_finalize();

-- ── 3. Recompute RPC ────────────────────────────────────────────────
--
-- Reuses the same formula as autoprice_registry_insert but runs on
-- the existing set of shipment_registry rows pinned to a given line.
-- Called by the frontend after the manager flips a variant to final
-- so that the previously-preliminary shipments pick up the final
-- (per-month or trigger) prices in one go.

CREATE OR REPLACE FUNCTION recompute_line_shipment_prices(
  p_line_id UUID,
  p_side    TEXT
) RETURNS INT AS $$
DECLARE
  v_price          NUMERIC;
  v_discount       NUMERIC;
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

  -- Pull line config.
  IF p_side = 'supplier' THEN
    SELECT price, COALESCE(discount, 0), price_condition::TEXT, quotation_type_id, price_stage
      INTO v_price, v_discount, v_condition, v_quotation_type, v_stage
    FROM deal_supplier_lines WHERE id = p_line_id;
  ELSE
    SELECT price, COALESCE(discount, 0), price_condition::TEXT, quotation_type_id, price_stage
      INTO v_price, v_discount, v_condition, v_quotation_type, v_stage
    FROM deal_buyer_lines WHERE id = p_line_id;
  END IF;

  IF v_price IS NULL AND v_condition <> 'average_month' THEN
    RETURN 0;
  END IF;

  -- Iterate over all shipments under this line.
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

    -- Final-stage formulae:
    --   average_month → monthly avg of quotations for the shipment month
    --   trigger       → (TODO once trigger flow is wired) — fall back
    --                   to line.price for now
    --   fixed/manual  → line.price as-is
    IF v_stage = 'final'
       AND v_condition = 'average_month'
       AND v_quotation_type IS NOT NULL
       AND v_year IS NOT NULL AND v_month IS NOT NULL THEN
      v_monthly_avg := compute_monthly_quotation_avg(v_quotation_type, v_year, v_month);
      IF v_monthly_avg IS NOT NULL THEN
        v_final_quote := v_monthly_avg;
        v_final_price := v_monthly_avg - COALESCE(v_discount, 0);
      END IF;
    END IF;

    IF v_final_price IS NULL THEN
      CONTINUE;
    END IF;

    -- Upsert the deal_shipment_prices row for this (registry, side).
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

-- ── 4. autoprice_registry_insert: respect price_stage ───────────────
--
-- Preliminary stage ⇒ always use line.price (the manager's
-- provisional number). Final stage ⇒ for average_month, fetch monthly
-- avg per shipment as in 00067.

CREATE OR REPLACE FUNCTION autoprice_registry_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_sup_price          NUMERIC;
  v_sup_discount       NUMERIC;
  v_sup_condition      TEXT;
  v_sup_quotation_type UUID;
  v_sup_stage          TEXT;
  v_buy_price          NUMERIC;
  v_buy_discount       NUMERIC;
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
      SELECT price, COALESCE(discount, 0), price_condition::TEXT, quotation_type_id, price_stage
        INTO v_sup_price, v_sup_discount, v_sup_condition, v_sup_quotation_type, v_sup_stage
      FROM deal_supplier_lines
      WHERE id = NEW.supplier_line_id;
    ELSE
      SELECT price, COALESCE(discount, 0), price_condition::TEXT, quotation_type_id, price_stage
        INTO v_sup_price, v_sup_discount, v_sup_condition, v_sup_quotation_type, v_sup_stage
      FROM deal_supplier_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    v_final_price     := v_sup_price;
    v_final_quotation := NULL;

    IF v_sup_stage = 'final'
       AND v_sup_condition = 'average_month'
       AND v_sup_quotation_type IS NOT NULL
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

  -- Buyer side: отгрузка
  IF NEW.shipment_volume IS NOT NULL THEN
    IF NEW.buyer_line_id IS NOT NULL THEN
      SELECT price, COALESCE(discount, 0), price_condition::TEXT, quotation_type_id, price_stage
        INTO v_buy_price, v_buy_discount, v_buy_condition, v_buy_quotation_type, v_buy_stage
      FROM deal_buyer_lines
      WHERE id = NEW.buyer_line_id;
    ELSE
      SELECT price, COALESCE(discount, 0), price_condition::TEXT, quotation_type_id, price_stage
        INTO v_buy_price, v_buy_discount, v_buy_condition, v_buy_quotation_type, v_buy_stage
      FROM deal_buyer_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    v_final_price     := v_buy_price;
    v_final_quotation := NULL;

    IF v_buy_stage = 'final'
       AND v_buy_condition = 'average_month'
       AND v_buy_quotation_type IS NOT NULL
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

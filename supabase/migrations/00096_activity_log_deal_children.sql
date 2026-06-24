-- Log deal-child row changes to the activity feed.
--
-- 00087/00088 only watched the `deals` table itself. Operator request
-- 2026-06-24: «Все действия по сделкам (паспорту) должны логироваться и
-- показываться в activities. Например: если логист добавил отгрузку или
-- налив в реестре по определенной сделке, мы должны это видеть».
--
-- This migration adds AFTER INSERT / UPDATE / DELETE triggers on every
-- child table that hangs off a deal:
--   * shipment_registry  → type 'shipment'    (вагон, объём, дата)
--   * deal_payments      → type 'payment'     (per-row payments, in addition
--                                              to the 00087 rollup delta)
--   * deal_supplier_lines→ type 'system'      (variant pricing line edits)
--   * deal_buyer_lines   → type 'system'
--   * deal_company_groups→ type 'system'      (company chain link edits)
--   * deal_attachments   → type 'attachment'  (file uploads / removals)
--
-- Conventions (mirroring 00088):
--   - All functions SECURITY DEFINER so they bypass RLS to write
--     deal_activity. auth.uid() captured once at the top of each fn and
--     passed to every INSERT — gives us «who did it» on the feed.
--   - Skip when the parent deal is_draft = TRUE. The draft → real flip
--     is one bulk write we don't want to flood the chat with (same trap
--     00088 already navigates for deals updates, and the same trap that
--     the default-line seeders in 00053 would hit if we logged their
--     INSERT — see deals AFTER INSERT trigger trg_seed_default_*_line).
--   - UPDATE triggers only fire INSERTs when a *meaningful* field
--     changed (IS DISTINCT FROM checks). Plain `updated_at` bumps do
--     not flood the feed.
--   - COALESCE(NEW.deal_id, OLD.deal_id) so DELETE triggers still
--     resolve to the parent deal.
--
-- Note: 00087 logs the *rollup* on deals.supplier_payment /
-- deals.buyer_payment as one «Оплата поставщику: 7 000 000» line. Per-row
-- INSERT logging here is additive — it records the individual ledger
-- entry behind that rollup (date, side, currency, type). Useful when an
-- operator deletes a single payment row: the rollup delta on deals will
-- log a negative number, but only the row-level trigger here knows
-- *which* payment was removed.

-- =====================================================================
-- helpers
-- =====================================================================

CREATE OR REPLACE FUNCTION _activity_is_draft_deal(p_deal_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_draft BOOLEAN;
BEGIN
  SELECT COALESCE(is_draft, FALSE) INTO v_is_draft FROM deals WHERE id = p_deal_id;
  -- Missing parent (DELETE cascade with no deal row) → treat as draft to
  -- skip. The deal row going away takes its activity with it.
  RETURN COALESCE(v_is_draft, TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Pretty-format a number in RU style with up to 3 fractional digits.
-- Used for tonnage / amounts in human-readable content strings.
CREATE OR REPLACE FUNCTION _activity_fmt_num(p NUMERIC)
RETURNS TEXT AS $$
BEGIN
  IF p IS NULL THEN RETURN '—'; END IF;
  -- 3 fraction digits is enough for тонны; trailing zeros are kept on
  -- purpose so «54.719 → 60.000» reads symmetrically.
  RETURN to_char(p, 'FM999999990.000');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================================
-- shipment_registry
-- =====================================================================

CREATE OR REPLACE FUNCTION log_shipment_registry_change()
RETURNS TRIGGER AS $$
DECLARE
  v_user UUID := auth.uid();
  v_deal_id UUID := COALESCE(NEW.deal_id, OLD.deal_id);
  v_content TEXT;
  v_metadata JSONB;
  v_changes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF v_deal_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF _activity_is_draft_deal(v_deal_id) THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    v_content := 'Добавлена отгрузка'
      || COALESCE(': вагон ' || NEW.wagon_number, '')
      || COALESCE(', объём ' || _activity_fmt_num(NEW.shipment_volume) || ' т', '')
      || COALESCE(' (' || to_char(NEW.date, 'DD.MM.YYYY') || ')', '');
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'wagon_number', NEW.wagon_number,
      'waybill_number', NEW.waybill_number,
      'shipment_volume', NEW.shipment_volume,
      'date', NEW.date,
      'registry_type', NEW.registry_type
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'shipment', v_content, v_metadata);

  ELSIF TG_OP = 'DELETE' THEN
    v_content := 'Удалена отгрузка'
      || COALESCE(': вагон ' || OLD.wagon_number, '')
      || COALESCE(', объём ' || _activity_fmt_num(OLD.shipment_volume) || ' т', '');
    v_metadata := jsonb_build_object(
      'row_id', OLD.id,
      'wagon_number', OLD.wagon_number,
      'waybill_number', OLD.waybill_number,
      'shipment_volume', OLD.shipment_volume,
      'date', OLD.date,
      'registry_type', OLD.registry_type
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'shipment', v_content, v_metadata);

  ELSIF TG_OP = 'UPDATE' THEN
    -- Build a list of changed fields so we don't fire on no-op updates
    -- (e.g. updated_at bumps via trg_shipment_registry_updated).
    IF OLD.wagon_number IS DISTINCT FROM NEW.wagon_number THEN
      v_changes := v_changes || ('вагон ' || COALESCE(OLD.wagon_number, '—') || ' → ' || COALESCE(NEW.wagon_number, '—'));
    END IF;
    IF OLD.waybill_number IS DISTINCT FROM NEW.waybill_number THEN
      v_changes := v_changes || ('накладная ' || COALESCE(OLD.waybill_number, '—') || ' → ' || COALESCE(NEW.waybill_number, '—'));
    END IF;
    IF OLD.shipment_volume IS DISTINCT FROM NEW.shipment_volume THEN
      v_changes := v_changes || ('объём ' || _activity_fmt_num(OLD.shipment_volume) || ' → ' || _activity_fmt_num(NEW.shipment_volume));
    END IF;
    IF OLD.date IS DISTINCT FROM NEW.date THEN
      v_changes := v_changes || ('дата ' || COALESCE(to_char(OLD.date, 'DD.MM.YYYY'), '—') || ' → ' || COALESCE(to_char(NEW.date, 'DD.MM.YYYY'), '—'));
    END IF;
    IF OLD.shipped_tonnage_amount IS DISTINCT FROM NEW.shipped_tonnage_amount THEN
      v_changes := v_changes || ('тоннаж ' || _activity_fmt_num(OLD.shipped_tonnage_amount) || ' → ' || _activity_fmt_num(NEW.shipped_tonnage_amount));
    END IF;
    IF OLD.rounded_tonnage_from_forwarder IS DISTINCT FROM NEW.rounded_tonnage_from_forwarder THEN
      v_changes := v_changes || ('округл. тоннаж ' || _activity_fmt_num(OLD.rounded_tonnage_from_forwarder) || ' → ' || _activity_fmt_num(NEW.rounded_tonnage_from_forwarder));
    END IF;
    IF OLD.railway_tariff IS DISTINCT FROM NEW.railway_tariff THEN
      v_changes := v_changes || ('ж/д тариф ' || _activity_fmt_num(OLD.railway_tariff) || ' → ' || _activity_fmt_num(NEW.railway_tariff));
    END IF;
    IF OLD.invoice_number IS DISTINCT FROM NEW.invoice_number THEN
      v_changes := v_changes || ('счёт-фактура ' || COALESCE(OLD.invoice_number, '—') || ' → ' || COALESCE(NEW.invoice_number, '—'));
    END IF;
    IF OLD.comment IS DISTINCT FROM NEW.comment THEN
      v_changes := v_changes || ('комментарий изменён');
    END IF;

    IF array_length(v_changes, 1) IS NULL THEN
      RETURN NEW; -- no meaningful change
    END IF;

    v_content := 'Изменена отгрузка'
      || COALESCE(': вагон ' || NEW.wagon_number, '')
      || ' (' || array_to_string(v_changes, ', ') || ')';
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'wagon_number', NEW.wagon_number,
      'old', jsonb_build_object(
        'wagon_number', OLD.wagon_number,
        'waybill_number', OLD.waybill_number,
        'shipment_volume', OLD.shipment_volume,
        'date', OLD.date,
        'shipped_tonnage_amount', OLD.shipped_tonnage_amount,
        'rounded_tonnage_from_forwarder', OLD.rounded_tonnage_from_forwarder,
        'railway_tariff', OLD.railway_tariff,
        'invoice_number', OLD.invoice_number
      ),
      'new', jsonb_build_object(
        'wagon_number', NEW.wagon_number,
        'waybill_number', NEW.waybill_number,
        'shipment_volume', NEW.shipment_volume,
        'date', NEW.date,
        'shipped_tonnage_amount', NEW.shipped_tonnage_amount,
        'rounded_tonnage_from_forwarder', NEW.rounded_tonnage_from_forwarder,
        'railway_tariff', NEW.railway_tariff,
        'invoice_number', NEW.invoice_number
      )
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'shipment', v_content, v_metadata);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_shipment_registry_activity ON shipment_registry;
CREATE TRIGGER trg_shipment_registry_activity
  AFTER INSERT OR UPDATE OR DELETE ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION log_shipment_registry_change();

-- =====================================================================
-- deal_payments  (per-row ledger entry, additive to 00087 rollup)
-- =====================================================================

CREATE OR REPLACE FUNCTION log_deal_payments_change()
RETURNS TRIGGER AS $$
DECLARE
  v_user UUID := auth.uid();
  v_deal_id UUID := COALESCE(NEW.deal_id, OLD.deal_id);
  v_content TEXT;
  v_metadata JSONB;
  v_changes TEXT[] := ARRAY[]::TEXT[];
  v_side_label TEXT;
  v_kind_label TEXT;
BEGIN
  IF v_deal_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF _activity_is_draft_deal(v_deal_id) THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    v_side_label := CASE WHEN NEW.side = 'supplier' THEN 'поставщику' ELSE 'покупателя' END;
    v_kind_label := CASE NEW.payment_type
      WHEN 'refund' THEN 'Возврат'
      WHEN 'offset' THEN 'Перезачет'
      ELSE 'Оплата' END;
    v_content := v_kind_label || ' ' || v_side_label
      || ': ' || _activity_fmt_num(NEW.amount)
      || COALESCE(' ' || NEW.currency, '')
      || COALESCE(' (' || to_char(NEW.payment_date, 'DD.MM.YYYY') || ')', '');
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'side', NEW.side,
      'payment_type', NEW.payment_type,
      'amount', NEW.amount,
      'currency', NEW.currency,
      'payment_date', NEW.payment_date,
      'description', NEW.description
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'payment', v_content, v_metadata);

  ELSIF TG_OP = 'DELETE' THEN
    v_side_label := CASE WHEN OLD.side = 'supplier' THEN 'поставщику' ELSE 'покупателя' END;
    v_content := 'Удалена оплата ' || v_side_label
      || ': ' || _activity_fmt_num(OLD.amount)
      || COALESCE(' ' || OLD.currency, '');
    v_metadata := jsonb_build_object(
      'row_id', OLD.id,
      'side', OLD.side,
      'payment_type', OLD.payment_type,
      'amount', OLD.amount,
      'currency', OLD.currency,
      'payment_date', OLD.payment_date,
      'description', OLD.description
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'payment', v_content, v_metadata);

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.amount IS DISTINCT FROM NEW.amount THEN
      v_changes := v_changes || ('сумма ' || _activity_fmt_num(OLD.amount) || ' → ' || _activity_fmt_num(NEW.amount));
    END IF;
    IF OLD.payment_date IS DISTINCT FROM NEW.payment_date THEN
      v_changes := v_changes || ('дата ' || COALESCE(to_char(OLD.payment_date, 'DD.MM.YYYY'), '—') || ' → ' || COALESCE(to_char(NEW.payment_date, 'DD.MM.YYYY'), '—'));
    END IF;
    IF OLD.currency IS DISTINCT FROM NEW.currency THEN
      v_changes := v_changes || ('валюта ' || COALESCE(OLD.currency, '—') || ' → ' || COALESCE(NEW.currency, '—'));
    END IF;
    IF OLD.payment_type IS DISTINCT FROM NEW.payment_type THEN
      v_changes := v_changes || ('тип ' || OLD.payment_type || ' → ' || NEW.payment_type);
    END IF;
    IF OLD.side IS DISTINCT FROM NEW.side THEN
      v_changes := v_changes || ('сторона ' || OLD.side || ' → ' || NEW.side);
    END IF;
    IF OLD.description IS DISTINCT FROM NEW.description THEN
      v_changes := v_changes || ('описание изменено');
    END IF;

    IF array_length(v_changes, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    v_side_label := CASE WHEN NEW.side = 'supplier' THEN 'поставщику' ELSE 'покупателя' END;
    v_content := 'Изменена оплата ' || v_side_label
      || ' (' || array_to_string(v_changes, ', ') || ')';
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'side', NEW.side,
      'old', jsonb_build_object(
        'amount', OLD.amount,
        'currency', OLD.currency,
        'payment_date', OLD.payment_date,
        'payment_type', OLD.payment_type,
        'description', OLD.description
      ),
      'new', jsonb_build_object(
        'amount', NEW.amount,
        'currency', NEW.currency,
        'payment_date', NEW.payment_date,
        'payment_type', NEW.payment_type,
        'description', NEW.description
      )
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'payment', v_content, v_metadata);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deal_payments_activity ON deal_payments;
CREATE TRIGGER trg_deal_payments_activity
  AFTER INSERT OR UPDATE OR DELETE ON deal_payments
  FOR EACH ROW EXECUTE FUNCTION log_deal_payments_change();

-- =====================================================================
-- deal_supplier_lines / deal_buyer_lines
-- =====================================================================

CREATE OR REPLACE FUNCTION log_deal_supplier_line_change()
RETURNS TRIGGER AS $$
DECLARE
  v_user UUID := auth.uid();
  v_deal_id UUID := COALESCE(NEW.deal_id, OLD.deal_id);
  v_content TEXT;
  v_metadata JSONB;
  v_changes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF v_deal_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF _activity_is_draft_deal(v_deal_id) THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    -- Skip the default-line that gets seeded for every new deal
    -- (00053 trg_seed_default_supplier_line). Default-line edits *after*
    -- the deal is real are interesting though, so only INSERT is muted.
    IF COALESCE(NEW.is_default, FALSE) THEN
      RETURN NEW;
    END IF;
    v_content := 'Добавлена линия поставщика #' || NEW.position
      || COALESCE(': цена ' || _activity_fmt_num(NEW.price), '');
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'side', 'supplier',
      'position', NEW.position,
      'is_default', NEW.is_default,
      'price', NEW.price,
      'quotation', NEW.quotation,
      'discount', NEW.discount,
      'delivery_basis', NEW.delivery_basis
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'system', v_content, v_metadata);

  ELSIF TG_OP = 'DELETE' THEN
    v_content := 'Удалена линия поставщика #' || OLD.position;
    v_metadata := jsonb_build_object(
      'row_id', OLD.id,
      'side', 'supplier',
      'position', OLD.position,
      'price', OLD.price,
      'quotation', OLD.quotation,
      'discount', OLD.discount
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'system', v_content, v_metadata);

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.price IS DISTINCT FROM NEW.price THEN
      v_changes := v_changes || ('цена ' || _activity_fmt_num(OLD.price) || ' → ' || _activity_fmt_num(NEW.price));
    END IF;
    IF OLD.quotation IS DISTINCT FROM NEW.quotation THEN
      v_changes := v_changes || ('котировка ' || _activity_fmt_num(OLD.quotation) || ' → ' || _activity_fmt_num(NEW.quotation));
    END IF;
    IF OLD.discount IS DISTINCT FROM NEW.discount THEN
      v_changes := v_changes || ('скидка ' || _activity_fmt_num(OLD.discount) || ' → ' || _activity_fmt_num(NEW.discount));
    END IF;
    IF OLD.delivery_basis IS DISTINCT FROM NEW.delivery_basis THEN
      v_changes := v_changes || ('базис ' || COALESCE(OLD.delivery_basis, '—') || ' → ' || COALESCE(NEW.delivery_basis, '—'));
    END IF;
    IF OLD.price_condition IS DISTINCT FROM NEW.price_condition THEN
      v_changes := v_changes || ('условие фиксации ' || COALESCE(OLD.price_condition::TEXT, '—') || ' → ' || COALESCE(NEW.price_condition::TEXT, '—'));
    END IF;
    IF OLD.departure_station_id IS DISTINCT FROM NEW.departure_station_id THEN
      v_changes := v_changes || ('ст. отправления изменена');
    END IF;

    IF array_length(v_changes, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    v_content := 'Изменена линия поставщика #' || NEW.position
      || ' (' || array_to_string(v_changes, ', ') || ')';
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'side', 'supplier',
      'position', NEW.position,
      'old', jsonb_build_object('price', OLD.price, 'quotation', OLD.quotation, 'discount', OLD.discount, 'delivery_basis', OLD.delivery_basis, 'price_condition', OLD.price_condition),
      'new', jsonb_build_object('price', NEW.price, 'quotation', NEW.quotation, 'discount', NEW.discount, 'delivery_basis', NEW.delivery_basis, 'price_condition', NEW.price_condition)
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'system', v_content, v_metadata);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deal_supplier_lines_activity ON deal_supplier_lines;
CREATE TRIGGER trg_deal_supplier_lines_activity
  AFTER INSERT OR UPDATE OR DELETE ON deal_supplier_lines
  FOR EACH ROW EXECUTE FUNCTION log_deal_supplier_line_change();

CREATE OR REPLACE FUNCTION log_deal_buyer_line_change()
RETURNS TRIGGER AS $$
DECLARE
  v_user UUID := auth.uid();
  v_deal_id UUID := COALESCE(NEW.deal_id, OLD.deal_id);
  v_content TEXT;
  v_metadata JSONB;
  v_changes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF v_deal_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF _activity_is_draft_deal(v_deal_id) THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.is_default, FALSE) THEN
      RETURN NEW;
    END IF;
    v_content := 'Добавлена линия покупателя #' || NEW.position
      || COALESCE(': цена ' || _activity_fmt_num(NEW.price), '');
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'side', 'buyer',
      'position', NEW.position,
      'is_default', NEW.is_default,
      'price', NEW.price,
      'quotation', NEW.quotation,
      'discount', NEW.discount,
      'delivery_basis', NEW.delivery_basis
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'system', v_content, v_metadata);

  ELSIF TG_OP = 'DELETE' THEN
    v_content := 'Удалена линия покупателя #' || OLD.position;
    v_metadata := jsonb_build_object(
      'row_id', OLD.id,
      'side', 'buyer',
      'position', OLD.position,
      'price', OLD.price,
      'quotation', OLD.quotation,
      'discount', OLD.discount
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'system', v_content, v_metadata);

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.price IS DISTINCT FROM NEW.price THEN
      v_changes := v_changes || ('цена ' || _activity_fmt_num(OLD.price) || ' → ' || _activity_fmt_num(NEW.price));
    END IF;
    IF OLD.quotation IS DISTINCT FROM NEW.quotation THEN
      v_changes := v_changes || ('котировка ' || _activity_fmt_num(OLD.quotation) || ' → ' || _activity_fmt_num(NEW.quotation));
    END IF;
    IF OLD.discount IS DISTINCT FROM NEW.discount THEN
      v_changes := v_changes || ('скидка ' || _activity_fmt_num(OLD.discount) || ' → ' || _activity_fmt_num(NEW.discount));
    END IF;
    IF OLD.delivery_basis IS DISTINCT FROM NEW.delivery_basis THEN
      v_changes := v_changes || ('базис ' || COALESCE(OLD.delivery_basis, '—') || ' → ' || COALESCE(NEW.delivery_basis, '—'));
    END IF;
    IF OLD.price_condition IS DISTINCT FROM NEW.price_condition THEN
      v_changes := v_changes || ('условие фиксации ' || COALESCE(OLD.price_condition::TEXT, '—') || ' → ' || COALESCE(NEW.price_condition::TEXT, '—'));
    END IF;
    IF OLD.destination_station_id IS DISTINCT FROM NEW.destination_station_id THEN
      v_changes := v_changes || ('ст. назначения изменена');
    END IF;

    IF array_length(v_changes, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    v_content := 'Изменена линия покупателя #' || NEW.position
      || ' (' || array_to_string(v_changes, ', ') || ')';
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'side', 'buyer',
      'position', NEW.position,
      'old', jsonb_build_object('price', OLD.price, 'quotation', OLD.quotation, 'discount', OLD.discount, 'delivery_basis', OLD.delivery_basis, 'price_condition', OLD.price_condition),
      'new', jsonb_build_object('price', NEW.price, 'quotation', NEW.quotation, 'discount', NEW.discount, 'delivery_basis', NEW.delivery_basis, 'price_condition', NEW.price_condition)
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'system', v_content, v_metadata);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deal_buyer_lines_activity ON deal_buyer_lines;
CREATE TRIGGER trg_deal_buyer_lines_activity
  AFTER INSERT OR UPDATE OR DELETE ON deal_buyer_lines
  FOR EACH ROW EXECUTE FUNCTION log_deal_buyer_line_change();

-- =====================================================================
-- deal_company_groups
-- =====================================================================

CREATE OR REPLACE FUNCTION log_deal_company_groups_change()
RETURNS TRIGGER AS $$
DECLARE
  v_user UUID := auth.uid();
  v_deal_id UUID := COALESCE(NEW.deal_id, OLD.deal_id);
  v_content TEXT;
  v_metadata JSONB;
  v_changes TEXT[] := ARRAY[]::TEXT[];
  v_group_name TEXT;
  v_old_group_name TEXT;
BEGIN
  IF v_deal_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF _activity_is_draft_deal(v_deal_id) THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT name INTO v_group_name FROM company_groups WHERE id = NEW.company_group_id;
    v_content := 'Добавлен контрагент в цепочку: #' || NEW.position
      || COALESCE(' ' || v_group_name, '')
      || COALESCE(' (цена ' || _activity_fmt_num(NEW.price) || ')', '');
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'position', NEW.position,
      'company_group_id', NEW.company_group_id,
      'company_group_label', v_group_name,
      'price', NEW.price,
      'price_kind', NEW.price_kind,
      'currency', NEW.currency,
      'contract_ref', NEW.contract_ref
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'system', v_content, v_metadata);

  ELSIF TG_OP = 'DELETE' THEN
    SELECT name INTO v_old_group_name FROM company_groups WHERE id = OLD.company_group_id;
    v_content := 'Удалён контрагент из цепочки: #' || OLD.position
      || COALESCE(' ' || v_old_group_name, '');
    v_metadata := jsonb_build_object(
      'row_id', OLD.id,
      'position', OLD.position,
      'company_group_id', OLD.company_group_id,
      'company_group_label', v_old_group_name,
      'price', OLD.price
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'system', v_content, v_metadata);

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.company_group_id IS DISTINCT FROM NEW.company_group_id THEN
      SELECT name INTO v_old_group_name FROM company_groups WHERE id = OLD.company_group_id;
      SELECT name INTO v_group_name FROM company_groups WHERE id = NEW.company_group_id;
      v_changes := v_changes || ('контрагент ' || COALESCE(v_old_group_name, '—') || ' → ' || COALESCE(v_group_name, '—'));
    END IF;
    IF OLD.price IS DISTINCT FROM NEW.price THEN
      v_changes := v_changes || ('цена ' || _activity_fmt_num(OLD.price) || ' → ' || _activity_fmt_num(NEW.price));
    END IF;
    IF OLD.price_kind IS DISTINCT FROM NEW.price_kind THEN
      v_changes := v_changes || ('тип цены ' || OLD.price_kind || ' → ' || NEW.price_kind);
    END IF;
    IF OLD.currency IS DISTINCT FROM NEW.currency THEN
      v_changes := v_changes || ('валюта ' || COALESCE(OLD.currency, '—') || ' → ' || COALESCE(NEW.currency, '—'));
    END IF;
    IF OLD.contract_ref IS DISTINCT FROM NEW.contract_ref THEN
      v_changes := v_changes || ('договор ' || COALESCE(OLD.contract_ref, '—') || ' → ' || COALESCE(NEW.contract_ref, '—'));
    END IF;
    IF OLD.quotation IS DISTINCT FROM NEW.quotation THEN
      v_changes := v_changes || ('котировка ' || _activity_fmt_num(OLD.quotation) || ' → ' || _activity_fmt_num(NEW.quotation));
    END IF;
    IF OLD.discount IS DISTINCT FROM NEW.discount THEN
      v_changes := v_changes || ('скидка ' || _activity_fmt_num(OLD.discount) || ' → ' || _activity_fmt_num(NEW.discount));
    END IF;

    IF array_length(v_changes, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT name INTO v_group_name FROM company_groups WHERE id = NEW.company_group_id;
    v_content := 'Изменён контрагент цепочки #' || NEW.position
      || COALESCE(' ' || v_group_name, '')
      || ' (' || array_to_string(v_changes, ', ') || ')';
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'position', NEW.position,
      'company_group_id', NEW.company_group_id,
      'company_group_label', v_group_name,
      'old', jsonb_build_object('price', OLD.price, 'price_kind', OLD.price_kind, 'currency', OLD.currency, 'contract_ref', OLD.contract_ref, 'quotation', OLD.quotation, 'discount', OLD.discount, 'company_group_id', OLD.company_group_id),
      'new', jsonb_build_object('price', NEW.price, 'price_kind', NEW.price_kind, 'currency', NEW.currency, 'contract_ref', NEW.contract_ref, 'quotation', NEW.quotation, 'discount', NEW.discount, 'company_group_id', NEW.company_group_id)
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'system', v_content, v_metadata);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deal_company_groups_activity ON deal_company_groups;
CREATE TRIGGER trg_deal_company_groups_activity
  AFTER INSERT OR UPDATE OR DELETE ON deal_company_groups
  FOR EACH ROW EXECUTE FUNCTION log_deal_company_groups_change();

-- =====================================================================
-- deal_attachments
-- =====================================================================

CREATE OR REPLACE FUNCTION log_deal_attachments_change()
RETURNS TRIGGER AS $$
DECLARE
  v_user UUID := auth.uid();
  v_deal_id UUID := COALESCE(NEW.deal_id, OLD.deal_id);
  v_content TEXT;
  v_metadata JSONB;
BEGIN
  IF v_deal_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF _activity_is_draft_deal(v_deal_id) THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    v_content := 'Загружен файл [' || NEW.category || ']: ' || NEW.file_name;
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'category', NEW.category,
      'file_name', NEW.file_name,
      'file_path', NEW.file_path,
      'file_size', NEW.file_size,
      'mime_type', NEW.mime_type
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'attachment', v_content, v_metadata);

  ELSIF TG_OP = 'DELETE' THEN
    v_content := 'Удалён файл [' || OLD.category || ']: ' || OLD.file_name;
    v_metadata := jsonb_build_object(
      'row_id', OLD.id,
      'category', OLD.category,
      'file_name', OLD.file_name
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'attachment', v_content, v_metadata);

  ELSIF TG_OP = 'UPDATE' THEN
    -- Attachments are mostly insert-then-delete; the only meaningful
    -- update is a category re-classification.
    IF OLD.category IS DISTINCT FROM NEW.category THEN
      v_content := 'Категория файла изменена: ' || NEW.file_name
        || ' (' || OLD.category || ' → ' || NEW.category || ')';
      v_metadata := jsonb_build_object(
        'row_id', NEW.id,
        'file_name', NEW.file_name,
        'old_category', OLD.category,
        'new_category', NEW.category
      );
      INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
      VALUES (v_deal_id, v_user, 'attachment', v_content, v_metadata);
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deal_attachments_activity ON deal_attachments;
CREATE TRIGGER trg_deal_attachments_activity
  AFTER INSERT OR UPDATE OR DELETE ON deal_attachments
  FOR EACH ROW EXECUTE FUNCTION log_deal_attachments_change();

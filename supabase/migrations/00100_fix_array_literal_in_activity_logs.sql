-- 00100_fix_array_literal_in_activity_logs.sql
--
-- Fix for «Ошибка: malformed array literal: "ст. отправления изменена"»
-- (operator screenshot 2026-06-26).
--
-- Four activity-log triggers added in 00096 each contain a line of the
-- form
--   v_changes := v_changes || ('something изменена');
-- where v_changes is TEXT[]. The right-hand side here is a bare
-- parenthesised string literal — an UNKNOWN type. PostgreSQL has two
-- overloads of `||` for arrays: «array || element» (TEXT[] || TEXT) and
-- «array || array» (TEXT[] || TEXT[]). With an UNKNOWN-typed RHS the
-- planner picks the array-array overload and tries to parse the string
-- as a Postgres array literal — which it isn't — so the trigger raises
-- malformed array literal at runtime and aborts the parent UPDATE.
--
-- The other branches in the same functions (e.g. «v_changes ||
-- ('цена ' || _activity_fmt_num(OLD.price) || ' → ' || ...)») work
-- because the explicit `||` text concatenation gives the RHS a known
-- TEXT type, picking the array-element overload.
--
-- Fix: cast the bare literals to TEXT explicitly (`'…изменена'::TEXT`).
-- Functions are recreated whole because PostgreSQL has no «patch one
-- line of a function body» primitive; the only change vs 00096 is the
-- ::TEXT cast on the four offending lines. Triggers themselves are
-- unchanged so no need to DROP/CREATE them — CREATE OR REPLACE
-- FUNCTION rebinds the existing trigger to the new function body.

-- =====================================================================
-- 1. shipment_registry  (comment column)
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
      v_changes := v_changes || ('комментарий изменён'::TEXT);
    END IF;

    IF array_length(v_changes, 1) IS NULL THEN
      RETURN NEW;
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

-- =====================================================================
-- 2. deal_payments  (description column)
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
      v_changes := v_changes || ('описание изменено'::TEXT);
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

-- =====================================================================
-- 3. deal_supplier_lines  (departure_station_id)  ← the screenshot bug
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
      v_changes := v_changes || ('ст. отправления изменена'::TEXT);
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

-- =====================================================================
-- 4. deal_buyer_lines  (destination_station_id)
-- =====================================================================

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
      v_changes := v_changes || ('ст. назначения изменена'::TEXT);
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

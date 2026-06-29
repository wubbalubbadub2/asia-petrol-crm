-- 00102_activity_log_shipment_company_group.sql
--
-- Extend log_shipment_registry_change (00096) to also detect changes
-- to shipment_registry.company_group_id and write them to the deal
-- activity feed.
--
-- Why: the registry now exposes inline-editing for «группа комп.» on
-- both columns (read-only mirror cell made editable 2026-06-29). When
-- the operator changes a row's company group, it should show up in
-- the deal chat — same UX as wagon/volume/date edits already do.
--
-- Implementation:
--   • Resolve old + new company_group_id to human names via JOIN to
--     company_groups so the chat message reads «OPT → OPT 2» instead
--     of UUID pairs.
--   • Add the names to v_changes (rendered into the chat content) and
--     to the metadata jsonb's `old` / `new` blocks (for downstream
--     audit / diff rendering).
--   • Idempotent — CREATE OR REPLACE just rewrites the function body.

CREATE OR REPLACE FUNCTION log_shipment_registry_change()
RETURNS TRIGGER AS $$
DECLARE
  v_user UUID := auth.uid();
  v_deal_id UUID := COALESCE(NEW.deal_id, OLD.deal_id);
  v_content TEXT;
  v_metadata JSONB;
  v_changes TEXT[] := ARRAY[]::TEXT[];
  v_old_cg_name TEXT;
  v_new_cg_name TEXT;
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
      v_changes := v_changes || ('вагон '::TEXT || COALESCE(OLD.wagon_number, '—') || ' → ' || COALESCE(NEW.wagon_number, '—'));
    END IF;
    IF OLD.waybill_number IS DISTINCT FROM NEW.waybill_number THEN
      v_changes := v_changes || ('накладная '::TEXT || COALESCE(OLD.waybill_number, '—') || ' → ' || COALESCE(NEW.waybill_number, '—'));
    END IF;
    IF OLD.shipment_volume IS DISTINCT FROM NEW.shipment_volume THEN
      v_changes := v_changes || ('объём '::TEXT || _activity_fmt_num(OLD.shipment_volume) || ' → ' || _activity_fmt_num(NEW.shipment_volume));
    END IF;
    IF OLD.date IS DISTINCT FROM NEW.date THEN
      v_changes := v_changes || ('дата '::TEXT || COALESCE(to_char(OLD.date, 'DD.MM.YYYY'), '—') || ' → ' || COALESCE(to_char(NEW.date, 'DD.MM.YYYY'), '—'));
    END IF;
    IF OLD.shipped_tonnage_amount IS DISTINCT FROM NEW.shipped_tonnage_amount THEN
      v_changes := v_changes || ('тоннаж '::TEXT || _activity_fmt_num(OLD.shipped_tonnage_amount) || ' → ' || _activity_fmt_num(NEW.shipped_tonnage_amount));
    END IF;
    IF OLD.rounded_tonnage_from_forwarder IS DISTINCT FROM NEW.rounded_tonnage_from_forwarder THEN
      v_changes := v_changes || ('округл. тоннаж '::TEXT || _activity_fmt_num(OLD.rounded_tonnage_from_forwarder) || ' → ' || _activity_fmt_num(NEW.rounded_tonnage_from_forwarder));
    END IF;
    IF OLD.railway_tariff IS DISTINCT FROM NEW.railway_tariff THEN
      v_changes := v_changes || ('ж/д тариф '::TEXT || _activity_fmt_num(OLD.railway_tariff) || ' → ' || _activity_fmt_num(NEW.railway_tariff));
    END IF;
    IF OLD.invoice_number IS DISTINCT FROM NEW.invoice_number THEN
      v_changes := v_changes || ('счёт-фактура '::TEXT || COALESCE(OLD.invoice_number, '—') || ' → ' || COALESCE(NEW.invoice_number, '—'));
    END IF;
    IF OLD.comment IS DISTINCT FROM NEW.comment THEN
      v_changes := v_changes || ('комментарий изменён'::TEXT);
    END IF;
    -- NEW: company_group_id (resolve UUID → name for the chat message).
    IF OLD.company_group_id IS DISTINCT FROM NEW.company_group_id THEN
      SELECT name INTO v_old_cg_name FROM company_groups WHERE id = OLD.company_group_id;
      SELECT name INTO v_new_cg_name FROM company_groups WHERE id = NEW.company_group_id;
      v_changes := v_changes || ('группа комп. '::TEXT || COALESCE(v_old_cg_name, '—') || ' → ' || COALESCE(v_new_cg_name, '—'));
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
        'invoice_number', OLD.invoice_number,
        'company_group_id', OLD.company_group_id,
        'company_group_name', v_old_cg_name
      ),
      'new', jsonb_build_object(
        'wagon_number', NEW.wagon_number,
        'waybill_number', NEW.waybill_number,
        'shipment_volume', NEW.shipment_volume,
        'date', NEW.date,
        'shipped_tonnage_amount', NEW.shipped_tonnage_amount,
        'rounded_tonnage_from_forwarder', NEW.rounded_tonnage_from_forwarder,
        'railway_tariff', NEW.railway_tariff,
        'invoice_number', NEW.invoice_number,
        'company_group_id', NEW.company_group_id,
        'company_group_name', v_new_cg_name
      )
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'shipment', v_content, v_metadata);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

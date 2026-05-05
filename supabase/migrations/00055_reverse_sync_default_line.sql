-- Bridge: keep the default line in sync with `deals.supplier_*` /
-- `deals.buyer_*` scalar writes that come from legacy code paths.
--
-- Why this exists: 00053 introduced the lines table and a one-way sync
-- (line → deals scalars). The deal-create form (deals/new) and a few
-- other places still write to the scalars directly. Without a reverse
-- mirror, the default line stays empty after deal creation and would
-- show as "пустой вариант" on the detail page.
--
-- Loop break: line→deals trigger sets a session flag before its
-- UPDATE; this trigger checks the flag and bails out, so the chain
-- doesn't loop forever.

-- Step 1: harden the existing line→deals trigger to set a guard flag
-- around its UPDATE so the reverse trigger knows to skip it.

CREATE OR REPLACE FUNCTION sync_deal_from_default_supplier_line()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default THEN
    PERFORM set_config('app.in_line_sync', 'on', true);
    UPDATE deals SET
      supplier_price_condition   = NEW.price_condition,
      supplier_quotation         = NEW.quotation,
      supplier_quotation_comment = NEW.quotation_comment,
      supplier_discount          = NEW.discount,
      supplier_price             = NEW.price,
      supplier_delivery_basis    = NEW.delivery_basis,
      supplier_departure_station_id = NEW.departure_station_id
    WHERE id = NEW.deal_id;
    PERFORM set_config('app.in_line_sync', '', true);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_deal_from_default_buyer_line()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default THEN
    PERFORM set_config('app.in_line_sync', 'on', true);
    UPDATE deals SET
      buyer_price_condition       = NEW.price_condition,
      buyer_quotation             = NEW.quotation,
      buyer_quotation_comment     = NEW.quotation_comment,
      buyer_discount              = NEW.discount,
      buyer_price                 = NEW.price,
      buyer_delivery_basis        = NEW.delivery_basis,
      buyer_destination_station_id = NEW.destination_station_id
    WHERE id = NEW.deal_id;
    PERFORM set_config('app.in_line_sync', '', true);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: reverse-sync trigger on deals.

CREATE OR REPLACE FUNCTION sync_default_supplier_line_from_deal()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip when the write is the line→deals mirror — would loop otherwise.
  IF current_setting('app.in_line_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Only update if any of the variant-level fields actually changed.
  IF NEW.supplier_price_condition   IS DISTINCT FROM OLD.supplier_price_condition
     OR NEW.supplier_quotation         IS DISTINCT FROM OLD.supplier_quotation
     OR NEW.supplier_quotation_comment IS DISTINCT FROM OLD.supplier_quotation_comment
     OR NEW.supplier_discount          IS DISTINCT FROM OLD.supplier_discount
     OR NEW.supplier_price             IS DISTINCT FROM OLD.supplier_price
     OR NEW.supplier_delivery_basis    IS DISTINCT FROM OLD.supplier_delivery_basis
     OR NEW.supplier_departure_station_id IS DISTINCT FROM OLD.supplier_departure_station_id
  THEN
    UPDATE deal_supplier_lines SET
      price_condition   = NEW.supplier_price_condition,
      quotation         = NEW.supplier_quotation,
      quotation_comment = NEW.supplier_quotation_comment,
      discount          = NEW.supplier_discount,
      price             = NEW.supplier_price,
      delivery_basis    = NEW.supplier_delivery_basis,
      departure_station_id = NEW.supplier_departure_station_id
    WHERE deal_id = NEW.id AND is_default = TRUE;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_default_buyer_line_from_deal()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.in_line_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.buyer_price_condition       IS DISTINCT FROM OLD.buyer_price_condition
     OR NEW.buyer_quotation             IS DISTINCT FROM OLD.buyer_quotation
     OR NEW.buyer_quotation_comment     IS DISTINCT FROM OLD.buyer_quotation_comment
     OR NEW.buyer_discount              IS DISTINCT FROM OLD.buyer_discount
     OR NEW.buyer_price                 IS DISTINCT FROM OLD.buyer_price
     OR NEW.buyer_delivery_basis        IS DISTINCT FROM OLD.buyer_delivery_basis
     OR NEW.buyer_destination_station_id IS DISTINCT FROM OLD.buyer_destination_station_id
  THEN
    UPDATE deal_buyer_lines SET
      price_condition   = NEW.buyer_price_condition,
      quotation         = NEW.buyer_quotation,
      quotation_comment = NEW.buyer_quotation_comment,
      discount          = NEW.buyer_discount,
      price             = NEW.buyer_price,
      delivery_basis    = NEW.buyer_delivery_basis,
      destination_station_id = NEW.buyer_destination_station_id
    WHERE deal_id = NEW.id AND is_default = TRUE;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_default_supplier_line_from_deal
  AFTER UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION sync_default_supplier_line_from_deal();

CREATE TRIGGER trg_sync_default_buyer_line_from_deal
  AFTER UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION sync_default_buyer_line_from_deal();

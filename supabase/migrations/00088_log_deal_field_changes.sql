-- Log non-payment deal field changes to the activity feed.
--
-- 00016/00087 only logged supplier_payment / buyer_payment changes.
-- Operators also want to see when volumes, prices, contracts, factories,
-- counterparties, dates, tariffs, etc. are edited — so anything done to
-- a deal shows up in the chat.
--
-- Drafts are skipped: the «new deal» page creates a deal with
-- is_draft = true then flips it to false on save, which would otherwise
-- emit a dozen "field changed from NULL to X" rows for every new deal.
-- Activity starts the moment is_draft becomes false.
--
-- metadata.field is the column name; old/new are the raw values; for FK
-- fields we additionally resolve a human name via metadata.old_label /
-- metadata.new_label so the frontend can render without a join.

CREATE OR REPLACE FUNCTION log_deal_field_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_user UUID := auth.uid();
  v_old_label TEXT;
  v_new_label TEXT;
BEGIN
  -- Skip draft activity. The user-facing chat is opened only after a
  -- deal is real; draft → real conversion is one bulk write we don't
  -- want to flood the feed with.
  IF COALESCE(NEW.is_draft, FALSE) OR COALESCE(OLD.is_draft, FALSE) THEN
    RETURN NEW;
  END IF;

  -- ---- Numeric fields (тонны / валюта / тариф) ---------------------
  IF OLD.supplier_contracted_volume IS DISTINCT FROM NEW.supplier_contracted_volume THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Объём поставщика изменён',
      jsonb_build_object('field','supplier_contracted_volume','old',OLD.supplier_contracted_volume,'new',NEW.supplier_contracted_volume,'unit','т'));
  END IF;
  IF OLD.buyer_contracted_volume IS DISTINCT FROM NEW.buyer_contracted_volume THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Объём покупателя изменён',
      jsonb_build_object('field','buyer_contracted_volume','old',OLD.buyer_contracted_volume,'new',NEW.buyer_contracted_volume,'unit','т'));
  END IF;
  IF OLD.buyer_ordered_volume IS DISTINCT FROM NEW.buyer_ordered_volume THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Заказанный объём покупателя изменён',
      jsonb_build_object('field','buyer_ordered_volume','old',OLD.buyer_ordered_volume,'new',NEW.buyer_ordered_volume,'unit','т'));
  END IF;
  IF OLD.supplier_price IS DISTINCT FROM NEW.supplier_price THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Цена поставщика изменена',
      jsonb_build_object('field','supplier_price','old',OLD.supplier_price,'new',NEW.supplier_price,'currency',NEW.supplier_currency));
  END IF;
  IF OLD.buyer_price IS DISTINCT FROM NEW.buyer_price THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Цена покупателя изменена',
      jsonb_build_object('field','buyer_price','old',OLD.buyer_price,'new',NEW.buyer_price,'currency',NEW.buyer_currency));
  END IF;
  IF OLD.supplier_quotation IS DISTINCT FROM NEW.supplier_quotation THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Котировка поставщика изменена',
      jsonb_build_object('field','supplier_quotation','old',OLD.supplier_quotation,'new',NEW.supplier_quotation,'currency',NEW.supplier_currency));
  END IF;
  IF OLD.buyer_quotation IS DISTINCT FROM NEW.buyer_quotation THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Котировка покупателя изменена',
      jsonb_build_object('field','buyer_quotation','old',OLD.buyer_quotation,'new',NEW.buyer_quotation,'currency',NEW.buyer_currency));
  END IF;
  IF OLD.supplier_discount IS DISTINCT FROM NEW.supplier_discount THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Скидка поставщика изменена',
      jsonb_build_object('field','supplier_discount','old',OLD.supplier_discount,'new',NEW.supplier_discount,'currency',NEW.supplier_currency));
  END IF;
  IF OLD.buyer_discount IS DISTINCT FROM NEW.buyer_discount THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Скидка покупателя изменена',
      jsonb_build_object('field','buyer_discount','old',OLD.buyer_discount,'new',NEW.buyer_discount,'currency',NEW.buyer_currency));
  END IF;
  IF OLD.planned_tariff IS DISTINCT FROM NEW.planned_tariff THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Плановый тариф изменён',
      jsonb_build_object('field','planned_tariff','old',OLD.planned_tariff,'new',NEW.planned_tariff));
  END IF;
  IF OLD.actual_tariff IS DISTINCT FROM NEW.actual_tariff THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Факт. тариф изменён',
      jsonb_build_object('field','actual_tariff','old',OLD.actual_tariff,'new',NEW.actual_tariff));
  END IF;
  IF OLD.preliminary_tonnage IS DISTINCT FROM NEW.preliminary_tonnage THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Предв. тоннаж изменён',
      jsonb_build_object('field','preliminary_tonnage','old',OLD.preliminary_tonnage,'new',NEW.preliminary_tonnage,'unit','т'));
  END IF;
  IF OLD.surcharge_amount IS DISTINCT FROM NEW.surcharge_amount THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Доплата изменена',
      jsonb_build_object('field','surcharge_amount','old',OLD.surcharge_amount,'new',NEW.surcharge_amount));
  END IF;

  -- ---- Text fields -----------------------------------------------
  IF OLD.supplier_contract IS DISTINCT FROM NEW.supplier_contract THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Договор поставщика изменён',
      jsonb_build_object('field','supplier_contract','old',OLD.supplier_contract,'new',NEW.supplier_contract));
  END IF;
  IF OLD.buyer_contract IS DISTINCT FROM NEW.buyer_contract THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Договор покупателя изменён',
      jsonb_build_object('field','buyer_contract','old',OLD.buyer_contract,'new',NEW.buyer_contract));
  END IF;
  IF OLD.supplier_delivery_basis IS DISTINCT FROM NEW.supplier_delivery_basis THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Базис поставки (поставщик) изменён',
      jsonb_build_object('field','supplier_delivery_basis','old',OLD.supplier_delivery_basis,'new',NEW.supplier_delivery_basis));
  END IF;
  IF OLD.buyer_delivery_basis IS DISTINCT FROM NEW.buyer_delivery_basis THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Базис поставки (покупатель) изменён',
      jsonb_build_object('field','buyer_delivery_basis','old',OLD.buyer_delivery_basis,'new',NEW.buyer_delivery_basis));
  END IF;
  IF OLD.supplier_payment_date IS DISTINCT FROM NEW.supplier_payment_date THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Дата оплаты поставщику изменена',
      jsonb_build_object('field','supplier_payment_date','old',OLD.supplier_payment_date,'new',NEW.supplier_payment_date));
  END IF;
  IF OLD.buyer_payment_date IS DISTINCT FROM NEW.buyer_payment_date THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Дата оплаты покупателя изменена',
      jsonb_build_object('field','buyer_payment_date','old',OLD.buyer_payment_date,'new',NEW.buyer_payment_date));
  END IF;
  IF OLD.buyer_ship_date IS DISTINCT FROM NEW.buyer_ship_date THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Дата отгрузки покупателю изменена',
      jsonb_build_object('field','buyer_ship_date','old',OLD.buyer_ship_date,'new',NEW.buyer_ship_date));
  END IF;
  IF OLD.month IS DISTINCT FROM NEW.month THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Месяц сделки изменён',
      jsonb_build_object('field','month','old',OLD.month,'new',NEW.month));
  END IF;

  -- ---- Foreign keys: resolve to human name ----------------------
  IF OLD.supplier_id IS DISTINCT FROM NEW.supplier_id THEN
    SELECT COALESCE(short_name, full_name) INTO v_old_label FROM counterparties WHERE id = OLD.supplier_id;
    SELECT COALESCE(short_name, full_name) INTO v_new_label FROM counterparties WHERE id = NEW.supplier_id;
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Поставщик изменён',
      jsonb_build_object('field','supplier_id','old',OLD.supplier_id,'new',NEW.supplier_id,'old_label',v_old_label,'new_label',v_new_label));
  END IF;
  IF OLD.buyer_id IS DISTINCT FROM NEW.buyer_id THEN
    SELECT COALESCE(short_name, full_name) INTO v_old_label FROM counterparties WHERE id = OLD.buyer_id;
    SELECT COALESCE(short_name, full_name) INTO v_new_label FROM counterparties WHERE id = NEW.buyer_id;
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Покупатель изменён',
      jsonb_build_object('field','buyer_id','old',OLD.buyer_id,'new',NEW.buyer_id,'old_label',v_old_label,'new_label',v_new_label));
  END IF;
  IF OLD.factory_id IS DISTINCT FROM NEW.factory_id THEN
    SELECT name INTO v_old_label FROM factories WHERE id = OLD.factory_id;
    SELECT name INTO v_new_label FROM factories WHERE id = NEW.factory_id;
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Завод изменён',
      jsonb_build_object('field','factory_id','old',OLD.factory_id,'new',NEW.factory_id,'old_label',v_old_label,'new_label',v_new_label));
  END IF;
  IF OLD.fuel_type_id IS DISTINCT FROM NEW.fuel_type_id THEN
    SELECT name INTO v_old_label FROM fuel_types WHERE id = OLD.fuel_type_id;
    SELECT name INTO v_new_label FROM fuel_types WHERE id = NEW.fuel_type_id;
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Вид ГСМ изменён',
      jsonb_build_object('field','fuel_type_id','old',OLD.fuel_type_id,'new',NEW.fuel_type_id,'old_label',v_old_label,'new_label',v_new_label));
  END IF;
  IF OLD.forwarder_id IS DISTINCT FROM NEW.forwarder_id THEN
    SELECT name INTO v_old_label FROM forwarders WHERE id = OLD.forwarder_id;
    SELECT name INTO v_new_label FROM forwarders WHERE id = NEW.forwarder_id;
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Экспедитор изменён',
      jsonb_build_object('field','forwarder_id','old',OLD.forwarder_id,'new',NEW.forwarder_id,'old_label',v_old_label,'new_label',v_new_label));
  END IF;
  IF OLD.supplier_manager_id IS DISTINCT FROM NEW.supplier_manager_id THEN
    SELECT full_name INTO v_old_label FROM profiles WHERE id = OLD.supplier_manager_id;
    SELECT full_name INTO v_new_label FROM profiles WHERE id = NEW.supplier_manager_id;
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Менеджер поставщика изменён',
      jsonb_build_object('field','supplier_manager_id','old',OLD.supplier_manager_id,'new',NEW.supplier_manager_id,'old_label',v_old_label,'new_label',v_new_label));
  END IF;
  IF OLD.buyer_manager_id IS DISTINCT FROM NEW.buyer_manager_id THEN
    SELECT full_name INTO v_old_label FROM profiles WHERE id = OLD.buyer_manager_id;
    SELECT full_name INTO v_new_label FROM profiles WHERE id = NEW.buyer_manager_id;
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Менеджер покупателя изменён',
      jsonb_build_object('field','buyer_manager_id','old',OLD.buyer_manager_id,'new',NEW.buyer_manager_id,'old_label',v_old_label,'new_label',v_new_label));
  END IF;
  IF OLD.trader_id IS DISTINCT FROM NEW.trader_id THEN
    SELECT full_name INTO v_old_label FROM profiles WHERE id = OLD.trader_id;
    SELECT full_name INTO v_new_label FROM profiles WHERE id = NEW.trader_id;
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'system', 'Трейдер изменён',
      jsonb_build_object('field','trader_id','old',OLD.trader_id,'new',NEW.trader_id,'old_label',v_old_label,'new_label',v_new_label));
  END IF;

  -- ---- Booleans -------------------------------------------------
  IF OLD.is_archived IS DISTINCT FROM NEW.is_archived THEN
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, v_user, 'status_change',
      CASE WHEN COALESCE(NEW.is_archived,FALSE) THEN 'Сделка перенесена в архив' ELSE 'Сделка восстановлена из архива' END,
      jsonb_build_object('field','is_archived','old',OLD.is_archived,'new',NEW.is_archived));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger name is alphabetically AFTER trg_deal_payment_log so the
-- payment trigger runs first; both are AFTER UPDATE so order is purely
-- for predictability when reviewing the activity feed.
DROP TRIGGER IF EXISTS trg_deal_field_changes ON deals;
CREATE TRIGGER trg_deal_field_changes
  AFTER UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION log_deal_field_changes();

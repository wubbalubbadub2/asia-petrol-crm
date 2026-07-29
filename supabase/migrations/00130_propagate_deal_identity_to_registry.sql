-- 00130_propagate_deal_identity_to_registry.sql
--
-- Клиент 2026-07-29: «поменял поле Завод в сделке, а в Отгрузках в
-- реестре по этой сделке завод не поменялся».
--
-- Root cause: строки shipment_registry хранят СВОИ копии
-- идентификационных полей сделки (factory_id, fuel_type_id, supplier_id,
-- buyer_id, forwarder_id, company_group_id), проставленные один раз при
-- создании строки. Позднее редактирование сделки вниз не распространялось
-- (в отличие от станций/тарифа — см. 00117/00118).
--
-- Решение (утверждено клиентом 2026-07-29):
--   1. Сделка = источник истины по этим шести полям. Триггер на deals:
--      при изменении любого из полей ПЕРЕЗАПИСАТЬ соответствующее поле во
--      ВСЕХ строках реестра этой сделки (включая NULL-строки).
--   2. Разовый catch-up: выровнять уже расходящиеся строки.
--
-- Маппинг: registry.company_group_id  ←  deals.logistics_company_group_id
--          (единственная логистическая группа; M2M deal_company_groups —
--          отдельная сущность и здесь не участвует).
--
-- NULL-семантика: перезаписываем только когда значение сделки НЕ NULL.
-- Если поле на сделке пустое — строку не трогаем (не затираем данные,
-- проставленные на уровне отгрузки; forwarder/company_group часто живут
-- на строке, когда на сделке их нет). Это совпадает с логикой 00118.
--
-- Безопасность пересчётов: ни один триггер shipment_registry не реагирует
-- на эти шесть колонок — autoprice_registry_update (volume/date),
-- compute_registry_amount (tariff×volume, идемпотентно),
-- reassign_registry_line_on_station_change (station/deal_id),
-- reprice_registry_on_line_change (line_id). Значит перезапись identity
-- не вызывает перецены/переподбора тарифа. Рекурсии нет: обратный роллап
-- trg_shipment_refresh_deal меняет объёмы/суммы на сделке, а не эти шесть
-- полей, поэтому WHEN-условие триггера не срабатывает повторно.

-- ── 1. Propagation trigger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION propagate_deal_identity_to_registry()
RETURNS TRIGGER AS $$
DECLARE
  v_rows INT;
BEGIN
  IF NEW.factory_id IS NOT NULL
     AND NEW.factory_id IS DISTINCT FROM OLD.factory_id THEN
    UPDATE shipment_registry SET factory_id = NEW.factory_id
     WHERE deal_id = NEW.id AND factory_id IS DISTINCT FROM NEW.factory_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      RAISE NOTICE 'сделка %: завод → % строк реестра', NEW.deal_code, v_rows;
    END IF;
  END IF;

  IF NEW.fuel_type_id IS NOT NULL
     AND NEW.fuel_type_id IS DISTINCT FROM OLD.fuel_type_id THEN
    UPDATE shipment_registry SET fuel_type_id = NEW.fuel_type_id
     WHERE deal_id = NEW.id AND fuel_type_id IS DISTINCT FROM NEW.fuel_type_id;
  END IF;

  IF NEW.supplier_id IS NOT NULL
     AND NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
    UPDATE shipment_registry SET supplier_id = NEW.supplier_id
     WHERE deal_id = NEW.id AND supplier_id IS DISTINCT FROM NEW.supplier_id;
  END IF;

  IF NEW.buyer_id IS NOT NULL
     AND NEW.buyer_id IS DISTINCT FROM OLD.buyer_id THEN
    UPDATE shipment_registry SET buyer_id = NEW.buyer_id
     WHERE deal_id = NEW.id AND buyer_id IS DISTINCT FROM NEW.buyer_id;
  END IF;

  IF NEW.forwarder_id IS NOT NULL
     AND NEW.forwarder_id IS DISTINCT FROM OLD.forwarder_id THEN
    UPDATE shipment_registry SET forwarder_id = NEW.forwarder_id
     WHERE deal_id = NEW.id AND forwarder_id IS DISTINCT FROM NEW.forwarder_id;
  END IF;

  IF NEW.logistics_company_group_id IS NOT NULL
     AND NEW.logistics_company_group_id IS DISTINCT FROM OLD.logistics_company_group_id THEN
    UPDATE shipment_registry SET company_group_id = NEW.logistics_company_group_id
     WHERE deal_id = NEW.id AND company_group_id IS DISTINCT FROM NEW.logistics_company_group_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_propagate_deal_identity ON deals;
CREATE TRIGGER trg_propagate_deal_identity
  AFTER UPDATE ON deals
  FOR EACH ROW
  WHEN (
       NEW.factory_id                 IS DISTINCT FROM OLD.factory_id
    OR NEW.fuel_type_id               IS DISTINCT FROM OLD.fuel_type_id
    OR NEW.supplier_id                IS DISTINCT FROM OLD.supplier_id
    OR NEW.buyer_id                   IS DISTINCT FROM OLD.buyer_id
    OR NEW.forwarder_id               IS DISTINCT FROM OLD.forwarder_id
    OR NEW.logistics_company_group_id IS DISTINCT FROM OLD.logistics_company_group_id
  )
  EXECUTE FUNCTION propagate_deal_identity_to_registry();

-- ── 2. Catch-up: выровнять существующие строки по сделке ──────────────
-- Идемпотентно (обновляются только реально расходящиеся строки), поэтому
-- повторное применение безопасно.
DO $$
DECLARE
  v_fac INT; v_fuel INT; v_sup INT; v_buy INT; v_fw INT; v_cg INT;
BEGIN
  UPDATE shipment_registry sr SET factory_id = d.factory_id
    FROM deals d WHERE sr.deal_id = d.id
     AND d.factory_id IS NOT NULL AND sr.factory_id IS DISTINCT FROM d.factory_id;
  GET DIAGNOSTICS v_fac = ROW_COUNT;

  UPDATE shipment_registry sr SET fuel_type_id = d.fuel_type_id
    FROM deals d WHERE sr.deal_id = d.id
     AND d.fuel_type_id IS NOT NULL AND sr.fuel_type_id IS DISTINCT FROM d.fuel_type_id;
  GET DIAGNOSTICS v_fuel = ROW_COUNT;

  UPDATE shipment_registry sr SET supplier_id = d.supplier_id
    FROM deals d WHERE sr.deal_id = d.id
     AND d.supplier_id IS NOT NULL AND sr.supplier_id IS DISTINCT FROM d.supplier_id;
  GET DIAGNOSTICS v_sup = ROW_COUNT;

  UPDATE shipment_registry sr SET buyer_id = d.buyer_id
    FROM deals d WHERE sr.deal_id = d.id
     AND d.buyer_id IS NOT NULL AND sr.buyer_id IS DISTINCT FROM d.buyer_id;
  GET DIAGNOSTICS v_buy = ROW_COUNT;

  UPDATE shipment_registry sr SET forwarder_id = d.forwarder_id
    FROM deals d WHERE sr.deal_id = d.id
     AND d.forwarder_id IS NOT NULL AND sr.forwarder_id IS DISTINCT FROM d.forwarder_id;
  GET DIAGNOSTICS v_fw = ROW_COUNT;

  UPDATE shipment_registry sr SET company_group_id = d.logistics_company_group_id
    FROM deals d WHERE sr.deal_id = d.id
     AND d.logistics_company_group_id IS NOT NULL
     AND sr.company_group_id IS DISTINCT FROM d.logistics_company_group_id;
  GET DIAGNOSTICS v_cg = ROW_COUNT;

  RAISE NOTICE 'catch-up: завод=% ГСМ=% поставщик=% покупатель=% экспедитор=% группа=%',
    v_fac, v_fuel, v_sup, v_buy, v_fw, v_cg;
END $$;

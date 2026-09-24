-- 00171_manual_line_price_wins.sql
--
-- Клиент 2026-09-24, КГ/26/502 и КГ/26/553: «Формула котировки идёт
-- верная, но покупатель поменял вручную. Мы сделали как покупатель.
-- Нужно, чтобы формула считала на ту цену, которая указана в разделе
-- цена». На КГ/26/502: «Цена» поставщика 540,119 (окончательная,
-- «Средний месяц»), у отгрузки 20 000 т цена по формуле 540,12 →
-- «Приход, сумма» 10 802 400 вместо 10 802 380.
--
-- КАК БЫЛО.
--   • Строки реестра окончательного варианта «Средний месяц» /
--     «Формульная вручную» пересчёт (00164) всегда ставит по формуле,
--     «Цену» варианта он не читает. Интерфейс зовёт пересчёт сразу после
--     правки «Цены» — введённая цена молча заменялась формулой.
--   • Ручные строки «Окончательной цены» (без реестра) правка «Цены» не
--     достигала вовсе: все пути переноса цены идут через реестр (00056).
--
-- КАК СТАЛО (согласовано 2026-09-24, «Цена главнее»).
--   • deal_{supplier,buyer}_lines.price_is_manual — цена введена руками.
--     Ставит его сама база: правка ОДНОЙ «Цены» → TRUE; правка любого
--     входа формулы (котировка, скидка, курс, коэффициент, условие, вид
--     котировки, стадия, месяц/дата, окно триггера) → FALSE, то есть
--     снова формула.
--   • Пока флаг поднят, каждая строка deal_shipment_prices этой стороны
--     получает calculated_price = «Цена» варианта — на ЛЮБОМ пути записи
--     (автоцена реестра, пересчёт, правка строки в таблице). Строка
--     реестра принадлежит своему варианту; ручная строка без реестра —
--     варианту по умолчанию (как и deals.*_price, куда он зеркалится).
--     Сумма = объём × цена по-прежнему считает 00166.
--   • Флаг сняли → строки реестра окончательного варианта пересчитываются
--     по формуле, ручные строки возвращаются к своей формуле
--     «котировка − скидка» (как shipmentRowPrice в интерфейсе).
--
-- ЧТО НЕ МЕНЯЕТСЯ. Формула, округление (3 знака цены, 00166), валюты,
-- роллапы сделки. Данные этой миграцией не трогаются: у всех вариантов
-- флаг FALSE, поведение прежнее, пока «Цену» не поправят руками.
-- Существующие сделки, где цена уже введена руками (КГ/26/502),
-- размечаются отдельным шагом после сверки списка.
--
-- ROLLBACK.
--   DROP TRIGGER trg_shipment_price_line_manual ON deal_shipment_prices;
--   DROP TRIGGER trg_mark_supplier_line_price_manual ON deal_supplier_lines;
--   DROP TRIGGER trg_mark_buyer_line_price_manual ON deal_buyer_lines;
--   DROP TRIGGER trg_sync_supplier_manual_price_to_shipments ON deal_supplier_lines;
--   DROP TRIGGER trg_sync_buyer_manual_price_to_shipments ON deal_buyer_lines;
--   затем для каждого варианта с флагом TRUE и стадией final —
--   SELECT recompute_line_shipment_prices(id, 'supplier' | 'buyer');
--   колонку price_is_manual можно оставить — без триггеров она инертна.

-- ── 1. Флаг ──────────────────────────────────────────────────────────
ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS price_is_manual BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS price_is_manual BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN deal_supplier_lines.price_is_manual IS
  '«Цена» введена руками (00171): отгрузки варианта считаются по ней, а не по формуле. Правка входа формулы снимает.';
COMMENT ON COLUMN deal_buyer_lines.price_is_manual IS
  '«Цена» введена руками (00171): отгрузки варианта считаются по ней, а не по формуле. Правка входа формулы снимает.';

-- ── 2. Флаг ставит база ─────────────────────────────────────────────
-- Одна функция на обе таблицы: колонки у вариантов одинаковые.
CREATE OR REPLACE FUNCTION mark_line_price_manual()
RETURNS TRIGGER AS $$
BEGIN
  -- Флаг задали явно в этой же записи — уважаем.
  IF NEW.price_is_manual IS DISTINCT FROM OLD.price_is_manual THEN
    RETURN NEW;
  END IF;

  IF NEW.quotation         IS DISTINCT FROM OLD.quotation
     OR NEW.discount          IS DISTINCT FROM OLD.discount
     OR NEW.fx_rate           IS DISTINCT FROM OLD.fx_rate
     OR NEW.barrel_ratio      IS DISTINCT FROM OLD.barrel_ratio
     OR NEW.price_condition   IS DISTINCT FROM OLD.price_condition
     OR NEW.quotation_type_id IS DISTINCT FROM OLD.quotation_type_id
     OR NEW.price_source      IS DISTINCT FROM OLD.price_source
     OR NEW.price_stage       IS DISTINCT FROM OLD.price_stage
     OR NEW.calc_mode         IS DISTINCT FROM OLD.calc_mode
     OR NEW.selected_month    IS DISTINCT FROM OLD.selected_month
     OR NEW.selected_date     IS DISTINCT FROM OLD.selected_date
     OR NEW.trigger_days      IS DISTINCT FROM OLD.trigger_days
     OR NEW.trigger_basis     IS DISTINCT FROM OLD.trigger_basis
  THEN
    NEW.price_is_manual := FALSE;
  ELSIF NEW.price IS DISTINCT FROM OLD.price THEN
    NEW.price_is_manual := NEW.price IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mark_supplier_line_price_manual ON deal_supplier_lines;
CREATE TRIGGER trg_mark_supplier_line_price_manual
  BEFORE UPDATE ON deal_supplier_lines
  FOR EACH ROW EXECUTE FUNCTION mark_line_price_manual();

DROP TRIGGER IF EXISTS trg_mark_buyer_line_price_manual ON deal_buyer_lines;
CREATE TRIGGER trg_mark_buyer_line_price_manual
  BEFORE UPDATE ON deal_buyer_lines
  FOR EACH ROW EXECUTE FUNCTION mark_line_price_manual();

-- ── 3. Строка отгрузки берёт ручную «Цену» на любом пути записи ──────
-- Имя триггера сортируется раньше trg_shipment_price_three_decimals
-- (00166): BEFORE-триггеры идут по алфавиту, и сумму тот считает уже
-- по подменённой цене.
CREATE OR REPLACE FUNCTION apply_manual_line_price()
RETURNS TRIGGER AS $$
DECLARE
  v_line_id UUID;
  v_price   NUMERIC;
  v_manual  BOOLEAN;
BEGIN
  IF NEW.shipment_registry_id IS NOT NULL THEN
    SELECT CASE WHEN NEW.side = 'supplier' THEN r.supplier_line_id ELSE r.buyer_line_id END
      INTO v_line_id
      FROM shipment_registry r
     WHERE r.id = NEW.shipment_registry_id;
  END IF;

  IF NEW.side = 'supplier' THEN
    SELECT price, price_is_manual INTO v_price, v_manual
      FROM deal_supplier_lines
     WHERE CASE WHEN v_line_id IS NOT NULL THEN id = v_line_id
                ELSE deal_id = NEW.deal_id AND is_default END;
  ELSE
    SELECT price, price_is_manual INTO v_price, v_manual
      FROM deal_buyer_lines
     WHERE CASE WHEN v_line_id IS NOT NULL THEN id = v_line_id
                ELSE deal_id = NEW.deal_id AND is_default END;
  END IF;

  IF v_manual AND v_price IS NOT NULL THEN
    NEW.calculated_price := v_price;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION apply_manual_line_price() IS
  'Ручная «Цена» варианта главнее формулы (00171): строка реестра — по своему варианту, строка без реестра — по варианту по умолчанию.';

DROP TRIGGER IF EXISTS trg_shipment_price_line_manual ON deal_shipment_prices;
CREATE TRIGGER trg_shipment_price_line_manual
  BEFORE INSERT OR UPDATE ON deal_shipment_prices
  FOR EACH ROW EXECUTE FUNCTION apply_manual_line_price();

-- ── 4. Правка «Цены» или флага доходит до уже существующих строк ─────
-- Имя сортируется после trg_propagate_*_line_price (00056): тот ставит
-- строкам реестра NEW.price, этот — финальное слово.
CREATE OR REPLACE FUNCTION sync_manual_line_price_to_shipments()
RETURNS TRIGGER AS $$
DECLARE
  v_side TEXT := CASE WHEN TG_TABLE_NAME = 'deal_supplier_lines' THEN 'supplier' ELSE 'buyer' END;
BEGIN
  IF NEW.price_is_manual THEN
    IF NEW.price IS NOT DISTINCT FROM OLD.price
       AND OLD.price_is_manual AND NEW.is_default IS NOT DISTINCT FROM OLD.is_default THEN
      RETURN NEW;
    END IF;
    -- Строки этого варианта + (у варианта по умолчанию) строки без
    -- варианта. Цену подставит apply_manual_line_price.
    UPDATE deal_shipment_prices p
       SET calculated_price = NEW.price
      FROM (SELECT p2.id
              FROM deal_shipment_prices p2
              LEFT JOIN shipment_registry r ON r.id = p2.shipment_registry_id
             WHERE p2.deal_id = NEW.deal_id AND p2.side = v_side
               AND (CASE WHEN v_side = 'supplier' THEN r.supplier_line_id ELSE r.buyer_line_id END = NEW.id
                    OR (NEW.is_default
                        AND CASE WHEN v_side = 'supplier' THEN r.supplier_line_id ELSE r.buyer_line_id END IS NULL))
           ) t
     WHERE p.id = t.id
       AND p.calculated_price IS DISTINCT FROM NEW.price;
    RETURN NEW;
  END IF;

  IF NOT OLD.price_is_manual THEN
    RETURN NEW;
  END IF;

  -- Флаг сняли — снова формула.
  IF NEW.price_stage = 'final' THEN
    PERFORM recompute_line_shipment_prices(NEW.id, v_side);
  END IF;

  IF NEW.is_default THEN
    -- Ручные строки без реестра — к своей формуле «котировка − скидка».
    UPDATE deal_shipment_prices p
       SET calculated_price = apply_price_formula(p.quotation_avg, p.discount, NULL, NULL)
     WHERE p.deal_id = NEW.deal_id AND p.side = v_side
       AND p.shipment_registry_id IS NULL
       AND p.quotation_avg IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_supplier_manual_price_to_shipments ON deal_supplier_lines;
CREATE TRIGGER trg_sync_supplier_manual_price_to_shipments
  AFTER UPDATE ON deal_supplier_lines
  FOR EACH ROW EXECUTE FUNCTION sync_manual_line_price_to_shipments();

DROP TRIGGER IF EXISTS trg_sync_buyer_manual_price_to_shipments ON deal_buyer_lines;
CREATE TRIGGER trg_sync_buyer_manual_price_to_shipments
  AFTER UPDATE ON deal_buyer_lines
  FOR EACH ROW EXECUTE FUNCTION sync_manual_line_price_to_shipments();

-- 00168_registry_row_always_pinned_to_variant.sql
--
-- Клиент 2026-09-23: «когда логисты будут сажать отгрузки, могли выбирать,
-- на какую цену или на какое приложение или домик сажать отгрузку»; плюс
-- «до 345 сделки есть выбор приложения для фиксации цены, после нету»;
-- плюс KZ/26/276 — «со стороны покупателя не села цена для подсчёта сумм
-- в отгрузки» на объём 101,468.
--
-- ПРИЧИНА (проверено по коду):
--   • Строка реестра привязывается к варианту цены через
--     shipment_registry.supplier_line_id / buyer_line_id (00054).
--   • Привязку ставит BEFORE INSERT триггер 00059
--     (`pin_registry_line_on_insert`), НО каждую сторону — только если у
--     строки в этот момент есть объём этой стороны:
--         supplier — при loading_volume IS NOT NULL   (00059:109)
--         buyer    — при shipment_volume IS NOT NULL  (00059:127)
--     Строку заводят наливом (входящее СНТ), а исходящее проставляют
--     позже — и buyer_line_id остаётся пустым НАВСЕГДА: на UPDATE
--     привязку не ставит никто. Это и есть KZ/26/276, где «не села цена»
--     именно со стороны покупателя.
--   • Пустая привязка = строка невидима для пересчёта «Окончательной»:
--     recompute_line_shipment_prices (00164:272-278) идёт циклом
--     WHERE sr.buyer_line_id = p_line_id. Цена по такой отгрузке не
--     считается, и починить её из интерфейса нечем.
--   • Отдельно: обе формы добавления отгрузок заполняли привязку только
--     при выборе приложения (registry/page.tsx, bulk-add-dialog.tsx), а
--     список приложений собирается из подписей вариантов. У сделок после
--     КГ/26/345 подписи пустые — выбирать нечего, и разложить 1000 т по
--     одной цене и 500 т по другой логист не мог. Это правится в
--     интерфейсе той же задачей.
--
-- ЧТО ДЕЛАЕТ ЭТА МИГРАЦИЯ:
--   1. BEFORE INSERT: привязывает ОБЕ стороны, не глядя на то, какой
--      объём уже заполнен. Подпись приложения подтягивается с варианта.
--   2. BEFORE UPDATE: если у стороны ПОЯВИЛСЯ объём, а привязки нет —
--      ставим её тогда же. Это закрывает дыру 00059 для строк, которые
--      завели наливом, а исходящее проставили позже.
--   3. Функция `pin_registry_lines(код сделки)` — починка уже созданных
--      строк. Вызывается вручную, по одной сделке.
--
-- Триггер 00059 не снимается: он выбирает вариант ПО СТАНЦИИ строки и
-- отрабатывает раньше (trg_pin_registry_line_on_insert < trg_pin_registry_lines_ins
-- по алфавиту). Наш триггер добирает только то, что осталось пустым.
--
-- ДЕНЬГИ ПРИ ВСТАВКЕ НЕ МЕНЯЮТСЯ. Автоцена (00164:123-137) и так берёт
-- основной вариант, когда привязки нет, — мы лишь записываем то, по чему
-- цена и так считалась. Меняется другое: такая строка теперь попадает в
-- пересчёт «Окончательной» и в сумму по варианту.
--
-- ⚠ ГЛОБАЛЬНОГО БЭКФИЛЛА ЗДЕСЬ НЕТ, И ЭТО ОСОЗНАННО. Проставление
-- привязки существующей строке поднимает AFTER UPDATE триггер 00057
-- (`trg_reprice_registry_on_line_change`), который пересчитывает цену и
-- сумму отгрузки по цене варианта. Для строк, где цена не села, это и
-- есть желаемая починка, но для остальных это движение денег по всей
-- базе разом. Поэтому чиним по одной сделке, осознанно:
--
--     SELECT pin_registry_lines('KZ/26/276');
--
-- Функция вернёт число привязанных строк и напечатает их в NOTICE.
-- Откат: вернуть строкам NULL в supplier_line_id / buyer_line_id по
-- напечатанным id (цена и сумма пересчитаются тем же триггером 00057).

-- ── 1. Привязка при вставке ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION pin_registry_default_lines()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.supplier_line_id IS NULL THEN
    SELECT id INTO NEW.supplier_line_id
      FROM deal_supplier_lines
     WHERE deal_id = NEW.deal_id AND is_default = TRUE
     ORDER BY position
     LIMIT 1;
  END IF;

  IF NEW.buyer_line_id IS NULL THEN
    SELECT id INTO NEW.buyer_line_id
      FROM deal_buyer_lines
     WHERE deal_id = NEW.deal_id AND is_default = TRUE
     ORDER BY position
     LIMIT 1;
  END IF;

  -- Подпись приложения — с варианта, если форма её не прислала.
  IF NEW.supplier_appendix IS NULL AND NEW.supplier_line_id IS NOT NULL THEN
    SELECT appendix INTO NEW.supplier_appendix
      FROM deal_supplier_lines WHERE id = NEW.supplier_line_id;
  END IF;
  IF NEW.buyer_appendix IS NULL AND NEW.buyer_line_id IS NOT NULL THEN
    SELECT appendix INTO NEW.buyer_appendix
      FROM deal_buyer_lines WHERE id = NEW.buyer_line_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION pin_registry_default_lines() IS
  'BEFORE INSERT на shipment_registry: строка без выбранного варианта цены привязывается к основному варианту сделки (00168). Цену не меняет — автоцена и так брала основной вариант.';

-- Имя с префиксом trg_pin_ ставит его после trg_key_resolve_tariff_ins:
-- BEFORE-триггеры идут по алфавиту, тариф встаёт раньше, порядок для
-- расчёта суммы сохраняется.
DROP TRIGGER IF EXISTS trg_pin_registry_lines_ins ON shipment_registry;
CREATE TRIGGER trg_pin_registry_lines_ins
  BEFORE INSERT ON shipment_registry
  FOR EACH ROW
  EXECUTE FUNCTION pin_registry_default_lines();

-- ── 1б. Появился объём стороны — ставим привязку тогда же ────────────
-- Строку заводят наливом, исходящее проставляют позже: до 00168 в этот
-- момент buyer_line_id так и оставался пустым (00059 работает только на
-- INSERT). Станцию учитываем так же, как 00059: сначала вариант по
-- станции строки, иначе основной.
CREATE OR REPLACE FUNCTION pin_registry_lines_on_volume_appears()
RETURNS TRIGGER AS $$
DECLARE
  v_line UUID;
BEGIN
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.loading_volume IS NOT NULL AND OLD.loading_volume IS NULL
     AND NEW.supplier_line_id IS NULL THEN
    IF NEW.departure_station_id IS NOT NULL THEN
      SELECT l.id INTO v_line FROM deal_supplier_lines l
       WHERE l.deal_id = NEW.deal_id AND l.departure_station_id = NEW.departure_station_id
       ORDER BY l.position LIMIT 1;
    END IF;
    IF v_line IS NULL THEN
      SELECT l.id INTO v_line FROM deal_supplier_lines l
       WHERE l.deal_id = NEW.deal_id AND l.is_default = TRUE LIMIT 1;
    END IF;
    NEW.supplier_line_id := v_line;
    IF NEW.supplier_appendix IS NULL AND v_line IS NOT NULL THEN
      SELECT appendix INTO NEW.supplier_appendix FROM deal_supplier_lines WHERE id = v_line;
    END IF;
  END IF;

  v_line := NULL;
  IF NEW.shipment_volume IS NOT NULL AND OLD.shipment_volume IS NULL
     AND NEW.buyer_line_id IS NULL THEN
    IF NEW.destination_station_id IS NOT NULL THEN
      SELECT l.id INTO v_line FROM deal_buyer_lines l
       WHERE l.deal_id = NEW.deal_id AND l.destination_station_id = NEW.destination_station_id
       ORDER BY l.position LIMIT 1;
    END IF;
    IF v_line IS NULL THEN
      SELECT l.id INTO v_line FROM deal_buyer_lines l
       WHERE l.deal_id = NEW.deal_id AND l.is_default = TRUE LIMIT 1;
    END IF;
    NEW.buyer_line_id := v_line;
    IF NEW.buyer_appendix IS NULL AND v_line IS NOT NULL THEN
      SELECT appendix INTO NEW.buyer_appendix FROM deal_buyer_lines WHERE id = v_line;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_pin_registry_lines_upd ON shipment_registry;
CREATE TRIGGER trg_pin_registry_lines_upd
  BEFORE UPDATE ON shipment_registry
  FOR EACH ROW
  WHEN (
       (NEW.loading_volume  IS NOT NULL AND OLD.loading_volume  IS NULL)
    OR (NEW.shipment_volume IS NOT NULL AND OLD.shipment_volume IS NULL)
  )
  EXECUTE FUNCTION pin_registry_lines_on_volume_appears();

-- ── 2. Починка уже созданных строк, по одной сделке ──────────────────
CREATE OR REPLACE FUNCTION pin_registry_lines(p_deal_code TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD;
  v_rows INT := 0;
BEGIN
  IF p_deal_code IS NULL THEN
    RAISE EXCEPTION 'Укажите код сделки: SELECT pin_registry_lines(''KZ/26/276''). Массовая привязка по всей базе запрещена — она пересчитает цены отгрузок через 00057.';
  END IF;

  FOR r IN
    SELECT sr.id, sr.wagon_number, sr.supplier_line_id, sr.buyer_line_id,
           sl.id AS sup_default, bl.id AS buy_default
      FROM shipment_registry sr
      JOIN deals d ON d.id = sr.deal_id
      LEFT JOIN deal_supplier_lines sl ON sl.deal_id = d.id AND sl.is_default
      LEFT JOIN deal_buyer_lines    bl ON bl.deal_id = d.id AND bl.is_default
     WHERE d.deal_code = p_deal_code
       AND (sr.supplier_line_id IS NULL OR sr.buyer_line_id IS NULL)
     ORDER BY sr.date, sr.wagon_number
  LOOP
    CONTINUE WHEN COALESCE(r.supplier_line_id, r.sup_default) IS NULL
              AND COALESCE(r.buyer_line_id, r.buy_default) IS NULL;

    UPDATE shipment_registry
       SET supplier_line_id = COALESCE(supplier_line_id, r.sup_default),
           buyer_line_id    = COALESCE(buyer_line_id,    r.buy_default)
     WHERE id = r.id;

    RAISE NOTICE 'вагон %: привязан к основному варианту [id %]',
      COALESCE(r.wagon_number, '—'), r.id;
    v_rows := v_rows + 1;
  END LOOP;

  RAISE NOTICE 'сделка %: привязано строк %', p_deal_code, v_rows;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION pin_registry_lines(TEXT) IS
  'Привязывает строки реестра одной сделки к основному варианту цены там, где привязки нет. Поднимает пересчёт цены отгрузки (00057). Вызывать вручную: SELECT pin_registry_lines(''KZ/26/276'').';

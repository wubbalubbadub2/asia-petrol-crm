-- 00167_registry_tariff_always_from_reference.sql
--
-- Клиент 2026-09-22/23: «нужно сделать, чтобы в реестре всегда были
-- ставки со справочника, а не только в определённых случаях».
-- Повод — КГ/26/434: в справочнике на ст. Белкол → ст. Карабалта,
-- TS Logistics, Печное топливо, август стоит 42,00, а в семи строках
-- реестра 44,000 и ещё в двух пусто.
--
-- ПОЧЕМУ ТАК ПОЛУЧАЛОСЬ (проверено по коду, не предположение):
--   • Справочник доезжал до реестра ровно в двух случаях: при ДОБАВЛЕНИИ
--     ставки (00117:74-77, без условий) и при изменении САМОЙ СУММЫ
--     существующей ставки (00117:78-82, WHEN OLD.planned_tariff IS
--     DISTINCT FROM NEW.planned_tariff).
--   • Правка у ставки месяца, станции, экспедитора или ГСМ не запускала
--     распространение вообще. Удаление ставки — тоже.
--   • Строка реестра подбирала ставку при вставке и при смене своего
--     ключа (00148, 00134), а если справочник молчал — молча оставалась
--     с тем, что прислала форма (00134:64-66). Формы же подставляют не
--     справочник, а тариф сделки (bulk-add-dialog.tsx:209, :255).
--   Отсюда 44 в строках: на момент их создания ключ не резолвился, а
--   позже ставку 42 ПРАВИЛИ, а не добавляли, и до реестра это не дошло.
--
-- ЧТО ДЕЛАЕТ ЭТА МИГРАЦИЯ:
--   1. Один резолвер ключа на всю базу — `resolve_registry_tariff(...)`.
--      Раньше один и тот же шестиполевой ключ был переписан в каждой
--      миграции заново (00047, 00117, 00118, 00132, 00134, 00148, 00161,
--      00163). Теперь он ровно один, и триггеры зовут его.
--   2. `sync_registry_tariffs()` — выравнивает ВСЕ не-ручные строки по
--      справочнику. Вызывается на ЛЮБОЕ изменение справочника: INSERT,
--      UPDATE (любого поля, не только суммы) и DELETE. Триггер
--      операторный (FOR EACH STATEMENT), поэтому массовый импорт ставок
--      запускает выравнивание один раз, а не на каждую строку.
--   3. Снятие ручной пометки теперь сразу возвращает ставку из
--      справочника: `railway_tariff_override` добавлен в WHEN-условие
--      триггера строки.
--   4. Аудит справочника: `tariffs` попадает в `audit_log`. До сих пор
--      ответить «кто и когда поменял ставку» было нечем (00036:71-93 —
--      шесть таблиц, `tariffs` среди них не было).
--   5. Разовое выравнивание уже разъехавшихся строк, построчно в NOTICE.
--
-- ДВА РЕШЕНИЯ, КОТОРЫЕ ПРИНЯТЫ ЗДЕСЬ ЯВНО (оба — в сторону «не трогать
-- деньги молча»; если клиент решит иначе, меняется одним условием):
--   • Ставки в справочнике по ключу строки НЕТ → строка остаётся с тем,
--     что в ней стоит. Ничего не обнуляется. Иначе применение миграции
--     стёрло бы суммы тысячам строк, для которых ставки не заведены
--     (на 18.09 таких было 4 298 — замер в 00161:33).
--   • Удаление ставки из справочника → строки сохраняют значение (тот же
--     принцип). Если после удаления по ключу находится другая ставка,
--     строки переедут на неё.
--   • Строки с ручной пометкой (`railway_tariff_override = TRUE`)
--     выравнивание НЕ трогает — ручной ввод остаётся ручным. Чтобы
--     вернуть строку на справочник, оператор очищает ячейку тарифа:
--     интерфейс снимает пометку, и п. 3 тут же подставляет ставку.
--
-- ЧЕГО МИГРАЦИЯ НЕ ДЕЛАЕТ:
--   • Не трогает `deals.planned_tariff` («Тариф план» в паспорте). Это
--     снимок на момент создания сделки, он не обновлялся из справочника
--     никогда, и менять это без решения клиента нельзя: колонка входит
--     в `preliminary_amount` (00120:67-69).
--   • Не трогает Сумму 2 и Сумму 3 и их тарифы (`supplier_railway_tariff`,
--     `manager_tariff`) — они со справочником `tariffs` не связаны.
--   • Не меняет правило «при нескольких подходящих ставках берётся
--     минимальная» (ORDER BY planned_tariff LIMIT 1) — оно перенесено
--     из 00134:61-62 как есть.
--   • Функцию `propagate_tariff_to_registry()` из 00117 не удаляет
--     (миграции append-only), но снимает её триггеры — её работу делает
--     `sync_registry_tariffs()`.
--
-- ДЕНЬГИ. Выравнивание меняет `railway_tariff` → через
-- `compute_registry_amount` пересчитывает Сумму 1 → через роллапы
-- `deals.invoice_amount` → «Тариф факт» (00120) и баланс поставщика у
-- сделок с галочкой «ЖД в цене». Каждая строка печатается построчно,
-- по сделкам печатается сдвиг суммы и баланса, в конце — сверка.
--
-- ROLLBACK:
--   DROP TRIGGER trg_sync_registry_tariffs ON tariffs;
--   вернуть триггеры 00117 (trg_propagate_tariff_ins/_upd);
--   значения «до» напечатаны построчно (сделка, вагон, было → стало, id),
--   вернуть их UPDATE shipment_registry SET railway_tariff = <было>,
--   railway_tariff_override = TRUE WHERE id = <id>.
--
-- Идемпотентна: повторный запуск не находит расхождений.

-- ── 1. Единый резолвер ключа ─────────────────────────────────────────
-- Ключ перенесён из 00134:52-62 ДОСЛОВНО, включая фолбэки на сделку и
-- правило выбора при нескольких совпадениях.
CREATE OR REPLACE FUNCTION resolve_registry_tariff(
  p_deal_id                UUID,
  p_departure_station_id   UUID,
  p_destination_station_id UUID,
  p_fuel_type_id           UUID,
  p_forwarder_id           UUID,
  p_shipment_month         TEXT
) RETURNS NUMERIC
LANGUAGE sql STABLE AS $fn$
  SELECT t.planned_tariff
    FROM deals d
    JOIN tariffs t
      ON t.departure_station_id   = COALESCE(p_departure_station_id,   d.supplier_departure_station_id)
     AND t.destination_station_id = COALESCE(p_destination_station_id, d.buyer_destination_station_id)
     AND t.fuel_type_id           = COALESCE(p_fuel_type_id,           d.fuel_type_id)
     AND t.forwarder_id           = COALESCE(p_forwarder_id,           d.forwarder_id)
     AND t.month                  = COALESCE(p_shipment_month,         d.month)
     AND t.year                   = d.year
   WHERE d.id = p_deal_id
     AND t.planned_tariff IS NOT NULL
   ORDER BY t.planned_tariff
   LIMIT 1;
$fn$;

COMMENT ON FUNCTION resolve_registry_tariff(UUID, UUID, UUID, UUID, UUID, TEXT) IS
  'Ставка справочника для строки реестра по ключу (отправление, назначение, ГСМ, экспедитор, месяц отгрузки, год сделки). Пустые поля строки берутся со сделки. При нескольких совпадениях — минимальная. ЕДИНСТВЕННОЕ место, где живёт ключ подбора (00167).';

-- ── 2. Триггер строки реестра зовёт общий резолвер ───────────────────
-- Поведение прежнее: ручные строки не трогаем; если справочник молчит —
-- оставляем то, что есть.
CREATE OR REPLACE FUNCTION reresolve_registry_tariff_on_key_change()
RETURNS TRIGGER AS $$
DECLARE
  v_tariff NUMERIC;
BEGIN
  IF COALESCE(NEW.railway_tariff_override, FALSE) THEN
    RETURN NEW;
  END IF;

  v_tariff := resolve_registry_tariff(
    NEW.deal_id, NEW.departure_station_id, NEW.destination_station_id,
    NEW.fuel_type_id, NEW.forwarder_id, NEW.shipment_month);

  IF v_tariff IS NOT NULL THEN
    NEW.railway_tariff := v_tariff;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Снятие ручной пометки добавлено в условие: очистил ячейку — ставка
-- вернулась из справочника тем же UPDATE'ом.
DROP TRIGGER IF EXISTS trg_key_reresolve_tariff ON shipment_registry;
CREATE TRIGGER trg_key_reresolve_tariff
  BEFORE UPDATE ON shipment_registry
  FOR EACH ROW
  WHEN (
       NEW.shipment_month         IS DISTINCT FROM OLD.shipment_month
    OR NEW.forwarder_id           IS DISTINCT FROM OLD.forwarder_id
    OR NEW.departure_station_id   IS DISTINCT FROM OLD.departure_station_id
    OR NEW.destination_station_id IS DISTINCT FROM OLD.destination_station_id
    OR NEW.fuel_type_id           IS DISTINCT FROM OLD.fuel_type_id
    OR NEW.deal_id                IS DISTINCT FROM OLD.deal_id
    OR (COALESCE(OLD.railway_tariff_override, FALSE)
        AND NOT COALESCE(NEW.railway_tariff_override, FALSE))
    -- Не-ручная строка осталась без ставки (очистили ячейку, пришла
    -- пустой из импорта) — подставляем из справочника сразу, а не ждём
    -- следующей правки ключа.
    OR (NEW.railway_tariff IS NULL
        AND NOT COALESCE(NEW.railway_tariff_override, FALSE))
  )
  EXECUTE FUNCTION reresolve_registry_tariff_on_key_change();

-- ── 3. Выравнивание реестра по справочнику ───────────────────────────
CREATE OR REPLACE FUNCTION sync_registry_tariffs(p_deal_id UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rows INT;
BEGIN
  WITH want AS (
    SELECT sr.id,
           resolve_registry_tariff(sr.deal_id, sr.departure_station_id, sr.destination_station_id,
                                   sr.fuel_type_id, sr.forwarder_id, sr.shipment_month) AS t
      FROM shipment_registry sr
     WHERE COALESCE(sr.railway_tariff_override, FALSE) = FALSE
       AND (p_deal_id IS NULL OR sr.deal_id = p_deal_id)
  )
  UPDATE shipment_registry sr
     SET railway_tariff = want.t
    FROM want
   WHERE want.id = sr.id
     AND want.t IS NOT NULL                       -- ставки нет → не трогаем
     AND sr.railway_tariff IS DISTINCT FROM want.t;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION sync_registry_tariffs(UUID) IS
  'Выравнивает railway_tariff всех не-ручных строк реестра по справочнику. Строки, для которых ставки нет, не трогает. Зовётся триггером на любое изменение tariffs (00167).';

CREATE OR REPLACE FUNCTION sync_registry_tariffs_stmt()
RETURNS TRIGGER AS $$
DECLARE
  v_rows INT;
BEGIN
  v_rows := sync_registry_tariffs();
  IF v_rows > 0 THEN
    RAISE NOTICE 'справочник тарифов изменён → выровнено строк реестра: %', v_rows;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Один операторный триггер вместо двух построчных из 00117: реагирует на
-- ЛЮБОЕ изменение справочника, включая правку ключевых полей и удаление.
DROP TRIGGER IF EXISTS trg_propagate_tariff_ins ON tariffs;
DROP TRIGGER IF EXISTS trg_propagate_tariff_upd ON tariffs;
DROP TRIGGER IF EXISTS trg_sync_registry_tariffs ON tariffs;
CREATE TRIGGER trg_sync_registry_tariffs
  AFTER INSERT OR UPDATE OR DELETE ON tariffs
  FOR EACH STATEMENT
  EXECUTE FUNCTION sync_registry_tariffs_stmt();

-- ── 4. Аудит справочника ставок ──────────────────────────────────────
-- audit_trigger() универсален (00036:22-24: любая таблица с id UUID).
DROP TRIGGER IF EXISTS trg_audit_tariffs ON tariffs;
CREATE TRIGGER trg_audit_tariffs
  AFTER INSERT OR UPDATE OR DELETE ON tariffs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ── 5. Разовое выравнивание накопленных расхождений ──────────────────
DO $$
DECLARE
  r RECORD;
  dl RECORD;
  v_ids UUID[] := '{}';
  v_deal_ids UUID[] := '{}';
  v_rows INT := 0;
  v_manual INT;
  v_no_rate INT;
  v_before JSONB;
BEGIN
  FOR r IN
    SELECT sr.id, sr.deal_id, d.deal_code, sr.wagon_number,
           COALESCE(sr.shipment_month, d.month) AS mon,
           sr.railway_tariff AS old_tariff,
           resolve_registry_tariff(sr.deal_id, sr.departure_station_id, sr.destination_station_id,
                                   sr.fuel_type_id, sr.forwarder_id, sr.shipment_month) AS ref_tariff
      FROM shipment_registry sr
      JOIN deals d ON d.id = sr.deal_id
     WHERE COALESCE(sr.railway_tariff_override, FALSE) = FALSE
     ORDER BY d.deal_code, sr.date, sr.wagon_number
  LOOP
    CONTINUE WHEN r.ref_tariff IS NULL;
    CONTINUE WHEN r.old_tariff IS NOT DISTINCT FROM r.ref_tariff;

    RAISE NOTICE '% вагон % (%): тариф % → % [id %]',
      r.deal_code, COALESCE(r.wagon_number, '—'), r.mon,
      COALESCE(r.old_tariff::TEXT, 'пусто'), r.ref_tariff, r.id;

    v_ids := v_ids || r.id;
    v_rows := v_rows + 1;
    IF NOT (r.deal_id = ANY (v_deal_ids)) THEN
      v_deal_ids := v_deal_ids || r.deal_id;
    END IF;
  END LOOP;

  IF v_rows > 0 THEN
    SELECT jsonb_object_agg(id, jsonb_build_object(
             'code', deal_code, 'inv', invoice_amount,
             'tar', actual_tariff, 'bal', supplier_balance))
      INTO v_before
      FROM deals WHERE id = ANY (v_deal_ids);

    PERFORM sync_registry_tariffs();

    FOR dl IN
      SELECT id, deal_code, invoice_amount, actual_tariff, supplier_balance
        FROM deals WHERE id = ANY (v_deal_ids)
       ORDER BY deal_code
    LOOP
      RAISE NOTICE '%: Сумма 1 % → %, «тариф факт» % → %, баланс поставщика % → %',
        dl.deal_code,
        v_before -> dl.id::TEXT ->> 'inv', dl.invoice_amount,
        v_before -> dl.id::TEXT ->> 'tar', dl.actual_tariff,
        v_before -> dl.id::TEXT ->> 'bal', dl.supplier_balance;
    END LOOP;

    RAISE NOTICE 'выровнено строк: % в % сделках', v_rows, array_length(v_deal_ids, 1);
  ELSE
    RAISE NOTICE 'расхождений со справочником нет — выравнивать нечего';
  END IF;

  -- Что осталось за пределами выравнивания — чтобы масштаб был виден.
  SELECT count(*) INTO v_manual
    FROM shipment_registry WHERE COALESCE(railway_tariff_override, FALSE);
  SELECT count(*) INTO v_no_rate
    FROM shipment_registry sr
   WHERE COALESCE(sr.railway_tariff_override, FALSE) = FALSE
     AND resolve_registry_tariff(sr.deal_id, sr.departure_station_id, sr.destination_station_id,
                                 sr.fuel_type_id, sr.forwarder_id, sr.shipment_month) IS NULL;
  RAISE NOTICE 'строк с ручной ставкой (не трогаем): %; строк, для которых ставки в справочнике нет: %',
    v_manual, v_no_rate;

  -- Сверка: не-ручных строк, расходящихся со справочником, не осталось.
  PERFORM 1
    FROM shipment_registry sr
   WHERE COALESCE(sr.railway_tariff_override, FALSE) = FALSE
     AND resolve_registry_tariff(sr.deal_id, sr.departure_station_id, sr.destination_station_id,
                                 sr.fuel_type_id, sr.forwarder_id, sr.shipment_month) IS NOT NULL
     AND sr.railway_tariff IS DISTINCT FROM
         resolve_registry_tariff(sr.deal_id, sr.departure_station_id, sr.destination_station_id,
                                 sr.fuel_type_id, sr.forwarder_id, sr.shipment_month);
  IF FOUND THEN
    RAISE EXCEPTION 'после выравнивания остались строки, расходящиеся со справочником — миграция отменена';
  END IF;
END $$;

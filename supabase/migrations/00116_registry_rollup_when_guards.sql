-- 00116_registry_rollup_when_guards.sql
--
-- Клиент 2026-07-16, 12:57 Алматы: «canceling statement due to
-- statement timeout» при быстром вводе № СФ в реестре — правка не
-- сохранилась. Audit_log показывает 15–18 UPDATE'ов реестра в минуту
-- в момент ошибки.
--
-- Root cause: КАЖДЫЙ UPDATE строки реестра (даже invoice_number,
-- который ни на один rollup не влияет) безусловно дёргает ДВА
-- `UPDATE deals`:
--   • trg_shipment_refresh_deal → refresh_deal_shipment_totals()
--     (SUM по всем строкам сделки + UPDATE deals из 00044);
--   • trg_update_deal_additional_expenses →
--     update_deal_additional_expenses() (SUM + UPDATE deals; 00115
--     снял OF-clause, и триггер стал срабатывать на любой UPDATE).
-- Каждый UPDATE deals тянет свой каскад (derived fields, audit с
-- двумя JSONB-снимками ~100-колоночной строки, field-change log,
-- sync default-линий). Все правки строк ОДНОЙ сделки сериализуются
-- на блокировке одной строки deals; ожидание блокировки засчитывается
-- в statement_timeout (8 s у Supabase) — хвост очереди при быстром
-- вводе убивается, правка оператора теряется.
--
-- Фикс — два уровня:
--   1. WHEN-guards на UPDATE-триггеры: rollup срабатывает только когда
--      изменилось то, от чего он зависит. WHEN сравнивает ЗНАЧЕНИЯ
--      OLD/NEW (а не SET-list, как `UPDATE OF`), поэтому auto-computed
--      additional_expenses из BEFORE-триггера 00113 корректно ловится —
--      баг 00112/00115 не возвращается.
--   2. No-op-guard внутри функций: не брать блокировку deals, когда
--      писать нечего (значения совпадают).
-- INSERT/DELETE остаются безусловными — там rollup нужен всегда.

-- ── 1. refresh_deal_shipment_totals: no-op guard ────────────────────
-- Прежняя версия (00044) делала UPDATE ... FROM (SELECT ... GROUP BY)
-- и ветку IF NOT FOUND → нули. С guard'ом в WHERE ветка NOT FOUND
-- срабатывала бы и при «значения не изменились» — поэтому суммы
-- сначала считаются в переменные, потом один guarded UPDATE.
CREATE OR REPLACE FUNCTION refresh_deal_shipment_totals(p_deal_id UUID)
RETURNS VOID AS $$
DECLARE
  v_loading  NUMERIC;
  v_shipment NUMERIC;
  v_amount   NUMERIC;
BEGIN
  SELECT COALESCE(SUM(loading_volume), 0),
         COALESCE(SUM(shipment_volume), 0),
         COALESCE(SUM(shipped_tonnage_amount), 0)
    INTO v_loading, v_shipment, v_amount
    FROM shipment_registry
   WHERE deal_id = p_deal_id;

  -- Пустой реестр даёт нули — прежняя ветка IF NOT FOUND сохранена
  -- семантически (SUM по пустому набору → NULL → COALESCE → 0).
  UPDATE deals
     SET supplier_shipped_volume = v_loading,
         buyer_shipped_volume    = v_shipment,
         actual_shipped_volume   = v_shipment,
         invoice_amount          = v_amount
   WHERE id = p_deal_id
     AND (supplier_shipped_volume IS DISTINCT FROM v_loading
       OR buyer_shipped_volume    IS DISTINCT FROM v_shipment
       OR actual_shipped_volume   IS DISTINCT FROM v_shipment
       OR invoice_amount          IS DISTINCT FROM v_amount);
END;
$$ LANGUAGE plpgsql;

-- ── 2. update_deal_additional_expenses: no-op guard ─────────────────
CREATE OR REPLACE FUNCTION update_deal_additional_expenses()
RETURNS TRIGGER AS $$
DECLARE
  v_deal_id UUID;
  v_sum NUMERIC;
BEGIN
  v_deal_id := COALESCE(NEW.deal_id, OLD.deal_id);
  IF v_deal_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COALESCE(SUM(additional_expenses), 0)
    INTO v_sum
    FROM shipment_registry
   WHERE deal_id = v_deal_id;

  UPDATE deals
     SET additional_expenses_amount = v_sum
   WHERE id = v_deal_id
     AND additional_expenses_amount IS DISTINCT FROM v_sum;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ── 3. trg_shipment_refresh_deal → split INSERT/DELETE vs UPDATE ────
-- WHEN с OLD/NEW допустим только на UPDATE-триггере, поэтому один
-- безусловный триггер превращается в два.
DROP TRIGGER IF EXISTS trg_shipment_refresh_deal ON shipment_registry;

CREATE TRIGGER trg_shipment_refresh_deal_ins_del
  AFTER INSERT OR DELETE ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION trg_refresh_deal_on_shipment();

CREATE TRIGGER trg_shipment_refresh_deal_upd
  AFTER UPDATE ON shipment_registry
  FOR EACH ROW
  WHEN (OLD.loading_volume          IS DISTINCT FROM NEW.loading_volume
     OR OLD.shipment_volume         IS DISTINCT FROM NEW.shipment_volume
     OR OLD.shipped_tonnage_amount  IS DISTINCT FROM NEW.shipped_tonnage_amount
     OR OLD.deal_id                 IS DISTINCT FROM NEW.deal_id)
  EXECUTE FUNCTION trg_refresh_deal_on_shipment();

-- ── 4. trg_update_deal_additional_expenses → тот же split ───────────
DROP TRIGGER IF EXISTS trg_update_deal_additional_expenses ON shipment_registry;

CREATE TRIGGER trg_update_deal_additional_expenses_ins_del
  AFTER INSERT OR DELETE ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION update_deal_additional_expenses();

CREATE TRIGGER trg_update_deal_additional_expenses_upd
  AFTER UPDATE ON shipment_registry
  FOR EACH ROW
  WHEN (OLD.additional_expenses IS DISTINCT FROM NEW.additional_expenses
     OR OLD.deal_id             IS DISTINCT FROM NEW.deal_id)
  EXECUTE FUNCTION update_deal_additional_expenses();

-- ── 5. Sanity: rollup'ы не разъехались ───────────────────────────────
-- Функции переопределены — прогоняем контрольный пересчёт по сделкам,
-- у которых текущие rollup-значения не совпадают с фактическим SUM
-- (guarded UPDATE сам пропустит совпадающие).
DO $$
DECLARE
  rec RECORD;
  v_fixed INT := 0;
BEGIN
  FOR rec IN SELECT DISTINCT deal_id FROM shipment_registry WHERE deal_id IS NOT NULL LOOP
    PERFORM refresh_deal_shipment_totals(rec.deal_id);
    v_fixed := v_fixed + 1;
  END LOOP;
  RAISE NOTICE 'refresh_deal_shipment_totals прогнан по % сделкам (no-op пропущены guard-ом)', v_fixed;
END $$;

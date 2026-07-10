-- 00115_additional_expenses_rollup_fix.sql
--
-- Клиент 2026-07-10 (KZ/26/002): «Галочка Грузоотправитель в цене не
-- плюсанула в баланс». Проверка БД показала:
--   • deals.additional_expenses_in_price = true
--   • deals.additional_expenses_amount = 0
--   • SUM(shipment_registry.additional_expenses) для этой сделки =
--     1 497 856.066 (реальная сумма)
--
-- Баг: триггер update_deal_additional_expenses (00112) был на
-- «AFTER INSERT OR UPDATE OF additional_expenses, deal_id OR DELETE».
-- После 00113 колонка additional_expenses стала AUTO-computed:
-- BEFORE-триггер меняет NEW.additional_expenses внутри UPDATE'а по
-- manager_tariff или loading_volume. Postgres `AFTER UPDATE OF col`
-- срабатывает только когда col В SET-list, а не когда col ИЗМЕНИЛСЯ
-- благодаря BEFORE-триггеру. Итог: rollup не обновлялся.
--
-- Фикс: убираем OF-clause. Триггер срабатывает на любой UPDATE строки
-- реестра. Пересчёт SUM цепёшовый: один запрос на deal. Дёшево.
--
-- Плюс backfill: пересчитать deals.additional_expenses_amount для
-- ВСЕХ сделок из текущего состояния shipment_registry.

DROP TRIGGER IF EXISTS trg_update_deal_additional_expenses ON shipment_registry;

CREATE TRIGGER trg_update_deal_additional_expenses
AFTER INSERT OR UPDATE OR DELETE
ON shipment_registry
FOR EACH ROW
EXECUTE FUNCTION update_deal_additional_expenses();

-- Backfill: для каждой сделки пересчитываем additional_expenses_amount.
UPDATE deals d
   SET additional_expenses_amount = COALESCE((
     SELECT SUM(additional_expenses)
       FROM shipment_registry
      WHERE deal_id = d.id
   ), 0);

-- Прогоняем deal-level триггер по всем сделкам, чтобы supplier_balance
-- пересчитался с учётом новой суммы + флажка additional_expenses_in_price.
UPDATE deals SET updated_at = now() WHERE id IS NOT NULL;

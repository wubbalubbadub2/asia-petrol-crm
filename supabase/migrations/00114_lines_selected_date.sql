-- 00114_lines_selected_date.sql
--
-- Клиент 2026-07-10: для формульных линий с подтипом «средний месяц»
-- добавить «Режим расчёта» (like triggers): «средний месяц» (текущий
-- дефолт) или «на дату». Второй режим позволяет менеджеру выбрать
-- конкретную дату — котировка на неё вместо среднего за месяц.
--
-- В БД calc_mode уже есть (00079: 'on_date' / 'avg_month'). Не хватает
-- поля для хранения этой даты — добавляю selected_date DATE. Для
-- обратной совместимости:
--   • Существующие average_month линии получат calc_mode='avg_month'
--     (уже дефолт из 00079).
--   • selected_date NULL — читаем как «использовать selected_month/deal
--     month/year как раньше».

ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS selected_date DATE;

ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS selected_date DATE;

COMMENT ON COLUMN deal_supplier_lines.selected_date IS
  'Клиент 2026-07-10: конкретная дата для формулы (calc_mode=on_date + subtype=average_month). Иначе NULL.';
COMMENT ON COLUMN deal_buyer_lines.selected_date IS
  'see deal_supplier_lines.selected_date';

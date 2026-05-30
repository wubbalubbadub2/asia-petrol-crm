-- Add an explicit anchor date on the deal for the «Средний месяц» pickup.
-- The quotation_avg fetch normally derives the month from each line's
-- shipment_date, but the client wants a single deal-level date as the
-- source of truth (per 30.05.2026 feedback). When this is set, the avg
-- pickup uses YYYY-MM of avg_month_date; otherwise behavior is unchanged.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS avg_month_date DATE;

COMMENT ON COLUMN deals.avg_month_date IS
  'Опорная дата для подтипа «Средний месяц». Если задана — котировка усредняется по её месяцу, иначе используется shipment_date строки.';

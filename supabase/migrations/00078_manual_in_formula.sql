-- New enum value `manual_in_formula` on `price_condition` (2026-05-21).
--
-- Per Beken's clarification on the variant editor: the «Подтип формулы»
-- picker on /deals/new now has three options — «Фикс цена», «Триггер по
-- дате отгрузки», «Триггер по дате пересечения границы». The «Фикс цена»
-- option means the variant lives under the formula tier (quotation +
-- sub-quotation are picked for the audit trail) but the price itself is
-- typed by the manager. It is DISTINCT from `fixed` — `fixed` is the
-- single-day auto-lookup mode that has moved into the new «Режим расчёта»
-- selector alongside `average_month` and `avg_to_date`.
--
-- Idempotent.

ALTER TYPE price_condition ADD VALUE IF NOT EXISTS 'manual_in_formula';

-- Comment for future-self: 'manual_in_formula' means the variant uses a
-- formula-tier layout (quotation + sub-quotation are picked for the audit
-- trail) but the price itself is entered manually by the manager. Distinct
-- from 'fixed' which auto-looks-up the quotation column for a given date.
COMMENT ON TYPE price_condition IS
  'manual: pure manual price, no quotation reference. manual_formula: '
  '(quotation - discount) * fx_rate. manual_in_formula: quotation/sub '
  'picked for record, price manual. fixed: single-day auto lookup. '
  'average_month: monthly average. avg_to_date: partial-month average '
  'ending on a date. trigger: 35-40 day window from shipment or border.';

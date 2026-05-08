-- Per-line trigger config for formula pricing.
--
-- The price-formation flow at the variant (line) level previously had only
-- `price_condition` and `quotation_type_id`. When `price_condition='trigger'`
-- the actual basis (shipment_date vs border_crossing_date) and the day
-- count lived only on the deal-level `deals.trigger_basis` column or on
-- per-shipment `deal_shipment_prices` rows — neither of which lets a
-- variant declare "this variant uses border-crossing trigger with N days".
--
-- Per client (2026-05-08): the manager wants to choose, on each variant:
--   • Триггер по дате отгрузки (30-44 дней, default 35)
--   • Триггер с пересечения границы (35-40 дней, default 37)
-- and edit the day count manually. To make that survive a save, the line
-- needs its own `trigger_basis` and `trigger_days` columns.
--
-- New columns on deal_supplier_lines + deal_buyer_lines:
--   trigger_basis trigger_basis        -- enum from 00023, nullable
--   trigger_days  INT                  -- nullable, default left to UI
--
-- Both NULLable so existing rows stay valid; UI sets sensible defaults
-- when condition flips to trigger. Backfill not needed — existing
-- trigger-conditioned lines keep falling back to the deal-level basis.

ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS trigger_basis trigger_basis,
  ADD COLUMN IF NOT EXISTS trigger_days  INT;

ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS trigger_basis trigger_basis,
  ADD COLUMN IF NOT EXISTS trigger_days  INT;

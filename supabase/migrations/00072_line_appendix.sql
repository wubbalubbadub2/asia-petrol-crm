-- Variant «Приложение» (appendix) label (product spec, 2026-05-19).
--
-- A deal can be split into multiple contractual appendices (Приложение
-- №1, №2…), each with its own pricing terms. Existing model already
-- has one variant per appendix on each side; this migration adds a
-- free-text label so the operator can identify the variant by its
-- appendix number when registering shipments.
--
-- Supplier and buyer appendices are independent — the same physical
-- shipment may sit under different appendices on each side. So we
-- carry two separate columns on shipment_registry.
--
-- The shipment_registry columns are metadata only — the existing
-- supplier_line_id / buyer_line_id FKs remain the source of truth
-- for pricing. The frontend auto-fills the line ids when the user
-- picks an appendix, and pricing flows from the matched line as
-- before.

ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS appendix TEXT;

ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS appendix TEXT;

ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS supplier_appendix TEXT,
  ADD COLUMN IF NOT EXISTS buyer_appendix TEXT;

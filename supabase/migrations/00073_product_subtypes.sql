-- Sub-quotations (product subtypes) — Phase 1 of the sub-quotation feature
-- (2026-05-21).
--
-- Today each parent quotation (quotation_product_types) has a single daily
-- row in `quotations` with a wide layout of price columns (price,
-- price_cif_nwe, price_fob_med, price_fob_rotterdam). The frontend's
-- `fetchQuotationPrice` falls back through `??` — effectively "pick whatever
-- column is non-null", which is wrong: each parent has its own meaningful
-- set of sub-quotations and managers must explicitly pick which one prices
-- a given variant.
--
-- This migration introduces the normalized list of sub-quotations per
-- parent, plus a nullable FK on the three lines tables (deal_supplier_lines,
-- deal_buyer_lines, shipment_registry) and a new price_condition enum value
-- 'avg_to_date' for the partial-month average mode ending on a chosen date.
--
-- No data backfill. No frontend changes. Phases 2 and 3 follow.

-- ── 1. product_subtypes table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_subtypes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type_id UUID NOT NULL REFERENCES quotation_product_types(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  display_order   INT  NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_type_id, name)
);

CREATE INDEX IF NOT EXISTS idx_product_subtypes_parent
  ON product_subtypes(product_type_id, display_order);

-- ── 2. extend price_condition enum ───────────────────────────────────────
-- 'avg_to_date' = partial-month average ending on a chosen date, bounded
-- by the 1st of that month. Existing values are untouched.
ALTER TYPE price_condition ADD VALUE IF NOT EXISTS 'avg_to_date';

-- ── 3. sub_quotation_id FK on the three lines tables ─────────────────────
ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS sub_quotation_id UUID REFERENCES product_subtypes(id);

CREATE INDEX IF NOT EXISTS idx_deal_supplier_lines_sub_quotation
  ON deal_supplier_lines(sub_quotation_id);

ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS sub_quotation_id UUID REFERENCES product_subtypes(id);

CREATE INDEX IF NOT EXISTS idx_deal_buyer_lines_sub_quotation
  ON deal_buyer_lines(sub_quotation_id);

ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS sub_quotation_id UUID REFERENCES product_subtypes(id);

CREATE INDEX IF NOT EXISTS idx_shipment_registry_sub_quotation
  ON shipment_registry(sub_quotation_id);

-- ── 4. seed product_subtypes from Карточка.xlsx ──────────────────────────
-- Idempotent: ON CONFLICT (product_type_id, name) DO NOTHING.
-- Parents that don't exist in quotation_product_types under the listed
-- name are silently skipped (INNER JOIN drops them).
INSERT INTO product_subtypes (product_type_id, name, display_order)
SELECT pt.id, x.sub_name, x.ord
FROM quotation_product_types pt
JOIN (VALUES
  ('ГАЗОЙЛЬ 0,1 %',              'Среднее CIF NWE',                              1),
  ('ГАЗОЙЛЬ 0,1 %',              'Среднее CIF NWE/Basis ARA и FOB Rotterdam',    2),
  ('ГАЗОЙЛЬ 0,1 %',              'Среднее FOB MED',                              3),

  ('ВГО 0,5-0,6 %',              'CIF NWE Cargo 0,5-0,6 %',                      1),
  ('ВГО 0,5-0,6 %',              'FOB Rotterdam barge 0,5-0,6 %',                2),

  ('ВГО 2 %',                    'CIF NWE Cargo 2 %',                            1),
  ('ВГО 2 %',                    'FOB Rotterdam barge 2 %',                      2),

  ('МАЗУТ 0,5 % Marine Fuel',    'FOB Rotterdam barge 0,5 %',                    1),

  ('МАЗУТ 1,0 % Fuel oil',       'CIF NWE/Basis ARA и FOB Rotterdam 1,0 %',      1),
  ('МАЗУТ 1,0 % Fuel oil',       'FOB MED 1,0 %',                                2),

  ('МАЗУТ 3,5 %',                'CIF NWE/Basis ARA и FOB Rotterdam 3,5 %',      1),
  ('МАЗУТ 3,5 %',                'FOB MED 3,5 %',                                2),

  ('МАЗУТ 1,0 % FOB NWE',        'FOB NWE 1,0 %',                                1),

  ('МАЗУТ 1,0 % FOB Rotterdam',  'FOB Rotterdam 1,0 %',                          1),

  ('МАЗУТ 3,5 % FOB NWE',        'FOB NWE 3,5 %',                                1),

  ('МАЗУТ 3,5 % FOB Rotterdam',  'FOB Rotterdam 3,5 %',                          1),

  ('Eurobob',                    'FOB Rotterdam / Eurobob',                      1),

  ('Prem Unl 10 ppm',            'FOB MED / Prem Unl 10 ppm Italy',              1),

  ('НАФТА',                      'Среднее CIF NWE/Basis ARA и FOB Rotterdam',    1),
  ('НАФТА',                      'Среднее FOB MED',                              2),

  ('ULSD 10 ppm',                'CIF NWE/Basis ARA / ULSD 10 ppm',              1),
  ('ULSD 10 ppm',                'FOB MED (Italy) / ULSD 10 ppm',                2),

  ('Jet',                        'CIF NWE/Basis ARA и FOB Rotterdam / Jet',      1),
  ('Jet',                        'FOB MED / Jet',                                2),

  ('BRENT DTD (Platts)',         'BRENT DTD (Platts)',                           1)
) AS x(parent_name, sub_name, ord) ON pt.name = x.parent_name
ON CONFLICT (product_type_id, name) DO NOTHING;

-- ── 5. column comments ───────────────────────────────────────────────────
COMMENT ON COLUMN deal_supplier_lines.sub_quotation_id IS
  'Manager-picked sub-quotation that determines which price column/index is used to compute the variant''s price; null = legacy/unset.';

COMMENT ON COLUMN deal_buyer_lines.sub_quotation_id IS
  'Manager-picked sub-quotation that determines which price column/index is used to compute the variant''s price; null = legacy/unset.';

COMMENT ON COLUMN shipment_registry.sub_quotation_id IS
  'Manager-picked sub-quotation that determines which price column/index is used to compute the shipment''s price; null = legacy/unset.';

-- Seed correction for product_subtypes (2026-05-21).
--
-- Migration 00073 seeded sub-quotations by joining product_subtypes rows
-- against quotation_product_types.name. The seed used Excel-derived names
-- like 'ГАЗОЙЛЬ 0,1 %' / 'МАЗУТ 1,0 % Fuel oil' (with a space before %),
-- but the live database stores them without the space — 'ГАЗОЙЛЬ 0,1%' /
-- 'МАЗУТ 1,0% Fuel oil'. The INNER JOIN silently dropped 10 of 16 parents
-- so the UI's «Подкотировка» picker stayed disabled («— нет подкотировок —»)
-- for the most-used quotations.
--
-- This migration re-inserts the missing rows using the correct parent names.
-- Idempotent via the existing UNIQUE (product_type_id, name) constraint
-- plus ON CONFLICT DO NOTHING — safe to run on environments that already
-- got the fix via direct API insert.

INSERT INTO product_subtypes (product_type_id, name, display_order)
SELECT pt.id, x.sub_name, x.ord
FROM quotation_product_types pt
JOIN (VALUES
  ('ГАЗОЙЛЬ 0,1%',              'Среднее CIF NWE',                              1),
  ('ГАЗОЙЛЬ 0,1%',              'Среднее CIF NWE/Basis ARA и FOB Rotterdam',     2),
  ('ГАЗОЙЛЬ 0,1%',              'Среднее FOB MED',                              3),

  ('ВГО 0,5-0,6%',              'CIF NWE Cargo 0,5-0,6 %',                      1),
  ('ВГО 0,5-0,6%',              'FOB Rotterdam barge 0,5-0,6 %',                2),

  ('ВГО 2%',                    'CIF NWE Cargo 2 %',                            1),
  ('ВГО 2%',                    'FOB Rotterdam barge 2 %',                      2),

  ('МАЗУТ 0,5% Marine Fuel',    'FOB Rotterdam barge 0,5 %',                    1),

  ('МАЗУТ 1,0% Fuel oil',       'CIF NWE/Basis ARA и FOB Rotterdam 1,0 %',      1),
  ('МАЗУТ 1,0% Fuel oil',       'FOB MED 1,0 %',                                2),

  ('МАЗУТ 3,5%',                'CIF NWE/Basis ARA и FOB Rotterdam 3,5 %',      1),
  ('МАЗУТ 3,5%',                'FOB MED 3,5 %',                                2),

  ('МАЗУТ 1,0% FOB NWE',        'FOB NWE 1,0 %',                                1),
  ('МАЗУТ 1,0% FOB Rotterdam',  'FOB Rotterdam 1,0 %',                          1),
  ('МАЗУТ 3,5% FOB NWE',        'FOB NWE 3,5 %',                                1),
  ('МАЗУТ 3,5% FOB Rotterdam',  'FOB Rotterdam 3,5 %',                          1)
) AS x(parent_name, sub_name, ord) ON pt.name = x.parent_name
ON CONFLICT (product_type_id, name) DO NOTHING;

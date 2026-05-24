-- Backfill correct formula avg into `quotations.price` (2026-05-24).
--
-- ROOT CAUSE
-- ──────────
-- `quotations.price` is the «Среднее CIF NWE и FOB Rotterdam» formula
-- column for products that use FULL_PRICE_COLS in
-- src/lib/constants/quotation-columns.ts:
--
--     { key: "price", formula: "avg",
--       avgOf: ["price_cif_nwe", "price_fob_rotterdam"] }
--
-- The /quotations page renders this column by recomputing the avg from
-- the avgOf source columns on every render (page.tsx:239-243), so the
-- table always SHOWS the correct value. But the variant editor's
-- `compute_quotation_value` RPC reads the stored `quotations.price`
-- value directly — and at some point in history a bulk-import job
-- populated that column as avg of ALL three wide columns
-- (price_cif_nwe + price_fob_med + price_fob_rotterdam) / 3, instead of
-- the configured two-column avg. Result: 276 rows had stale 3-avg values.
--
-- Concrete repro that surfaced the bug: МАЗУТ 1,0% Fuel oil on 2026-02-05
-- showed 377.500 on /quotations (correct: (388.5+366.5)/2) but the deal
-- create page showed 370.667 (the stored 3-avg: (388.5+357.0+366.5)/3).
--
-- DATA TOUCHED (audited 2026-05-24)
-- ─────────────────────────────────
-- The 3-avg bug only manifests when all three wide cols are non-null.
-- Of the products that use FULL_PRICE_COLS (ГАЗОЙЛЬ 0,1%, МАЗУТ 1,0%
-- Fuel oil, МАЗУТ 3,5%, НАФТА, Jet):
--   • ГАЗОЙЛЬ 0,1%        91/91 already correct (presumably hand-edited)
--   • МАЗУТ 1,0% Fuel oil 70/91 buggy
--   • МАЗУТ 3,5%          69/90 buggy
--   • НАФТА               67/91 buggy
--   • Jet                 70/91 buggy
-- Total: 276 rows.
--
-- The fix was applied via REST PATCH from the dev box on 2026-05-24
-- (the script in commit history). This migration records the same
-- operation as SQL so a fresh DB restored from migrations matches.
--
-- IDEMPOTENT — running twice changes nothing (only updates rows whose
-- current value disagrees with the formula by ≥ 0.005).

UPDATE quotations
SET price = ROUND(((price_cif_nwe + price_fob_rotterdam) / 2.0)::numeric, 4)
WHERE price_cif_nwe IS NOT NULL
  AND price_fob_med IS NOT NULL
  AND price_fob_rotterdam IS NOT NULL
  AND product_type_id IN (
    SELECT id FROM quotation_product_types
    WHERE name IN (
      'ГАЗОЙЛЬ 0,1%',
      'МАЗУТ 1,0% Fuel oil',
      'МАЗУТ 3,5%',
      'НАФТА',
      'Jet'
    )
  )
  AND (
    price IS NULL
    OR ABS(price - ((price_cif_nwe + price_fob_rotterdam) / 2.0)) >= 0.005
  );

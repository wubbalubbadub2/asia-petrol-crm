-- ============================================================================
-- profile.sql — Pre-M2 migration profiling (MIGRATION-PLAN.md §1)
--
-- STRICTLY READ-ONLY. Every block is a single SELECT / WITH statement.
-- profile.ts runs each block inside a READ ONLY transaction. Do NOT add any
-- INSERT / UPDATE / DELETE / DDL here — profile.ts refuses to run if a block
-- does not start with SELECT or WITH, and the READ ONLY transaction rejects
-- writes at the server regardless.
--
-- Block format (parsed by profile.ts):
--   -- @block <id> | <human title>
--   <one SQL statement ending in ;>
--
-- <id> = q<N>.<kind>.<slug>
--   kind: count  → aggregate numbers (machine-readable, top of section)
--         sample → up to 20 example rows (LIMIT 20 enforced in SQL AND in TS)
--         assert → rows that MUST be empty; non-empty = FAILURE / halt condition
--         note   → schema-introspection used to confirm / flag an AS-BUILT expectation
--         meta   → helper data (not rendered), e.g. the counterparty mask map
--
-- Masking: any sample column aliased "cp__<x>" holds a counterparty id; profile.ts
-- replaces it with C-001, C-002, … and renames the header to <x>. Never SELECT raw
-- counterparty names in sample blocks.
-- ============================================================================


-- @block meta.counterparties | counterparty id → C-NNN mask map
SELECT id FROM counterparties ORDER BY id;


-- ============================================================================
-- Q1. Quotation shape
--   per-basis columns actually populated per product type; «Среднее» stored vs
--   derivable; null distribution per column.
-- ============================================================================

-- @block q1.count.populated_basis_per_product | Populated per-basis price columns per product type
SELECT pt.name AS product_type,
       pt.basis AS declared_basis,
       COUNT(q.id)                       AS rows,
       COUNT(q.price)                    AS price,
       COUNT(q.price_fob_med)            AS fob_med,
       COUNT(q.price_fob_rotterdam)      AS fob_rotterdam,
       COUNT(q.price_cif_nwe)            AS cif_nwe,
       COUNT(q.price_cif_nwe_standalone) AS cif_nwe_standalone
FROM quotation_product_types pt
LEFT JOIN quotations q ON q.product_type_id = pt.id
GROUP BY pt.id, pt.name, pt.basis
ORDER BY pt.name;

-- @block q1.count.null_distribution | NULLs per quotations column
SELECT COUNT(*)                                     AS total_rows,
       COUNT(*) - COUNT(price)                      AS null_price,
       COUNT(*) - COUNT(price_fob_med)              AS null_fob_med,
       COUNT(*) - COUNT(price_fob_rotterdam)        AS null_fob_rotterdam,
       COUNT(*) - COUNT(price_cif_nwe)              AS null_cif_nwe,
       COUNT(*) - COUNT(price_cif_nwe_standalone)   AS null_cif_nwe_standalone
FROM quotations;

-- @block q1.count.srednee_stored_vs_derivable | «Среднее» (monthly averages): stored vs recomputable from quotations
WITH d AS (
  SELECT product_type_id,
         EXTRACT(year  FROM date)::int AS y,
         EXTRACT(month FROM date)::int AS m,
         AVG(price) AS recomputed_avg
  FROM quotations
  WHERE price IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT COUNT(*)                                                                          AS monthly_avg_rows,
       COUNT(*) FILTER (WHERE qma.avg_price IS NOT NULL)                                 AS avg_price_stored,
       COUNT(*) FILTER (WHERE qma.avg_combined IS NOT NULL)                              AS avg_combined_stored,
       COUNT(*) FILTER (WHERE qma.avg_price IS NOT NULL AND d.recomputed_avg IS NOT NULL) AS comparable,
       COUNT(*) FILTER (WHERE qma.avg_price IS NOT NULL AND d.recomputed_avg IS NOT NULL
                         AND ABS(qma.avg_price - d.recomputed_avg) > 0.01)               AS stored_disagrees_recompute
FROM quotation_monthly_averages qma
LEFT JOIN d ON d.product_type_id = qma.product_type_id AND d.y = qma.year AND d.m = qma.month;

-- @block q1.sample.srednee_divergence | Months where stored «Среднее» ≠ recomputed avg(price)
WITH d AS (
  SELECT product_type_id,
         EXTRACT(year  FROM date)::int AS y,
         EXTRACT(month FROM date)::int AS m,
         AVG(price) AS recomputed_avg
  FROM quotations WHERE price IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT pt.name AS product_type, qma.year, qma.month,
       ROUND(qma.avg_price, 4)                    AS stored_avg,
       ROUND(d.recomputed_avg, 4)                 AS recomputed_avg,
       ROUND(qma.avg_price - d.recomputed_avg, 4) AS diff
FROM quotation_monthly_averages qma
JOIN quotation_product_types pt ON pt.id = qma.product_type_id
JOIN d ON d.product_type_id = qma.product_type_id AND d.y = qma.year AND d.m = qma.month
WHERE qma.avg_price IS NOT NULL
  AND ABS(qma.avg_price - d.recomputed_avg) > 0.01
ORDER BY ABS(qma.avg_price - d.recomputed_avg) DESC
LIMIT 20;


-- ============================================================================
-- Q2. Pricing lines
--   0/1/>1 default variants per side; scalar-vs-default-line divergence;
--   legacy price_condition distribution incl. dead enums.
-- ============================================================================

-- @block q2.count.default_variants_supplier | Deals by # of default supplier variants
SELECT n_default, COUNT(*) AS deals
FROM (
  SELECT d.id, COUNT(l.id) FILTER (WHERE l.is_default) AS n_default
  FROM deals d LEFT JOIN deal_supplier_lines l ON l.deal_id = d.id
  GROUP BY d.id
) t
GROUP BY n_default ORDER BY n_default;

-- @block q2.count.default_variants_buyer | Deals by # of default buyer variants
SELECT n_default, COUNT(*) AS deals
FROM (
  SELECT d.id, COUNT(l.id) FILTER (WHERE l.is_default) AS n_default
  FROM deals d LEFT JOIN deal_buyer_lines l ON l.deal_id = d.id
  GROUP BY d.id
) t
GROUP BY n_default ORDER BY n_default;

-- @block q2.count.scalar_vs_line_supplier | Scalar deal fields vs single default supplier line
WITH single AS (
  SELECT d.id, d.supplier_price, d.supplier_quotation, d.supplier_discount,
         l.price AS l_price, l.quotation AS l_quotation, l.discount AS l_discount
  FROM deals d
  JOIN deal_supplier_lines l ON l.deal_id = d.id AND l.is_default
  WHERE (SELECT COUNT(*) FROM deal_supplier_lines x WHERE x.deal_id = d.id AND x.is_default) = 1
)
SELECT COUNT(*)                                                                AS deals_single_default,
       COUNT(*) FILTER (WHERE supplier_price      IS DISTINCT FROM l_price)    AS price_diverges,
       COUNT(*) FILTER (WHERE supplier_quotation  IS DISTINCT FROM l_quotation) AS quotation_diverges,
       COUNT(*) FILTER (WHERE supplier_discount   IS DISTINCT FROM l_discount)  AS discount_diverges
FROM single;

-- @block q2.count.scalar_vs_line_buyer | Scalar deal fields vs single default buyer line
WITH single AS (
  SELECT d.id, d.buyer_price, d.buyer_quotation, d.buyer_discount,
         l.price AS l_price, l.quotation AS l_quotation, l.discount AS l_discount
  FROM deals d
  JOIN deal_buyer_lines l ON l.deal_id = d.id AND l.is_default
  WHERE (SELECT COUNT(*) FROM deal_buyer_lines x WHERE x.deal_id = d.id AND x.is_default) = 1
)
SELECT COUNT(*)                                                                AS deals_single_default,
       COUNT(*) FILTER (WHERE buyer_price     IS DISTINCT FROM l_price)        AS price_diverges,
       COUNT(*) FILTER (WHERE buyer_quotation IS DISTINCT FROM l_quotation)     AS quotation_diverges,
       COUNT(*) FILTER (WHERE buyer_discount  IS DISTINCT FROM l_discount)      AS discount_diverges
FROM single;

-- @block q2.sample.scalar_vs_line_supplier | Deals where supplier scalar price ≠ default line price
WITH single AS (
  SELECT d.id, d.deal_type, d.year, d.deal_number, d.supplier_id,
         d.supplier_price, l.price AS line_price,
         d.supplier_quotation, l.quotation AS line_quotation,
         d.supplier_discount, l.discount AS line_discount
  FROM deals d
  JOIN deal_supplier_lines l ON l.deal_id = d.id AND l.is_default
  WHERE (SELECT COUNT(*) FROM deal_supplier_lines x WHERE x.deal_id = d.id AND x.is_default) = 1
)
SELECT deal_type || '/' || year || '/' || deal_number AS deal_code,
       supplier_id AS "cp__supplier",
       supplier_price AS scalar_price, line_price,
       supplier_quotation AS scalar_quotation, line_quotation,
       supplier_discount AS scalar_discount, line_discount
FROM single
WHERE supplier_price IS DISTINCT FROM line_price
   OR supplier_quotation IS DISTINCT FROM line_quotation
   OR supplier_discount IS DISTINCT FROM line_discount
ORDER BY year DESC, deal_number DESC
LIMIT 20;

-- @block q2.count.price_condition_lines | price_condition distribution on pricing lines (incl. NULL)
SELECT 'supplier_line' AS source, price_condition::text AS price_condition, COUNT(*) AS n
FROM deal_supplier_lines GROUP BY 2
UNION ALL
SELECT 'buyer_line', price_condition::text, COUNT(*)
FROM deal_buyer_lines GROUP BY 2
ORDER BY 1, 2 NULLS FIRST;

-- @block q2.count.price_condition_scalar | Legacy scalar *_price_condition on deals
SELECT 'deals.supplier_price_condition' AS source, supplier_price_condition::text AS price_condition, COUNT(*) AS n
FROM deals GROUP BY 2
UNION ALL
SELECT 'deals.buyer_price_condition', buyer_price_condition::text, COUNT(*)
FROM deals GROUP BY 2
ORDER BY 1, 2 NULLS FIRST;

-- @block q2.count.calc_mode_price_source | calc_mode / price_source / price_stage distribution on lines
SELECT field, value, COUNT(*) AS n FROM (
  SELECT 'calc_mode'    AS field, calc_mode    AS value FROM deal_supplier_lines
  UNION ALL SELECT 'calc_mode',    calc_mode    FROM deal_buyer_lines
  UNION ALL SELECT 'price_source', price_source FROM deal_supplier_lines
  UNION ALL SELECT 'price_source', price_source FROM deal_buyer_lines
  UNION ALL SELECT 'price_stage',  price_stage  FROM deal_supplier_lines
  UNION ALL SELECT 'price_stage',  price_stage  FROM deal_buyer_lines
) t
GROUP BY field, value ORDER BY field, value NULLS FIRST;

-- @block q2.assert.dead_enums_absent | Dead price_condition enums (avg_to_date, manual_in_formula) MUST be absent
SELECT source, price_condition, n FROM (
  SELECT 'deal_supplier_lines' AS source, price_condition::text AS price_condition, COUNT(*) AS n
  FROM deal_supplier_lines WHERE price_condition::text IN ('avg_to_date','manual_in_formula') GROUP BY 1,2
  UNION ALL
  SELECT 'deal_buyer_lines', price_condition::text, COUNT(*)
  FROM deal_buyer_lines WHERE price_condition::text IN ('avg_to_date','manual_in_formula') GROUP BY 1,2
  UNION ALL
  SELECT 'deals.supplier_price_condition', supplier_price_condition::text, COUNT(*)
  FROM deals WHERE supplier_price_condition::text IN ('avg_to_date','manual_in_formula') GROUP BY 1,2
  UNION ALL
  SELECT 'deals.buyer_price_condition', buyer_price_condition::text, COUNT(*)
  FROM deals WHERE buyer_price_condition::text IN ('avg_to_date','manual_in_formula') GROUP BY 1,2
) t
ORDER BY 1, 2;


-- ============================================================================
-- Q3. Natural keys (shipment_registry wagon / waybill)
-- ============================================================================

-- @block q3.count.formatting_census | Wagon/waybill formatting census
SELECT 'wagon_number' AS field,
       COUNT(*) FILTER (WHERE wagon_number IS NOT NULL AND wagon_number <> '')      AS non_empty,
       COUNT(*) FILTER (WHERE wagon_number ~ '^0')                                  AS leading_zero,
       COUNT(*) FILTER (WHERE wagon_number ~ '\s')                                  AS has_space,
       COUNT(*) FILTER (WHERE wagon_number ~ '[^0-9A-Za-zА-Яа-яЁё]')                AS has_punct,
       COUNT(*) FILTER (WHERE wagon_number ~ '[А-Яа-яЁё]')                          AS has_cyrillic,
       COUNT(*) FILTER (WHERE wagon_number ~ '[A-Za-z]')                            AS has_latin,
       COUNT(*) FILTER (WHERE wagon_number ~ '[А-Яа-яЁё]' AND wagon_number ~ '[A-Za-z]') AS mixed_scripts,
       COUNT(*) FILTER (WHERE wagon_number IS NULL OR wagon_number = '')            AS null_or_empty
FROM shipment_registry
UNION ALL
SELECT 'waybill_number',
       COUNT(*) FILTER (WHERE waybill_number IS NOT NULL AND waybill_number <> ''),
       COUNT(*) FILTER (WHERE waybill_number ~ '^0'),
       COUNT(*) FILTER (WHERE waybill_number ~ '\s'),
       COUNT(*) FILTER (WHERE waybill_number ~ '[^0-9A-Za-zА-Яа-яЁё]'),
       COUNT(*) FILTER (WHERE waybill_number ~ '[А-Яа-яЁё]'),
       COUNT(*) FILTER (WHERE waybill_number ~ '[A-Za-z]'),
       COUNT(*) FILTER (WHERE waybill_number ~ '[А-Яа-яЁё]' AND waybill_number ~ '[A-Za-z]'),
       COUNT(*) FILTER (WHERE waybill_number IS NULL OR waybill_number = '')
FROM shipment_registry;

-- @block q3.count.null_key_components | NULL components of the natural key (deal, wagon, waybill, date)
SELECT COUNT(*)                                                                  AS total_rows,
       COUNT(*) FILTER (WHERE deal_id IS NULL)                                   AS null_deal_id,
       COUNT(*) FILTER (WHERE wagon_number IS NULL OR wagon_number = '')         AS null_wagon,
       COUNT(*) FILTER (WHERE waybill_number IS NULL OR waybill_number = '')     AS null_waybill,
       COUNT(*) FILTER (WHERE date IS NULL)                                      AS null_date
FROM shipment_registry;

-- @block q3.count.duplicate_natural_keys | Surviving duplicate (deal, wagon, waybill, date) groups after 00104–05
SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(cnt - 1), 0) AS extra_rows
FROM (
  SELECT deal_id, wagon_number, waybill_number, date, COUNT(*) AS cnt
  FROM shipment_registry
  GROUP BY deal_id, wagon_number, waybill_number, date
  HAVING COUNT(*) > 1
) g;

-- @block q3.sample.duplicate_groups | Example surviving duplicate natural-key groups
SELECT sr.deal_id,
       d.deal_type || '/' || d.year || '/' || d.deal_number AS deal_code,
       sr.wagon_number, sr.waybill_number, sr.date, COUNT(*) AS cnt
FROM shipment_registry sr
LEFT JOIN deals d ON d.id = sr.deal_id
GROUP BY sr.deal_id, deal_code, sr.wagon_number, sr.waybill_number, sr.date
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 20;

-- @block q3.sample.messy_keys | Example wagon/waybill values with spaces, punctuation or mixed scripts
SELECT id,
       wagon_number, waybill_number, date
FROM shipment_registry
WHERE wagon_number ~ '\s' OR waybill_number ~ '\s'
   OR wagon_number ~ '[^0-9A-Za-zА-Яа-яЁё]' OR waybill_number ~ '[^0-9A-Za-zА-Яа-яЁё]'
   OR (wagon_number ~ '[А-Яа-яЁё]' AND wagon_number ~ '[A-Za-z]')
ORDER BY id
LIMIT 20;


-- ============================================================================
-- Q4. Money
-- ============================================================================

-- @block q4.count.currency_census | Currency value census across money-bearing columns
SELECT source, currency, COUNT(*) AS n FROM (
  SELECT 'deals.supplier_currency' AS source, supplier_currency AS currency FROM deals
  UNION ALL SELECT 'deals.buyer_currency',     buyer_currency     FROM deals
  UNION ALL SELECT 'deals.logistics_currency', logistics_currency FROM deals
  UNION ALL SELECT 'deals.currency',           currency           FROM deals
  UNION ALL SELECT 'deal_payments.currency',   currency           FROM deal_payments
  UNION ALL SELECT 'deal_company_groups.currency', currency        FROM deal_company_groups
) t
GROUP BY source, currency ORDER BY source, currency NULLS FIRST;

-- @block q4.count.payment_currency_mismatch | Payments whose currency ≠ side currency (R-CUR-3 set)
SELECT COUNT(*) AS total_payments,
       COUNT(*) FILTER (WHERE p.currency IS NULL) AS null_currency,
       COUNT(*) FILTER (
         WHERE p.currency IS NOT NULL
           AND p.currency <> CASE WHEN p.side = 'supplier' THEN d.supplier_currency
                                  WHEN p.side = 'buyer'    THEN d.buyer_currency END
       ) AS currency_mismatch
FROM deal_payments p
JOIN deals d ON d.id = p.deal_id;

-- @block q4.sample.payment_currency_mismatch | Example mismatched-currency payments (become INCLUDED post-migration)
SELECT d.deal_type || '/' || d.year || '/' || d.deal_number AS deal_code,
       p.side,
       CASE WHEN p.side = 'supplier' THEN d.supplier_id ELSE d.buyer_id END AS "cp__party",
       p.currency AS payment_currency,
       CASE WHEN p.side = 'supplier' THEN d.supplier_currency ELSE d.buyer_currency END AS side_currency,
       p.amount, p.payment_type, p.payment_date
FROM deal_payments p
JOIN deals d ON d.id = p.deal_id
WHERE p.currency IS NOT NULL
  AND p.currency <> CASE WHEN p.side = 'supplier' THEN d.supplier_currency ELSE d.buyer_currency END
ORDER BY d.year DESC, d.deal_number DESC
LIMIT 20;

-- @block q4.count.negative_amounts_by_kind | Negative payment amounts by payment_type
SELECT payment_type,
       COUNT(*)                          AS total,
       COUNT(*) FILTER (WHERE amount < 0) AS negative,
       MIN(amount)                       AS min_amount
FROM deal_payments
GROUP BY payment_type
ORDER BY payment_type;

-- @block q4.note.stored_converted_columns | AS-BUILT check: does any table persist a CONVERTED money value?
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (column_name ILIKE '%converted%' OR column_name ILIKE '%_usd%'
       OR column_name ILIKE '%_kzt%'   OR column_name ILIKE '%_in_usd%'
       OR column_name ILIKE '%_native%')
ORDER BY table_name, column_name;


-- ============================================================================
-- Q5. Dates
-- ============================================================================

-- @block q5.count.date_outliers | Date values outside 2020–2030 per date column (the year-226 class)
SELECT col, outliers FROM (
  SELECT 'shipment_registry.date'         AS col, COUNT(*) FILTER (WHERE date IS NOT NULL AND (EXTRACT(year FROM date) < 2020 OR EXTRACT(year FROM date) > 2030)) AS outliers FROM shipment_registry
  UNION ALL SELECT 'shipment_registry.loading_date', COUNT(*) FILTER (WHERE loading_date IS NOT NULL AND (EXTRACT(year FROM loading_date) < 2020 OR EXTRACT(year FROM loading_date) > 2030)) FROM shipment_registry
  UNION ALL SELECT 'quotations.date',              COUNT(*) FILTER (WHERE date IS NOT NULL AND (EXTRACT(year FROM date) < 2020 OR EXTRACT(year FROM date) > 2030)) FROM quotations
  UNION ALL SELECT 'deal_payments.payment_date',   COUNT(*) FILTER (WHERE payment_date IS NOT NULL AND (EXTRACT(year FROM payment_date) < 2020 OR EXTRACT(year FROM payment_date) > 2030)) FROM deal_payments
  UNION ALL SELECT 'deal_shipment_prices.shipment_date', COUNT(*) FILTER (WHERE shipment_date IS NOT NULL AND (EXTRACT(year FROM shipment_date) < 2020 OR EXTRACT(year FROM shipment_date) > 2030)) FROM deal_shipment_prices
  UNION ALL SELECT 'fx_rates.date',                COUNT(*) FILTER (WHERE date IS NOT NULL AND (EXTRACT(year FROM date) < 2020 OR EXTRACT(year FROM date) > 2030)) FROM fx_rates
  UNION ALL SELECT 'deal_supplier_lines.selected_date', COUNT(*) FILTER (WHERE selected_date IS NOT NULL AND (EXTRACT(year FROM selected_date) < 2020 OR EXTRACT(year FROM selected_date) > 2030)) FROM deal_supplier_lines
  UNION ALL SELECT 'deal_buyer_lines.selected_date',    COUNT(*) FILTER (WHERE selected_date IS NOT NULL AND (EXTRACT(year FROM selected_date) < 2020 OR EXTRACT(year FROM selected_date) > 2030)) FROM deal_buyer_lines
) t
ORDER BY col;

-- @block q5.sample.date_outliers | Example out-of-range date rows
SELECT * FROM (
  SELECT 'shipment_registry' AS tbl, id::text AS row_id, date::text AS bad_date FROM shipment_registry WHERE date IS NOT NULL AND (EXTRACT(year FROM date) < 2020 OR EXTRACT(year FROM date) > 2030)
  UNION ALL SELECT 'shipment_registry.loading_date', id::text, loading_date::text FROM shipment_registry WHERE loading_date IS NOT NULL AND (EXTRACT(year FROM loading_date) < 2020 OR EXTRACT(year FROM loading_date) > 2030)
  UNION ALL SELECT 'deal_shipment_prices', id::text, shipment_date::text FROM deal_shipment_prices WHERE shipment_date IS NOT NULL AND (EXTRACT(year FROM shipment_date) < 2020 OR EXTRACT(year FROM shipment_date) > 2030)
  UNION ALL SELECT 'quotations', id::text, date::text FROM quotations WHERE date IS NOT NULL AND (EXTRACT(year FROM date) < 2020 OR EXTRACT(year FROM date) > 2030)
) t
LIMIT 20;

-- @block q5.count.null_event_dates_on_money | Money rows missing their event date
SELECT 'deal_shipment_prices (amount, null shipment_date)' AS metric,
       COUNT(*) AS n FROM deal_shipment_prices WHERE amount IS NOT NULL AND shipment_date IS NULL
UNION ALL
SELECT 'shipment_registry (shipped_tonnage_amount, null date)',
       COUNT(*) FROM shipment_registry WHERE shipped_tonnage_amount IS NOT NULL AND date IS NULL;


-- ============================================================================
-- Q6. Payment TEXT dates (deals.supplier_payment_date / buyer_payment_date)
-- ============================================================================

-- @block q6.count.text_payment_date_census | Deals with a TEXT payment date set (the 8-of-792 census)
SELECT COUNT(*)                                                                                AS total_deals,
       COUNT(*) FILTER (WHERE supplier_payment_date IS NOT NULL AND supplier_payment_date <> '') AS supplier_text_set,
       COUNT(*) FILTER (WHERE buyer_payment_date    IS NOT NULL AND buyer_payment_date    <> '') AS buyer_text_set
FROM deals;

-- @block q6.count.text_date_without_payment | TEXT payment date set but no matching-side payment recorded
SELECT COUNT(*) FILTER (
         WHERE d.supplier_payment_date IS NOT NULL AND d.supplier_payment_date <> ''
           AND NOT EXISTS (SELECT 1 FROM deal_payments p WHERE p.deal_id = d.id AND p.side = 'supplier')
       ) AS supplier_text_no_payment,
       COUNT(*) FILTER (
         WHERE d.buyer_payment_date IS NOT NULL AND d.buyer_payment_date <> ''
           AND NOT EXISTS (SELECT 1 FROM deal_payments p WHERE p.deal_id = d.id AND p.side = 'buyer')
       ) AS buyer_text_no_payment
FROM deals d;

-- @block q6.sample.text_payment_dates | Deals with TEXT payment dates vs recorded payments (raw text kept verbatim)
SELECT d.deal_type || '/' || d.year || '/' || d.deal_number AS deal_code, t.side, t.text_date,
       (SELECT COUNT(*) FROM deal_payments p WHERE p.deal_id = d.id AND p.side = t.side)               AS side_payments,
       (SELECT MIN(p.payment_date)::text FROM deal_payments p WHERE p.deal_id = d.id AND p.side = t.side) AS first_payment_date
FROM deals d
CROSS JOIN LATERAL (
  VALUES ('supplier', d.supplier_payment_date), ('buyer', d.buyer_payment_date)
) AS t(side, text_date)
WHERE t.text_date IS NOT NULL AND t.text_date <> ''
ORDER BY d.year DESC, d.deal_number DESC
LIMIT 20;


-- ============================================================================
-- Q7. Audit
-- ============================================================================

-- @block q7.count.null_actor | Audit events with null actor, by op
SELECT op,
       COUNT(*)                            AS total,
       COUNT(*) FILTER (WHERE user_id IS NULL) AS null_actor
FROM audit_log
GROUP BY op ORDER BY op;

-- @block q7.count.doubled_totals_window | 00097/00098 doubled-totals burst (service-role INSERTs, 2026-06-24 16:23–16:24Z)
SELECT
  (SELECT COUNT(*) FROM audit_log
     WHERE table_name = 'deal_shipment_prices' AND op = 'INSERT' AND user_id IS NULL
       AND changed_at >= '2026-06-24 16:23:00+00'::timestamptz
       AND changed_at <  '2026-06-24 16:24:00+00'::timestamptz)                AS inserts_in_window,
  (SELECT COUNT(*) FROM deal_shipment_prices dsp
     WHERE dsp.id IN (SELECT row_id FROM audit_log
        WHERE table_name = 'deal_shipment_prices' AND op = 'INSERT' AND user_id IS NULL
          AND changed_at >= '2026-06-24 16:23:00+00'::timestamptz
          AND changed_at <  '2026-06-24 16:24:00+00'::timestamptz))            AS still_present_should_be_0;

-- @block q7.sample.null_actor_recent | Recent null-actor audit events
SELECT id, table_name, op, changed_at, changed_fields
FROM audit_log
WHERE user_id IS NULL
ORDER BY changed_at DESC
LIMIT 20;


-- ============================================================================
-- Q8. Flags
-- ============================================================================

-- @block q8.count.additional_expenses_in_price | additional_expenses_in_price distribution (feeds open client question)
SELECT additional_expenses_in_price AS value, COUNT(*) AS n
FROM deals GROUP BY 1 ORDER BY 1 NULLS FIRST;

-- @block q8.count.railway_in_price | railway_in_price distribution
SELECT railway_in_price AS value, COUNT(*) AS n
FROM deals GROUP BY 1 ORDER BY 1 NULLS FIRST;

-- @block q8.count.is_hidden | is_hidden distribution (carried verbatim at migration)
SELECT is_hidden AS value, COUNT(*) AS n
FROM deals GROUP BY 1 ORDER BY 1;

-- @block q8.count.override_flags | Override-flag census (deals + shipment_registry)
SELECT flag, true_count, total FROM (
  SELECT 'deals.actual_tariff_override'         AS flag, COUNT(*) FILTER (WHERE actual_tariff_override)         AS true_count, COUNT(*) AS total FROM deals
  UNION ALL SELECT 'deals.shipper_actual_tariff_override', COUNT(*) FILTER (WHERE shipper_actual_tariff_override), COUNT(*) FROM deals
  UNION ALL SELECT 'shipment_registry.shipped_tonnage_amount_override', COUNT(*) FILTER (WHERE shipped_tonnage_amount_override), COUNT(*) FROM shipment_registry
  UNION ALL SELECT 'shipment_registry.additional_expenses_override', COUNT(*) FILTER (WHERE additional_expenses_override), COUNT(*) FROM shipment_registry
  UNION ALL SELECT 'shipment_registry.railway_tariff_override', COUNT(*) FILTER (WHERE railway_tariff_override), COUNT(*) FROM shipment_registry
  UNION ALL SELECT 'shipment_registry.round_volume', COUNT(*) FILTER (WHERE round_volume), COUNT(*) FROM shipment_registry
) t
ORDER BY flag;


-- ============================================================================
-- Q9. Users (auth.users + profiles) — requires the Supabase auth schema
-- ============================================================================

-- @block q9.count.password_hash_algo | Password hash algorithm census (bcrypt portability)
SELECT CASE
         WHEN encrypted_password LIKE '$2a$%' THEN 'bcrypt ($2a)'
         WHEN encrypted_password LIKE '$2b$%' THEN 'bcrypt ($2b)'
         WHEN encrypted_password LIKE '$2y$%' THEN 'bcrypt ($2y)'
         WHEN encrypted_password IS NULL OR encrypted_password = '' THEN 'none / external'
         ELSE 'other'
       END AS algo,
       COUNT(*) AS n
FROM auth.users
GROUP BY 1 ORDER BY 1;

-- @block q9.count.account_activity | Account activity (auth.users)
SELECT COUNT(*)                                        AS total,
       COUNT(*) FILTER (WHERE deleted_at IS NULL)      AS not_deleted,
       COUNT(*) FILTER (WHERE last_sign_in_at IS NOT NULL) AS ever_signed_in,
       COUNT(*) FILTER (WHERE banned_until IS NOT NULL AND banned_until > now()) AS currently_banned
FROM auth.users;

-- @block q9.count.role_distribution | Role distribution vs v1 capability seeds (profiles)
SELECT role::text AS role,
       COUNT(*)                          AS total,
       COUNT(*) FILTER (WHERE is_active) AS active
FROM profiles
GROUP BY role ORDER BY role;


-- ============================================================================
-- Q10. Volumes
-- ============================================================================

-- @block q10.count.row_counts | Row count per CRM table (drift vs AS-BUILT baseline — diff externally)
SELECT tbl, n FROM (
  SELECT 'deals' AS tbl, COUNT(*) AS n FROM deals
  UNION ALL SELECT 'deal_supplier_lines', COUNT(*) FROM deal_supplier_lines
  UNION ALL SELECT 'deal_buyer_lines', COUNT(*) FROM deal_buyer_lines
  UNION ALL SELECT 'deal_company_groups', COUNT(*) FROM deal_company_groups
  UNION ALL SELECT 'deal_shipment_prices', COUNT(*) FROM deal_shipment_prices
  UNION ALL SELECT 'deal_payments', COUNT(*) FROM deal_payments
  UNION ALL SELECT 'deal_activity', COUNT(*) FROM deal_activity
  UNION ALL SELECT 'deal_attachments', COUNT(*) FROM deal_attachments
  UNION ALL SELECT 'deal_sequences', COUNT(*) FROM deal_sequences
  UNION ALL SELECT 'shipment_registry', COUNT(*) FROM shipment_registry
  UNION ALL SELECT 'dt_kt_logistics', COUNT(*) FROM dt_kt_logistics
  UNION ALL SELECT 'dt_kt_payments', COUNT(*) FROM dt_kt_payments
  UNION ALL SELECT 'quotations', COUNT(*) FROM quotations
  UNION ALL SELECT 'quotation_product_types', COUNT(*) FROM quotation_product_types
  UNION ALL SELECT 'quotation_monthly_averages', COUNT(*) FROM quotation_monthly_averages
  UNION ALL SELECT 'fx_rates', COUNT(*) FROM fx_rates
  UNION ALL SELECT 'counterparties', COUNT(*) FROM counterparties
  UNION ALL SELECT 'company_groups', COUNT(*) FROM company_groups
  UNION ALL SELECT 'factories', COUNT(*) FROM factories
  UNION ALL SELECT 'forwarders', COUNT(*) FROM forwarders
  UNION ALL SELECT 'stations', COUNT(*) FROM stations
  UNION ALL SELECT 'fuel_types', COUNT(*) FROM fuel_types
  UNION ALL SELECT 'regions', COUNT(*) FROM regions
  UNION ALL SELECT 'consignees', COUNT(*) FROM consignees
  UNION ALL SELECT 'tariffs', COUNT(*) FROM tariffs
  UNION ALL SELECT 'surcharges', COUNT(*) FROM surcharges
  UNION ALL SELECT 'applications', COUNT(*) FROM applications
  UNION ALL SELECT 'application_deals', COUNT(*) FROM application_deals
  UNION ALL SELECT 'snt_documents', COUNT(*) FROM snt_documents
  UNION ALL SELECT 'esf_documents', COUNT(*) FROM esf_documents
  UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log
  UNION ALL SELECT 'profiles', COUNT(*) FROM profiles
  UNION ALL SELECT 'user_prefs', COUNT(*) FROM user_prefs
  UNION ALL SELECT 'archive_years', COUNT(*) FROM archive_years
) t
ORDER BY tbl;

-- @block q10.count.attachments_db | Attachment rows + total MB per deal_attachments.file_size
SELECT COUNT(*) AS attachment_rows,
       ROUND(COALESCE(SUM(file_size), 0) / 1048576.0, 2) AS total_mb
FROM deal_attachments;

-- @block q10.count.storage_objects | Objects + total MB in Supabase Storage (storage.objects)
SELECT COUNT(*) AS objects,
       ROUND(COALESCE(SUM((metadata->>'size')::bigint), 0) / 1048576.0, 2) AS total_mb
FROM storage.objects;

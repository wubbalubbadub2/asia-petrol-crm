-- READ-ONLY. Ничего не меняет. Год правится в первой строке.
WITH params AS (SELECT 2026::INT AS y),
flip133 AS (   -- когда 00133 разово перевернула знаки
  SELECT MIN(changed_at) AS cut FROM audit_log
   WHERE table_name = 'dt_kt_logistics' AND op = 'UPDATE' AND user_id IS NULL
     AND changed_fields @> ARRAY['opening_balance']
     AND (old_row->>'opening_balance') IS NOT NULL
     AND (new_row->>'opening_balance')::NUMERIC = -(old_row->>'opening_balance')::NUMERIC
     AND (old_row->>'opening_balance')::NUMERIC <> 0),
last_edit AS ( -- последняя правка «Сальдо 1 янв.» по каждой строке
  SELECT DISTINCT ON (row_id) row_id, changed_at, user_id,
         (old_row->>'opening_balance')::NUMERIC AS было,
         (new_row->>'opening_balance')::NUMERIC AS стало
    FROM audit_log
   WHERE table_name = 'dt_kt_logistics' AND changed_fields @> ARRAY['opening_balance']
   ORDER BY row_id, changed_at DESC),
ship AS (
  SELECT forwarder_id, company_group_id, SUM(COALESCE(shipped_tonnage_amount,0)) AS amt
    FROM shipment_registry, params
   WHERE date >= make_date(y,1,1) AND date <= make_date(y,12,31)
   GROUP BY 1,2),
pay AS (SELECT dt_kt_id, SUM(amount) AS amt FROM dt_kt_payments GROUP BY 1)
SELECT
  f.name                                   AS "экспедитор",
  g.name                                   AS "плательщик ЖД",
  l.opening_balance                        AS "сальдо 1 янв (сейчас)",
  CASE WHEN e.changed_at IS NULL THEN 'создана без правок'
       WHEN e.changed_at <= x.cut + INTERVAL '1 minute' THEN 'конвенция 00133 — не трогать'
       WHEN e.user_id IS NULL THEN 'правка без пользователя — разобрать'
       ELSE 'ПРАВИЛИ РУКАМИ после 00133' END               AS "происхождение знака",
  e.changed_at                             AS "когда правили",
  e.было, e.стало,
  ROUND(COALESCE(l.opening_balance,0) + COALESCE(l.refund,0) + COALESCE(s.amt,0)
        + COALESCE(l.fines,0) + COALESCE(l.surcharge_preliminary,0) + COALESCE(l.ogem,0)
        - COALESCE(p.amt, COALESCE(l.payment,0)), 2)        AS "сальдо как есть",
  ROUND(-COALESCE(l.opening_balance,0) + COALESCE(l.refund,0) + COALESCE(s.amt,0)
        + COALESCE(l.fines,0) + COALESCE(l.surcharge_preliminary,0) + COALESCE(l.ogem,0)
        - COALESCE(p.amt, COALESCE(l.payment,0)), 2)        AS "сальдо если развернуть 1 янв"
FROM dt_kt_logistics l
JOIN forwarders f     ON f.id = l.forwarder_id
JOIN company_groups g ON g.id = l.company_group_id
LEFT JOIN last_edit e ON e.row_id = l.id
LEFT JOIN ship s      ON s.forwarder_id = l.forwarder_id AND s.company_group_id IS NOT DISTINCT FROM l.company_group_id
LEFT JOIN pay  p      ON p.dt_kt_id = l.id
CROSS JOIN params
CROSS JOIN flip133 x
WHERE l.year = params.y
ORDER BY 4 DESC, 1, 2;

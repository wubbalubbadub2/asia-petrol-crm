-- ТОЛЬКО ЧТЕНИЕ. Варианты, где «Цена» расходится с ценой отгрузок (к 00171).
-- Ложные срабатывания: «Средний месяц» с отгрузками в разных месяцах.

WITH lines AS (
  SELECT 'supplier' AS side, id, deal_id, is_default, price, price_condition::text AS cond, price_stage FROM deal_supplier_lines
  UNION ALL
  SELECT 'buyer', id, deal_id, is_default, price, price_condition::text, price_stage FROM deal_buyer_lines
)
SELECT d.deal_code, l.side, l.cond, l.price_stage, l.price AS line_price,
       COUNT(*)                                    AS rows_off,
       MIN(p.calculated_price)                     AS min_row_price,
       MAX(p.calculated_price)                     AS max_row_price,
       SUM(p.volume * (l.price - p.calculated_price)) AS amount_delta
FROM lines l
JOIN deals d ON d.id = l.deal_id
JOIN deal_shipment_prices p ON p.deal_id = l.deal_id AND p.side = l.side
LEFT JOIN shipment_registry r ON r.id = p.shipment_registry_id
WHERE l.price IS NOT NULL
  AND l.price_stage = 'final'
  AND l.cond IN ('average_month', 'manual_formula')
  AND COALESCE(p.volume, 0) <> 0
  AND p.calculated_price IS DISTINCT FROM l.price
  AND (CASE WHEN l.side = 'supplier' THEN r.supplier_line_id ELSE r.buyer_line_id END = l.id
       OR (l.is_default AND CASE WHEN l.side = 'supplier' THEN r.supplier_line_id ELSE r.buyer_line_id END IS NULL))
GROUP BY d.deal_code, l.side, l.cond, l.price_stage, l.price
ORDER BY d.deal_code, l.side;

-- ТОЛЬКО ЧТЕНИЕ. Требует 00173 (функция line_formula_quotation).
-- Отгрузки финального «Среднего месяца», чья цена не совпадает с ценой по
-- котировке варианта («Котировка значение», иначе средняя за «Месяц
-- расчёта» по подкотировке). Ручная «Цена» (price_is_manual, 00171)
-- исключена. 00173 такие строки сама не пересчитывает — пересчёт по
-- согласованному списку: SELECT recompute_line_shipment_prices(line_id, side);
WITH x AS (
  SELECT d.deal_code, p.side, r.wagon_number, r.date, p.volume,
         p.quotation_avg, p.calculated_price,
         CASE WHEN p.side = 'supplier' THEN r.supplier_line_id ELSE r.buyer_line_id END AS line_id,
         COALESCE(sl.discount, bl.discount, 0)      AS disc,
         COALESCE(sl.barrel_ratio, bl.barrel_ratio) AS ratio
  FROM deal_shipment_prices p
  JOIN shipment_registry r ON r.id = p.shipment_registry_id
  JOIN deals d ON d.id = p.deal_id
  LEFT JOIN deal_supplier_lines sl ON p.side = 'supplier' AND sl.id = r.supplier_line_id
  LEFT JOIN deal_buyer_lines    bl ON p.side = 'buyer'    AND bl.id = r.buyer_line_id
  WHERE COALESCE(sl.price_condition, bl.price_condition)::text = 'average_month'
    AND COALESCE(sl.price_stage, bl.price_stage) = 'final'
    AND NOT COALESCE(sl.price_is_manual, bl.price_is_manual, FALSE)
), y AS (
  SELECT x.*, line_formula_quotation(side, line_id) AS q_var FROM x
)
SELECT deal_code, side, line_id, count(*) AS otgruzok,
       min(quotation_avg) AS kotirovka_seychas_min, max(quotation_avg) AS kotirovka_seychas_max,
       max(q_var) AS kotirovka_varianta,
       min(calculated_price) AS cena_seychas_min, max(calculated_price) AS cena_seychas_max,
       max(apply_price_formula(q_var, disc, NULL, ratio)) AS cena_po_variantu,
       sum(volume * (apply_price_formula(q_var, disc, NULL, ratio) - calculated_price)) AS raznica_summy
FROM y
WHERE q_var IS NOT NULL
  AND calculated_price IS DISTINCT FROM apply_price_formula(q_var, disc, NULL, ratio)
GROUP BY deal_code, side, line_id
ORDER BY abs(sum(volume * (apply_price_formula(q_var, disc, NULL, ratio) - calculated_price))) DESC;

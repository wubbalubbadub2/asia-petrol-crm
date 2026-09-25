-- ТОЛЬКО ЧТЕНИЕ (к 00172). Отгрузки окончательного «Среднего месяца»,
-- чья котировка не совпадает со средней за месяц их даты (без даты —
-- «Месяц отгрузки»). Ручная «Цена» (price_is_manual, 00171) исключена.
-- Такие строки 00172 не пересчитывает сама — только при следующей
-- правке даты/месяца или фиксации.
WITH x AS (
  SELECT d.deal_code, p.side, r.wagon_number, r.date, r.shipment_month,
         p.volume, p.quotation_avg, p.calculated_price, p.amount,
         COALESCE(sl.quotation_type_id, bl.quotation_type_id) AS qt,
         COALESCE(sl.discount, bl.discount, 0)                 AS disc,
         COALESCE(sl.barrel_ratio, bl.barrel_ratio)            AS ratio,
         ym.y, ym.m
  FROM deal_shipment_prices p
  JOIN shipment_registry r ON r.id = p.shipment_registry_id
  JOIN deals d ON d.id = p.deal_id
  LEFT JOIN deal_supplier_lines sl ON p.side = 'supplier' AND sl.id = r.supplier_line_id
  LEFT JOIN deal_buyer_lines    bl ON p.side = 'buyer'    AND bl.id = r.buyer_line_id
  CROSS JOIN LATERAL resolve_shipment_year_month(r.date, r.shipment_month, r.deal_id) ym
  WHERE COALESCE(sl.price_condition, bl.price_condition)::text = 'average_month'
    AND COALESCE(sl.price_stage, bl.price_stage) = 'final'
    AND NOT COALESCE(sl.price_is_manual, bl.price_is_manual, FALSE)
)
SELECT deal_code, side, wagon_number, date, shipment_month, volume,
       quotation_avg AS kotirovka_seychas,
       compute_monthly_quotation_avg(qt, y, m) AS kotirovka_mesyaca,
       calculated_price AS cena_seychas,
       apply_price_formula(compute_monthly_quotation_avg(qt, y, m), disc, NULL, ratio) AS cena_po_formule,
       volume * (apply_price_formula(compute_monthly_quotation_avg(qt, y, m), disc, NULL, ratio) - calculated_price) AS raznica_summy
FROM x
WHERE compute_monthly_quotation_avg(qt, y, m) IS NOT NULL
  AND calculated_price IS DISTINCT FROM apply_price_formula(compute_monthly_quotation_avg(qt, y, m), disc, NULL, ratio)
ORDER BY deal_code, side, date;

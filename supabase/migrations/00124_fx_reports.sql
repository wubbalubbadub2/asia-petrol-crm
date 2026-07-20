-- 00124_fx_reports.sql
-- RPC под вкладку «Отчёты». Каждая сумма конвертится по своей дате
-- события; нет даты → среднемесячный курс месяца сделки/отгрузки.

CREATE OR REPLACE FUNCTION fx_report_flows(p_from DATE, p_to DATE)
RETURNS TABLE(metric TEXT, deal_type TEXT, year INT, month INT, usd NUMERIC, kzt NUMERIC)
LANGUAGE sql STABLE AS $$
WITH events AS (
  -- Приход: цена поставщика × входящий объём, дата входящего СНТ
  SELECT 'supply_in'::text AS metric, d.deal_type::text AS deal_type,
         (d.supplier_price * r.loading_volume) AS amount,
         d.supplier_currency AS cur, r.loading_date AS ev_date,
         COALESCE(EXTRACT(YEAR FROM r.loading_date)::int, d.year) AS fb_year,
         COALESCE(EXTRACT(MONTH FROM r.loading_date)::int, month_num(d.month)) AS fb_month
    FROM shipment_registry r JOIN deals d ON d.id = r.deal_id
   WHERE r.loading_volume IS NOT NULL AND d.supplier_price IS NOT NULL
  UNION ALL
  -- Исход: цена покупателя × исходящий объём, дата исходящего СНТ
  SELECT 'ship_out', d.deal_type::text,
         (d.buyer_price * r.shipment_volume), d.buyer_currency, r.date,
         COALESCE(EXTRACT(YEAR FROM r.date)::int, d.year),
         COALESCE(EXTRACT(MONTH FROM r.date)::int, month_num(d.month))
    FROM shipment_registry r JOIN deals d ON d.id = r.deal_id
   WHERE r.shipment_volume IS NOT NULL AND d.buyer_price IS NOT NULL
  UNION ALL
  -- Оплаты поставщикам (знак по типу платежа)
  SELECT 'pay_supplier', d.deal_type::text,
         (CASE WHEN p.payment_type IN ('refund','offset') THEN -1 ELSE 1 END) * p.amount,
         COALESCE(p.currency, d.supplier_currency), p.payment_date,
         COALESCE(EXTRACT(YEAR FROM p.payment_date)::int, d.year),
         COALESCE(EXTRACT(MONTH FROM p.payment_date)::int, month_num(d.month))
    FROM deal_payments p JOIN deals d ON d.id = p.deal_id
   WHERE p.side = 'supplier'
  UNION ALL
  -- Оплаты покупателям (поступления от покупателей)
  SELECT 'pay_buyer', d.deal_type::text,
         (CASE WHEN p.payment_type IN ('refund','offset') THEN -1 ELSE 1 END) * p.amount,
         COALESCE(p.currency, d.buyer_currency), p.payment_date,
         COALESCE(EXTRACT(YEAR FROM p.payment_date)::int, d.year),
         COALESCE(EXTRACT(MONTH FROM p.payment_date)::int, month_num(d.month))
    FROM deal_payments p JOIN deals d ON d.id = p.deal_id
   WHERE p.side = 'buyer'
), converted AS (
  SELECT metric, deal_type, fb_year, fb_month,
         CASE WHEN ev_date IS NOT NULL
              THEN fx_convert(amount, cur, 'USD', ev_date)
              ELSE fx_convert_month(amount, cur, 'USD', fb_year, fb_month) END AS u,
         CASE WHEN ev_date IS NOT NULL
              THEN fx_convert(amount, cur, 'KZT', ev_date)
              ELSE fx_convert_month(amount, cur, 'KZT', fb_year, fb_month) END AS k
    FROM events
   WHERE (ev_date IS NOT NULL AND ev_date BETWEEN p_from AND p_to)
      OR (ev_date IS NULL AND fb_year IS NOT NULL AND fb_month IS NOT NULL
          AND make_date(fb_year, fb_month, 1) BETWEEN date_trunc('month', p_from)::date AND p_to)
)
SELECT metric, deal_type, fb_year AS year, fb_month AS month,
       SUM(CASE WHEN u IS NOT NULL AND k IS NOT NULL THEN u END) AS usd,
       SUM(CASE WHEN u IS NOT NULL AND k IS NOT NULL THEN k END) AS kzt
  FROM converted
 GROUP BY metric, deal_type, fb_year, fb_month
 ORDER BY fb_year, fb_month, metric, deal_type;
$$;

CREATE OR REPLACE FUNCTION fx_report_price(p_from DATE, p_to DATE)
RETURNS TABLE(
  deal_code TEXT, deal_type TEXT, snt_date DATE, loading_date DATE,
  supplier_price_usd NUMERIC, supplier_price_kzt NUMERIC,
  buyer_price_usd NUMERIC, buyer_price_kzt NUMERIC
) LANGUAGE sql STABLE AS $$
  SELECT
    d.deal_code, d.deal_type::text, r.date AS snt_date, r.loading_date,
    CASE WHEN COALESCE(r.loading_volume,0) > 0 THEN
      (CASE WHEN r.loading_date IS NOT NULL
            THEN fx_convert(d.supplier_price * r.loading_volume, d.supplier_currency, 'USD', r.loading_date)
            ELSE fx_convert_month(d.supplier_price * r.loading_volume, d.supplier_currency, 'USD', d.year, month_num(d.month)) END
      ) / r.loading_volume END,
    CASE WHEN COALESCE(r.loading_volume,0) > 0 THEN
      (CASE WHEN r.loading_date IS NOT NULL
            THEN fx_convert(d.supplier_price * r.loading_volume, d.supplier_currency, 'KZT', r.loading_date)
            ELSE fx_convert_month(d.supplier_price * r.loading_volume, d.supplier_currency, 'KZT', d.year, month_num(d.month)) END
      ) / r.loading_volume END,
    CASE WHEN COALESCE(r.shipment_volume,0) > 0 THEN
      (CASE WHEN r.date IS NOT NULL
            THEN fx_convert(d.buyer_price * r.shipment_volume, d.buyer_currency, 'USD', r.date)
            ELSE fx_convert_month(d.buyer_price * r.shipment_volume, d.buyer_currency, 'USD', d.year, month_num(d.month)) END
      ) / r.shipment_volume END,
    CASE WHEN COALESCE(r.shipment_volume,0) > 0 THEN
      (CASE WHEN r.date IS NOT NULL
            THEN fx_convert(d.buyer_price * r.shipment_volume, d.buyer_currency, 'KZT', r.date)
            ELSE fx_convert_month(d.buyer_price * r.shipment_volume, d.buyer_currency, 'KZT', d.year, month_num(d.month)) END
      ) / r.shipment_volume END
  FROM shipment_registry r JOIN deals d ON d.id = r.deal_id
  -- Построчный отчёт: строка без обеих дат СНТ не имеет места в периоде и
  -- исключается (в отличие от fx_report_flows, где агрегат кладёт бездатные
  -- события на fallback-месяц).
  WHERE COALESCE(r.date, r.loading_date) BETWEEN p_from AND p_to
  ORDER BY COALESCE(r.date, r.loading_date), d.deal_code;
$$;

GRANT EXECUTE ON FUNCTION fx_report_flows(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION fx_report_price(DATE, DATE) TO authenticated;

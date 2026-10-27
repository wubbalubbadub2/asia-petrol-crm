-- ТОЛЬКО ЧТЕНИЕ. Просмотр миграции 00182 (логистика — только исходящее СНТ)
-- до её применения: один SELECT, ничего не пишет.
--
-- Формула ожидаемых «округл» и Суммы 1 — дословно из CTE «было» в
-- supabase/migrations/00182_logistics_amount_outgoing_only.sql. Правишь
-- одну — правь обе.
--
-- Возвращает одну строку JSON:
--   summary — сколько строк/сделок меняется, по классам;
--   totals  — Сумма 1 по валютам до → после (весь реестр);
--   deals   — сделки, у которых меняются Сумма (логисты), тариф факт или
--             баланс поставщика (до → после);
--   rows    — каждая строка, у которой меняется «округл» или Сумма 1;
--   risks   — строки, на которых миграция упадёт целиком (пустой UPDATE
--             заполнил бы Сумму 3 или Сумму 2, или подобрал бы тариф строке
--             с суммой без тарифа), и KZ-тариф факт, не влезающий в
--             numeric(10,4). Должны быть пустыми.
-- Результат сохранить в файл до применения: rows — это и список «было →
-- стало», и id для отката.
--
-- Запуск: supabase db query --project-ref <ref> -f scripts/logistics-outgoing-only-preview.sql

WITH calc AS (
  SELECT sr.id, sr.deal_id, sr.wagon_number, sr.loading_volume, sr.shipment_volume,
         sr.shipped_tonnage_amount AS s1,
         sr.manager_tariff, sr.additional_expenses, sr.supplier_railway_tariff,
         sr.supplier_railway_amount, sr.rounded_volume_override, sr.registry_type,
         COALESCE(sr.currency, d.logistics_currency, '—') AS cur,
         COALESCE(d.deal_code, 'без сделки') AS deal_code,
         (sr.shipped_tonnage_amount_override AND sr.shipped_tonnage_amount IS NOT NULL) AS manual,
         CASE
           WHEN sr.rounded_volume_override IS NOT NULL THEN sr.rounded_volume_override
           WHEN COALESCE(sr.loading_volume, sr.shipment_volume) IS NULL THEN NULL
           WHEN sr.round_volume THEN CEIL(COALESCE(sr.loading_volume, sr.shipment_volume))
           ELSE COALESCE(sr.loading_volume, sr.shipment_volume)
         END AS round_old,
         CASE
           WHEN sr.rounded_volume_override IS NOT NULL THEN sr.rounded_volume_override
           WHEN sr.shipment_volume IS NULL THEN NULL
           WHEN sr.round_volume THEN CEIL(sr.shipment_volume)
           ELSE sr.shipment_volume
         END AS round_new,
         sr.railway_tariff
    FROM shipment_registry sr
    LEFT JOIN deals d ON d.id = sr.deal_id
),
exp AS (
  SELECT c.*,
         CASE
           WHEN c.manual THEN c.s1
           WHEN c.railway_tariff IS NULL THEN NULL
           WHEN c.loading_volume IS NULL AND c.shipment_volume IS NULL THEN NULL
           WHEN c.round_new IS NULL THEN NULL
           ELSE ROUND(c.round_new * c.railway_tariff, 4)
         END AS s1_new,
         CASE
           WHEN c.shipment_volume IS NULL AND c.loading_volume IS NOT NULL THEN 'только входящее'
           WHEN c.shipment_volume IS NOT NULL AND c.loading_volume IS NOT NULL THEN 'оба объёма'
           ELSE 'прочее'
         END AS cls
    FROM calc c
),
listed AS (
  SELECT * FROM exp
   WHERE round_old IS DISTINCT FROM round_new OR s1 IS DISTINCT FROM s1_new
),
upd AS (SELECT * FROM listed WHERE s1 IS DISTINCT FROM s1_new),
-- Новая Сумма (логисты) сделки = Σ новых Сумм 1 всех её строк — так её
-- пересчитает refresh_deal_shipment_totals (00116).
deal_new AS (
  SELECT e.deal_id, COALESCE(SUM(e.s1_new), 0) AS inv_new
    FROM exp e
   WHERE e.deal_id IN (SELECT deal_id FROM upd)
   GROUP BY e.deal_id
),
deal_calc AS (
  SELECT d.id, d.deal_code, d.deal_type, COALESCE(d.logistics_currency, '—') AS cur,
         d.invoice_amount AS inv_old, COALESCE(n.inv_new, d.invoice_amount) AS inv_new,
         d.actual_tariff AS tf_old,
         CASE
           WHEN COALESCE(d.actual_tariff_override, FALSE) THEN d.actual_tariff
           WHEN COALESCE(n.inv_new, d.invoice_amount) IS NOT NULL AND COALESCE(d.actual_shipped_volume, 0) > 0
             THEN ROUND(COALESCE(n.inv_new, d.invoice_amount) / d.actual_shipped_volume, 4)
         END AS tf_new,
         d.supplier_balance AS bal_old,
         d.supplier_balance
           + CASE WHEN d.logistics_amount_in_price IS TRUE
                   AND d.supplier_currency = d.logistics_currency
                  THEN COALESCE(n.inv_new, d.invoice_amount, 0) - COALESCE(d.invoice_amount, 0)
                  ELSE 0 END AS bal_new
    FROM deals d
    LEFT JOIN deal_new n ON n.deal_id = d.id
   WHERE n.deal_id IS NOT NULL OR d.deal_type = 'KZ'
),
deal_changed AS (
  SELECT * FROM deal_calc
   WHERE inv_new IS DISTINCT FROM inv_old OR tf_new IS DISTINCT FROM tf_old OR bal_new IS DISTINCT FROM bal_old
)
SELECT jsonb_build_object(
  'summary', jsonb_build_object(
    'rows_listed',            (SELECT COUNT(*) FROM listed),
    'rows_s1_changed',        (SELECT COUNT(*) FROM upd),
    'rows_s1_by_class',       (SELECT jsonb_object_agg(cls, n) FROM (SELECT cls, COUNT(*) n FROM upd GROUP BY cls) t),
    'rows_round_only',        (SELECT COUNT(*) FROM listed WHERE s1 IS NOT DISTINCT FROM s1_new),
    'rows_round_only_manual', (SELECT COUNT(*) FROM listed WHERE s1 IS NOT DISTINCT FROM s1_new AND manual),
    'deals_s1_changed',       (SELECT COUNT(DISTINCT deal_id) FROM upd),
    'deals_s1_by_type',       (SELECT jsonb_object_agg(t, n) FROM (SELECT d.deal_type t, COUNT(DISTINCT u.deal_id) n FROM upd u JOIN deals d ON d.id = u.deal_id GROUP BY 1) x),
    'deals_changed',          (SELECT COUNT(*) FROM deal_changed),
    'rows_without_deal',      (SELECT COUNT(*) FROM upd WHERE deal_id IS NULL),
    'kz_deals_tariff_only',   (SELECT COUNT(*) FROM deal_changed WHERE inv_new IS NOT DISTINCT FROM inv_old)
  ),
  'totals', (SELECT jsonb_object_agg(cur, jsonb_build_object(
                 'before', s_old, 'after', s_new, 'delta', s_new - s_old,
                 'changed_rows_before', ch_old, 'changed_rows_after', ch_new))
               FROM (SELECT cur, SUM(s1) s_old, SUM(s1_new) s_new,
                            SUM(s1) FILTER (WHERE s1 IS DISTINCT FROM s1_new) ch_old,
                            COALESCE(SUM(s1_new) FILTER (WHERE s1 IS DISTINCT FROM s1_new), 0) ch_new
                       FROM exp GROUP BY cur) t),
  'deals', (SELECT jsonb_agg(jsonb_build_object(
                 'deal', deal_code, 'type', deal_type, 'cur', cur,
                 'invoice_before', inv_old, 'invoice_after', inv_new,
                 'tariff_fact_before', tf_old, 'tariff_fact_after', tf_new,
                 'supplier_balance_before', bal_old, 'supplier_balance_after', bal_new)
               ORDER BY deal_code) FROM deal_changed),
  'rows', (SELECT jsonb_agg(jsonb_build_object(
                 'deal', deal_code, 'wagon', wagon_number, 'id', id, 'class', cls,
                 'incoming', loading_volume, 'outgoing', shipment_volume,
                 'round_before', round_old, 'round_after', round_new,
                 's1_before', s1, 's1_after', s1_new, 'cur', cur, 'manual_amount', manual)
               ORDER BY deal_code, wagon_number NULLS FIRST, id) FROM listed),
  'risks', jsonb_build_object(
    -- Пустой UPDATE заполнит пустую Сумму 3 по формуле → миграция упадёт.
    's3_would_fill', (SELECT COALESCE(jsonb_agg(jsonb_build_object('deal', deal_code, 'wagon', wagon_number, 'id', id)), '[]')
                        FROM upd
                       WHERE additional_expenses IS NULL AND manager_tariff IS NOT NULL
                         AND COALESCE(rounded_volume_override, loading_volume, shipment_volume) IS NOT NULL),
    -- То же для Суммы 2 (база — входящее; у KZ ручной «округл» главнее).
    's2_would_fill', (SELECT COALESCE(jsonb_agg(jsonb_build_object('deal', deal_code, 'wagon', wagon_number, 'id', id)), '[]')
                        FROM upd
                       WHERE supplier_railway_amount IS NULL AND supplier_railway_tariff IS NOT NULL
                         AND ((rounded_volume_override IS NOT NULL AND registry_type = 'KZ') OR loading_volume IS NOT NULL)),
    -- Сумма есть, тарифа нет: пустой UPDATE запустит подбор тарифа по
    -- справочнику (00167) и сверка уронит миграцию.
    'amount_without_tariff', (SELECT COALESCE(jsonb_agg(jsonb_build_object('deal', deal_code, 'wagon', wagon_number, 'id', id)), '[]')
                                FROM upd WHERE railway_tariff IS NULL),
    -- deals.actual_tariff — numeric(10,4).
    'tariff_fact_overflow', (SELECT COALESCE(jsonb_agg(deal_code), '[]') FROM deal_calc WHERE abs(tf_new) >= 1000000),
    -- Сохранённая Сумма (логисты) уже расходится с Σ строк — роллап её
    -- поправит заодно; это не 00182, но сдвиг попадёт в список.
    'invoice_stale_before', (SELECT COALESCE(jsonb_agg(jsonb_build_object('deal', d.deal_code, 'stored', d.invoice_amount, 'sum_rows', s.s)), '[]')
                               FROM deals d
                               JOIN (SELECT deal_id, COALESCE(SUM(s1), 0) s FROM exp GROUP BY deal_id) s ON s.deal_id = d.id
                              WHERE d.id IN (SELECT deal_id FROM upd)
                                AND d.invoice_amount IS DISTINCT FROM s.s)
  )
) AS preview;

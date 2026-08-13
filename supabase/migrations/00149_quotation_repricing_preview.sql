-- 00149_quotation_repricing_preview.sql
--
-- Клиент 2026-08-13: «если закончился месяц, нужно выставить нужную
-- котировку — ср. месяц, и Паспорт должен пересчитать цены среднего
-- месяца во всех сделках с условием ср. месяц отгрузки. Менеджер при
-- пересчёте может подтверждать ок или нет».
--
-- Сегодня котировки живут сами по себе: на таблице quotations нет ни
-- одного триггера, кроме служебного updated_at. Значение подтягивается
-- в строку варианта ровно один раз — когда открыли карточку, а поле
-- пустое. Уже заполненное не обновится никогда.
--
-- Эта миграция даёт ПРЕДПРОСМОТР: что пересчитается, если принять
-- новую котировку. Ничего не меняет. Применение — отдельным шагом,
-- после подтверждения менеджера (клиент: «предлагать»).
--
-- Область: режим «Средний месяц» (price_condition = 'average_month',
-- расчёт по среднему за месяц). Триггерные цены считаются по каждой
-- отгрузке отдельно и сюда не входят — это отдельная задача, клиент
-- просил сперва обсудить.
--
-- Строки в окончательной цене (price_stage = 'final') НЕ ТРОГАЕМ —
-- прямое указание клиента 2026-08-13.

CREATE OR REPLACE FUNCTION quotation_repricing_preview(
  p_product_type_id UUID,
  p_date            DATE
)
RETURNS TABLE (
  side            TEXT,
  line_id         UUID,
  deal_id         UUID,
  deal_code       TEXT,
  appendix        TEXT,
  target_month    TEXT,
  target_year     INT,
  price_source    TEXT,
  discount        NUMERIC,
  old_quotation   NUMERIC,
  new_quotation   NUMERIC,
  old_price       NUMERIC,
  new_price       NUMERIC,
  shipped_volume  NUMERIC,
  old_amount      NUMERIC,
  new_amount      NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH lines AS (
    SELECT 'supplier'::TEXT AS side, l.id AS line_id, l.deal_id, d.deal_code, l.appendix,
           COALESCE(l.selected_month, d.month) AS target_month,
           d.year AS target_year,
           COALESCE(l.price_source, 'price') AS price_source,
           COALESCE(l.discount, 0) AS discount,
           l.quotation AS old_quotation, l.price AS old_price
      FROM deal_supplier_lines l
      JOIN deals d ON d.id = l.deal_id
     WHERE l.quotation_type_id = p_product_type_id
       AND l.price_condition = 'average_month'
       AND COALESCE(l.calc_mode, 'avg_month') = 'avg_month'
       AND COALESCE(l.price_stage, 'preliminary') <> 'final'
       AND COALESCE(d.is_archived, FALSE) = FALSE
    UNION ALL
    SELECT 'buyer', l.id, l.deal_id, d.deal_code, l.appendix,
           COALESCE(l.selected_month, d.month), d.year,
           COALESCE(l.price_source, 'price'), COALESCE(l.discount, 0),
           l.quotation, l.price
      FROM deal_buyer_lines l
      JOIN deals d ON d.id = l.deal_id
     WHERE l.quotation_type_id = p_product_type_id
       AND l.price_condition = 'average_month'
       AND COALESCE(l.calc_mode, 'avg_month') = 'avg_month'
       AND COALESCE(l.price_stage, 'preliminary') <> 'final'
       AND COALESCE(d.is_archived, FALSE) = FALSE
  ),
  -- Новая котировка влияет только на те строки, чей месяц совпадает с
  -- месяцем внесённой котировки: среднее считается внутри месяца.
  scoped AS (
    SELECT ln.*,
           month_num(ln.target_month) AS m
      FROM lines ln
     WHERE month_num(ln.target_month) = EXTRACT(MONTH FROM p_date)::INT
       AND ln.target_year = EXTRACT(YEAR FROM p_date)::INT
  ),
  priced AS (
    SELECT s.*,
           -- Действующая сигнатура (00079): целевая ДАТА + режим.
           -- Для среднего месяца достаточно любой даты внутри месяца.
           compute_quotation_value(
             p_product_type_id, s.price_source,
             make_date(s.target_year, s.m, 1), 'avg_month'
           ) AS new_quotation
      FROM scoped s
  ),
  -- Отгруженный объём по строке — чтобы показать, на сколько сдвинутся
  -- суммы. Берём то же, что питает роллапы: deal_shipment_prices.
  withvol AS (
    SELECT p.*,
           COALESCE((SELECT SUM(sp.volume) FROM deal_shipment_prices sp
                      WHERE sp.deal_id = p.deal_id AND sp.side = p.side), 0) AS shipped_volume
      FROM priced p
  )
  SELECT w.side, w.line_id, w.deal_id, w.deal_code, w.appendix,
         w.target_month, w.target_year, w.price_source, w.discount,
         w.old_quotation, w.new_quotation,
         w.old_price,
         -- Цена формульного режима: котировка минус скидка. Та же
         -- формула, что применяется при ручной правке строки.
         (w.new_quotation - w.discount) AS new_price,
         w.shipped_volume,
         (w.old_price * w.shipped_volume) AS old_amount,
         ((w.new_quotation - w.discount) * w.shipped_volume) AS new_amount
    FROM withvol w
   WHERE w.new_quotation IS NOT NULL
     -- Показываем только то, что реально изменится.
     AND (w.old_price IS NULL OR round(w.old_price, 4) <> round(w.new_quotation - w.discount, 4));
$$;

COMMENT ON FUNCTION quotation_repricing_preview(UUID, DATE) IS
  'Что пересчитается, если принять котировку за указанную дату: строки-варианты в режиме «Средний месяц», кроме окончательных. Ничего не меняет.';

REVOKE ALL ON FUNCTION quotation_repricing_preview(UUID, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION quotation_repricing_preview(UUID, DATE) TO authenticated;

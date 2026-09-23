-- 00160_passport_as_of.sql
--
-- Клиент 2026-09-17: «нужна выгрузка паспорта в эксель на определённую
-- дату». То есть паспорт таким, каким он был на дату среза: отгрузки и
-- оплаты, случившиеся позже, в цифры не входят.
--
-- ПОЧЕМУ ЭТО НЕ СЧИТАЕТСЯ НА КЛИЕНТЕ. Все денежные колонки паспорта —
-- это rollup-колонки `deals`, которые пишут триггеры:
--   • объёмы и Сумма (логисты) / грузоотправления / ЖД поставщика —
--     refresh_deal_shipment_totals + update_deal_additional_expenses (00116),
--     rollup Суммы 2 (00150);
--   • Приход, сумма / Отгр. сумма — refresh_deal_price_totals (00030);
--   • Оплата / Взаимозачёт / нетто — refresh_deal_payment_totals (00145);
--   • Баланс, Долг, тарифы факт — compute_deal_derived_fields (00120).
-- Истории у этих колонок нет, поэтому срез нужно пересчитывать. Деньги
-- считает Postgres — формулы ниже перенесены из перечисленных функций
-- ДОСЛОВНО, меняется только условие отбора строк-источников.
--
-- ПРАВИЛА СРЕЗА (согласованы с клиентом 2026-09-17):
--   • сторона поставщика режется по дате ВХОДЯЩЕГО СНТ
--     (shipment_registry.loading_date, 00119) — приход в тоннах,
--     Сумма грузоотправления, Сумма ЖД (поставщик);
--   • сторона покупателя — по дате ИСХОДЯЩЕГО СНТ (shipment_registry.date):
--     отгружено в тоннах и Сумма (логисты);
--   • суммы отгрузки обеих сторон — по дате строки раздела «Триггера»
--     (deal_shipment_prices.shipment_date);
--   • оплаты — по deal_payments.payment_date;
--   • ВЗАИМОЗАЧЁТЫ входят в срез ВСЕГДА, без фильтра по дате: CHECK из
--     00145 разрешает им пустую дату, и отбрасывать их значило бы
--     расходиться с текущим паспортом на сумму недатированных зачётов;
--   • строка-источник с пустой датой в срез не попадает (события на
--     дату не было). Сравнение `дата <= p_date` для NULL даёт NULL,
--     FILTER такую строку не берёт — это и есть нужное поведение.
--
-- ЧЕГО ФУНКЦИЯ НЕ ДЕЛАЕТ (осознанно):
--   • не восстанавливает СТАТИЧЕСКИЕ поля сделки на дату — цены,
--     котировки, скидки, объёмы договора, контрагентов, цепочку групп,
--     галочки «в цене». Они берутся текущими; историческая их версия
--     лежала бы только в audit_log и стоила бы отдельной задачи. В
--     выгрузке это подписано в шапке файла;
--   • Сумма (логисты) режется по дате исходящего СНТ и в KZ, хотя её
--     формула считается от входящего объёма. Пара строк, у которых
--     налив и отгрузка разошлись через дату среза, покажет тариф факт
--     ниже фактического; для любой даты после обоих событий расхождения
--     нет. Клиент выбрал простое правило «сумма признаётся по дате
--     исходящего СНТ»;
--   • ничего не пишет: STABLE, только SELECT. Триггеры, схема и данные
--     не затронуты.
--
-- RLS: SECURITY INVOKER (по умолчанию) + GRANT только authenticated —
-- как у get_deal_bundle (00093). Функция читает deals / shipment_registry
-- / deal_shipment_prices / deal_payments от имени вызывающего, политики
-- этих таблиц действуют как обычно.
--
-- Rollback: DROP FUNCTION passport_snapshot_as_of(DATE, UUID[]);
-- выгрузка «на дату» перестанет работать, обычный паспорт не изменится.

CREATE OR REPLACE FUNCTION passport_snapshot_as_of(
  p_date     DATE,
  p_deal_ids UUID[] DEFAULT NULL   -- NULL = все сделки, доступные вызывающему
)
RETURNS TABLE (
  deal_id                    UUID,
  supplier_shipped_volume    NUMERIC,
  supplier_shipped_amount    NUMERIC,
  supplier_payment_gross     NUMERIC,
  supplier_refund_total      NUMERIC,
  supplier_offset_total      NUMERIC,
  supplier_payment           NUMERIC,
  supplier_railway_amount    NUMERIC,
  additional_expenses_amount NUMERIC,
  supplier_balance           NUMERIC,
  buyer_shipped_volume       NUMERIC,
  buyer_shipped_amount       NUMERIC,
  buyer_payment_gross        NUMERIC,
  buyer_refund_total         NUMERIC,
  buyer_offset_total         NUMERIC,
  buyer_payment              NUMERIC,
  buyer_debt                 NUMERIC,
  actual_shipped_volume      NUMERIC,
  invoice_amount             NUMERIC,
  actual_tariff              NUMERIC,
  shipper_actual_tariff      NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH scope AS (
    SELECT d.* FROM deals d
     WHERE p_deal_ids IS NULL OR d.id = ANY (p_deal_ids)
  ),
  -- ── Реестр: refresh_deal_shipment_totals (00116) + rollup'ы
  --    additional_expenses (00115) и Суммы 2 (00150) со срезом по дате.
  reg AS (
    SELECT r.deal_id,
           COALESCE(SUM(r.loading_volume)          FILTER (WHERE r.loading_date <= p_date), 0) AS loading_volume,
           COALESCE(SUM(r.shipment_volume)         FILTER (WHERE r.date         <= p_date), 0) AS shipment_volume,
           COALESCE(SUM(r.shipped_tonnage_amount)  FILTER (WHERE r.date         <= p_date), 0) AS invoice_amount,
           COALESCE(SUM(r.additional_expenses)     FILTER (WHERE r.loading_date <= p_date), 0) AS additional_expenses,
           COALESCE(SUM(r.supplier_railway_amount) FILTER (WHERE r.loading_date <= p_date), 0) AS supplier_railway_amount
      FROM shipment_registry r
      JOIN scope s ON s.id = r.deal_id
     GROUP BY r.deal_id
  ),
  -- ── Суммы отгрузки: refresh_deal_price_totals (00030) со срезом.
  prc AS (
    SELECT sp.deal_id,
           COALESCE(SUM(sp.amount) FILTER (WHERE sp.side = 'supplier'), 0) AS supplier_amount,
           COALESCE(SUM(sp.amount) FILTER (WHERE sp.side = 'buyer'),    0) AS buyer_amount
      FROM deal_shipment_prices sp
      JOIN scope s ON s.id = sp.deal_id
     WHERE sp.shipment_date <= p_date
     GROUP BY sp.deal_id
  ),
  -- ── Оплаты: refresh_deal_payment_totals (00145). Условие по валюте
  --    стороны перенесено дословно; добавлен только срез по дате, и
  --    только для 'payment' / 'refund' — взаимозачёты берём все.
  pay AS (
    SELECT p.deal_id,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'supplier'
               AND (p.currency IS NULL OR p.currency = s.supplier_currency)
               AND p.payment_type = 'payment'
               AND p.payment_date <= p_date), 0) AS sup_gross,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'supplier'
               AND (p.currency IS NULL OR p.currency = s.supplier_currency)
               AND p.payment_type = 'refund'
               AND p.payment_date <= p_date), 0) AS sup_refund,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'supplier'
               AND (p.currency IS NULL OR p.currency = s.supplier_currency)
               AND p.payment_type = 'offset'), 0) AS sup_offset,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'buyer'
               AND (p.currency IS NULL OR p.currency = s.buyer_currency)
               AND p.payment_type = 'payment'
               AND p.payment_date <= p_date), 0) AS buy_gross,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'buyer'
               AND (p.currency IS NULL OR p.currency = s.buyer_currency)
               AND p.payment_type = 'refund'
               AND p.payment_date <= p_date), 0) AS buy_refund,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'buyer'
               AND (p.currency IS NULL OR p.currency = s.buyer_currency)
               AND p.payment_type = 'offset'), 0) AS buy_offset
      FROM deal_payments p
      JOIN scope s ON s.id = p.deal_id
     GROUP BY p.deal_id
  ),
  snap AS (
    SELECT
      s.id,
      s.deal_type,
      s.railway_in_price,
      s.additional_expenses_in_price,
      s.supplier_currency,
      s.logistics_currency,
      s.actual_tariff_override,
      s.actual_tariff          AS manual_actual_tariff,
      s.shipper_actual_tariff_override,
      s.shipper_actual_tariff  AS manual_shipper_tariff,
      COALESCE(reg.loading_volume, 0)          AS loading_volume,
      COALESCE(reg.shipment_volume, 0)         AS shipment_volume,
      COALESCE(reg.invoice_amount, 0)          AS invoice_amount,
      COALESCE(reg.additional_expenses, 0)     AS additional_expenses,
      COALESCE(reg.supplier_railway_amount, 0) AS supplier_railway_amount,
      COALESCE(prc.supplier_amount, 0)         AS supplier_shipped_amount,
      COALESCE(prc.buyer_amount, 0)            AS buyer_shipped_amount,
      COALESCE(pay.sup_gross, 0)               AS sup_gross,
      COALESCE(pay.sup_refund, 0)              AS sup_refund,
      COALESCE(pay.sup_offset, 0)              AS sup_offset,
      COALESCE(pay.buy_gross, 0)               AS buy_gross,
      COALESCE(pay.buy_refund, 0)              AS buy_refund,
      COALESCE(pay.buy_offset, 0)              AS buy_offset
    FROM scope s
    LEFT JOIN reg ON reg.deal_id = s.id
    LEFT JOIN prc ON prc.deal_id = s.id
    LEFT JOIN pay ON pay.deal_id = s.id
  )
  -- Округление до 4 знаков — не косметика: rollup-колонки `deals`
  -- объявлены DECIMAL(14,4), и триггер округляет запись до того же
  -- масштаба. Без ROUND срез «на сегодня» расходился бы с паспортом
  -- в хвосте деления у тарифов факт.
  SELECT
    n.id,
    ROUND(n.loading_volume, 4),
    ROUND(n.supplier_shipped_amount, 4),
    ROUND(n.sup_gross, 4),
    ROUND(n.sup_refund, 4),
    ROUND(n.sup_offset, 4),
    -- Нетто (00145): возвраты вычитаются, взаимозачёт прибавляется со знаком.
    ROUND(n.sup_gross - n.sup_refund + n.sup_offset, 4),
    ROUND(n.supplier_railway_amount, 4),
    ROUND(n.additional_expenses, 4),
    -- Баланс поставщика — compute_deal_derived_fields (00120).
    ROUND(
      n.supplier_shipped_amount
      - (n.sup_gross - n.sup_refund + n.sup_offset)
      + CASE WHEN n.railway_in_price IS TRUE
              AND n.supplier_currency = n.logistics_currency
             THEN n.invoice_amount ELSE 0 END
      + CASE WHEN n.additional_expenses_in_price IS TRUE
              AND n.supplier_currency = n.logistics_currency
             THEN n.additional_expenses ELSE 0 END
    , 4),
    ROUND(n.shipment_volume, 4),
    ROUND(n.buyer_shipped_amount, 4),
    ROUND(n.buy_gross, 4),
    ROUND(n.buy_refund, 4),
    ROUND(n.buy_offset, 4),
    ROUND(n.buy_gross - n.buy_refund + n.buy_offset, 4),
    -- Долг покупателя — там же, 00060 перевернул знак.
    ROUND((n.buy_gross - n.buy_refund + n.buy_offset) - n.buyer_shipped_amount, 4),
    ROUND(n.shipment_volume, 4),
    ROUND(n.invoice_amount, 4),
    -- Тариф факт (логисты): Сумма ÷ объём СНТ, база как в 00120 —
    -- KZ считает от входящего, остальные от исходящего. Ручной ввод
    -- (override) на дату не пересчитывается: это закреплённое значение.
    CASE
      WHEN COALESCE(n.actual_tariff_override, FALSE) THEN n.manual_actual_tariff
      WHEN COALESCE(CASE WHEN n.deal_type = 'KZ' THEN n.loading_volume ELSE n.shipment_volume END, 0) > 0
        THEN ROUND(n.invoice_amount / CASE WHEN n.deal_type = 'KZ' THEN n.loading_volume ELSE n.shipment_volume END, 4)
      ELSE NULL
    END,
    -- Тариф факт (грузоотпр.): Сумма грузоотправления ÷ входящее СНТ.
    CASE
      WHEN COALESCE(n.shipper_actual_tariff_override, FALSE) THEN n.manual_shipper_tariff
      WHEN n.loading_volume > 0 THEN ROUND(n.additional_expenses / n.loading_volume, 4)
      ELSE NULL
    END
  FROM snap n;
$$;

COMMENT ON FUNCTION passport_snapshot_as_of(DATE, UUID[]) IS
  'Пересчитанные на дату rollup-колонки паспорта: приход/отгрузка, суммы, оплата, взаимозачёт, баланс, долг, тарифы факт. Формулы перенесены из триггеров 00030/00116/00120/00145/00150, отличается только срез по датам событий. Взаимозачёты входят без фильтра по дате. Статические поля сделки не восстанавливаются. Ничего не пишет.';

REVOKE ALL ON FUNCTION passport_snapshot_as_of(DATE, UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION passport_snapshot_as_of(DATE, UUID[]) TO authenticated;

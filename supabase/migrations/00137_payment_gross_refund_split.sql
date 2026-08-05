-- 00137_payment_gross_refund_split.sql
--
-- Клиент 2026-08-05: «в таблицу сделок попадает агрегированные данные
-- всех оплат. Нужно вывести два поля: Оплата, Возврат/Перерасчет».
--
-- До этой миграции у сделки было одно число на сторону —
-- deals.supplier_payment / buyer_payment — и в нём уже сидело
-- НЕТТО: payment − refund − offset (00051, 00062). Возвраты и
-- перезачёты вычитались, но увидеть их отдельной величиной было
-- негде: сумма в паспорте молча «худела».
--
-- Теперь rollup материализует три числа на сторону:
--     gross   = Σ amount WHERE payment_type = 'payment'
--     refund  = Σ amount WHERE payment_type IN ('refund','offset')
--     payment = gross − refund        -- ровно то же, что и раньше
--
-- refund хранится ПОЛОЖИТЕЛЬНЫМ: это отдельная колонка «Возврат/
-- Перезачет», а не слагаемое со знаком. Знак живёт только в нетто.
--
-- Баланс НЕ МЕНЯЕТСЯ. compute_deal_derived_fields (00021 → 00052 →
-- 00060 → 00112) продолжает читать нетто-колонки, формула, валюта,
-- единицы, округление и дата-основа те же. Ни одно историческое
-- значение баланса не сдвигается.
--
-- Валютный guard из 00043/00051/00062 сохранён дословно: платёж в
-- валюте, отличной от валюты стороны, не попадает НИ В ОДНУ из трёх
-- сумм.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_payment_gross DECIMAL(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_refund_total  DECIMAL(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_payment_gross    DECIMAL(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_refund_total     DECIMAL(14,4) DEFAULT 0;

COMMENT ON COLUMN deals.supplier_payment_gross IS
  'Оплаты поставщику, только payment_type=''payment''. Колонка «Оплата» в паспорте.';
COMMENT ON COLUMN deals.supplier_refund_total IS
  'Возвраты и перезачёты по стороне поставщика (refund+offset), ПОЛОЖИТЕЛЬНОЕ. Колонка «Возврат/Перезачет».';
COMMENT ON COLUMN deals.buyer_payment_gross IS
  'Оплаты покупателя, только payment_type=''payment''. Колонка «Оплата» в паспорте.';
COMMENT ON COLUMN deals.buyer_refund_total IS
  'Возвраты и перезачёты по стороне покупателя (refund+offset), ПОЛОЖИТЕЛЬНОЕ. Колонка «Возврат/Перезачет».';
COMMENT ON COLUMN deals.supplier_payment IS
  'НЕТТО оплат поставщику = supplier_payment_gross − supplier_refund_total. Именно это число читает формула баланса.';
COMMENT ON COLUMN deals.buyer_payment IS
  'НЕТТО оплат покупателя = buyer_payment_gross − buyer_refund_total. Именно это число читает формула долга.';

CREATE OR REPLACE FUNCTION refresh_deal_payment_totals(p_deal_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE deals d SET
    supplier_payment_gross = COALESCE(sub.sup_gross, 0),
    supplier_refund_total  = COALESCE(sub.sup_refund, 0),
    supplier_payment       = COALESCE(sub.sup_gross, 0) - COALESCE(sub.sup_refund, 0),
    buyer_payment_gross    = COALESCE(sub.buy_gross, 0),
    buyer_refund_total     = COALESCE(sub.buy_refund, 0),
    buyer_payment          = COALESCE(sub.buy_gross, 0) - COALESCE(sub.buy_refund, 0)
  FROM (
    SELECT
      p.deal_id,
      SUM(CASE
            WHEN p.side = 'supplier'
             AND (p.currency IS NULL OR p.currency = d2.supplier_currency)
             AND p.payment_type = 'payment'
            THEN p.amount ELSE 0
          END) AS sup_gross,
      SUM(CASE
            WHEN p.side = 'supplier'
             AND (p.currency IS NULL OR p.currency = d2.supplier_currency)
             AND p.payment_type IN ('refund','offset')
            THEN p.amount ELSE 0
          END) AS sup_refund,
      SUM(CASE
            WHEN p.side = 'buyer'
             AND (p.currency IS NULL OR p.currency = d2.buyer_currency)
             AND p.payment_type = 'payment'
            THEN p.amount ELSE 0
          END) AS buy_gross,
      SUM(CASE
            WHEN p.side = 'buyer'
             AND (p.currency IS NULL OR p.currency = d2.buyer_currency)
             AND p.payment_type IN ('refund','offset')
            THEN p.amount ELSE 0
          END) AS buy_refund
    FROM deal_payments p
    JOIN deals d2 ON d2.id = p.deal_id
    WHERE p.deal_id = p_deal_id
    GROUP BY p.deal_id
  ) sub
  WHERE d.id = sub.deal_id;

  -- Ни одной строки оплат — обнуляем все шесть колонок (иначе после
  -- удаления последней оплаты в сделке остались бы прошлые итоги).
  IF NOT FOUND THEN
    UPDATE deals SET
      supplier_payment = 0, supplier_payment_gross = 0, supplier_refund_total = 0,
      buyer_payment    = 0, buyer_payment_gross    = 0, buyer_refund_total    = 0
    WHERE id = p_deal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── Бэкфилл ──────────────────────────────────────────────────────
-- Прогон по сделкам, у которых есть оплаты. У остальных остаются
-- нули из DEFAULT.
--
-- Нетто пересчитывается в ТЕ ЖЕ значения (формула не изменилась) —
-- кроме сделок с активным ручным переопределением итога («Изменить
-- итог» в паспорте пишет прямо в deals.supplier_payment и живёт до
-- следующего срабатывания rollup). Там нетто вернётся к сумме строк,
-- и триггер 00094 запишет в ленту сделки строку «Оплата ...: Δ».
-- Это тот же эффект, что дало бы любое редактирование оплаты, просто
-- случившийся в момент миграции.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_payments LOOP
    PERFORM refresh_deal_payment_totals(r.deal_id);
  END LOOP;
END $$;

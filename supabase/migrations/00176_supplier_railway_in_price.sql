-- 00176_supplier_railway_in_price.sql
--
-- Клиент 2026-09-28, сделка KZ/26/201: «ж/д тариф не плюсуется на сальдо,
-- галочки ЖД и грузоотправления не работают».
--
-- ПРИЧИНА (проверено на проде): ж/д тариф там введён как «ЖД поставщика» —
-- Сумма 2 (00150, 2 797 951,17), а она по 00150 в баланс не входит. Две
-- галочки работают, но плюсуют Сумму 1 (логисты) и Сумму 3 (грузоотпр.),
-- а у сделки обе нулевые.
--
-- РЕШЕНИЕ (вариант 1, владелец 2026-09-28): отдельная галочка
-- deals.supplier_railway_in_price «ЖД поставщика в цене». Когда поднята,
-- Сумма 2 (deals.supplier_railway_amount) плюсуется к балансу поставщика —
-- по тому же условию валют, что и у двух других галочек (валюта
-- поставщика = валюте логистики). УМОЛЧАНИЕ FALSE: ни один существующий
-- баланс не меняется, пока галочку не поднимут. Бэкфилла нет.
--
-- Формула баланса есть в трёх местах, меняются все три:
--   1. compute_deal_derived_fields (тело 00120 дословно + одно слагаемое);
--   2. passport_snapshot_as_of (тело 00160 дословно + колонка и слагаемое).
--      00160 на проде НЕ применена (функции нет, проверено 2026-09-28) —
--      эта миграция создаёт её целиком, 00160 применять не нужно, а после
--      00176 — нельзя: она вернёт функцию без нового слагаемого;
--   3. src/lib/fx/convert-deal.ts — «Анализ по валюте» (в коде).
--
-- Идемпотентна. ROLLBACK: снять галочку у всех сделок, затем
--   ALTER TABLE deals DROP COLUMN supplier_railway_in_price и вернуть
--   функции из 00120 / 00160.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_railway_in_price BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN deals.supplier_railway_in_price IS
  'TRUE = Сумма 2 (ЖД поставщика, supplier_railway_amount) входит в баланс поставщика при равных валютах поставщика и логистики. Умолчание FALSE (00176).';

-- ── 1. Баланс поставщика ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_deal_derived_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_logistics_base NUMERIC;
BEGIN
  IF NEW.supplier_contracted_volume IS NOT NULL AND NEW.supplier_price IS NOT NULL THEN
    NEW.supplier_contracted_amount := NEW.supplier_contracted_volume * NEW.supplier_price;
  END IF;

  IF NEW.buyer_contracted_volume IS NOT NULL AND NEW.buyer_price IS NOT NULL THEN
    NEW.buyer_contracted_amount := NEW.buyer_contracted_volume * NEW.buyer_price;
  END IF;

  NEW.supplier_balance :=
    COALESCE(NEW.supplier_shipped_amount, 0)
    - COALESCE(NEW.supplier_payment, 0)
    + CASE
        WHEN NEW.railway_in_price IS TRUE
         AND NEW.supplier_currency = NEW.logistics_currency
        THEN COALESCE(NEW.invoice_amount, 0)
        ELSE 0
      END
    + CASE
        WHEN NEW.additional_expenses_in_price IS TRUE
         AND NEW.supplier_currency = NEW.logistics_currency
        THEN COALESCE(NEW.additional_expenses_amount, 0)
        ELSE 0
      END
    -- «ЖД поставщика в цене» (00176): Сумма 2 — по тому же условию валют.
    + CASE
        WHEN NEW.supplier_railway_in_price IS TRUE
         AND NEW.supplier_currency = NEW.logistics_currency
        THEN COALESCE(NEW.supplier_railway_amount, 0)
        ELSE 0
      END;

  NEW.buyer_debt :=
    COALESCE(NEW.buyer_payment, 0)
    - COALESCE(NEW.buyer_shipped_amount, 0);

  NEW.buyer_remaining := COALESCE(NEW.buyer_contracted_volume, 0) - COALESCE(NEW.buyer_ordered_volume, 0);

  IF NEW.planned_tariff IS NOT NULL AND NEW.preliminary_tonnage IS NOT NULL THEN
    NEW.preliminary_amount := NEW.planned_tariff * NEW.preliminary_tonnage;
  END IF;

  -- ── Тариф факт (логисты): Сумма ÷ объем СНТ (00120) ────────────────
  -- База как в формуле суммы реестра: KZ — входящее, KG/прочие — исходящее.
  IF COALESCE(NEW.actual_tariff_override, FALSE) = FALSE THEN
    v_logistics_base := CASE
      WHEN NEW.deal_type = 'KZ' THEN NEW.supplier_shipped_volume
      ELSE NEW.actual_shipped_volume
    END;
    IF NEW.invoice_amount IS NOT NULL AND COALESCE(v_logistics_base, 0) > 0 THEN
      NEW.actual_tariff := NEW.invoice_amount / v_logistics_base;
    ELSE
      NEW.actual_tariff := NULL;
    END IF;
  END IF;

  -- ── Тариф факт (грузоотпр.): Сумма грузоотправителя ÷ входящее СНТ ─
  IF COALESCE(NEW.shipper_actual_tariff_override, FALSE) = FALSE THEN
    IF NEW.additional_expenses_amount IS NOT NULL
       AND COALESCE(NEW.supplier_shipped_volume, 0) > 0 THEN
      NEW.shipper_actual_tariff := NEW.additional_expenses_amount / NEW.supplier_shipped_volume;
    ELSE
      NEW.shipper_actual_tariff := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Паспорт на дату (тело 00160 + ЖД поставщика) ─────────────────
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
      s.supplier_railway_in_price,
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
      + CASE WHEN n.supplier_railway_in_price IS TRUE
              AND n.supplier_currency = n.logistics_currency
             THEN n.supplier_railway_amount ELSE 0 END
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

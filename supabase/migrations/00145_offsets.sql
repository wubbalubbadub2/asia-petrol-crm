-- 00145_offsets.sql
--
-- Клиент 2026-08-12, взаимозачёты:
--   • тип оплаты убирается — остаётся одна «Оплата», а возврат клиенты
--     пишут той же оплатой со знаком минус;
--   • взаимозачёт хранится СО СВОИМ знаком (может быть и плюсом),
--     в «Оплате» не участвует, а в балансе прибавляется к оплате:
--     «если оплата 100 и взаимозачет −10, в баланс берём 100 + (−10)»;
--   • двусторонний взаимозачёт указывает встречную сделку, и в ней
--     автоматически появляется зеркальная запись с противоположным
--     знаком; правка одной стороны меняет другую;
--   • у трёхстороннего зеркала нет.
--
-- ── Что меняется в деньгах и почему числа не поедут ──────────────────
-- До сих пор (00051 → 00062 → 00137) перезачёт лежал в
-- payment_type = 'offset' ПОЛОЖИТЕЛЬНЫМ числом и ВЫЧИТАЛСЯ из нетто
-- вместе с возвратами: payment = gross − (refund + offset).
--
-- Теперь взаимозачёт — величина со знаком, и она ПРИБАВЛЯЕТСЯ:
--     payment = gross − refund + offset
--
-- Чтобы исторические балансы остались прежними, знак существующих
-- строк 'offset' инвертируется: было +10 и вычиталось, стало −10 и
-- прибавляется — результат тот же. Это единственная правка данных в
-- миграции, она обратима и покрыта тестом.
--
-- Возвраты (payment_type = 'refund') не трогаем: исторические строки
-- продолжают вычитаться как раньше. Новые интерфейс больше не создаёт —
-- вместо них минусовая «Оплата».

-- =====================================================================
-- 1. Реквизиты взаимозачёта на строке оплаты
-- =====================================================================

ALTER TABLE deal_payments
  ADD COLUMN IF NOT EXISTS offset_kind          TEXT,
  ADD COLUMN IF NOT EXISTS counterparty_deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  -- Зеркало удаляется вместе с оригиналом.
  ADD COLUMN IF NOT EXISTS mirror_of            UUID REFERENCES deal_payments(id) ON DELETE CASCADE;

DO $$
BEGIN
  ALTER TABLE deal_payments ADD CONSTRAINT deal_payments_offset_kind_chk
    CHECK (offset_kind IS NULL OR offset_kind IN ('bilateral','trilateral'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Встречная сделка имеет смысл только у двустороннего взаимозачёта.
DO $$
BEGIN
  ALTER TABLE deal_payments ADD CONSTRAINT deal_payments_counterparty_only_bilateral_chk
    CHECK (counterparty_deal_id IS NULL OR offset_kind = 'bilateral');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Сделка не может зачитываться сама с собой: зеркало легло бы в ту же
-- строку и тригер зациклился бы на собственной записи.
DO $$
BEGIN
  ALTER TABLE deal_payments ADD CONSTRAINT deal_payments_counterparty_not_self_chk
    CHECK (counterparty_deal_id IS NULL OR counterparty_deal_id <> deal_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- У взаимозачёта даты оплаты нет: клиент 2026-08-12, «при нажатии
-- +Взаимозачет выходят те же поля, только без поля даты оплат».
-- Снимаем NOT NULL, но тут же возвращаем его условием — обычная оплата
-- по-прежнему обязана иметь дату, пустой она стать не может.
ALTER TABLE deal_payments ALTER COLUMN payment_date DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE deal_payments ADD CONSTRAINT deal_payments_date_required_chk
    CHECK (payment_date IS NOT NULL OR payment_type = 'offset');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_deal_payments_mirror_of ON deal_payments(mirror_of);
CREATE INDEX IF NOT EXISTS idx_deal_payments_counterparty ON deal_payments(counterparty_deal_id);

COMMENT ON COLUMN deal_payments.offset_kind IS
  'Вид взаимозачёта: bilateral — двусторонний (с встречной сделкой и зеркалом), trilateral — трёхсторонний (зеркала нет).';
COMMENT ON COLUMN deal_payments.counterparty_deal_id IS
  'Встречная сделка двустороннего взаимозачёта.';
COMMENT ON COLUMN deal_payments.mirror_of IS
  'Заполнено у автоматически созданной зеркальной строки; указывает на исходную. Правки исходной переносятся сюда, удаление — каскадом.';

-- =====================================================================
-- 2. Итог взаимозачётов на сделке + новая формула нетто
-- =====================================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_offset_total DECIMAL(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_offset_total    DECIMAL(14,4) DEFAULT 0;

COMMENT ON COLUMN deals.supplier_offset_total IS
  'Сумма взаимозачётов поставщика СО ЗНАКОМ. В колонке «Оплата» не участвует, в баланс входит слагаемым.';
COMMENT ON COLUMN deals.buyer_offset_total IS
  'Сумма взаимозачётов покупателя СО ЗНАКОМ. В колонке «Оплата» не участвует, в баланс входит слагаемым.';

CREATE OR REPLACE FUNCTION refresh_deal_payment_totals(p_deal_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE deals d SET
    supplier_payment_gross = COALESCE(sub.sup_gross, 0),
    supplier_refund_total  = COALESCE(sub.sup_refund, 0),
    supplier_offset_total  = COALESCE(sub.sup_offset, 0),
    -- Нетто, которое читает формула баланса: возвраты вычитаются
    -- (историческое поведение), взаимозачёт прибавляется со своим знаком.
    supplier_payment       = COALESCE(sub.sup_gross, 0) - COALESCE(sub.sup_refund, 0) + COALESCE(sub.sup_offset, 0),
    buyer_payment_gross    = COALESCE(sub.buy_gross, 0),
    buyer_refund_total     = COALESCE(sub.buy_refund, 0),
    buyer_offset_total     = COALESCE(sub.buy_offset, 0),
    buyer_payment          = COALESCE(sub.buy_gross, 0) - COALESCE(sub.buy_refund, 0) + COALESCE(sub.buy_offset, 0)
  FROM (
    SELECT
      p.deal_id,
      SUM(CASE WHEN p.side = 'supplier'
                AND (p.currency IS NULL OR p.currency = d2.supplier_currency)
                AND p.payment_type = 'payment'
               THEN p.amount ELSE 0 END) AS sup_gross,
      SUM(CASE WHEN p.side = 'supplier'
                AND (p.currency IS NULL OR p.currency = d2.supplier_currency)
                AND p.payment_type = 'refund'
               THEN p.amount ELSE 0 END) AS sup_refund,
      SUM(CASE WHEN p.side = 'supplier'
                AND (p.currency IS NULL OR p.currency = d2.supplier_currency)
                AND p.payment_type = 'offset'
               THEN p.amount ELSE 0 END) AS sup_offset,
      SUM(CASE WHEN p.side = 'buyer'
                AND (p.currency IS NULL OR p.currency = d2.buyer_currency)
                AND p.payment_type = 'payment'
               THEN p.amount ELSE 0 END) AS buy_gross,
      SUM(CASE WHEN p.side = 'buyer'
                AND (p.currency IS NULL OR p.currency = d2.buyer_currency)
                AND p.payment_type = 'refund'
               THEN p.amount ELSE 0 END) AS buy_refund,
      SUM(CASE WHEN p.side = 'buyer'
                AND (p.currency IS NULL OR p.currency = d2.buyer_currency)
                AND p.payment_type = 'offset'
               THEN p.amount ELSE 0 END) AS buy_offset
    FROM deal_payments p
    JOIN deals d2 ON d2.id = p.deal_id
    WHERE p.deal_id = p_deal_id
    GROUP BY p.deal_id
  ) sub
  WHERE d.id = sub.deal_id;

  IF NOT FOUND THEN
    UPDATE deals SET
      supplier_payment = 0, supplier_payment_gross = 0, supplier_refund_total = 0, supplier_offset_total = 0,
      buyer_payment    = 0, buyer_payment_gross    = 0, buyer_refund_total    = 0, buyer_offset_total    = 0
    WHERE id = p_deal_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================================
-- 3. Зеркало двустороннего взаимозачёта
-- =====================================================================
-- Правило клиента: «при добавлении взаимозачёта в сделку А и выборе
-- сделки Б, в сделке Б появится взаимозачёт с противоположным знаком и
-- с выбранной сделкой А. Если изменить — другая сторона тоже изменится».
--
-- Зеркало ложится на ТУ ЖЕ сторону (поставщик ↔ поставщик): клиент
-- задал только смену знака, про смену стороны речи не было.
--
-- Рекурсии нет: у зеркала заполнен mirror_of, и триггер такие строки
-- пропускает. Удаление оригинала уносит зеркало каскадом по FK.

CREATE OR REPLACE FUNCTION sync_offset_mirror()
RETURNS TRIGGER AS $$
DECLARE
  v_mirror_id UUID;
BEGIN
  -- Зеркала сами зеркал не порождают.
  IF COALESCE(NEW.mirror_of, OLD.mirror_of) IS NOT NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD; -- каскад по mirror_of уже удалил зеркало
  END IF;

  SELECT id INTO v_mirror_id FROM deal_payments WHERE mirror_of = NEW.id;

  -- Условия для зеркала отпали (сняли встречную сделку, сменили вид,
  -- перестало быть взаимозачётом) — зеркало убираем.
  IF NEW.payment_type <> 'offset'
     OR NEW.offset_kind IS DISTINCT FROM 'bilateral'
     OR NEW.counterparty_deal_id IS NULL THEN
    IF v_mirror_id IS NOT NULL THEN
      DELETE FROM deal_payments WHERE id = v_mirror_id;
    END IF;
    RETURN NEW;
  END IF;

  IF v_mirror_id IS NULL THEN
    INSERT INTO deal_payments (
      deal_id, side, payment_type, amount, currency, payment_date,
      description, offset_kind, counterparty_deal_id, mirror_of
    ) VALUES (
      NEW.counterparty_deal_id, NEW.side, 'offset', -NEW.amount, NEW.currency, NEW.payment_date,
      NEW.description, 'bilateral', NEW.deal_id, NEW.id
    );
  ELSE
    UPDATE deal_payments SET
      deal_id              = NEW.counterparty_deal_id,
      side                 = NEW.side,
      amount               = -NEW.amount,
      currency             = NEW.currency,
      payment_date         = NEW.payment_date,
      description          = NEW.description,
      counterparty_deal_id = NEW.deal_id
    WHERE id = v_mirror_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_offset_mirror ON deal_payments;
CREATE TRIGGER trg_offset_mirror
  AFTER INSERT OR UPDATE OR DELETE ON deal_payments
  FOR EACH ROW EXECUTE FUNCTION sync_offset_mirror();

-- =====================================================================
-- 4. Перенос исторических взаимозачётов — со сверкой балансов
-- =====================================================================
-- Единственная правка данных во всей миграции: знак существующих строк
-- 'offset' инвертируется, потому что смысл поменялся с «вычитается» на
-- «прибавляется со знаком».
--
-- Клиент 2026-08-12: «главное при переносе чтобы данные не потерялись».
-- Поэтому перенос не на доверии: снимаем балансы ДО, переносим,
-- пересчитываем итоги и сверяем. Разошёлся хоть один — миграция падает
-- целиком, ничего не остаётся наполовину применённым.
--
-- Остальные пункты задачи (галочки и суммы переезжают из реестра в
-- карточку сделки) данных не касаются вовсе: там меняется только место
-- ввода, колонки в базе остаются те же.

DO $$
DECLARE
  v_id       UUID;
  v_bad      INT;
  v_touched  INT;
BEGIN
  CREATE TEMP TABLE _offset_before ON COMMIT DROP AS
    SELECT d.id, d.supplier_balance, d.buyer_debt
      FROM deals d
     WHERE d.id IN (SELECT DISTINCT deal_id FROM deal_payments WHERE payment_type = 'offset');

  SELECT COUNT(*) INTO v_touched FROM _offset_before;

  UPDATE deal_payments
     SET amount = -amount
   WHERE payment_type = 'offset'
     AND amount <> 0;

  FOR v_id IN SELECT id FROM _offset_before LOOP
    PERFORM refresh_deal_payment_totals(v_id);
  END LOOP;

  SELECT COUNT(*) INTO v_bad
    FROM _offset_before b
    JOIN deals d ON d.id = b.id
   WHERE COALESCE(d.supplier_balance, 0) IS DISTINCT FROM COALESCE(b.supplier_balance, 0)
      OR COALESCE(d.buyer_debt, 0)       IS DISTINCT FROM COALESCE(b.buyer_debt, 0);

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'перенос взаимозачётов сдвинул баланс у % сделок из % — миграция отменена', v_bad, v_touched;
  END IF;

  RAISE NOTICE 'взаимозачёты перенесены, балансы сошлись у всех % сделок', v_touched;
END $$;

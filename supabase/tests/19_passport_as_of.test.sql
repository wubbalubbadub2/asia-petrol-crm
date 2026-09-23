-- Test: паспорт на дату — passport_snapshot_as_of (миграция 00160).
--
-- Клиент 2026-09-17: «выгрузка паспорта в эксель на определённую дату».
-- Главное требование к функции: срез на дату ПОСЛЕ всех событий обязан
-- совпадать с текущим паспортом до копейки — иначе выгрузка «на дату»
-- рассказывает про сделку не то, что показывает экран. Дальше —
-- поведение на промежуточных датах и два согласованных исключения:
-- взаимозачёты входят всегда, недатированные строки реестра не входят
-- никогда.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000aa01', 'supplier', 'T-ASOF Поставщик'),
  ('00000000-0000-0000-0000-00000000aa02', 'buyer',    'T-ASOF Покупатель');

-- Сверка «срез == паспорт» нужна дважды (до и после галочки «ЖД в
-- цене»), поэтому живёт отдельной временной функцией.
CREATE FUNCTION pg_temp.assert_snapshot_matches_deal(p_deal UUID, p_label TEXT)
RETURNS VOID AS $fn$
DECLARE
  s RECORD;
  d deals%ROWTYPE;
BEGIN
  -- Дата заведомо позже всех событий фикстуры.
  SELECT * INTO s FROM passport_snapshot_as_of(DATE '2099-12-31', ARRAY[p_deal]);
  SELECT * INTO d FROM deals WHERE id = p_deal;

  IF s.deal_id IS NULL THEN
    RAISE EXCEPTION '%: функция не вернула строку по сделке', p_label;
  END IF;

  IF s.supplier_shipped_volume    IS DISTINCT FROM d.supplier_shipped_volume    THEN RAISE EXCEPTION '%: приход, т — срез % вместо %',        p_label, s.supplier_shipped_volume,    d.supplier_shipped_volume;    END IF;
  IF s.supplier_shipped_amount    IS DISTINCT FROM d.supplier_shipped_amount    THEN RAISE EXCEPTION '%: приход, сумма — срез % вместо %',    p_label, s.supplier_shipped_amount,    d.supplier_shipped_amount;    END IF;
  IF s.supplier_payment_gross     IS DISTINCT FROM d.supplier_payment_gross     THEN RAISE EXCEPTION '%: оплата поставщику — срез % вместо %', p_label, s.supplier_payment_gross,     d.supplier_payment_gross;     END IF;
  IF s.supplier_refund_total      IS DISTINCT FROM d.supplier_refund_total      THEN RAISE EXCEPTION '%: возвраты поставщика — срез % вместо %', p_label, s.supplier_refund_total,    d.supplier_refund_total;      END IF;
  IF s.supplier_offset_total      IS DISTINCT FROM d.supplier_offset_total      THEN RAISE EXCEPTION '%: взаимозачёт поставщика — срез % вместо %', p_label, s.supplier_offset_total,  d.supplier_offset_total;      END IF;
  IF s.supplier_payment           IS DISTINCT FROM d.supplier_payment           THEN RAISE EXCEPTION '%: нетто поставщика — срез % вместо %',  p_label, s.supplier_payment,           d.supplier_payment;           END IF;
  IF s.supplier_railway_amount    IS DISTINCT FROM d.supplier_railway_amount    THEN RAISE EXCEPTION '%: Сумма ЖД — срез % вместо %',          p_label, s.supplier_railway_amount,    d.supplier_railway_amount;    END IF;
  IF s.additional_expenses_amount IS DISTINCT FROM d.additional_expenses_amount THEN RAISE EXCEPTION '%: Сумма грузоотпр. — срез % вместо %',  p_label, s.additional_expenses_amount, d.additional_expenses_amount; END IF;
  IF s.supplier_balance           IS DISTINCT FROM d.supplier_balance           THEN RAISE EXCEPTION '%: баланс — срез % вместо %',            p_label, s.supplier_balance,           d.supplier_balance;           END IF;
  IF s.buyer_shipped_volume       IS DISTINCT FROM d.buyer_shipped_volume       THEN RAISE EXCEPTION '%: отгружено, т — срез % вместо %',      p_label, s.buyer_shipped_volume,       d.buyer_shipped_volume;       END IF;
  IF s.buyer_shipped_amount       IS DISTINCT FROM d.buyer_shipped_amount       THEN RAISE EXCEPTION '%: отгр. сумма — срез % вместо %',       p_label, s.buyer_shipped_amount,       d.buyer_shipped_amount;       END IF;
  IF s.buyer_payment_gross        IS DISTINCT FROM d.buyer_payment_gross        THEN RAISE EXCEPTION '%: оплата покупателя — срез % вместо %', p_label, s.buyer_payment_gross,        d.buyer_payment_gross;        END IF;
  IF s.buyer_refund_total         IS DISTINCT FROM d.buyer_refund_total         THEN RAISE EXCEPTION '%: возвраты покупателя — срез % вместо %', p_label, s.buyer_refund_total,       d.buyer_refund_total;         END IF;
  IF s.buyer_offset_total         IS DISTINCT FROM d.buyer_offset_total         THEN RAISE EXCEPTION '%: взаимозачёт покупателя — срез % вместо %', p_label, s.buyer_offset_total,   d.buyer_offset_total;         END IF;
  IF s.buyer_payment              IS DISTINCT FROM d.buyer_payment              THEN RAISE EXCEPTION '%: нетто покупателя — срез % вместо %',  p_label, s.buyer_payment,              d.buyer_payment;              END IF;
  IF s.buyer_debt                 IS DISTINCT FROM d.buyer_debt                 THEN RAISE EXCEPTION '%: долг — срез % вместо %',              p_label, s.buyer_debt,                 d.buyer_debt;                 END IF;
  IF s.actual_shipped_volume      IS DISTINCT FROM d.actual_shipped_volume      THEN RAISE EXCEPTION '%: факт объём — срез % вместо %',        p_label, s.actual_shipped_volume,      d.actual_shipped_volume;      END IF;
  IF s.invoice_amount             IS DISTINCT FROM d.invoice_amount             THEN RAISE EXCEPTION '%: Сумма (логисты) — срез % вместо %',   p_label, s.invoice_amount,             d.invoice_amount;             END IF;
  IF s.actual_tariff              IS DISTINCT FROM d.actual_tariff              THEN RAISE EXCEPTION '%: тариф факт — срез % вместо %',        p_label, s.actual_tariff,              d.actual_tariff;              END IF;
  IF s.shipper_actual_tariff      IS DISTINCT FROM d.shipper_actual_tariff      THEN RAISE EXCEPTION '%: тариф грузоотпр. — срез % вместо %',  p_label, s.shipper_actual_tariff,      d.shipper_actual_tariff;      END IF;
END;
$fn$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_deal    UUID := gen_random_uuid();
  v_row_a   UUID;
  v_row_b   UUID;
  v_amt_a   NUMERIC;
  v_amt_b   NUMERIC;
  v_add_a   NUMERIC;
  v_add_b   NUMERIC;
  v_exp_a   NUMERIC;
  s         RECORD;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal, 'KZ', 9960, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aa02');

  -- ── Фикстура ───────────────────────────────────────────────────────
  -- Строка А: налив 01.06, отгрузка 03.06. Строка Б — на 20 дней позже.
  -- Суммы реестра считает триггер (00113/00150), поэтому читаем их из
  -- строк, а не вбиваем числами: тест про срез, а не про формулу суммы.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_date, date, loading_volume, shipment_volume,
                                 railway_tariff, manager_tariff, supplier_railway_tariff)
  VALUES (v_deal, 'KZ', 'ASOF-A', DATE '2099-06-01', DATE '2099-06-03', 100, 98, 5, 2, 3)
  RETURNING id INTO v_row_a;

  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_date, date, loading_volume, shipment_volume,
                                 railway_tariff, manager_tariff, supplier_railway_tariff)
  VALUES (v_deal, 'KZ', 'ASOF-B', DATE '2099-06-20', DATE '2099-06-22', 50, 49, 5, 2, 3)
  RETURNING id INTO v_row_b;

  -- Суммы отгрузки: поставщик признан 03.06, покупатель — 22.06.
  INSERT INTO deal_shipment_prices (deal_id, side, shipment_date, volume, amount)
  VALUES (v_deal, 'supplier', DATE '2099-06-03', 100, 1000),
         (v_deal, 'buyer',    DATE '2099-06-22',  98, 1200);

  -- Оплаты и взаимозачёт без даты (00145 это разрешает).
  INSERT INTO deal_payments (deal_id, side, payment_type, amount, payment_date)
  VALUES (v_deal, 'supplier', 'payment', 400, DATE '2099-06-05'),
         (v_deal, 'buyer',    'payment', 600, DATE '2099-06-25');
  INSERT INTO deal_payments (deal_id, side, payment_type, amount, offset_kind)
  VALUES (v_deal, 'supplier', 'offset', -10, 'trilateral');

  SELECT shipped_tonnage_amount, additional_expenses INTO v_amt_a, v_add_a
    FROM shipment_registry WHERE id = v_row_a;
  SELECT shipped_tonnage_amount, additional_expenses INTO v_amt_b, v_add_b
    FROM shipment_registry WHERE id = v_row_b;

  -- ── 1. Срез после всех событий == текущий паспорт ──────────────────
  PERFORM pg_temp.assert_snapshot_matches_deal(v_deal, '1. полный срез');

  -- ── 2. Срез 04.06: строка А есть, строка Б и оплаты ещё нет ────────
  SELECT * INTO s FROM passport_snapshot_as_of(DATE '2099-06-04', ARRAY[v_deal]);

  IF s.supplier_shipped_volume <> 100 THEN
    RAISE EXCEPTION '2. приход должен быть 100 (только строка А), получили %', s.supplier_shipped_volume;
  END IF;
  IF s.buyer_shipped_volume <> 98 THEN
    RAISE EXCEPTION '2. отгружено должно быть 98 (только строка А), получили %', s.buyer_shipped_volume;
  END IF;
  IF s.supplier_shipped_amount <> 1000 THEN
    RAISE EXCEPTION '2. приход по сумме должен быть 1000, получили %', s.supplier_shipped_amount;
  END IF;
  IF s.buyer_shipped_amount <> 0 THEN
    RAISE EXCEPTION '2. отгр. сумма покупателя признаётся 22.06 и на 04.06 должна быть 0, получили %', s.buyer_shipped_amount;
  END IF;
  IF s.supplier_payment_gross <> 0 THEN
    RAISE EXCEPTION '2. оплата от 05.06 не должна попасть в срез на 04.06, получили %', s.supplier_payment_gross;
  END IF;
  -- Взаимозачёт без даты входит всегда — решение клиента 2026-09-17.
  IF s.supplier_offset_total <> -10 THEN
    RAISE EXCEPTION '2. взаимозачёт без даты должен входить в любой срез, получили %', s.supplier_offset_total;
  END IF;
  IF s.supplier_payment <> -10 THEN
    RAISE EXCEPTION '2. нетто = 0 − 0 + (−10) = −10, получили %', s.supplier_payment;
  END IF;
  -- Галочка «Грузоотправитель в цене» у новых сделок включена (00128),
  -- поэтому в баланс входит и Сумма 3 — но только строки А: она режется
  -- по дате налива, и налив строки Б (20.06) в срез не попал.
  IF s.additional_expenses_amount IS DISTINCT FROM v_add_a THEN
    RAISE EXCEPTION '2. Сумма грузоотправления должна быть суммой строки А (%), получили %', v_add_a, s.additional_expenses_amount;
  END IF;
  IF s.supplier_balance IS DISTINCT FROM ROUND(1000 + 10 + v_add_a, 4) THEN
    RAISE EXCEPTION '2. баланс = 1000 − (−10) + Сумма 3 строки А (%) = %, получили %',
      v_add_a, ROUND(1000 + 10 + v_add_a, 4), s.supplier_balance;
  END IF;
  IF s.buyer_debt <> 0 THEN
    RAISE EXCEPTION '2. у покупателя на 04.06 ни отгрузки, ни оплаты — долг 0, получили %', s.buyer_debt;
  END IF;
  IF s.invoice_amount IS DISTINCT FROM v_amt_a THEN
    RAISE EXCEPTION '2. Сумма (логисты) должна быть суммой строки А (%), получили %', v_amt_a, s.invoice_amount;
  END IF;
  -- Тариф факт в KZ считается от входящего СНТ: сумма строки А ÷ 100.
  v_exp_a := ROUND(v_amt_a / 100, 4);
  IF s.actual_tariff IS DISTINCT FROM v_exp_a THEN
    RAISE EXCEPTION '2. тариф факт должен быть % (сумма А ÷ 100), получили %', v_exp_a, s.actual_tariff;
  END IF;

  -- ── 3. Срез 02.06: налив А был, исходящего СНТ ещё нет ─────────────
  -- Документирует согласованное правило: Сумма (логисты) признаётся по
  -- дате исходящего СНТ, даже если её база в KZ — входящий объём.
  SELECT * INTO s FROM passport_snapshot_as_of(DATE '2099-06-02', ARRAY[v_deal]);

  IF s.supplier_shipped_volume <> 100 THEN
    RAISE EXCEPTION '3. налив 01.06 должен попасть в срез на 02.06, получили %', s.supplier_shipped_volume;
  END IF;
  IF s.buyer_shipped_volume <> 0 THEN
    RAISE EXCEPTION '3. исходящее СНТ от 03.06 не должно попасть в срез на 02.06, получили %', s.buyer_shipped_volume;
  END IF;
  IF s.supplier_shipped_amount <> 0 THEN
    RAISE EXCEPTION '3. сумма отгрузки поставщика признана 03.06 и на 02.06 должна быть 0, получили %', s.supplier_shipped_amount;
  END IF;
  IF s.invoice_amount <> 0 THEN
    RAISE EXCEPTION '3. Сумма (логисты) на 02.06 должна быть 0, получили %', s.invoice_amount;
  END IF;
  -- Сумма 3 режется по дате налива, поэтому она УЖЕ есть — вместе с
  -- тарифом грузоотправителя (2 за тонну, задан в фикстуре).
  IF s.shipper_actual_tariff <> 2 THEN
    RAISE EXCEPTION '3. тариф грузоотпр. должен быть 2 (Сумма 3 ÷ 100), получили %', s.shipper_actual_tariff;
  END IF;

  -- ── 4. Срез до всех событий: только взаимозачёт ────────────────────
  SELECT * INTO s FROM passport_snapshot_as_of(DATE '2099-01-01', ARRAY[v_deal]);

  IF s.supplier_shipped_volume <> 0 OR s.buyer_shipped_volume <> 0
     OR s.supplier_shipped_amount <> 0 OR s.buyer_shipped_amount <> 0
     OR s.supplier_payment_gross <> 0 OR s.buyer_payment_gross <> 0 THEN
    RAISE EXCEPTION '4. на 01.01 у сделки не должно быть ни отгрузок, ни оплат';
  END IF;
  IF s.supplier_balance <> 10 THEN
    RAISE EXCEPTION '4. баланс = 0 − (−10) = 10, получили %', s.supplier_balance;
  END IF;
  IF s.actual_tariff IS NOT NULL THEN
    RAISE EXCEPTION '4. без объёма тариф факт должен быть пустым, получили %', s.actual_tariff;
  END IF;

  -- ── 5. Строка реестра без дат в срез не попадает ───────────────────
  -- Событие не датировано — отнести его к дате нельзя. При этом в
  -- текущем паспорте она участвует, и расхождение здесь ожидаемое.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, shipment_volume, railway_tariff)
  VALUES (v_deal, 'KZ', 'ASOF-C', 7, 7, 5);

  SELECT * INTO s FROM passport_snapshot_as_of(DATE '2099-12-31', ARRAY[v_deal]);
  IF s.supplier_shipped_volume <> 150 THEN
    RAISE EXCEPTION '5. недатированная строка не должна попасть в срез: ожидали 150, получили %', s.supplier_shipped_volume;
  END IF;
  IF (SELECT supplier_shipped_volume FROM deals WHERE id = v_deal) <> 157 THEN
    RAISE EXCEPTION '5. в самом паспорте недатированная строка обязана остаться';
  END IF;

  DELETE FROM shipment_registry WHERE wagon_number = 'ASOF-C';

  -- ── 6. Галочка «ЖД в цене» — баланс среза идёт за паспортом ────────
  UPDATE deals SET railway_in_price = TRUE WHERE id = v_deal;
  PERFORM pg_temp.assert_snapshot_matches_deal(v_deal, '6. срез с галочкой «ЖД в цене»');

  -- Проверяем, что галочка вообще что-то изменила, иначе пункт 6 пустой.
  SELECT * INTO s FROM passport_snapshot_as_of(DATE '2099-12-31', ARRAY[v_deal]);
  IF s.supplier_balance IS DISTINCT FROM ROUND(1000 - (400 - 10) + v_amt_a + v_amt_b + v_add_a + v_add_b, 4) THEN
    RAISE EXCEPTION '6. баланс должен включить Суммы (логисты) и грузоотправления обеих строк: ожидали %, получили %',
      ROUND(1000 - (400 - 10) + v_amt_a + v_amt_b + v_add_a + v_add_b, 4), s.supplier_balance;
  END IF;

  -- ── 7. Без списка id функция отдаёт сделку наравне с остальными ────
  SELECT * INTO s FROM passport_snapshot_as_of(DATE '2099-12-31') WHERE deal_id = v_deal;
  IF s.deal_id IS NULL THEN
    RAISE EXCEPTION '7. вызов без списка сделок должен возвращать все сделки';
  END IF;

  RAISE NOTICE 'OK: срез на дату сходится с паспортом, промежуточные даты режут события по своим датам';
END $$;

ROLLBACK;

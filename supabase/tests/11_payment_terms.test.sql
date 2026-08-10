-- Test: условия оплаты по приложению и расчёт «дней до оплаты» (00141)
--
-- Приёмочные сценарии согласованы с клиентом 2026-08-10 и сверены с его
-- файлом-примером: там 12.02.2026 + 90 дней = 13.05.2026, а 18.03.2026 +
-- 14 дней = 01.04.2026. Эти две даты проверяются буквально — они не
-- зависят от «сегодня». Всё, что зависит от текущей даты, задаётся
-- смещением от CURRENT_DATE, иначе тест протухнет назавтра.
--
-- Отдельно закрыт баг из исходного файла клиента: строки без даты СНТ
-- показывали плановую дату 30.03.1900 и просрочку −46154 и висели как
-- настоящая просрочка. У нас это NULL.

BEGIN;

INSERT INTO counterparties (id, type, full_name, short_name) VALUES
  ('00000000-0000-0000-0000-0000000005a1', 'supplier', 'T-PT Поставщик Полный', 'T-PT Поставщик'),
  ('00000000-0000-0000-0000-0000000005a2', 'buyer',    'T-PT Покупатель Полный', 'T-PT Покупатель');

DO $$
DECLARE
  v_deal    UUID := gen_random_uuid();
  v_sup_ln  UUID;
  v_buy_ln  UUID;
  v_row     deal_payment_terms%ROWTYPE;
  v_planned DATE;
  v_days    INT;
  v_basis   TEXT;
  v_cnt     INT;
  v_amount  NUMERIC;
  v_volume  NUMERIC;
  v_price   NUMERIC;
  v_sup_ln2 UUID;
  v_days_list INT[];
  v_days_expect INT;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal, 'KG', 9920, 2099, 'январь',
          '00000000-0000-0000-0000-0000000005a1',
          '00000000-0000-0000-0000-0000000005a2');

  -- Строки-варианты по умолчанию заводятся триггером 00053/00055.
  SELECT id INTO v_sup_ln FROM deal_supplier_lines WHERE deal_id = v_deal AND is_default;
  SELECT id INTO v_buy_ln FROM deal_buyer_lines    WHERE deal_id = v_deal AND is_default;
  IF v_sup_ln IS NULL OR v_buy_ln IS NULL THEN
    RAISE EXCEPTION 'фикстура: строки-варианты по умолчанию не созданы';
  END IF;

  UPDATE deal_supplier_lines SET appendix = 'ПР-СУП-1', price = 100 WHERE id = v_sup_ln;
  UPDATE deal_buyer_lines    SET appendix = 'ПР-ПОК-1', price = 120 WHERE id = v_buy_ln;

  -- ── 1. Пример клиента: 12.02.2026 + 90 = 13.05.2026 ────────────────
  UPDATE deal_supplier_lines SET deferral_days = 90 WHERE id = v_sup_ln;

  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, loading_date,
                                 shipment_volume, date)
  VALUES (v_deal, 'KG', 'PT-0001',
          60, DATE '2026-02-12',
          60, DATE '2026-02-12');

  SELECT planned_pay_date INTO v_planned
  FROM deal_payment_terms
  WHERE deal_id = v_deal AND side = 'supplier' AND wagon_number = 'PT-0001';

  IF v_planned <> DATE '2026-05-13' THEN
    RAISE EXCEPTION 'пример клиента 12.02.2026+90: ожидали 13.05.2026, получили %', v_planned;
  END IF;

  -- ── 2. Приложение важнее сделки ────────────────────────────────────
  -- На сделке 90 (00125), на приложении 14 — должно победить 14.
  UPDATE deals SET buyer_deferral_days = 90 WHERE id = v_deal;
  UPDATE deal_buyer_lines SET deferral_days = 14 WHERE id = v_buy_ln;

  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 shipment_volume, date)
  VALUES (v_deal, 'KG', 'PT-0002', 60, DATE '2026-03-18');

  SELECT deferral_days, planned_pay_date INTO v_days, v_planned
  FROM deal_payment_terms
  WHERE deal_id = v_deal AND side = 'buyer' AND wagon_number = 'PT-0002';

  IF v_days <> 14 THEN
    RAISE EXCEPTION 'приоритет приложения: ожидали 14 дней, получили %', v_days;
  END IF;
  IF v_planned <> DATE '2026-04-01' THEN
    RAISE EXCEPTION 'пример клиента 18.03.2026+14: ожидали 01.04.2026, получили %', v_planned;
  END IF;

  -- ── 3. Запасное значение со сделки, когда у приложения своего нет ───
  UPDATE deal_buyer_lines SET deferral_days = NULL WHERE id = v_buy_ln;
  SELECT deferral_days INTO v_days
  FROM deal_payment_terms
  WHERE deal_id = v_deal AND side = 'buyer' AND wagon_number = 'PT-0002';
  IF v_days <> 90 THEN
    RAISE EXCEPTION 'запасное значение сделки: ожидали 90, получили %', v_days;
  END IF;
  UPDATE deal_buyer_lines SET deferral_days = 14 WHERE id = v_buy_ln;

  -- ── 4. Умолчание отсчёта — «от даты отгрузки» на обеих сторонах ─────
  SELECT date_basis INTO v_basis FROM deal_payment_terms
   WHERE deal_id = v_deal AND side = 'supplier' AND wagon_number = 'PT-0001';
  IF v_basis <> 'auto' THEN
    RAISE EXCEPTION 'умолчание поставщика: ожидали auto, получили %', v_basis;
  END IF;
  SELECT date_basis INTO v_basis FROM deal_payment_terms
   WHERE deal_id = v_deal AND side = 'buyer' AND wagon_number = 'PT-0002';
  IF v_basis <> 'auto' THEN
    RAISE EXCEPTION 'умолчание покупателя: ожидали auto, получили %', v_basis;
  END IF;

  -- ── 5. Дата отгрузки берётся по стороне автоматически ──────────────
  -- У PT-0003 приход и отгрузка в разные дни: поставщик считает от
  -- прихода, покупатель — от отгрузки. Выбора у пользователя нет.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, loading_date,
                                 shipment_volume, date)
  VALUES (v_deal, 'KG', 'PT-0003',
          60, DATE '2026-02-01',
          60, DATE '2026-02-20');

  SELECT basis_date INTO v_planned FROM deal_payment_terms
   WHERE deal_id = v_deal AND side = 'supplier' AND wagon_number = 'PT-0003';
  IF v_planned <> DATE '2026-02-01' THEN
    RAISE EXCEPTION 'поставщик считает от прихода: ожидали 01.02.2026, получили %', v_planned;
  END IF;

  SELECT basis_date INTO v_planned FROM deal_payment_terms
   WHERE deal_id = v_deal AND side = 'buyer' AND wagon_number = 'PT-0003';
  IF v_planned <> DATE '2026-02-20' THEN
    RAISE EXCEPTION 'покупатель считает от отгрузки: ожидали 20.02.2026, получили %', v_planned;
  END IF;

  -- ── 6. Знак и граница «дней до оплаты» ─────────────────────────────
  -- Срок ровно сегодня → 0. Просрочка на 32 дня → −32 (пример клиента).
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, loading_date)
  VALUES (v_deal, 'KG', 'PT-DUE',  60, CURRENT_DATE - 90),
         (v_deal, 'KG', 'PT-LATE', 60, CURRENT_DATE - 122);

  SELECT days_to_pay INTO v_days FROM deal_payment_terms
   WHERE deal_id = v_deal AND side = 'supplier' AND wagon_number = 'PT-DUE';
  IF v_days <> 0 THEN
    RAISE EXCEPTION 'граница «платить сегодня»: ожидали 0, получили %', v_days;
  END IF;

  SELECT days_to_pay INTO v_days FROM deal_payment_terms
   WHERE deal_id = v_deal AND side = 'supplier' AND wagon_number = 'PT-LATE';
  IF v_days <> -32 THEN
    RAISE EXCEPTION 'просрочка: ожидали −32, получили %', v_days;
  END IF;

  -- ── 7. Пустые значения дают NULL, а не 1900 год ────────────────────
  -- Ровно тот мусор, что висел в исходном файле клиента (−46154).
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_volume, date)
  VALUES (v_deal, 'KG', 'PT-NODATE', 60, NULL);

  SELECT planned_pay_date, days_to_pay INTO v_planned, v_days
  FROM deal_payment_terms
  WHERE deal_id = v_deal AND side = 'buyer' AND wagon_number = 'PT-NODATE';
  IF v_planned IS NOT NULL OR v_days IS NOT NULL THEN
    RAISE EXCEPTION 'нет даты СНТ: ожидали NULL/NULL, получили % / %', v_planned, v_days;
  END IF;

  -- Нет срока — тоже NULL, а не ноль.
  UPDATE deal_supplier_lines SET deferral_days = NULL WHERE id = v_sup_ln;
  SELECT planned_pay_date, days_to_pay INTO v_planned, v_days
  FROM deal_payment_terms
  WHERE deal_id = v_deal AND side = 'supplier' AND wagon_number = 'PT-0001';
  IF v_planned IS NOT NULL OR v_days IS NOT NULL THEN
    RAISE EXCEPTION 'нет срока: ожидали NULL/NULL, получили % / %', v_planned, v_days;
  END IF;
  UPDATE deal_supplier_lines SET deferral_days = 90 WHERE id = v_sup_ln;

  -- ── 8. Режим «прочее» берёт ручную дату ────────────────────────────
  UPDATE deals SET supplier_deferral_mode = 'other',
                   supplier_planned_pay_date = DATE '2026-09-01'
   WHERE id = v_deal;
  SELECT planned_pay_date INTO v_planned FROM deal_payment_terms
   WHERE deal_id = v_deal AND side = 'supplier' AND wagon_number = 'PT-0001';
  IF v_planned <> DATE '2026-09-01' THEN
    RAISE EXCEPTION 'режим other: ожидали 01.09.2026, получили %', v_planned;
  END IF;
  UPDATE deals SET supplier_deferral_mode = NULL, supplier_planned_pay_date = NULL
   WHERE id = v_deal;

  -- ── 9. Отчёт: вагоны одной даты складываются в одну строку ─────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, loading_date)
  VALUES (v_deal, 'KG', 'PT-AGG-1', 40, DATE '2026-06-10'),
         (v_deal, 'KG', 'PT-AGG-2', 60, DATE '2026-06-10');

  SELECT COUNT(*), MAX(shipped_volume), MAX(shipped_amount), MAX(price)
    INTO v_cnt, v_volume, v_amount, v_price
  FROM deal_payment_terms_report
  WHERE deal_id = v_deal AND side = 'supplier' AND basis_date = DATE '2026-06-10';

  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'агрегация по дате: ожидали 1 строку, получили %', v_cnt;
  END IF;
  IF v_volume <> 100 THEN
    RAISE EXCEPTION 'агрегация объёма: ожидали 100, получили %', v_volume;
  END IF;
  -- Цена на строке-варианте 100 → сумма 100 т × 100 = 10 000.
  IF v_amount <> 10000 THEN
    RAISE EXCEPTION 'агрегация суммы: ожидали 10000, получили %', v_amount;
  END IF;
  IF v_price <> 100 THEN
    RAISE EXCEPTION 'цена = сумма/объём: ожидали 100, получили %', v_price;
  END IF;

  -- ── 10. Строки без даты СНТ в отчёт не попадают ────────────────────
  SELECT COUNT(*) INTO v_cnt
  FROM deal_payment_terms_report
  WHERE deal_id = v_deal AND basis_date IS NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'отчёт: строки без даты СНТ должны отсекаться, найдено %', v_cnt;
  END IF;

  -- ── 11. Сальдо каноническое, а не пересчитанное ────────────────────
  SELECT MAX(deal_saldo) INTO v_amount
  FROM deal_payment_terms_report
  WHERE deal_id = v_deal AND side = 'supplier';
  SELECT supplier_balance INTO v_volume FROM deals WHERE id = v_deal;
  IF v_amount IS DISTINCT FROM v_volume THEN
    RAISE EXCEPTION 'сальдо поставщика должно совпадать с deals.supplier_balance: % vs %', v_amount, v_volume;
  END IF;

  -- По покупателю берём -buyer_debt: в отчёте величина «должны контрагенту».
  SELECT MAX(deal_saldo) INTO v_amount
  FROM deal_payment_terms_report
  WHERE deal_id = v_deal AND side = 'buyer';
  SELECT -buyer_debt INTO v_volume FROM deals WHERE id = v_deal;
  IF v_amount IS DISTINCT FROM v_volume THEN
    RAISE EXCEPTION 'сальдо покупателя должно быть -buyer_debt: % vs %', v_amount, v_volume;
  END IF;

  -- ── 12. Сводка для паспорта ────────────────────────────────────────
  -- Одно приложение на стороне → паспорт может править по месту, и
  -- single_line_id указывает куда именно.
  SELECT line_count, single_line_id INTO v_cnt, v_sup_ln2
  FROM deal_payment_terms_summary
  WHERE deal_id = v_deal AND side = 'supplier';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'сводка: ожидали 1 приложение поставщика, получили %', v_cnt;
  END IF;
  IF v_sup_ln2 IS DISTINCT FROM v_sup_ln THEN
    RAISE EXCEPTION 'сводка: single_line_id должен указывать на строку-вариант';
  END IF;

  -- Худшая просрочка = самая отрицательная по отгрузкам стороны.
  -- Сверяем с самим атомарным слоем, а не с константой: у части фикстур
  -- даты СНТ абсолютные (12.02.2026 и т.п.), поэтому конкретное число
  -- меняется каждый день, а инвариант «сводка = MIN по отгрузкам» — нет.
  SELECT MIN(days_to_pay) INTO v_days_expect
  FROM deal_payment_terms
  WHERE deal_id = v_deal AND side = 'supplier' AND days_to_pay IS NOT NULL;

  SELECT worst_days_to_pay INTO v_days
  FROM deal_payment_terms_summary
  WHERE deal_id = v_deal AND side = 'supplier';

  IF v_days IS DISTINCT FROM v_days_expect THEN
    RAISE EXCEPTION 'сводка: худшая просрочка % не совпала с MIN по отгрузкам %', v_days, v_days_expect;
  END IF;
  IF v_days >= 0 THEN
    RAISE EXCEPTION 'фикстура: ожидали хотя бы одну просроченную отгрузку, получили %', v_days;
  END IF;

  -- Просроченные отгрузки посчитаны.
  SELECT overdue_count INTO v_cnt
  FROM deal_payment_terms_summary
  WHERE deal_id = v_deal AND side = 'supplier';
  IF v_cnt < 1 THEN
    RAISE EXCEPTION 'сводка: ожидали ненулевой счётчик просрочек, получили %', v_cnt;
  END IF;

  -- Второе приложение на стороне → правка по месту неоднозначна.
  INSERT INTO deal_supplier_lines (deal_id, position, appendix, price, deferral_days)
  VALUES (v_deal, 2, 'ПР-СУП-2', 105, 30);

  SELECT line_count INTO v_cnt
  FROM deal_payment_terms_summary
  WHERE deal_id = v_deal AND side = 'supplier';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'сводка: после второго приложения ожидали 2, получили %', v_cnt;
  END IF;

  -- Оба срока видны в списке — паспорт покажет их без захода в сделку.
  SELECT deferral_days_list INTO v_days_list
  FROM deal_payment_terms_summary
  WHERE deal_id = v_deal AND side = 'supplier';
  IF NOT (30 = ANY (v_days_list) AND 90 = ANY (v_days_list)) THEN
    RAISE EXCEPTION 'сводка: ожидали сроки 30 и 90, получили %', v_days_list;
  END IF;
  -- ── 13. Ручная дата по приложению (00142) ──────────────────────────
  -- Клиент 2026-08-10: «или ввести дату самому, и дальше менеджер сам
  -- вводит дату». Дата приложения важнее и срока, и режима сделки.
  UPDATE deal_supplier_lines
     SET deferral_date_basis = 'manual',
         deferral_planned_date = DATE '2026-10-15',
         deferral_days = 90
   WHERE id = v_sup_ln;

  SELECT planned_pay_date, deferral_days INTO v_planned, v_days
  FROM deal_payment_terms
  WHERE deal_id = v_deal AND side = 'supplier' AND wagon_number = 'PT-0001';

  IF v_planned <> DATE '2026-10-15' THEN
    RAISE EXCEPTION 'ручная дата: ожидали 15.10.2026, получили %', v_planned;
  END IF;
  -- Срок в днях при ручной дате не показывается: он ни на что не влияет.
  IF v_days IS NOT NULL THEN
    RAISE EXCEPTION 'ручная дата: срок в днях должен быть пуст, получили %', v_days;
  END IF;

  -- Дата отгрузки сохраняется — иначе строка выпала бы из отчёта.
  SELECT basis_date INTO v_planned FROM deal_payment_terms
   WHERE deal_id = v_deal AND side = 'supplier' AND wagon_number = 'PT-0001';
  IF v_planned <> DATE '2026-02-12' THEN
    RAISE EXCEPTION 'ручная дата: дата СНТ должна остаться 12.02.2026, получили %', v_planned;
  END IF;

  -- Приложение с ручной датой перебивает режим 'other' на сделке.
  UPDATE deals SET supplier_deferral_mode = 'other',
                   supplier_planned_pay_date = DATE '2026-12-31'
   WHERE id = v_deal;
  SELECT planned_pay_date INTO v_planned FROM deal_payment_terms
   WHERE deal_id = v_deal AND side = 'supplier' AND wagon_number = 'PT-0001';
  IF v_planned <> DATE '2026-10-15' THEN
    RAISE EXCEPTION 'приоритет приложения над режимом сделки: ожидали 15.10.2026, получили %', v_planned;
  END IF;

  -- Признак ручной даты виден в сводке для паспорта.
  IF NOT (SELECT has_manual_date FROM deal_payment_terms_summary
           WHERE deal_id = v_deal AND side = 'supplier') THEN
    RAISE EXCEPTION 'сводка: признак ручной даты не выставлен';
  END IF;

  UPDATE deals SET supplier_deferral_mode = NULL, supplier_planned_pay_date = NULL WHERE id = v_deal;
  UPDATE deal_supplier_lines SET deferral_date_basis = NULL, deferral_planned_date = NULL WHERE id = v_sup_ln;
END $$;

ROLLBACK;

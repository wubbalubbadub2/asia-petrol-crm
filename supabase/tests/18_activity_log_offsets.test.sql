-- Test: журнал активности по deal_payments (миграция 00156)
--
-- 27.08.2026 в ленте сделки KZ/26/147 висело «Перезачет поставщику:
-- -66358495.820»: старое слово, формат тонн вместо денег и без валюты.
-- Тест закрепляет новый текст и следит, чтобы обычная оплата не поехала.
--
-- Все записи в одной транзакции получают ОДИН created_at, поэтому
-- «последнюю» строку журнала выбираем не сортировкой, а исключая уже
-- проверенные: на каждый шаг триггер пишет ровно одну новую.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-000000000801', 'supplier', 'T-ActSupplier');

DO $$
DECLARE
  v_deal   UUID := gen_random_uuid();
  v_other  UUID := gen_random_uuid();
  v_pay    UUID := gen_random_uuid();
  v_off    UUID := gen_random_uuid();
  v_seen   UUID[] := ARRAY[]::UUID[];
  v_id     UUID;
  v_text   TEXT;
  v_md     JSONB;
  NBSP     TEXT := chr(160);
  MINUS    TEXT := chr(8722);

BEGIN
  -- ── Форматтер денег ───────────────────────────────────────────────
  IF _activity_fmt_money(NULL) <> '—' THEN
    RAISE EXCEPTION 'NULL должен давать прочерк, получено %', _activity_fmt_money(NULL);
  END IF;
  IF _activity_fmt_money(0) <> '0,00' THEN
    RAISE EXCEPTION 'ноль: ожидалось 0,00, получено %', _activity_fmt_money(0);
  END IF;
  -- Граница группировки: три цифры разделителя не получают.
  IF _activity_fmt_money(999.5) <> '999,50' THEN
    RAISE EXCEPTION '999.5: ожидалось 999,50, получено %', _activity_fmt_money(999.5);
  END IF;
  IF _activity_fmt_money(1000) <> '1' || NBSP || '000,00' THEN
    RAISE EXCEPTION '1000: группировка не сработала, получено %', _activity_fmt_money(1000);
  END IF;
  -- Ровно тот случай из ленты: было «-66358495.820».
  IF _activity_fmt_money(-66358495.82) <> MINUS || '66' || NBSP || '358' || NBSP || '495,82' THEN
    RAISE EXCEPTION 'сумма со скриншота отформатирована как %', _activity_fmt_money(-66358495.82);
  END IF;
  -- Округление до копейки, а не обрезание.
  IF _activity_fmt_money(1.005) <> '1,01' THEN
    RAISE EXCEPTION 'округление: ожидалось 1,01, получено %', _activity_fmt_money(1.005);
  END IF;

  -- ── Данные ────────────────────────────────────────────────────────
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id,
                     supplier_currency, is_draft)
  VALUES (v_deal,  'KZ', 981, 2099, 'январь',
          '00000000-0000-0000-0000-000000000801', 'KZT', FALSE),
         (v_other, 'KZ', 982, 2099, 'январь',
          '00000000-0000-0000-0000-000000000801', 'KZT', FALSE);

  -- ── Обычная оплата не изменилась ─────────────────────────────────
  INSERT INTO deal_payments (id, deal_id, side, payment_type, amount, payment_date)
  VALUES (v_pay, v_deal, 'supplier', 'payment', 1000, DATE '2099-01-15');

  SELECT a.id, a.content INTO v_id, v_text FROM deal_activity a
   WHERE a.deal_id = v_deal AND a.metadata->>'row_id' = v_pay::TEXT
     AND NOT (a.id = ANY(v_seen)) LIMIT 1;
  v_seen := v_seen || v_id;
  IF v_text IS DISTINCT FROM 'Оплата поставщику: 1' || NBSP || '000,00 ₸ (15.01.2099)' THEN
    RAISE EXCEPTION 'оплата: неожиданный текст «%»', v_text;
  END IF;

  -- ── Взаимозачёт: слово, деньги, валюта сделки, вид, встречная ─────
  -- currency NULL — самый частый случай: «валюта сделки».
  INSERT INTO deal_payments (id, deal_id, side, payment_type, amount,
                             offset_kind, counterparty_deal_id)
  VALUES (v_off, v_deal, 'supplier', 'offset', -66358495.82, 'bilateral', v_other);

  SELECT a.id, a.content, a.metadata INTO v_id, v_text, v_md FROM deal_activity a
   WHERE a.deal_id = v_deal AND a.metadata->>'row_id' = v_off::TEXT
     AND NOT (a.id = ANY(v_seen)) LIMIT 1;
  v_seen := v_seen || v_id;

  IF v_text LIKE '%Перезачет%' THEN
    RAISE EXCEPTION 'в журнале осталось слово «Перезачет»: «%»', v_text;
  END IF;
  IF v_text IS DISTINCT FROM 'Взаимозачёт поставщику: ' || MINUS || '66' || NBSP || '358' || NBSP
                             || '495,82 ₸, 2-х сторонний, встречная сделка KZ/99/982' THEN
    RAISE EXCEPTION 'взаимозачёт: неожиданный текст «%»', v_text;
  END IF;
  IF v_md->>'offset_kind' <> 'bilateral' OR v_md->>'counterparty_deal_id' <> v_other::TEXT THEN
    RAISE EXCEPTION 'реквизиты взаимозачёта не попали в metadata: %', v_md;
  END IF;

  -- Зеркало во встречной сделке тоже подписано как взаимозачёт.
  SELECT a.content INTO v_text FROM deal_activity a
   WHERE a.deal_id = v_other AND a.type = 'payment' LIMIT 1;
  IF v_text NOT LIKE 'Взаимозачёт %' OR v_text NOT LIKE '%встречная сделка KZ/99/981%' THEN
    RAISE EXCEPTION 'зеркало: неожиданный текст «%»', v_text;
  END IF;

  -- ── Правка: суммы деньгами, вид и встречная сделка замечены ───────
  UPDATE deal_payments SET amount = -1000, offset_kind = 'trilateral',
                           counterparty_deal_id = NULL
   WHERE id = v_off;

  SELECT a.id, a.content INTO v_id, v_text FROM deal_activity a
   WHERE a.deal_id = v_deal AND a.metadata->>'row_id' = v_off::TEXT
     AND NOT (a.id = ANY(v_seen)) LIMIT 1;
  v_seen := v_seen || v_id;
  IF v_text NOT LIKE 'Изменён взаимозачёт поставщику %' THEN
    RAISE EXCEPTION 'правка: род/сущность не согласованы: «%»', v_text;
  END IF;
  IF v_text NOT LIKE '%сумма ' || MINUS || '66' || NBSP || '358' || NBSP || '495,82 → ' || MINUS || '1' || NBSP || '000,00%' THEN
    RAISE EXCEPTION 'правка: сумма не в денежном формате: «%»', v_text;
  END IF;
  IF v_text NOT LIKE '%вид 2-х сторонний → 3-х сторонний%' THEN
    RAISE EXCEPTION 'правка: смена вида не записана: «%»', v_text;
  END IF;
  IF v_text NOT LIKE '%встречная сделка KZ/99/982 → —%' THEN
    RAISE EXCEPTION 'правка: снятие встречной сделки не записано: «%»', v_text;
  END IF;

  -- ── Смена типа пишется по-русски ─────────────────────────────────
  UPDATE deal_payments SET payment_type = 'payment', offset_kind = NULL,
                           payment_date = DATE '2099-02-01'
   WHERE id = v_off;

  SELECT a.id, a.content INTO v_id, v_text FROM deal_activity a
   WHERE a.deal_id = v_deal AND a.metadata->>'row_id' = v_off::TEXT
     AND NOT (a.id = ANY(v_seen)) LIMIT 1;
  v_seen := v_seen || v_id;
  IF v_text LIKE '%offset%' OR v_text LIKE '%payment%' THEN
    RAISE EXCEPTION 'смена типа осталась по-английски: «%»', v_text;
  END IF;
  IF v_text NOT LIKE '%тип взаимозачёт → оплата%' THEN
    RAISE EXCEPTION 'смена типа: неожиданный текст «%»', v_text;
  END IF;

  -- ── Удаление называет сущность и согласовано по роду ─────────────
  UPDATE deal_payments SET payment_type = 'offset', offset_kind = 'trilateral',
                           payment_date = NULL
   WHERE id = v_off;
  SELECT a.id INTO v_id FROM deal_activity a
   WHERE a.deal_id = v_deal AND a.metadata->>'row_id' = v_off::TEXT
     AND NOT (a.id = ANY(v_seen)) LIMIT 1;
  v_seen := v_seen || v_id;

  DELETE FROM deal_payments WHERE id = v_off;
  SELECT a.id, a.content INTO v_id, v_text FROM deal_activity a
   WHERE a.deal_id = v_deal AND a.metadata->>'row_id' = v_off::TEXT
     AND NOT (a.id = ANY(v_seen)) LIMIT 1;
  v_seen := v_seen || v_id;
  IF v_text NOT LIKE 'Удалён взаимозачёт поставщику: %' THEN
    RAISE EXCEPTION 'удаление взаимозачёта: неожиданный текст «%»', v_text;
  END IF;

  DELETE FROM deal_payments WHERE id = v_pay;
  SELECT a.id, a.content INTO v_id, v_text FROM deal_activity a
   WHERE a.deal_id = v_deal AND a.metadata->>'row_id' = v_pay::TEXT
     AND NOT (a.id = ANY(v_seen)) LIMIT 1;
  v_seen := v_seen || v_id;
  IF v_text NOT LIKE 'Удалена оплата поставщику: %' THEN
    RAISE EXCEPTION 'удаление оплаты: неожиданный текст «%»', v_text;
  END IF;

  RAISE NOTICE 'OK: журнал называет взаимозачёт взаимозачётом, суммы в деньгах, встречная сделка видна';
END $$;

ROLLBACK;

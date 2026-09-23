-- Test: ВТД — номер документа по вагону и свод по сделке (00169).
--
-- Клиент 2026-09-23: «ВТД — нужно добавить сюда же в реестр отгрузки KG,
-- столбец по ВТД вставить в паспорте в раздел поставщик между столбцами
-- Взаимозачет и Баланс, добавить фильтр по ВТД». Уточнено: ВТД — номер
-- документа у отгрузки, в паспорте собирается со строк.
--
-- Здесь проверяется сам свод: паспорт и фильтр читают deals.vtd_numbers
-- и не ходят в реестр по каждой сделке.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000bb91', 'supplier', 'T-VTD Поставщик'),
  ('00000000-0000-0000-0000-00000000bb92', 'buyer',    'T-VTD Покупатель');

DO $$
DECLARE
  v_deal  UUID := gen_random_uuid();
  v_deal2 UUID := gen_random_uuid();
  v_row   UUID;
  v_row2  UUID;
  v_sum   TEXT;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal,  'KG', 9781, 2099, 'август',
          '00000000-0000-0000-0000-00000000bb91', '00000000-0000-0000-0000-00000000bb92'),
         (v_deal2, 'KG', 9782, 2099, 'август',
          '00000000-0000-0000-0000-00000000bb91', '00000000-0000-0000-0000-00000000bb92');

  -- ── 1. Пока номеров нет — свод пустой ─────────────────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_volume)
  VALUES (v_deal, 'KG', 'VTD-0001', 60)
  RETURNING id INTO v_row;

  SELECT vtd_numbers INTO v_sum FROM deals WHERE id = v_deal;
  IF v_sum IS NOT NULL THEN
    RAISE EXCEPTION '1. без номеров свод обязан быть пустым, получили %', v_sum;
  END IF;

  -- ── 2. Номер у строки попадает в свод сделки ──────────────────────
  UPDATE shipment_registry SET vtd_number = '10008/2026' WHERE id = v_row;
  SELECT vtd_numbers INTO v_sum FROM deals WHERE id = v_deal;
  IF v_sum IS DISTINCT FROM '10008/2026' THEN
    RAISE EXCEPTION '2. ожидали свод «10008/2026», получили %', v_sum;
  END IF;

  -- ── 3. Второй вагон с другим номером — оба, по алфавиту ───────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_volume, vtd_number)
  VALUES (v_deal, 'KG', 'VTD-0002', 55, '10007/2026')
  RETURNING id INTO v_row2;

  SELECT vtd_numbers INTO v_sum FROM deals WHERE id = v_deal;
  IF v_sum IS DISTINCT FROM '10007/2026, 10008/2026' THEN
    RAISE EXCEPTION '3. ожидали два номера по алфавиту, получили %', v_sum;
  END IF;

  -- ── 4. Одинаковые номера не дублируются ───────────────────────────
  UPDATE shipment_registry SET vtd_number = '10008/2026' WHERE id = v_row2;
  SELECT vtd_numbers INTO v_sum FROM deals WHERE id = v_deal;
  IF v_sum IS DISTINCT FROM '10008/2026' THEN
    RAISE EXCEPTION '4. одинаковые номера должны схлопнуться, получили %', v_sum;
  END IF;

  -- ── 5. Пробелы и пустые строки в свод не идут ─────────────────────
  UPDATE shipment_registry SET vtd_number = '   ' WHERE id = v_row2;
  SELECT vtd_numbers INTO v_sum FROM deals WHERE id = v_deal;
  IF v_sum IS DISTINCT FROM '10008/2026' THEN
    RAISE EXCEPTION '5. пустой номер не должен попадать в свод, получили %', v_sum;
  END IF;

  -- ── 6. Перенос строки в другую сделку двигает оба свода ───────────
  UPDATE shipment_registry SET vtd_number = '20001/2026' WHERE id = v_row2;
  UPDATE shipment_registry SET deal_id = v_deal2 WHERE id = v_row2;

  SELECT vtd_numbers INTO v_sum FROM deals WHERE id = v_deal;
  IF v_sum IS DISTINCT FROM '10008/2026' THEN
    RAISE EXCEPTION '6. у исходной сделки должен остаться свой номер, получили %', v_sum;
  END IF;
  SELECT vtd_numbers INTO v_sum FROM deals WHERE id = v_deal2;
  IF v_sum IS DISTINCT FROM '20001/2026' THEN
    RAISE EXCEPTION '6. у новой сделки должен появиться номер, получили %', v_sum;
  END IF;

  -- ── 7. Удаление строки убирает номер из свода ─────────────────────
  DELETE FROM shipment_registry WHERE id = v_row;
  SELECT vtd_numbers INTO v_sum FROM deals WHERE id = v_deal;
  IF v_sum IS NOT NULL THEN
    RAISE EXCEPTION '7. после удаления строки свод обязан опустеть, получили %', v_sum;
  END IF;

  RAISE NOTICE 'OK: ВТД пишется по вагону, свод сделки следует за строками';
END $$;

ROLLBACK;

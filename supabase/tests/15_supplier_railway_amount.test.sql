-- Test: «Сумма 2» — ЖД расходы от поставщика (миграция 00150).
--
-- Клиент 2026-08-15: «Сумма 2 (сумма ЖД расходов от поставщика) =
-- тариф * объем входящего снт - обязательно обратная формула - тариф
-- Жд расходов от поставщика = сумма Жд расходов от поставщика / объем
-- входящего снт».
--
-- Проверяем: обе стороны формулы, реакцию на изменение объёма,
-- округление, роллап на сделку (включая перенос строки в другую
-- сделку) и главное — что баланс поставщика от новой суммы не зависит.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-0000000009a1', 'supplier', 'T-SRW Поставщик'),
  ('00000000-0000-0000-0000-0000000009a2', 'buyer',    'T-SRW Покупатель');

DO $$
DECLARE
  v_deal_a UUID := gen_random_uuid();
  v_deal_b UUID := gen_random_uuid();
  v_row    UUID;
  v_amt    NUMERIC;
  v_tar    NUMERIC;
  v_bal_before NUMERIC;
  v_bal_after  NUMERIC;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_deal_a, 'KZ', 9950, 2099, 'июнь',
          '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009a2'),
         (v_deal_b, 'KZ', 9951, 2099, 'июнь',
          '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009a2');

  -- ── 1. Прямая формула: тариф × округл(входящее СНТ) ────────────────
  -- round_volume по умолчанию TRUE, поэтому 60.4 → 61.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, shipment_volume,
                                 supplier_railway_tariff)
  VALUES (v_deal_a, 'KZ', 'SRW-0001', 60.4, 59.0, 10.00)
  RETURNING id INTO v_row;

  SELECT supplier_railway_amount INTO v_amt FROM shipment_registry WHERE id = v_row;
  IF v_amt IS DISTINCT FROM 610.00 THEN
    RAISE EXCEPTION '1. ожидали сумму 610.00 (61 × 10), получили %', v_amt;
  END IF;

  -- База — именно ВХОДЯЩЕЕ СНТ: с исходящего 59 сумма была бы 590.
  IF v_amt = 590.00 THEN
    RAISE EXCEPTION '1. сумма посчитана от исходящего СНТ, а должна от входящего';
  END IF;

  -- ── 2. Обратная формула: правим сумму — пересчитывается тариф ──────
  UPDATE shipment_registry SET supplier_railway_amount = 1220.00 WHERE id = v_row;

  SELECT supplier_railway_tariff, supplier_railway_amount
    INTO v_tar, v_amt FROM shipment_registry WHERE id = v_row;
  IF v_tar IS DISTINCT FROM 20.00 THEN
    RAISE EXCEPTION '2. ожидали тариф 20.00 (1220 ÷ 61), получили %', v_tar;
  END IF;
  IF v_amt IS DISTINCT FROM 1220.00 THEN
    RAISE EXCEPTION '2. введённая вручную сумма должна остаться 1220.00, получили %', v_amt;
  END IF;

  -- ── 3. Посторонняя правка строки сумму не сбрасывает ───────────────
  -- Ради этого у Суммы 2 и нет флага override: обратная формула уже
  -- привела тариф и сумму к согласию, замораживать нечего.
  UPDATE shipment_registry SET comment = 'правка не про деньги' WHERE id = v_row;

  SELECT supplier_railway_amount INTO v_amt FROM shipment_registry WHERE id = v_row;
  IF v_amt IS DISTINCT FROM 1220.00 THEN
    RAISE EXCEPTION '3. посторонняя правка сбросила сумму до %', v_amt;
  END IF;

  -- ── 4. Изменился объём — сумма идёт за тарифом ─────────────────────
  UPDATE shipment_registry SET loading_volume = 30.0 WHERE id = v_row;

  SELECT supplier_railway_tariff, supplier_railway_amount
    INTO v_tar, v_amt FROM shipment_registry WHERE id = v_row;
  IF v_tar IS DISTINCT FROM 20.00 THEN
    RAISE EXCEPTION '4. тариф должен был остаться 20.00, получили %', v_tar;
  END IF;
  IF v_amt IS DISTINCT FROM 600.00 THEN
    RAISE EXCEPTION '4. ожидали сумму 600.00 (30 × 20), получили %', v_amt;
  END IF;

  -- ── 5. Стёрли тариф — сумма пустая, а не нулевая ───────────────────
  UPDATE shipment_registry SET supplier_railway_tariff = NULL WHERE id = v_row;

  SELECT supplier_railway_amount INTO v_amt FROM shipment_registry WHERE id = v_row;
  IF v_amt IS NOT NULL THEN
    RAISE EXCEPTION '5. без тарифа сумма должна быть пустой, получили %', v_amt;
  END IF;

  -- ── 6. Ввод суммы при пустом входящем СНТ ──────────────────────────
  -- Тариф вывести не из чего. Введённое человеком число обязано
  -- сохраниться — затирать его нельзя.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 shipment_volume, supplier_railway_amount)
  VALUES (v_deal_a, 'KZ', 'SRW-0002', 50.0, 777.00);

  SELECT supplier_railway_amount, supplier_railway_tariff
    INTO v_amt, v_tar FROM shipment_registry WHERE wagon_number = 'SRW-0002';
  IF v_amt IS DISTINCT FROM 777.00 THEN
    RAISE EXCEPTION '6. сумма без входящего СНТ должна сохраниться, получили %', v_amt;
  END IF;
  IF v_tar IS NOT NULL THEN
    RAISE EXCEPTION '6. тариф без базы должен остаться пустым, получили %', v_tar;
  END IF;

  -- ── 7. Роллап на сделку ────────────────────────────────────────────
  UPDATE shipment_registry SET supplier_railway_tariff = 10.00 WHERE id = v_row;
  -- Строка 1: 30 × 10 = 300. Строка 2: 777 вручную. Итого 1077.
  SELECT supplier_railway_amount INTO v_amt FROM deals WHERE id = v_deal_a;
  IF v_amt IS DISTINCT FROM 1077.00 THEN
    RAISE EXCEPTION '7. ожидали роллап 1077.00, получили %', v_amt;
  END IF;

  -- ── 8. Перенос строки в другую сделку пересчитывает обе ────────────
  UPDATE shipment_registry SET deal_id = v_deal_b WHERE id = v_row;

  SELECT supplier_railway_amount INTO v_amt FROM deals WHERE id = v_deal_a;
  IF v_amt IS DISTINCT FROM 777.00 THEN
    RAISE EXCEPTION '8. у старой сделки должно остаться 777.00, получили %', v_amt;
  END IF;
  SELECT supplier_railway_amount INTO v_amt FROM deals WHERE id = v_deal_b;
  IF v_amt IS DISTINCT FROM 300.00 THEN
    RAISE EXCEPTION '8. новая сделка должна получить 300.00, получили %', v_amt;
  END IF;

  -- ── 9. Удаление строки ─────────────────────────────────────────────
  DELETE FROM shipment_registry WHERE id = v_row;
  SELECT supplier_railway_amount INTO v_amt FROM deals WHERE id = v_deal_b;
  IF v_amt IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '9. после удаления строки ожидали 0, получили %', v_amt;
  END IF;

  -- ── 10. Баланс поставщика от Суммы 2 не зависит ────────────────────
  -- Ключевой инвариант: клиент просил показать эту сумму, а не
  -- включить её в расчёты. Галочки «в цене» у неё нет.
  SELECT supplier_balance INTO v_bal_before FROM deals WHERE id = v_deal_a;

  UPDATE shipment_registry
     SET supplier_railway_amount = 999999.00
   WHERE wagon_number = 'SRW-0002';

  SELECT supplier_balance INTO v_bal_after FROM deals WHERE id = v_deal_a;
  IF v_bal_before IS DISTINCT FROM v_bal_after THEN
    RAISE EXCEPTION '10. баланс поставщика поехал с % на % из-за Суммы 2',
      v_bal_before, v_bal_after;
  END IF;

  -- ── 11. Суммы 1 и 3 живут своей жизнью ─────────────────────────────
  -- Правка Суммы 2 не должна задевать соседей по строке.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, railway_tariff, manager_tariff)
  VALUES (v_deal_a, 'KZ', 'SRW-0003', 40.0, 5.00, 3.00);

  UPDATE shipment_registry SET supplier_railway_tariff = 7.00
   WHERE wagon_number = 'SRW-0003';

  SELECT shipped_tonnage_amount INTO v_amt FROM shipment_registry WHERE wagon_number = 'SRW-0003';
  IF v_amt IS DISTINCT FROM 200.00 THEN
    RAISE EXCEPTION '11. Сумма 1 должна остаться 200.00 (40 × 5), получили %', v_amt;
  END IF;
  SELECT additional_expenses INTO v_amt FROM shipment_registry WHERE wagon_number = 'SRW-0003';
  IF v_amt IS DISTINCT FROM 120.00 THEN
    RAISE EXCEPTION '11. Сумма 3 должна остаться 120.00 (40 × 3), получили %', v_amt;
  END IF;
  SELECT supplier_railway_amount INTO v_amt FROM shipment_registry WHERE wagon_number = 'SRW-0003';
  IF v_amt IS DISTINCT FROM 280.00 THEN
    RAISE EXCEPTION '11. Сумма 2 должна быть 280.00 (40 × 7), получили %', v_amt;
  END IF;

  RAISE NOTICE 'OK: Сумма 2 считается в обе стороны, роллап сходится, баланс не тронут';
END $$;

ROLLBACK;

-- Test: «Сумма 3» — обратная формула суммы грузоотправления (00151).
--
-- Клиент 2026-08-15: «Сумма 3 - сумма грузоотправления = тариф
-- грузоотправления * объем входящего снт - обратная формула - тариф
-- груоотправления = сумма грузоотправления / объем входящего снт».
--
-- Главное, что здесь проверяется помимо самой формулы: база НЕ
-- изменилась. У KZ это входящее СНТ, у KG — исходящее; переписать её
-- «как в ТЗ» означало бы обнулить Сумму 3 во всех KG-строках.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000ba01', 'supplier', 'T-EXP Поставщик'),
  ('00000000-0000-0000-0000-00000000ba02', 'buyer',    'T-EXP Покупатель');

DO $$
DECLARE
  v_kz  UUID := gen_random_uuid();
  v_kg  UUID := gen_random_uuid();
  v_row UUID;
  v_amt NUMERIC;
  v_tar NUMERIC;
  v_ovr BOOLEAN;
  v_s1  NUMERIC;
  v_s2  NUMERIC;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_kz, 'KZ', 9960, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000ba01', '00000000-0000-0000-0000-00000000ba02'),
         (v_kg, 'KG', 9961, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000ba01', '00000000-0000-0000-0000-00000000ba02');

  -- ── 1. Прямая формула не изменилась ────────────────────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, shipment_volume, manager_tariff)
  VALUES (v_kz, 'KZ', 'EXP-0001', 60.4, 59.0, 3.00)
  RETURNING id INTO v_row;

  SELECT additional_expenses INTO v_amt FROM shipment_registry WHERE id = v_row;
  IF v_amt IS DISTINCT FROM 183.00 THEN
    RAISE EXCEPTION '1. ожидали 183.00 (61 × 3), получили %', v_amt;
  END IF;

  -- ── 2. Обратная формула: правим сумму — пересчитывается тариф ──────
  UPDATE shipment_registry SET additional_expenses = 610.00 WHERE id = v_row;

  SELECT manager_tariff, additional_expenses, additional_expenses_override
    INTO v_tar, v_amt, v_ovr FROM shipment_registry WHERE id = v_row;
  IF v_tar IS DISTINCT FROM 10.00 THEN
    RAISE EXCEPTION '2. ожидали тариф 10.00 (610 ÷ 61), получили %', v_tar;
  END IF;
  IF v_amt IS DISTINCT FROM 610.00 THEN
    RAISE EXCEPTION '2. введённая сумма должна остаться 610.00, получили %', v_amt;
  END IF;
  IF v_ovr THEN
    RAISE EXCEPTION '2. флаг override должен сняться — тариф теперь соответствует сумме';
  END IF;

  -- ── 3. Посторонняя правка сумму не сбрасывает ──────────────────────
  UPDATE shipment_registry SET comment = 'правка не про деньги' WHERE id = v_row;
  SELECT additional_expenses INTO v_amt FROM shipment_registry WHERE id = v_row;
  IF v_amt IS DISTINCT FROM 610.00 THEN
    RAISE EXCEPTION '3. посторонняя правка сбросила сумму до %', v_amt;
  END IF;

  -- ── 4. Изменился объём — сумма идёт за тарифом ─────────────────────
  UPDATE shipment_registry SET loading_volume = 30.0 WHERE id = v_row;
  SELECT manager_tariff, additional_expenses INTO v_tar, v_amt
    FROM shipment_registry WHERE id = v_row;
  IF v_tar IS DISTINCT FROM 10.00 THEN
    RAISE EXCEPTION '4. тариф должен был остаться 10.00, получили %', v_tar;
  END IF;
  IF v_amt IS DISTINCT FROM 300.00 THEN
    RAISE EXCEPTION '4. ожидали 300.00 (30 × 10), получили %', v_amt;
  END IF;

  -- ── 5. Стёрли сумму — гаснет и тариф ───────────────────────────────
  UPDATE shipment_registry SET additional_expenses = NULL WHERE id = v_row;
  SELECT manager_tariff, additional_expenses INTO v_tar, v_amt
    FROM shipment_registry WHERE id = v_row;
  IF v_tar IS NOT NULL OR v_amt IS NOT NULL THEN
    RAISE EXCEPTION '5. после очистки суммы ожидали пустые тариф и сумму, получили % / %', v_tar, v_amt;
  END IF;

  -- ── 6. Сумма без базы остаётся ручной ──────────────────────────────
  -- Клиент 2026-07-14: «сумму грузоотправителя нужно вносить и БЕЗ
  -- тарифа». Тариф вывести не из чего — флаг защищает ввод.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, additional_expenses)
  VALUES (v_kz, 'KZ', 'EXP-0002', 777.00);

  SELECT additional_expenses, manager_tariff, additional_expenses_override
    INTO v_amt, v_tar, v_ovr FROM shipment_registry WHERE wagon_number = 'EXP-0002';
  IF v_amt IS DISTINCT FROM 777.00 THEN
    RAISE EXCEPTION '6. сумма без базы должна сохраниться, получили %', v_amt;
  END IF;
  IF v_tar IS NOT NULL THEN
    RAISE EXCEPTION '6. тариф без базы должен остаться пустым, получили %', v_tar;
  END IF;
  IF NOT v_ovr THEN
    RAISE EXCEPTION '6. без базы флаг обязан взвестись — иначе сумму сотрёт следующая правка';
  END IF;

  UPDATE shipment_registry SET comment = 'ещё правка' WHERE wagon_number = 'EXP-0002';
  SELECT additional_expenses INTO v_amt FROM shipment_registry WHERE wagon_number = 'EXP-0002';
  IF v_amt IS DISTINCT FROM 777.00 THEN
    RAISE EXCEPTION '6. ручная сумма без базы не пережила правку строки: %', v_amt;
  END IF;

  -- ── 7. База KG не изменилась: исходящее СНТ ────────────────────────
  -- Если бы базу переписали на loading_volume «как в ТЗ», здесь была
  -- бы пустота вместо 150.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 shipment_volume, manager_tariff)
  VALUES (v_kg, 'KG', 'EXP-0003', 49.5, 3.00);

  SELECT additional_expenses INTO v_amt FROM shipment_registry WHERE wagon_number = 'EXP-0003';
  IF v_amt IS DISTINCT FROM 150.00 THEN
    RAISE EXCEPTION '7. в KG ожидали 150.00 (50 × 3) от ИСХОДЯЩЕГО СНТ, получили %', v_amt;
  END IF;

  -- ── 8. Соседние суммы не задеты ────────────────────────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, railway_tariff,
                                 supplier_railway_tariff)
  VALUES (v_kz, 'KZ', 'EXP-0004', 40.0, 5.00, 7.00);

  UPDATE shipment_registry SET additional_expenses = 400.00
   WHERE wagon_number = 'EXP-0004';

  SELECT shipped_tonnage_amount, supplier_railway_amount, manager_tariff
    INTO v_s1, v_s2, v_tar FROM shipment_registry WHERE wagon_number = 'EXP-0004';
  IF v_s1 IS DISTINCT FROM 200.00 THEN
    RAISE EXCEPTION '8. Сумма 1 должна остаться 200.00, получили %', v_s1;
  END IF;
  IF v_s2 IS DISTINCT FROM 280.00 THEN
    RAISE EXCEPTION '8. Сумма 2 должна остаться 280.00, получили %', v_s2;
  END IF;
  IF v_tar IS DISTINCT FROM 10.00 THEN
    RAISE EXCEPTION '8. тариф грузоотправления ожидали 10.00 (400 ÷ 40), получили %', v_tar;
  END IF;

  -- ── 9. Роллап на сделку сходится ───────────────────────────────────
  -- EXP-0001 пустая, EXP-0002 = 777, EXP-0004 = 400. Итого 1177.
  SELECT additional_expenses_amount INTO v_amt FROM deals WHERE id = v_kz;
  IF v_amt IS DISTINCT FROM 1177.00 THEN
    RAISE EXCEPTION '9. ожидали роллап 1177.00, получили %', v_amt;
  END IF;

  RAISE NOTICE 'OK: Сумма 3 считается в обе стороны, база не изменилась, соседи не тронуты';
END $$;

ROLLBACK;

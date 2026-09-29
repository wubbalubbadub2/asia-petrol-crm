-- Test: пометка «ручная сумма» без суммы не отключает формулу (00178).
--
-- Клиент 2026-09-29: «формулы грузоотправления и ЖД часто вылетают».
-- На проде 134 строки с shipped_tonnage_amount_override = TRUE и пустой
-- суммой — формула «тариф × объём» в них не работала никогда.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000ac01', 'supplier', 'T-MFLAG Поставщик'),
  ('00000000-0000-0000-0000-00000000ac02', 'buyer',    'T-MFLAG Покупатель');

DO $$
DECLARE
  v_deal UUID := gen_random_uuid();
  v_a    UUID;
  v_b    UUID;
  v_c    UUID;
  r      RECORD;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id,
                     supplier_currency, logistics_currency, railway_in_price)
  VALUES (v_deal, 'KZ', 9978, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000ac02',
          'KZT', 'KZT', TRUE);

  -- А. «Ручная» без суммы, тариф и объём есть (как KZ/26/108).
  --    Тариф закреплён вручную, чтобы справочник Тарифы его не стёр (00167).
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, loading_volume, loading_date,
                                 railway_tariff, railway_tariff_override,
                                 shipped_tonnage_amount, shipped_tonnage_amount_override, round_volume)
  VALUES (v_deal, 'KZ', 'MF-A', 228.35, DATE '2099-06-01', 16810.03, TRUE, NULL, TRUE, FALSE)
  RETURNING id INTO v_a;
  SELECT shipped_tonnage_amount, shipped_tonnage_amount_override INTO r FROM shipment_registry WHERE id = v_a;
  IF r.shipped_tonnage_amount IS DISTINCT FROM 228.35 * 16810.03 OR r.shipped_tonnage_amount_override THEN
    RAISE EXCEPTION 'А: сумма % (ждали %), пометка %', r.shipped_tonnage_amount, 228.35 * 16810.03, r.shipped_tonnage_amount_override;
  END IF;

  -- Б. Настоящая ручная сумма — не трогаем, пометка остаётся.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, loading_volume, loading_date,
                                 railway_tariff, railway_tariff_override,
                                 shipped_tonnage_amount, shipped_tonnage_amount_override, round_volume)
  VALUES (v_deal, 'KZ', 'MF-B', 100, DATE '2099-06-02', 1000, TRUE, 12345.67, TRUE, FALSE)
  RETURNING id INTO v_b;
  UPDATE shipment_registry SET comment = 'правка' WHERE id = v_b;
  SELECT shipped_tonnage_amount, shipped_tonnage_amount_override INTO r FROM shipment_registry WHERE id = v_b;
  IF r.shipped_tonnage_amount IS DISTINCT FROM 12345.67 OR NOT r.shipped_tonnage_amount_override THEN
    RAISE EXCEPTION 'Б: ручная сумма изменилась: % / %', r.shipped_tonnage_amount, r.shipped_tonnage_amount_override;
  END IF;

  -- В. Экран очищает ячейку старым способом (сумма NULL, пометка TRUE) —
  --    формула возвращается.
  UPDATE shipment_registry SET shipped_tonnage_amount = NULL, shipped_tonnage_amount_override = TRUE WHERE id = v_b;
  SELECT shipped_tonnage_amount, shipped_tonnage_amount_override INTO r FROM shipment_registry WHERE id = v_b;
  IF r.shipped_tonnage_amount IS DISTINCT FROM 100 * 1000::NUMERIC OR r.shipped_tonnage_amount_override THEN
    RAISE EXCEPTION 'В: после очистки сумма %, пометка %', r.shipped_tonnage_amount, r.shipped_tonnage_amount_override;
  END IF;

  -- Г. Без тарифа «ручная» без суммы просто снимается, сумма пустая.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, loading_volume, loading_date,
                                 shipped_tonnage_amount, shipped_tonnage_amount_override)
  VALUES (v_deal, 'KZ', 'MF-C', 50, DATE '2099-06-03', NULL, TRUE)
  RETURNING id INTO v_c;
  SELECT shipped_tonnage_amount, shipped_tonnage_amount_override INTO r FROM shipment_registry WHERE id = v_c;
  IF r.shipped_tonnage_amount IS NOT NULL OR r.shipped_tonnage_amount_override THEN
    RAISE EXCEPTION 'Г: без тарифа сумма %, пометка %', r.shipped_tonnage_amount, r.shipped_tonnage_amount_override;
  END IF;

  -- Роллап и баланс: «ЖД в цене» стоит — Сумма 1 обеих строк в балансе.
  SELECT invoice_amount, supplier_balance INTO r FROM deals WHERE id = v_deal;
  IF r.invoice_amount IS DISTINCT FROM ROUND(228.35 * 16810.03 + 100000, 4) THEN
    RAISE EXCEPTION 'роллап Суммы 1: %, ждали %', r.invoice_amount, ROUND(228.35 * 16810.03 + 100000, 4);
  END IF;
  IF r.supplier_balance IS DISTINCT FROM r.invoice_amount THEN
    RAISE EXCEPTION 'баланс % не включил Сумму 1 %', r.supplier_balance, r.invoice_amount;
  END IF;

  -- Д. Введённая руками сумма грузоотправления (тариф выведен из неё) не
  --    «плывёт» от посторонней правки строки. До 00178 любое UPDATE
  --    пересчитывало её как база × тариф(4 знака) — копеечный дрейф.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, loading_volume, loading_date, round_volume)
  VALUES (v_deal, 'KZ', 'MF-D', 116.9, DATE '2099-06-04', FALSE)
  RETURNING id INTO v_c;
  UPDATE shipment_registry SET additional_expenses = 1497856.05 WHERE id = v_c;   -- ввели сумму
  SELECT additional_expenses, manager_tariff INTO r FROM shipment_registry WHERE id = v_c;
  IF r.additional_expenses IS DISTINCT FROM 1497856.05 OR r.manager_tariff IS NULL THEN
    RAISE EXCEPTION 'Д: ввод суммы 3: % / тариф %', r.additional_expenses, r.manager_tariff;
  END IF;
  UPDATE shipment_registry SET comment = 'посторонняя правка', date = DATE '2099-06-05' WHERE id = v_c;
  SELECT additional_expenses INTO r FROM shipment_registry WHERE id = v_c;
  IF r.additional_expenses IS DISTINCT FROM 1497856.05 THEN
    RAISE EXCEPTION 'Д: сумма грузоотправления уплыла после посторонней правки: %', r.additional_expenses;
  END IF;
  -- Смена тарифа — пересчёт по формуле, как и раньше.
  UPDATE shipment_registry SET manager_tariff = 10000 WHERE id = v_c;
  SELECT additional_expenses INTO r FROM shipment_registry WHERE id = v_c;
  IF r.additional_expenses IS DISTINCT FROM 116.9 * 10000::NUMERIC THEN
    RAISE EXCEPTION 'Д: после смены тарифа сумма %, ждали %', r.additional_expenses, 116.9 * 10000;
  END IF;

  -- Е. То же для Суммы 2 (ЖД поставщика, обратная формула 00150).
  UPDATE shipment_registry SET supplier_railway_amount = 2797951.17 WHERE id = v_c;
  UPDATE shipment_registry SET comment = 'ещё правка' WHERE id = v_c;
  SELECT supplier_railway_amount INTO r FROM shipment_registry WHERE id = v_c;
  IF r.supplier_railway_amount IS DISTINCT FROM 2797951.17 THEN
    RAISE EXCEPTION 'Е: Сумма 2 уплыла после посторонней правки: %', r.supplier_railway_amount;
  END IF;

  RAISE NOTICE 'OK: пометка «ручная» без суммы не отключает формулу, настоящая ручная сумма цела, введённые суммы 2 и 3 не плывут';
END $$;

ROLLBACK;

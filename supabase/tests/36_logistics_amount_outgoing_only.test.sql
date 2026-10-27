-- Test: «округл» и Сумма 1 (логисты) — только от исходящего СНТ (00182).
--
-- Клиент через владельца 2026-10-27: «округл» и «Сумма» считаются ТОЛЬКО
-- от исходящего СНТ (shipment_volume). Входящее (loading_volume) — для
-- сравнения (естественная убыль: налили 960, слили 957) и отчётов
-- себестоимости. Строка только со входящим СНТ экспедитора не получает.
-- Отменяет 00165 (база = входящее, иначе исходящее). KG и KZ одинаково.
--
-- Не меняется: Сумма 3 (грузоотправитель) — база прежняя, входящее, если
-- есть; Сумма 2 — только входящее; ручные «округл», сумма и тариф.
--
-- Тариф 99,61 USD/т — числа из брифа владельца.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000c801', 'supplier', 'T-OUT Поставщик'),
  ('00000000-0000-0000-0000-00000000c802', 'buyer',    'T-OUT Покупатель');
INSERT INTO forwarders (id, name) VALUES
  ('00000000-0000-0000-0000-00000000c803', 'T-OUT Экспедитор'),
  ('00000000-0000-0000-0000-00000000c804', 'T-OUT Экспедитор 2');

DO $$
DECLARE
  v_fw   UUID := '00000000-0000-0000-0000-00000000c803';
  v_fw2  UUID := '00000000-0000-0000-0000-00000000c804';
  v_kg   UUID := gen_random_uuid();
  v_kz   UUID := gen_random_uuid();
  v_in   UUID;
  v_wag  UUID;
  v_both UUID;
  v_man  UUID;
  v_rnd  UUID;
  r      RECORD;
  d      RECORD;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id,
                     forwarder_id, logistics_currency)
  VALUES (v_kg, 'KG', 9982, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000c801', '00000000-0000-0000-0000-00000000c802', v_fw, 'USD'),
         (v_kz, 'KZ', 9983, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000c801', '00000000-0000-0000-0000-00000000c802', v_fw, 'USD');

  -- ── 1. Только входящее 419,391 т (как KG/26/652) ───────────────────
  --    «округл»/Сумма 1 пустые (было 420 / 41 836,20), тариф остаётся,
  --    экспедитор не ставится — даже если форма его прислала.
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, loading_volume,
                                 railway_tariff, railway_tariff_override, forwarder_id)
  VALUES (v_kg, 'KG', NULL, 419.391, 99.61, TRUE, v_fw)
  RETURNING id INTO v_in;
  SELECT * INTO r FROM shipment_registry WHERE id = v_in;
  IF r.shipped_tonnage_amount IS NOT NULL THEN
    RAISE EXCEPTION '1. только входящее: Сумма 1 должна быть пустой, получили %', r.shipped_tonnage_amount;
  END IF;
  IF r.railway_tariff IS DISTINCT FROM 99.61 THEN
    RAISE EXCEPTION '1. тариф должен остаться 99,61, получили %', r.railway_tariff;
  END IF;
  IF r.forwarder_id IS NOT NULL THEN
    RAISE EXCEPTION '1. строка только со входящим не получает экспедитора, получили %', r.forwarder_id;
  END IF;

  -- ── 2. Вагон, исходящее 60,047 → 61 × 99,61 = 6 076,21 ─────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, shipment_volume,
                                 railway_tariff, railway_tariff_override, forwarder_id)
  VALUES (v_kg, 'KG', 'OUT-0002', 60.047, 99.61, TRUE, v_fw)
  RETURNING id INTO v_wag;
  SELECT * INTO r FROM shipment_registry WHERE id = v_wag;
  IF r.shipped_tonnage_amount IS DISTINCT FROM 6076.21 THEN
    RAISE EXCEPTION '2. исходящее 60,047: ожидали 6 076,21, получили %', r.shipped_tonnage_amount;
  END IF;
  IF r.forwarder_id IS DISTINCT FROM v_fw THEN
    RAISE EXCEPTION '2. у вагона с исходящим экспедитор остаётся, получили %', r.forwarder_id;
  END IF;

  -- ── 3. Входящее 960, исходящее 957,4 → округл 958, 95 426,38 ───────
  --    Сумма 2 — по входящему 960; Сумма 3 — прежнее правило (входящее).
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, shipment_volume,
                                 railway_tariff, railway_tariff_override,
                                 manager_tariff, supplier_railway_tariff)
  VALUES (v_kz, 'KZ', 'OUT-0003', 960, 957.4, 99.61, TRUE, 3.00, 2.00)
  RETURNING id INTO v_both;
  SELECT * INTO r FROM shipment_registry WHERE id = v_both;
  IF r.shipped_tonnage_amount IS DISTINCT FROM 95426.38 THEN
    RAISE EXCEPTION '3. 960 / 957,4: Сумма 1 ожидали 95 426,38 (958 × 99,61), получили %', r.shipped_tonnage_amount;
  END IF;
  IF r.supplier_railway_amount IS DISTINCT FROM 1920.00 THEN
    RAISE EXCEPTION '3. Сумма 2 по входящему: ожидали 1 920 (960 × 2), получили %', r.supplier_railway_amount;
  END IF;
  IF r.additional_expenses IS DISTINCT FROM 2880.00 THEN
    RAISE EXCEPTION '3. Сумма 3 по прежнему правилу: ожидали 2 880 (960 × 3), получили %', r.additional_expenses;
  END IF;

  --    Тариф факт (логисты) у KZ-сделки — Сумма 1 ÷ исходящее (решение
  --    00182; раньше KZ делил на входящее). Колонка — 4 знака.
  SELECT * INTO d FROM deals WHERE id = v_kz;
  IF d.actual_tariff IS DISTINCT FROM ROUND(d.invoice_amount / d.actual_shipped_volume, 4) THEN
    RAISE EXCEPTION '3. KZ тариф факт = Сумма ÷ исходящее (% ÷ %), получили %',
      d.invoice_amount, d.actual_shipped_volume, d.actual_tariff;
  END IF;
  --    Тариф факт грузоотправителя — по входящему, как раньше.
  IF d.shipper_actual_tariff IS DISTINCT FROM ROUND(d.additional_expenses_amount / d.supplier_shipped_volume, 4) THEN
    RAISE EXCEPTION '3. тариф факт грузоотпр. должен остаться на входящем, получили %', d.shipper_actual_tariff;
  END IF;

  -- ── 4. Строке со входящим пришло исходящее 59,969 → 60 × 99,61 ─────
  --    = 5 976,60, экспедитор — из сделки.
  UPDATE shipment_registry SET shipment_volume = 59.969, wagon_number = 'OUT-0004' WHERE id = v_in;
  SELECT * INTO r FROM shipment_registry WHERE id = v_in;
  IF r.shipped_tonnage_amount IS DISTINCT FROM 5976.60 THEN
    RAISE EXCEPTION '4. пришло исходящее 59,969: ожидали 5 976,60, получили %', r.shipped_tonnage_amount;
  END IF;
  IF r.forwarder_id IS DISTINCT FROM v_fw THEN
    RAISE EXCEPTION '4. экспедитор должен встать из сделки, получили %', r.forwarder_id;
  END IF;

  --    Обратный ход: исходящее стёрли — сумма пустая, экспедитор НЕ
  --    стирается (владелец: «ничего не стираем»).
  UPDATE shipment_registry SET shipment_volume = NULL WHERE id = v_in;
  SELECT * INTO r FROM shipment_registry WHERE id = v_in;
  IF r.shipped_tonnage_amount IS NOT NULL THEN
    RAISE EXCEPTION '4. исходящее стёрли: Сумма 1 должна опустеть, получили %', r.shipped_tonnage_amount;
  END IF;
  IF r.forwarder_id IS DISTINCT FROM v_fw THEN
    RAISE EXCEPTION '4. экспедитор на строке не стирается, получили %', r.forwarder_id;
  END IF;

  -- ── 5. Итог сделки = Σ сумм строк с исходящим ──────────────────────
  SELECT * INTO d FROM deals WHERE id = v_kg;
  IF d.invoice_amount IS DISTINCT FROM 6076.21 THEN
    RAISE EXCEPTION '5. invoice_amount KG: ожидали 6 076,21 (только вагон), получили %', d.invoice_amount;
  END IF;

  -- ── 6. Ручные значения на строке только со входящим не трогаем ─────
  INSERT INTO shipment_registry (deal_id, registry_type, loading_volume,
                                 railway_tariff, railway_tariff_override,
                                 shipped_tonnage_amount, shipped_tonnage_amount_override)
  VALUES (v_kg, 'KG', 100.5, 99.61, TRUE, 12345.67, TRUE)
  RETURNING id INTO v_man;
  UPDATE shipment_registry SET comment = 'правка' WHERE id = v_man;
  SELECT * INTO r FROM shipment_registry WHERE id = v_man;
  IF r.shipped_tonnage_amount IS DISTINCT FROM 12345.67 OR NOT r.shipped_tonnage_amount_override THEN
    RAISE EXCEPTION '6. ручная сумма изменилась: % / %', r.shipped_tonnage_amount, r.shipped_tonnage_amount_override;
  END IF;

  INSERT INTO shipment_registry (deal_id, registry_type, loading_volume,
                                 railway_tariff, railway_tariff_override, rounded_volume_override)
  VALUES (v_kg, 'KG', 100.5, 99.61, TRUE, 100)
  RETURNING id INTO v_rnd;
  UPDATE shipment_registry SET comment = 'правка' WHERE id = v_rnd;
  SELECT * INTO r FROM shipment_registry WHERE id = v_rnd;
  IF r.shipped_tonnage_amount IS DISTINCT FROM 9961.00 THEN
    RAISE EXCEPTION '6. ручной округл 100 × 99,61: ожидали 9 961, получили %', r.shipped_tonnage_amount;
  END IF;

  -- ── 7. Смена экспедитора сделки не ставит его строкам без исходящего ─
  UPDATE shipment_registry SET forwarder_id = NULL WHERE id = v_man;
  UPDATE deals SET forwarder_id = v_fw2 WHERE id = v_kg;
  SELECT forwarder_id INTO r FROM shipment_registry WHERE id = v_man;
  IF r.forwarder_id IS NOT NULL THEN
    RAISE EXCEPTION '7. строке только со входящим экспедитор сделки не ставится, получили %', r.forwarder_id;
  END IF;
  SELECT forwarder_id INTO r FROM shipment_registry WHERE id = v_wag;
  IF r.forwarder_id IS DISTINCT FROM v_fw2 THEN
    RAISE EXCEPTION '7. вагону с исходящим экспедитор сделки ставится, получили %', r.forwarder_id;
  END IF;
  --    Строка, которой экспедитор поставили раньше (строка 1, исходящее
  --    у неё стёрто), его не теряет и чужого не получает.
  SELECT forwarder_id INTO r FROM shipment_registry WHERE id = v_in;
  IF r.forwarder_id IS DISTINCT FROM v_fw THEN
    RAISE EXCEPTION '7. экспедитор строки без исходящего не меняется, получили %', r.forwarder_id;
  END IF;

  RAISE NOTICE 'ok: «округл» и Сумма 1 — только от исходящего СНТ';
END $$;

ROLLBACK;

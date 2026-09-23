-- Test: база сумм 1 и 3 в реестре — входящее СНТ, если оно есть,
-- иначе исходящее (00165).
--
-- Клиент 2026-09-22: «в реестре для расчёта суммы мы используем тариф
-- (логисты) × округлённая сумма исходящего СНТ. А должно быть так: если
-- есть входящее СНТ, то нужно умножать тариф на округл. сумму входящего,
-- иначе округл. сумму исходящего».
--
-- До 00165 база выбиралась по типу реестра: KZ — входящее, KG — всегда
-- исходящее. Здесь проверяется, что тип реестра на выбор базы больше не
-- влияет, а всё остальное (округление, ручной «округл», override суммы,
-- база Суммы 2) осталось как было.

BEGIN;

INSERT INTO counterparties (id, type, full_name) VALUES
  ('00000000-0000-0000-0000-00000000bb01', 'supplier', 'T-BASE Поставщик'),
  ('00000000-0000-0000-0000-00000000bb02', 'buyer',    'T-BASE Покупатель');

DO $$
DECLARE
  v_kz  UUID := gen_random_uuid();
  v_kg  UUID := gen_random_uuid();
  v_row UUID;
  v_s1  NUMERIC;
  v_s2  NUMERIC;
  v_s3  NUMERIC;
BEGIN
  INSERT INTO deals (id, deal_type, deal_number, year, month, supplier_id, buyer_id)
  VALUES (v_kz, 'KZ', 9970, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bb02'),
         (v_kg, 'KG', 9971, 2099, 'июнь',
          '00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bb02');

  -- ── 1. KG, есть оба объёма → база входящее ─────────────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 loading_volume, shipment_volume,
                                 railway_tariff, manager_tariff)
  VALUES (v_kg, 'KG', 'BASE-0001', 60.4, 59.0, 10.00, 3.00)
  RETURNING id INTO v_row;

  SELECT shipped_tonnage_amount, additional_expenses INTO v_s1, v_s3
    FROM shipment_registry WHERE id = v_row;
  IF v_s1 IS DISTINCT FROM 610.00 THEN
    RAISE EXCEPTION '1. Сумма 1 в KG при входящем 60.4: ожидали 610 (61 × 10), получили %', v_s1;
  END IF;
  IF v_s3 IS DISTINCT FROM 183.00 THEN
    RAISE EXCEPTION '1. Сумма 3 в KG при входящем 60.4: ожидали 183 (61 × 3), получили %', v_s3;
  END IF;

  -- ── 2. KG, без округления → 60.4 × 10 ──────────────────────────────
  UPDATE shipment_registry SET round_volume = FALSE WHERE id = v_row;
  SELECT shipped_tonnage_amount INTO v_s1 FROM shipment_registry WHERE id = v_row;
  IF v_s1 IS DISTINCT FROM 604.00 THEN
    RAISE EXCEPTION '2. без округления ожидали 604 (60.4 × 10), получили %', v_s1;
  END IF;
  UPDATE shipment_registry SET round_volume = TRUE WHERE id = v_row;

  -- ── 3. Ручной «округл» по-прежнему главнее обоих объёмов ───────────
  UPDATE shipment_registry SET rounded_volume_override = 50 WHERE id = v_row;
  SELECT shipped_tonnage_amount INTO v_s1 FROM shipment_registry WHERE id = v_row;
  IF v_s1 IS DISTINCT FROM 500.00 THEN
    RAISE EXCEPTION '3. ручной округл 50: ожидали 500, получили %', v_s1;
  END IF;
  UPDATE shipment_registry SET rounded_volume_override = NULL WHERE id = v_row;

  -- ── 4. Входящее стёрли → база переходит на исходящее ───────────────
  UPDATE shipment_registry SET loading_volume = NULL WHERE id = v_row;
  SELECT shipped_tonnage_amount, additional_expenses INTO v_s1, v_s3
    FROM shipment_registry WHERE id = v_row;
  IF v_s1 IS DISTINCT FROM 590.00 THEN
    RAISE EXCEPTION '4. без входящего ожидали 590 (59 × 10), получили %', v_s1;
  END IF;
  IF v_s3 IS DISTINCT FROM 177.00 THEN
    RAISE EXCEPTION '4. Сумма 3 без входящего: ожидали 177 (59 × 3), получили %', v_s3;
  END IF;

  -- ── 5. Входящее появилось → база снова входящее ────────────────────
  UPDATE shipment_registry SET loading_volume = 30.0 WHERE id = v_row;
  SELECT shipped_tonnage_amount INTO v_s1 FROM shipment_registry WHERE id = v_row;
  IF v_s1 IS DISTINCT FROM 300.00 THEN
    RAISE EXCEPTION '5. входящее 30 появилось: ожидали 300, получили %', v_s1;
  END IF;

  -- ── 6. Ручная Сумма 1 (override) не пересчитывается ────────────────
  UPDATE shipment_registry
     SET shipped_tonnage_amount = 999.00, shipped_tonnage_amount_override = TRUE
   WHERE id = v_row;
  UPDATE shipment_registry SET loading_volume = 40.0 WHERE id = v_row;
  SELECT shipped_tonnage_amount INTO v_s1 FROM shipment_registry WHERE id = v_row;
  IF v_s1 IS DISTINCT FROM 999.00 THEN
    RAISE EXCEPTION '6. ручную сумму пересчитали: ожидали 999, получили %', v_s1;
  END IF;

  -- ── 7. KZ, только исходящее → база исходящее (раньше — NULL) ───────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number,
                                 shipment_volume, railway_tariff,
                                 supplier_railway_tariff)
  VALUES (v_kz, 'KZ', 'BASE-0002', 59.0, 10.00, 2.00)
  RETURNING id INTO v_row;

  SELECT shipped_tonnage_amount, supplier_railway_amount INTO v_s1, v_s2
    FROM shipment_registry WHERE id = v_row;
  IF v_s1 IS DISTINCT FROM 590.00 THEN
    RAISE EXCEPTION '7. KZ без входящего: ожидали 590 (59 × 10), получили %', v_s1;
  END IF;
  -- Сумма 2 (ЖД поставщика) считается ТОЛЬКО от входящего — клиент
  -- 2026-08-15 задал её базу явно. Без входящего она пустая.
  IF v_s2 IS NOT NULL THEN
    RAISE EXCEPTION '7. Сумма 2 без входящего должна быть пустой, получили %', v_s2;
  END IF;

  -- ── 8. KZ, есть оба → входящее, как и раньше ───────────────────────
  UPDATE shipment_registry SET loading_volume = 60.4 WHERE id = v_row;
  SELECT shipped_tonnage_amount, supplier_railway_amount INTO v_s1, v_s2
    FROM shipment_registry WHERE id = v_row;
  IF v_s1 IS DISTINCT FROM 610.00 THEN
    RAISE EXCEPTION '8. KZ с входящим 60.4: ожидали 610, получили %', v_s1;
  END IF;
  IF v_s2 IS DISTINCT FROM 122.00 THEN
    RAISE EXCEPTION '8. Сумма 2 с входящим 60.4: ожидали 122 (61 × 2), получили %', v_s2;
  END IF;

  -- ── 9. Нет ни одного объёма → суммы пустые ─────────────────────────
  INSERT INTO shipment_registry (deal_id, registry_type, wagon_number, railway_tariff)
  VALUES (v_kg, 'KG', 'BASE-0003', 10.00)
  RETURNING id INTO v_row;
  SELECT shipped_tonnage_amount INTO v_s1 FROM shipment_registry WHERE id = v_row;
  IF v_s1 IS NOT NULL THEN
    RAISE EXCEPTION '9. без объёмов сумма должна быть пустой, получили %', v_s1;
  END IF;

  RAISE NOTICE 'ok: база сумм 1 и 3 — входящее, если есть, иначе исходящее';
END $$;

ROLLBACK;

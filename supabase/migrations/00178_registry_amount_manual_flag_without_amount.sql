-- 00178_registry_amount_manual_flag_without_amount.sql
--
-- Клиент 2026-09-29: «формулы грузоотправления и ЖД часто вылетают, не
-- просчитываются в балансе».
--
-- ПРИЧИНА (проверено на проде 2026-09-29, read-only):
--   • 134 строки реестра помечены «ручная сумма»
--     (shipped_tonnage_amount_override = TRUE), а суммы в них НЕТ. Триггер
--     compute_registry_amount ручную сумму не трогает — значит, в этих
--     строках формула «тариф × объём» не работает никогда, даже когда тариф
--     и объём есть. Строки заведены 05–08.2026 старыми версиями экрана и
--     импорта; нынешний экран реестра при очистке ячейки пометку снимает.
--     Сейчас это даёт пустую Сумму 1 у 10 строк с тарифом и объёмом:
--     KZ/26/006, 008, 023 (2), 024, 025, 108 (4).
--   • 4 строки не пересчитаны после смены формулы (пометки нет, тариф и
--     объём есть, суммы нет): KZ/26/102 (2), KG/26/403 — Сумма 1;
--     KZ/26/144 — Сумма 3 (грузоотправление) 1 501 780,96.
--   Балансы сами по себе считаются верно: у всех 1 217 активных сделок
--   supplier_balance совпадает с формулой (00176).
--
-- ЧТО ДЕЛАЕТ:
--   1. compute_registry_amount (тело 00165 дословно + два правила):
--      а) пометка «ручная» у Суммы 1 защищает только введённую сумму; без
--         суммы пометка снимается, и работает формула;
--      б) Сумма 3 и Сумма 2 пересчитываются по тарифу только когда
--         изменились тариф или объём (или суммы нет). Раньше ЛЮБАЯ правка
--         строки пересчитывала их — и введённая руками сумма уплывала на
--         доли копейки: тариф выведен из неё с 4 знаками (00151/00150).
--         Найдено пробным прогоном этой миграции на dev (копия прода):
--         ~40 сделок получали дрейф ±0,01.
--   2. Пересчитывает ровно эти строки: помеченные «ручная» без суммы и
--      строки с тарифом и объёмом, но пустой Суммой 1 / Суммой 3. Строки,
--      где сумма ЕСТЬ, не трогаются — в том числе ручные суммы
--      грузоотправления с расхождением в копейку против «тариф × объём»
--      (тариф там выведен из введённой суммы, 00151).
--   Каждая строка печатается NOTICE: сделка, вагон, Сумма 1 и Сумма 3
--   «было → стало», id; затем сдвиг баланса поставщика по сделкам.
--
-- ОЖИДАЕМОЕ ВЛИЯНИЕ НА БАЛАНС (расчёт 2026-09-29): меняется только
-- KZ/26/144 — +1 501 780,96 (галочка «Грузоотправитель в цене» стоит). У
-- остальных сделок «ЖД в цене» снята — Сумма 1 появится, баланс нет.
--
-- ROLLBACK: вернуть функцию из 00165; для напечатанных id —
--   UPDATE shipment_registry SET shipped_tonnage_amount = NULL,
--          shipped_tonnage_amount_override = TRUE WHERE id IN (…);   -- Сумма 1
--   UPDATE shipment_registry SET additional_expenses = NULL WHERE id IN (…); -- Сумма 3
-- Роллапы и балансы подтянутся триггерами.
--
-- Идемпотентна: повторный запуск строк для пересчёта не находит.
-- Состояние — только внутри одного DO-блока (SQL-редактор Supabase).

-- ── 1. Формула суммы строки реестра ──────────────────────────────────
CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_base NUMERIC;
  v_effective_base NUMERIC;      -- база сумм 1 и 3
  v_effective_base_old NUMERIC;  -- она же до правки, только для UPDATE
  v_in_base NUMERIC;             -- округл. входящее СНТ (база Суммы 2)
  v_in_base_old NUMERIC;
  v_amount_edited BOOLEAN;       -- правили сумму 2, а не тариф
  v_exp_edited BOOLEAN;          -- правили сумму 3, а не тариф
BEGIN
  -- 00165: входящее СНТ, если оно заполнено, иначе исходящее.
  v_base := COALESCE(NEW.loading_volume, NEW.shipment_volume);

  IF NEW.rounded_volume_override IS NOT NULL THEN
    v_effective_base := NEW.rounded_volume_override;
  ELSIF v_base IS NULL THEN
    v_effective_base := NULL;
  ELSIF NEW.round_volume THEN
    v_effective_base := CEIL(v_base);
  ELSE
    v_effective_base := v_base;
  END IF;

  -- Округл. входящее СНТ — база Суммы 2, только входящее (00150).
  IF NEW.rounded_volume_override IS NOT NULL AND NEW.registry_type = 'KZ' THEN
    v_in_base := NEW.rounded_volume_override;
  ELSIF NEW.loading_volume IS NULL THEN
    v_in_base := NULL;
  ELSIF NEW.round_volume THEN
    v_in_base := CEIL(NEW.loading_volume);
  ELSE
    v_in_base := NEW.loading_volume;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_effective_base_old := COALESCE(OLD.loading_volume, OLD.shipment_volume);
    IF OLD.rounded_volume_override IS NOT NULL THEN
      v_effective_base_old := OLD.rounded_volume_override;
    ELSIF v_effective_base_old IS NULL THEN
      v_effective_base_old := NULL;
    ELSIF OLD.round_volume THEN
      v_effective_base_old := CEIL(v_effective_base_old);
    END IF;

    IF OLD.rounded_volume_override IS NOT NULL AND OLD.registry_type = 'KZ' THEN
      v_in_base_old := OLD.rounded_volume_override;
    ELSIF OLD.loading_volume IS NULL THEN
      v_in_base_old := NULL;
    ELSIF OLD.round_volume THEN
      v_in_base_old := CEIL(OLD.loading_volume);
    ELSE
      v_in_base_old := OLD.loading_volume;
    END IF;
  END IF;

  -- === Сумма 1: тариф логистов × база ===============================
  -- 00178: «ручная» защищает только введённую сумму. Пометка без суммы
  -- ничего не защищает и навсегда отключала формулу (134 строки на проде,
  -- 2026-09-29) — снимаем её и считаем как обычно. Так же, как экран
  -- реестра: очистка ячейки снимает пометку.
  IF NEW.shipped_tonnage_amount_override AND NEW.shipped_tonnage_amount IS NOT NULL THEN
    NULL;
  ELSE
    NEW.shipped_tonnage_amount_override := FALSE;
    IF NEW.railway_tariff IS NULL OR v_base IS NULL THEN
      NEW.shipped_tonnage_amount := NULL;
    ELSE
      NEW.shipped_tonnage_amount := v_effective_base * NEW.railway_tariff;
    END IF;
  END IF;

  -- === Сумма 3: сумма грузоотправления (двусторонняя, 00151) ========
  v_exp_edited :=
    (TG_OP = 'INSERT'
       AND NEW.additional_expenses IS NOT NULL
       AND NEW.manager_tariff IS NULL)
    OR
    (TG_OP = 'UPDATE'
       AND NEW.additional_expenses IS DISTINCT FROM OLD.additional_expenses
       AND NEW.manager_tariff IS NOT DISTINCT FROM OLD.manager_tariff);

  IF v_exp_edited THEN
    -- Обратная формула: тариф = сумма ÷ округл. база.
    IF NEW.additional_expenses IS NULL THEN
      NEW.manager_tariff := NULL;
      NEW.additional_expenses_override := FALSE;
    ELSIF COALESCE(v_effective_base, 0) > 0 THEN
      NEW.manager_tariff := NEW.additional_expenses / v_effective_base;
      NEW.additional_expenses_override := FALSE;
    ELSE
      -- Базы нет — тариф вывести не из чего. Единственный случай, где
      -- флаг ещё нужен: он защищает ручную сумму от обнуления при
      -- следующей правке строки.
      NEW.additional_expenses_override := TRUE;
    END IF;

  -- 00178: прямая формула — только когда её входы изменились (или суммы
  -- нет). Иначе посторонняя правка строки переписывала ВВЕДЁННУЮ сумму:
  -- тариф выведен из неё с 4 знаками, база × тариф ≠ сумма на копейки.
  ELSIF NEW.manager_tariff IS NOT NULL AND v_effective_base IS NOT NULL
        AND (TG_OP = 'INSERT'
             OR NEW.additional_expenses IS NULL
             OR NEW.manager_tariff IS DISTINCT FROM OLD.manager_tariff
             OR v_effective_base IS DISTINCT FROM v_effective_base_old) THEN
    NEW.additional_expenses := v_effective_base * NEW.manager_tariff;
    NEW.additional_expenses_override := FALSE;

  ELSIF COALESCE(NEW.additional_expenses_override, FALSE) THEN
    -- Строка без базы: сумма введена руками, тариф не выводится.
    NULL;

  ELSIF TG_OP = 'UPDATE'
        AND (NEW.manager_tariff IS DISTINCT FROM OLD.manager_tariff
             OR v_effective_base IS DISTINCT FROM v_effective_base_old) THEN
    -- Вход реально исчез. Посторонние правки строки сюда не попадают.
    NEW.additional_expenses := NULL;
  ELSIF TG_OP = 'INSERT' AND NEW.manager_tariff IS NULL THEN
    NULL;
  END IF;

  -- === Сумма 2: ЖД расходы поставщика (00150) =======================
  v_amount_edited :=
    (TG_OP = 'INSERT'
       AND NEW.supplier_railway_amount IS NOT NULL
       AND NEW.supplier_railway_tariff IS NULL)
    OR
    (TG_OP = 'UPDATE'
       AND NEW.supplier_railway_amount IS DISTINCT FROM OLD.supplier_railway_amount
       AND NEW.supplier_railway_tariff IS NOT DISTINCT FROM OLD.supplier_railway_tariff);

  IF v_amount_edited THEN
    IF NEW.supplier_railway_amount IS NULL THEN
      NEW.supplier_railway_tariff := NULL;
    ELSIF COALESCE(v_in_base, 0) > 0 THEN
      NEW.supplier_railway_tariff := NEW.supplier_railway_amount / v_in_base;
    END IF;

  -- 00178: так же, как Сумма 3 — пересчёт только при смене входов.
  ELSIF NEW.supplier_railway_tariff IS NOT NULL AND v_in_base IS NOT NULL
        AND (TG_OP = 'INSERT'
             OR NEW.supplier_railway_amount IS NULL
             OR NEW.supplier_railway_tariff IS DISTINCT FROM OLD.supplier_railway_tariff
             OR v_in_base IS DISTINCT FROM v_in_base_old) THEN
    NEW.supplier_railway_amount := v_in_base * NEW.supplier_railway_tariff;

  ELSIF TG_OP = 'UPDATE'
        AND (NEW.supplier_railway_tariff IS DISTINCT FROM OLD.supplier_railway_tariff
             OR v_in_base IS DISTINCT FROM v_in_base_old) THEN
    NEW.supplier_railway_amount := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Пересчёт затронутых строк ─────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  dl RECORD;
  v_ids UUID[] := '{}';
  v_deal_ids UUID[] := '{}';
  v_rows_before JSONB := '{}';
  v_bal_before JSONB;
  v_rows INT := 0;
  v_changed INT := 0;
BEGIN
  -- «Было» по каждой строке — в jsonb-переменной, без временных таблиц.
  FOR r IN
    SELECT sr.id, sr.deal_id, sr.shipped_tonnage_amount AS s1, sr.additional_expenses AS s3
      FROM shipment_registry sr
     WHERE (sr.shipped_tonnage_amount_override AND sr.shipped_tonnage_amount IS NULL)
        OR (NOT COALESCE(sr.shipped_tonnage_amount_override, FALSE)
            AND sr.shipped_tonnage_amount IS NULL
            AND sr.railway_tariff IS NOT NULL
            AND COALESCE(sr.rounded_volume_override, sr.loading_volume, sr.shipment_volume) IS NOT NULL)
        OR (sr.additional_expenses IS NULL
            AND sr.manager_tariff IS NOT NULL
            AND COALESCE(sr.rounded_volume_override, sr.loading_volume, sr.shipment_volume) IS NOT NULL)
  LOOP
    v_rows := v_rows + 1;
    v_ids := v_ids || r.id;
    v_rows_before := v_rows_before || jsonb_build_object(r.id::TEXT, jsonb_build_object('s1', r.s1, 's3', r.s3));
    IF NOT (r.deal_id = ANY (v_deal_ids)) THEN
      v_deal_ids := v_deal_ids || r.deal_id;
    END IF;
  END LOOP;

  IF v_rows = 0 THEN
    RAISE NOTICE 'строк для пересчёта нет — всё уже на месте';
    RETURN;
  END IF;

  SELECT jsonb_object_agg(id, jsonb_build_object(
           'inv', invoice_amount, 'exp', additional_expenses_amount, 'sup', supplier_balance))
    INTO v_bal_before
    FROM deals WHERE id = ANY (v_deal_ids);

  -- Пустой UPDATE: BEFORE-триггер (п.1) пересчитает суммы, AFTER-триггеры
  -- подтянут роллапы сделок и балансы.
  UPDATE shipment_registry sr SET round_volume = sr.round_volume WHERE sr.id = ANY (v_ids);

  FOR r IN
    SELECT sr.id, d.deal_code, sr.wagon_number,
           sr.shipped_tonnage_amount AS s1_new, sr.additional_expenses AS s3_new
      FROM shipment_registry sr JOIN deals d ON d.id = sr.deal_id
     WHERE sr.id = ANY (v_ids)
     ORDER BY d.deal_code, sr.wagon_number
  LOOP
    IF (v_rows_before -> r.id::TEXT ->> 's1')::NUMERIC IS DISTINCT FROM r.s1_new
       OR (v_rows_before -> r.id::TEXT ->> 's3')::NUMERIC IS DISTINCT FROM r.s3_new THEN
      v_changed := v_changed + 1;
      RAISE NOTICE '% вагон %: Сумма 1 % → %, Сумма 3 % → % [id %]',
        r.deal_code, COALESCE(r.wagon_number, '—'),
        COALESCE(v_rows_before -> r.id::TEXT ->> 's1', '—'), COALESCE(r.s1_new::TEXT, '—'),
        COALESCE(v_rows_before -> r.id::TEXT ->> 's3', '—'), COALESCE(r.s3_new::TEXT, '—'), r.id;
    END IF;
  END LOOP;

  RAISE NOTICE 'просмотрено строк: %, суммы изменились: %, сделок: %',
    v_rows, v_changed, array_length(v_deal_ids, 1);

  FOR dl IN
    SELECT id, deal_code, invoice_amount, additional_expenses_amount, supplier_balance
      FROM deals WHERE id = ANY (v_deal_ids) ORDER BY deal_code
  LOOP
    IF dl.supplier_balance IS DISTINCT FROM (v_bal_before -> dl.id::TEXT ->> 'sup')::NUMERIC
       OR dl.invoice_amount IS DISTINCT FROM (v_bal_before -> dl.id::TEXT ->> 'inv')::NUMERIC
       OR dl.additional_expenses_amount IS DISTINCT FROM (v_bal_before -> dl.id::TEXT ->> 'exp')::NUMERIC THEN
      RAISE NOTICE '%: баланс % → %; Сумма 1 % → %; Сумма 3 % → %',
        dl.deal_code,
        v_bal_before -> dl.id::TEXT ->> 'sup', dl.supplier_balance,
        v_bal_before -> dl.id::TEXT ->> 'inv', dl.invoice_amount,
        v_bal_before -> dl.id::TEXT ->> 'exp', dl.additional_expenses_amount;
    END IF;
  END LOOP;
END $$;

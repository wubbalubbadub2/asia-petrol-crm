-- 00165_registry_amount_base_loading_first.sql
--
-- Клиент 2026-09-22: «в реестре для расчёта суммы мы используем тариф
-- (логисты) × округлённая сумма исходящего СНТ. А должно быть так: если
-- есть входящее СНТ, то нужно умножать тариф на округл. сумму входящего,
-- иначе округл. сумму исходящего».
--
-- КАК БЫЛО (00086 → 00151). База «округл.» выбиралась по типу реестра:
--   KZ — входящее СНТ (loading_volume), KG — ВСЕГДА исходящее
--   (shipment_volume), даже если входящее в строке заполнено. В KZ-строке
--   без входящего сумма оставалась пустой, хотя исходящее было.
--
-- КАК СТАЛО. Тип реестра на выбор базы не влияет:
--   база = входящее СНТ, если оно заполнено, иначе исходящее СНТ.
--   Дальше всё как раньше: rounded_volume_override главнее, CEIL по
--   round_volume, Сумма 1 = база × railway_tariff, Сумма 3 = база ×
--   manager_tariff (двусторонняя, 00151). «Округл.» на экране и в
--   выгрузке считается по той же базе (registry-excel.ts, registry/page).
--
-- ЧТО ЭТА МИГРАЦИЯ НЕ МЕНЯЕТ (осознанно):
--   • Сумму 2 (ЖД расходы поставщика, 00150): её база — только входящее
--     СНТ, клиент 2026-08-15 задал это явно. Без входящего она пустая.
--   • Ручные суммы: shipped_tonnage_amount_override = TRUE и
--     additional_expenses_override = TRUE не пересчитываются.
--   • Строки с ручным «округл.» (rounded_volume_override) — база у них
--     и так ручная, объёмы на неё не влияют.
--   • «Тариф факт (логисты)» на сделке (00120) по-прежнему делит Сумму 1
--     на объём по типу сделки (KZ — входящее, KG — исходящее). После
--     этой миграции у KG-сделок, где строки имеют входящее СНТ, база
--     строки и база сделки разойдутся. Отдельное решение клиента.
--
-- ДАННЫЕ. У уже существующих строк база могла измениться (KG с
-- заполненным входящим, KZ без входящего). Такие строки пересчитываются
-- здесь же — иначе «Округл.» на экране (новая база) × тариф не сходился
-- бы с сохранённой суммой до первой правки строки. Каждая строка
-- печатается NOTICE'ом: сделка, вагон, Сумма 1 и Сумма 3 «было → стало»,
-- id. Затем — итог и сдвиг балансов по затронутым сделкам.
--
-- ROLLBACK. Вернуть функцию из 00151 (база по типу реестра) и выполнить
-- по напечатанным id:
--   UPDATE shipment_registry SET round_volume = round_volume WHERE id IN (…);
-- триггер пересчитает суммы по прежней базе. Роллапы и балансы сделок
-- подтянутся сами.
--
-- Миграция идемпотентна: повторный запуск не находит строк, у которых
-- сохранённая сумма расходится с новой базой.

-- ── Триггер: база — входящее, если есть, иначе исходящее ─────────────
-- Тело переносится из 00151 ДОСЛОВНО; меняются только две строки —
-- выбор v_base и v_effective_base_old.

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
  IF NEW.shipped_tonnage_amount_override THEN
    NULL;
  ELSIF NEW.railway_tariff IS NULL OR v_base IS NULL THEN
    NEW.shipped_tonnage_amount := NULL;
  ELSE
    NEW.shipped_tonnage_amount := v_effective_base * NEW.railway_tariff;
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

  ELSIF NEW.manager_tariff IS NOT NULL AND v_effective_base IS NOT NULL THEN
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

  ELSIF NEW.supplier_railway_tariff IS NOT NULL AND v_in_base IS NOT NULL THEN
    NEW.supplier_railway_amount := v_in_base * NEW.supplier_railway_tariff;

  ELSIF TG_OP = 'UPDATE'
        AND (NEW.supplier_railway_tariff IS DISTINCT FROM OLD.supplier_railway_tariff
             OR v_in_base IS DISTINCT FROM v_in_base_old) THEN
    NEW.supplier_railway_amount := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN shipment_registry.round_volume IS
  'TRUE = CEIL(база), FALSE = база как есть. База (00165): loading_volume, если заполнено, иначе shipment_volume — независимо от registry_type. rounded_volume_override главнее.';

-- ── Пересчёт строк, у которых база изменилась ───────────────────────
-- Всё в ОДНОМ DO-блоке, без временных таблиц (в SQL-редакторе Supabase
-- они не доживают до следующего запроса — см. 00151). Балансы сделок
-- «до» держим в jsonb-переменной.
DO $$
DECLARE
  r RECORD;
  dl RECORD;
  v_rows INT := 0;
  v_s1_before NUMERIC := 0;
  v_s1_after  NUMERIC := 0;
  v_s3_before NUMERIC := 0;
  v_s3_after  NUMERIC := 0;
  v_ids UUID[] := '{}';
  v_deal_ids UUID[] := '{}';
  v_bal_before JSONB;
BEGIN
  -- Строки, где «было» и «стало» расходятся. new_amount считается по
  -- той же формуле, что compute_registry_amount выше.
  FOR r IN
    SELECT sr.id, sr.deal_id, d.deal_code, sr.registry_type, sr.wagon_number,
           sr.loading_volume, sr.shipment_volume,
           sr.shipped_tonnage_amount AS s1_old,
           sr.additional_expenses    AS s3_old,
           CASE WHEN COALESCE(sr.shipped_tonnage_amount_override, FALSE) OR sr.railway_tariff IS NULL
                THEN sr.shipped_tonnage_amount
                ELSE b.eff * sr.railway_tariff END AS s1_new,
           -- Как в триггере: есть тариф грузоотправления — прямая формула
           -- (override при этом снимается); нет — сумма остаётся как есть.
           CASE WHEN sr.manager_tariff IS NULL
                THEN sr.additional_expenses
                ELSE b.eff * sr.manager_tariff END AS s3_new
      FROM shipment_registry sr
      JOIN deals d ON d.id = sr.deal_id
      CROSS JOIN LATERAL (
        SELECT CASE
                 WHEN sr.round_volume THEN CEIL(COALESCE(sr.loading_volume, sr.shipment_volume))
                 ELSE COALESCE(sr.loading_volume, sr.shipment_volume)
               END AS eff
      ) b
     WHERE sr.rounded_volume_override IS NULL
       AND COALESCE(sr.loading_volume, sr.shipment_volume) IS NOT NULL
       -- база по старому правилу отличается от базы по новому
       AND (CASE WHEN sr.registry_type = 'KZ' THEN sr.loading_volume ELSE sr.shipment_volume END)
           IS DISTINCT FROM COALESCE(sr.loading_volume, sr.shipment_volume)
     ORDER BY d.deal_code, sr.row_number, sr.wagon_number
  LOOP
    -- Идемпотентность: сохранённые суммы уже совпадают с новой базой.
    CONTINUE WHEN r.s1_old IS NOT DISTINCT FROM r.s1_new
             AND r.s3_old IS NOT DISTINCT FROM r.s3_new;

    RAISE NOTICE '% вагон % (%: вход % / исход %): Сумма 1 % → %, Сумма 3 % → % [id %]',
      r.deal_code, COALESCE(r.wagon_number, '—'), r.registry_type,
      COALESCE(r.loading_volume::TEXT, '—'), COALESCE(r.shipment_volume::TEXT, '—'),
      COALESCE(r.s1_old::TEXT, '—'), COALESCE(r.s1_new::TEXT, '—'),
      COALESCE(r.s3_old::TEXT, '—'), COALESCE(r.s3_new::TEXT, '—'),
      r.id;

    v_s1_before := v_s1_before + COALESCE(r.s1_old, 0);
    v_s1_after  := v_s1_after  + COALESCE(r.s1_new, 0);
    v_s3_before := v_s3_before + COALESCE(r.s3_old, 0);
    v_s3_after  := v_s3_after  + COALESCE(r.s3_new, 0);
    v_rows := v_rows + 1;
    v_ids := v_ids || r.id;
    IF NOT (r.deal_id = ANY (v_deal_ids)) THEN
      v_deal_ids := v_deal_ids || r.deal_id;
    END IF;
  END LOOP;

  IF v_rows = 0 THEN
    RAISE NOTICE 'строк с изменившейся базой нет — пересчитывать нечего';
    RETURN;
  END IF;

  -- Балансы затронутых сделок до пересчёта.
  SELECT jsonb_object_agg(id, jsonb_build_object(
           'code', deal_code,
           'inv',  invoice_amount,
           'exp',  additional_expenses_amount,
           'sup',  supplier_balance))
    INTO v_bal_before
    FROM deals WHERE id = ANY (v_deal_ids);

  -- Пустой UPDATE: BEFORE-триггер пересчитает суммы по новой базе,
  -- AFTER-триггеры подтянут роллапы и балансы сделок.
  UPDATE shipment_registry sr
     SET round_volume = sr.round_volume
   WHERE sr.id = ANY (v_ids);

  RAISE NOTICE 'пересчитано строк: % в % сделках; Сумма 1: % → % (дельта %); Сумма 3: % → % (дельта %)',
    v_rows, array_length(v_deal_ids, 1),
    v_s1_before, v_s1_after, v_s1_after - v_s1_before,
    v_s3_before, v_s3_after, v_s3_after - v_s3_before;

  -- Сдвиг баланса поставщика по сделкам — только там, где он есть
  -- (Сумма 1 / Сумма 3 входят в него по галочкам «в цене»; долг
  -- покупателя от них не зависит).
  FOR dl IN
    SELECT id, deal_code, invoice_amount, additional_expenses_amount, supplier_balance
      FROM deals WHERE id = ANY (v_deal_ids)
     ORDER BY deal_code
  LOOP
    IF dl.supplier_balance IS DISTINCT FROM (v_bal_before -> dl.id::TEXT ->> 'sup')::NUMERIC THEN
      RAISE NOTICE '%: баланс поставщика % → % (Сумма 1 % → %, Сумма 3 % → %)',
        dl.deal_code,
        v_bal_before -> dl.id::TEXT ->> 'sup', dl.supplier_balance,
        v_bal_before -> dl.id::TEXT ->> 'inv', dl.invoice_amount,
        v_bal_before -> dl.id::TEXT ->> 'exp', dl.additional_expenses_amount;
    END IF;
  END LOOP;

  -- Сверка по пересчитанным строкам: Сумма 1 сходится с новой базой.
  PERFORM 1
    FROM shipment_registry sr
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN sr.round_volume THEN CEIL(COALESCE(sr.loading_volume, sr.shipment_volume))
               ELSE COALESCE(sr.loading_volume, sr.shipment_volume)
             END AS eff
    ) b
   WHERE sr.id = ANY (v_ids)
     AND NOT COALESCE(sr.shipped_tonnage_amount_override, FALSE)
     AND sr.railway_tariff IS NOT NULL
     AND sr.shipped_tonnage_amount IS DISTINCT FROM b.eff * sr.railway_tariff;
  IF FOUND THEN
    RAISE EXCEPTION 'после пересчёта остались строки, где Сумма 1 не сходится с новой базой — миграция отменена';
  END IF;
END $$;

-- 00182_logistics_amount_outgoing_only.sql
--
-- Клиент через владельца 2026-10-27: «округл» и «Сумма» (Сумма 1,
-- shipped_tonnage_amount) и всё, что из них выводится, считаются ТОЛЬКО от
-- исходящего СНТ (shipment_volume). Входящее СНТ (loading_volume) — для
-- сравнения (естественная убыль: налили 960 т, слили 957 т) и отчётов
-- себестоимости. ДТ-КТ логистика берёт исходящее. Строка, внесённая только
-- со входящим СНТ, экспедитора не получает.
--
-- ОТМЕНЯЕТ 00165 (клиент 2026-09-22: база = входящее, если есть, иначе
-- исходящее). Из-за 00165 на 184 KG-сделках груз считался дважды: строки
-- только со входящим + вагоны только с исходящим. Пример KG/26/652:
-- invoice_amount 389 275,88 USD вместо 195 135,99.
--
-- РЕШЕНИЯ ВЛАДЕЛЬЦА 2026-10-27:
--   1. KG и KZ одинаково.
--   2. Пересчитать все существующие строки.
--   3. Ничего не стирать: тарифы и уже стоящие экспедиторы остаются. У строк
--      только со входящим «округл»/Сумма 1 опустеют — это формула (базы нет).
--   4. Исходящее появилось на строке (слияние импорта, правка) → экспедитор
--      из сделки, если на строке его нет. Новая строка только со входящим —
--      без экспедитора (здесь, в БД, а не только в формах). Протяжка
--      экспедитора сделки в реестр (00130) строки только со входящим
--      пропускает.
--   5. Ручные значения не трогаем: rounded_volume_override, ручная сумма
--      (shipped_tonnage_amount_override), ручной тариф.
--   6. Сумма 3 (additional_expenses, грузоотправитель) — база прежняя:
--      входящее, если есть, иначе исходящее (00165). Сумма 2
--      (supplier_railway_amount) — только входящее (00150).
--
-- РЕШЕНИЕ ПО «ТАРИФ ФАКТ (ЛОГИСТЫ)» KZ (открытый пункт брифа):
--   compute_deal_derived_fields (00179) и passport_snapshot_as_of делили
--   Сумму KZ-сделки на ВХОДЯЩЕЕ (supplier_shipped_volume), повторяя старую
--   базу KZ-строки (00086/00108). Теперь Сумма KZ-строки считается от
--   исходящего, поэтому и делитель — исходящее (actual_shipped_volume),
--   как у KG. Иначе тариф факт занижен на естественную убыль, а на сделках
--   со строками только со входящим (их Сумма теперь пустая) — ещё и на весь
--   их объём. «Тариф факт (грузоотпр.)» остаётся на входящем: его Сумма 3
--   не меняется. Ручной тариф факт (actual_tariff_override) не трогаем.
--
-- ЧТО ДЕЛАЕТ (один DO-блок = одна транзакция; SQL-редактор Supabase между
-- запросами не атомарен, поэтому формулы и пересчёт — вместе или никак):
--   1. Запоминает «было» по каждой строке, где меняется «округл» или
--      Сумма 1, и по затронутым сделкам — в переменных, без TEMP TABLE.
--   2. Пересоздаёт compute_registry_amount, compute_deal_derived_fields,
--      passport_snapshot_as_of, propagate_deal_identity_to_registry и
--      добавляет триггер trg_forwarder_by_outgoing.
--   3. Пустой UPDATE строк, где меняется Сумма 1 — BEFORE-триггер
--      пересчитывает, AFTER-триггеры подтягивают роллапы сделок. Затем
--      пустой UPDATE KZ-сделок, у которых меняется тариф факт.
--   4. Сверка: Сумма 1 каждой строки = ожидаемой; Сумма 2 и Сумма 3 не
--      изменились. Любое расхождение — EXCEPTION, откатывается всё.
--   5. Печатает NOTICE: каждую строку (сделка, вагон, id, класс, «округл» и
--      Сумма 1 было → стало), сдвиг invoice_amount / тарифа факт / баланса
--      поставщика по сделкам, итоги Суммы 1 по валютам до → после.
--   Просмотр без записи: scripts/logistics-outgoing-only-preview.sql (та же
--   формула ожидаемой суммы). Его список rows (id, было → стало) сохранить
--   ДО применения: редактор Supabase NOTICE может не показать, а по этим id
--   делается откат.
--
-- ROLLBACK: вернуть определения функций compute_registry_amount (00178),
-- compute_deal_derived_fields и passport_snapshot_as_of (00179),
-- propagate_deal_identity_to_registry (00130); DROP TRIGGER
-- trg_forwarder_by_outgoing ON shipment_registry; DROP FUNCTION
-- registry_forwarder_by_outgoing(); затем по напечатанным id
--   UPDATE shipment_registry SET round_volume = round_volume WHERE id IN (…);
--   UPDATE deals SET actual_tariff = actual_tariff WHERE deal_type = 'KZ'
--      AND NOT COALESCE(actual_tariff_override, FALSE);
-- Роллапы и балансы подтянутся триггерами. Экспедиторы эта миграция не
-- меняет, откатывать нечего.
--
-- Идемпотентна: повторный запуск пересоздаёт функции и строк для
-- пересчёта не находит.

DO $mig$
DECLARE
  r RECORD;
  dl RECORD;
  v_rows_before JSONB := '{}';
  v_deal_before JSONB := '{}';
  v_upd_ids UUID[] := '{}';
  v_deal_ids UUID[] := '{}';
  v_tot_before JSONB;
  v_tot_after JSONB;
  v_rows INT := 0;
  v_upd INT := 0;
  v_kz INT := 0;
  v_bad INT := 0;
  v_deals_changed INT := 0;
  v_first_run BOOLEAN;
BEGIN
  -- Повторный запуск: формула уже новая, «округл» по старой базе
  -- сравнивать не с чем — печатаем только строки с другой Суммой 1.
  SELECT position('v_out_base' IN prosrc) = 0 INTO v_first_run
    FROM pg_proc WHERE proname = 'compute_registry_amount';

  -- ── 1. «Было» ──────────────────────────────────────────────────────
  -- Ожидаемые «округл» и Сумма 1 — та же формула, что в триггере ниже и в
  -- scripts/logistics-outgoing-only-preview.sql.
  FOR r IN
    WITH calc AS (
      SELECT sr.id, sr.deal_id, sr.shipped_tonnage_amount AS s1,
             sr.additional_expenses AS s3, sr.supplier_railway_amount AS s2,
             (sr.shipped_tonnage_amount_override AND sr.shipped_tonnage_amount IS NOT NULL) AS manual,
             CASE
               WHEN sr.rounded_volume_override IS NOT NULL THEN sr.rounded_volume_override
               WHEN COALESCE(sr.loading_volume, sr.shipment_volume) IS NULL THEN NULL
               WHEN sr.round_volume THEN CEIL(COALESCE(sr.loading_volume, sr.shipment_volume))
               ELSE COALESCE(sr.loading_volume, sr.shipment_volume)
             END AS round_old,
             CASE
               WHEN sr.rounded_volume_override IS NOT NULL THEN sr.rounded_volume_override
               WHEN sr.shipment_volume IS NULL THEN NULL
               WHEN sr.round_volume THEN CEIL(sr.shipment_volume)
               ELSE sr.shipment_volume
             END AS round_new,
             sr.railway_tariff, sr.loading_volume, sr.shipment_volume
        FROM shipment_registry sr
    ), exp AS (
      SELECT c.*,
             CASE
               WHEN c.manual THEN c.s1
               WHEN c.railway_tariff IS NULL THEN NULL
               WHEN c.loading_volume IS NULL AND c.shipment_volume IS NULL THEN NULL
               WHEN c.round_new IS NULL THEN NULL
               ELSE ROUND(c.round_new * c.railway_tariff, 4)
             END AS s1_new
        FROM calc c
    )
    SELECT * FROM exp
     WHERE (v_first_run AND round_old IS DISTINCT FROM round_new)
        OR s1 IS DISTINCT FROM s1_new
  LOOP
    v_rows := v_rows + 1;
    v_rows_before := v_rows_before || jsonb_build_object(r.id::TEXT, jsonb_build_object(
      's1', r.s1, 's2', r.s2, 's3', r.s3, 's1_new', r.s1_new,
      'ro', r.round_old, 'rn', r.round_new));
    IF r.s1 IS DISTINCT FROM r.s1_new THEN
      v_upd_ids := v_upd_ids || r.id;
      IF NOT (r.deal_id = ANY (v_deal_ids)) THEN
        v_deal_ids := v_deal_ids || r.deal_id;
      END IF;
    END IF;
  END LOOP;

  -- Сделки: затронутые строками + все KZ (у них меняется делитель тарифа факт).
  SELECT COALESCE(jsonb_object_agg(id, jsonb_build_object(
           'inv', invoice_amount, 'tf', actual_tariff, 'sup', supplier_balance)), '{}')
    INTO v_deal_before
    FROM deals
   WHERE id = ANY (v_deal_ids) OR deal_type = 'KZ';

  SELECT COALESCE(jsonb_object_agg(cur, s), '{}') INTO v_tot_before
    FROM (SELECT COALESCE(sr.currency, d.logistics_currency, '—') AS cur,
                 SUM(sr.shipped_tonnage_amount) AS s
            FROM shipment_registry sr LEFT JOIN deals d ON d.id = sr.deal_id
           GROUP BY 1) t;

  -- ── 2. Формулы ─────────────────────────────────────────────────────
  EXECUTE $f1$
CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_base NUMERIC;                -- база Суммы 3: входящее, иначе исходящее (00165)
  v_effective_base NUMERIC;      -- округл. база Суммы 3
  v_effective_base_old NUMERIC;  -- она же до правки, только для UPDATE
  v_out_base NUMERIC;            -- «округл» и база Суммы 1: только исходящее (00182)
  v_in_base NUMERIC;             -- округл. входящее СНТ (база Суммы 2)
  v_in_base_old NUMERIC;
  v_amount_edited BOOLEAN;       -- правили сумму 2, а не тариф
  v_exp_edited BOOLEAN;          -- правили сумму 3, а не тариф
BEGIN
  -- Сумма 3 — база 00165 без изменений (владелец 2026-10-27).
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

  -- 00182: «округл» — только исходящее СНТ. Ручной «округл» главнее.
  IF NEW.rounded_volume_override IS NOT NULL THEN
    v_out_base := NEW.rounded_volume_override;
  ELSIF NEW.shipment_volume IS NULL THEN
    v_out_base := NULL;
  ELSIF NEW.round_volume THEN
    v_out_base := CEIL(NEW.shipment_volume);
  ELSE
    v_out_base := NEW.shipment_volume;
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

  -- === Сумма 1: тариф логистов × «округл» (исходящее, 00182) =========
  -- 00178: «ручная» защищает только введённую сумму.
  -- Строка без объёмов — сумма пустая (как в 00178). Ручной «округл» на
  -- строке только со входящим сумму сохраняет (владелец: ручное не трогаем).
  IF NEW.shipped_tonnage_amount_override AND NEW.shipped_tonnage_amount IS NOT NULL THEN
    NULL;
  ELSE
    NEW.shipped_tonnage_amount_override := FALSE;
    IF NEW.railway_tariff IS NULL OR v_base IS NULL OR v_out_base IS NULL THEN
      NEW.shipped_tonnage_amount := NULL;
    ELSE
      NEW.shipped_tonnage_amount := v_out_base * NEW.railway_tariff;
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
  $f1$;

  -- Экспедитор строки и исходящее СНТ (решение владельца п.4).
  -- Имя триггера начинается на trg_f — BEFORE-триггеры идут по алфавиту,
  -- и экспедитор встаёт ДО подбора тарифа (trg_key_*, 00148/00167).
  EXECUTE $f2$
CREATE OR REPLACE FUNCTION registry_forwarder_by_outgoing()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Новая строка только со входящим — экспедитора нет, что бы ни
    -- прислала форма.
    IF NEW.shipment_volume IS NULL AND NEW.loading_volume IS NOT NULL THEN
      NEW.forwarder_id := NULL;
    END IF;
  ELSIF NEW.shipment_volume IS NOT NULL AND OLD.shipment_volume IS NULL
        AND NEW.forwarder_id IS NULL THEN
    -- Исходящее появилось (слияние импорта, правка) — экспедитор сделки.
    -- Уже стоящий экспедитор не меняем; исчезновение исходящего его не
    -- стирает.
    SELECT d.forwarder_id INTO NEW.forwarder_id FROM deals d WHERE d.id = NEW.deal_id;
  END IF;
  RETURN NEW;
END;
$$;
  $f2$;

  DROP TRIGGER IF EXISTS trg_forwarder_by_outgoing ON shipment_registry;
  CREATE TRIGGER trg_forwarder_by_outgoing
    BEFORE INSERT OR UPDATE OF shipment_volume ON shipment_registry
    FOR EACH ROW
    EXECUTE FUNCTION registry_forwarder_by_outgoing();

  -- Протяжка экспедитора сделки (00130) пропускает строки только со
  -- входящим. Остальное тело — 00130 дословно.
  EXECUTE $f3$
CREATE OR REPLACE FUNCTION propagate_deal_identity_to_registry()
RETURNS TRIGGER AS $$
DECLARE
  v_rows INT;
BEGIN
  IF NEW.factory_id IS NOT NULL
     AND NEW.factory_id IS DISTINCT FROM OLD.factory_id THEN
    UPDATE shipment_registry SET factory_id = NEW.factory_id
     WHERE deal_id = NEW.id AND factory_id IS DISTINCT FROM NEW.factory_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      RAISE NOTICE 'сделка %: завод → % строк реестра', NEW.deal_code, v_rows;
    END IF;
  END IF;

  IF NEW.fuel_type_id IS NOT NULL
     AND NEW.fuel_type_id IS DISTINCT FROM OLD.fuel_type_id THEN
    UPDATE shipment_registry SET fuel_type_id = NEW.fuel_type_id
     WHERE deal_id = NEW.id AND fuel_type_id IS DISTINCT FROM NEW.fuel_type_id;
  END IF;

  IF NEW.supplier_id IS NOT NULL
     AND NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
    UPDATE shipment_registry SET supplier_id = NEW.supplier_id
     WHERE deal_id = NEW.id AND supplier_id IS DISTINCT FROM NEW.supplier_id;
  END IF;

  IF NEW.buyer_id IS NOT NULL
     AND NEW.buyer_id IS DISTINCT FROM OLD.buyer_id THEN
    UPDATE shipment_registry SET buyer_id = NEW.buyer_id
     WHERE deal_id = NEW.id AND buyer_id IS DISTINCT FROM NEW.buyer_id;
  END IF;

  -- 00182: строкам только со входящим СНТ экспедитор не ставится.
  IF NEW.forwarder_id IS NOT NULL
     AND NEW.forwarder_id IS DISTINCT FROM OLD.forwarder_id THEN
    UPDATE shipment_registry SET forwarder_id = NEW.forwarder_id
     WHERE deal_id = NEW.id AND forwarder_id IS DISTINCT FROM NEW.forwarder_id
       AND NOT (shipment_volume IS NULL AND loading_volume IS NOT NULL);
  END IF;

  IF NEW.logistics_company_group_id IS NOT NULL
     AND NEW.logistics_company_group_id IS DISTINCT FROM OLD.logistics_company_group_id THEN
    UPDATE shipment_registry SET company_group_id = NEW.logistics_company_group_id
     WHERE deal_id = NEW.id AND company_group_id IS DISTINCT FROM NEW.logistics_company_group_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
  $f3$;

  -- Тариф факт (логисты): делитель — исходящее и для KZ. Остальное тело —
  -- 00179 дословно.
  EXECUTE $f4$
CREATE OR REPLACE FUNCTION compute_deal_derived_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_contracted_volume IS NOT NULL AND NEW.supplier_price IS NOT NULL THEN
    NEW.supplier_contracted_amount := NEW.supplier_contracted_volume * NEW.supplier_price;
  END IF;

  IF NEW.buyer_contracted_volume IS NOT NULL AND NEW.buyer_price IS NOT NULL THEN
    NEW.buyer_contracted_amount := NEW.buyer_contracted_volume * NEW.buyer_price;
  END IF;

  NEW.supplier_balance :=
    COALESCE(NEW.supplier_shipped_amount, 0)
    - COALESCE(NEW.supplier_payment, 0)
    -- «ЖД в цене» (00179): Сумма ЖД поставщика (supplier_railway_amount).
    + CASE
        WHEN NEW.railway_in_price IS TRUE
         AND NEW.supplier_currency = NEW.logistics_currency
        THEN COALESCE(NEW.supplier_railway_amount, 0)
        ELSE 0
      END
    + CASE
        WHEN NEW.additional_expenses_in_price IS TRUE
         AND NEW.supplier_currency = NEW.logistics_currency
        THEN COALESCE(NEW.additional_expenses_amount, 0)
        ELSE 0
      END
    -- «Сумма логистов в цене» (00179): Сумма (логисты), invoice_amount.
    + CASE
        WHEN NEW.logistics_amount_in_price IS TRUE
         AND NEW.supplier_currency = NEW.logistics_currency
        THEN COALESCE(NEW.invoice_amount, 0)
        ELSE 0
      END;

  NEW.buyer_debt :=
    COALESCE(NEW.buyer_payment, 0)
    - COALESCE(NEW.buyer_shipped_amount, 0);

  NEW.buyer_remaining := COALESCE(NEW.buyer_contracted_volume, 0) - COALESCE(NEW.buyer_ordered_volume, 0);

  IF NEW.planned_tariff IS NOT NULL AND NEW.preliminary_tonnage IS NOT NULL THEN
    NEW.preliminary_amount := NEW.planned_tariff * NEW.preliminary_tonnage;
  END IF;

  -- ── Тариф факт (логисты): Сумма ÷ исходящее СНТ (00182) ────────────
  -- База как у Суммы строки реестра: только исходящее, KG и KZ.
  IF COALESCE(NEW.actual_tariff_override, FALSE) = FALSE THEN
    IF NEW.invoice_amount IS NOT NULL AND COALESCE(NEW.actual_shipped_volume, 0) > 0 THEN
      NEW.actual_tariff := NEW.invoice_amount / NEW.actual_shipped_volume;
    ELSE
      NEW.actual_tariff := NULL;
    END IF;
  END IF;

  -- ── Тариф факт (грузоотпр.): Сумма грузоотправителя ÷ входящее СНТ ─
  IF COALESCE(NEW.shipper_actual_tariff_override, FALSE) = FALSE THEN
    IF NEW.additional_expenses_amount IS NOT NULL
       AND COALESCE(NEW.supplier_shipped_volume, 0) > 0 THEN
      NEW.shipper_actual_tariff := NEW.additional_expenses_amount / NEW.supplier_shipped_volume;
    ELSE
      NEW.shipper_actual_tariff := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
  $f4$;

  -- Срез паспорта на дату — тот же делитель. Остальное тело — 00179
  -- дословно.
  EXECUTE $f5$
CREATE OR REPLACE FUNCTION passport_snapshot_as_of(
  p_date     DATE,
  p_deal_ids UUID[] DEFAULT NULL   -- NULL = все сделки, доступные вызывающему
)
RETURNS TABLE (
  deal_id                    UUID,
  supplier_shipped_volume    NUMERIC,
  supplier_shipped_amount    NUMERIC,
  supplier_payment_gross     NUMERIC,
  supplier_refund_total      NUMERIC,
  supplier_offset_total      NUMERIC,
  supplier_payment           NUMERIC,
  supplier_railway_amount    NUMERIC,
  additional_expenses_amount NUMERIC,
  supplier_balance           NUMERIC,
  buyer_shipped_volume       NUMERIC,
  buyer_shipped_amount       NUMERIC,
  buyer_payment_gross        NUMERIC,
  buyer_refund_total         NUMERIC,
  buyer_offset_total         NUMERIC,
  buyer_payment              NUMERIC,
  buyer_debt                 NUMERIC,
  actual_shipped_volume      NUMERIC,
  invoice_amount             NUMERIC,
  actual_tariff              NUMERIC,
  shipper_actual_tariff      NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH scope AS (
    SELECT d.* FROM deals d
     WHERE p_deal_ids IS NULL OR d.id = ANY (p_deal_ids)
  ),
  -- ── Реестр: refresh_deal_shipment_totals (00116) + rollup'ы
  --    additional_expenses (00115) и Суммы 2 (00150) со срезом по дате.
  reg AS (
    SELECT r.deal_id,
           COALESCE(SUM(r.loading_volume)          FILTER (WHERE r.loading_date <= p_date), 0) AS loading_volume,
           COALESCE(SUM(r.shipment_volume)         FILTER (WHERE r.date         <= p_date), 0) AS shipment_volume,
           COALESCE(SUM(r.shipped_tonnage_amount)  FILTER (WHERE r.date         <= p_date), 0) AS invoice_amount,
           COALESCE(SUM(r.additional_expenses)     FILTER (WHERE r.loading_date <= p_date), 0) AS additional_expenses,
           COALESCE(SUM(r.supplier_railway_amount) FILTER (WHERE r.loading_date <= p_date), 0) AS supplier_railway_amount
      FROM shipment_registry r
      JOIN scope s ON s.id = r.deal_id
     GROUP BY r.deal_id
  ),
  -- ── Суммы отгрузки: refresh_deal_price_totals (00030) со срезом.
  prc AS (
    SELECT sp.deal_id,
           COALESCE(SUM(sp.amount) FILTER (WHERE sp.side = 'supplier'), 0) AS supplier_amount,
           COALESCE(SUM(sp.amount) FILTER (WHERE sp.side = 'buyer'),    0) AS buyer_amount
      FROM deal_shipment_prices sp
      JOIN scope s ON s.id = sp.deal_id
     WHERE sp.shipment_date <= p_date
     GROUP BY sp.deal_id
  ),
  -- ── Оплаты: refresh_deal_payment_totals (00145). Условие по валюте
  --    стороны перенесено дословно; добавлен только срез по дате, и
  --    только для 'payment' / 'refund' — взаимозачёты берём все.
  pay AS (
    SELECT p.deal_id,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'supplier'
               AND (p.currency IS NULL OR p.currency = s.supplier_currency)
               AND p.payment_type = 'payment'
               AND p.payment_date <= p_date), 0) AS sup_gross,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'supplier'
               AND (p.currency IS NULL OR p.currency = s.supplier_currency)
               AND p.payment_type = 'refund'
               AND p.payment_date <= p_date), 0) AS sup_refund,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'supplier'
               AND (p.currency IS NULL OR p.currency = s.supplier_currency)
               AND p.payment_type = 'offset'), 0) AS sup_offset,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'buyer'
               AND (p.currency IS NULL OR p.currency = s.buyer_currency)
               AND p.payment_type = 'payment'
               AND p.payment_date <= p_date), 0) AS buy_gross,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'buyer'
               AND (p.currency IS NULL OR p.currency = s.buyer_currency)
               AND p.payment_type = 'refund'
               AND p.payment_date <= p_date), 0) AS buy_refund,
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.side = 'buyer'
               AND (p.currency IS NULL OR p.currency = s.buyer_currency)
               AND p.payment_type = 'offset'), 0) AS buy_offset
      FROM deal_payments p
      JOIN scope s ON s.id = p.deal_id
     GROUP BY p.deal_id
  ),
  snap AS (
    SELECT
      s.id,
      s.deal_type,
      s.railway_in_price,
      s.additional_expenses_in_price,
      s.logistics_amount_in_price,
      s.supplier_currency,
      s.logistics_currency,
      s.actual_tariff_override,
      s.actual_tariff          AS manual_actual_tariff,
      s.shipper_actual_tariff_override,
      s.shipper_actual_tariff  AS manual_shipper_tariff,
      COALESCE(reg.loading_volume, 0)          AS loading_volume,
      COALESCE(reg.shipment_volume, 0)         AS shipment_volume,
      COALESCE(reg.invoice_amount, 0)          AS invoice_amount,
      COALESCE(reg.additional_expenses, 0)     AS additional_expenses,
      COALESCE(reg.supplier_railway_amount, 0) AS supplier_railway_amount,
      COALESCE(prc.supplier_amount, 0)         AS supplier_shipped_amount,
      COALESCE(prc.buyer_amount, 0)            AS buyer_shipped_amount,
      COALESCE(pay.sup_gross, 0)               AS sup_gross,
      COALESCE(pay.sup_refund, 0)              AS sup_refund,
      COALESCE(pay.sup_offset, 0)              AS sup_offset,
      COALESCE(pay.buy_gross, 0)               AS buy_gross,
      COALESCE(pay.buy_refund, 0)              AS buy_refund,
      COALESCE(pay.buy_offset, 0)              AS buy_offset
    FROM scope s
    LEFT JOIN reg ON reg.deal_id = s.id
    LEFT JOIN prc ON prc.deal_id = s.id
    LEFT JOIN pay ON pay.deal_id = s.id
  )
  -- Округление до 4 знаков — не косметика: rollup-колонки `deals`
  -- объявлены DECIMAL(14,4), и триггер округляет запись до того же
  -- масштаба. Без ROUND срез «на сегодня» расходился бы с паспортом
  -- в хвосте деления у тарифов факт.
  SELECT
    n.id,
    ROUND(n.loading_volume, 4),
    ROUND(n.supplier_shipped_amount, 4),
    ROUND(n.sup_gross, 4),
    ROUND(n.sup_refund, 4),
    ROUND(n.sup_offset, 4),
    -- Нетто (00145): возвраты вычитаются, взаимозачёт прибавляется со знаком.
    ROUND(n.sup_gross - n.sup_refund + n.sup_offset, 4),
    ROUND(n.supplier_railway_amount, 4),
    ROUND(n.additional_expenses, 4),
    -- Баланс поставщика — compute_deal_derived_fields (00120).
    ROUND(
      n.supplier_shipped_amount
      - (n.sup_gross - n.sup_refund + n.sup_offset)
      + CASE WHEN n.railway_in_price IS TRUE
              AND n.supplier_currency = n.logistics_currency
             THEN n.supplier_railway_amount ELSE 0 END
      + CASE WHEN n.additional_expenses_in_price IS TRUE
              AND n.supplier_currency = n.logistics_currency
             THEN n.additional_expenses ELSE 0 END
      + CASE WHEN n.logistics_amount_in_price IS TRUE
              AND n.supplier_currency = n.logistics_currency
             THEN n.invoice_amount ELSE 0 END
    , 4),
    ROUND(n.shipment_volume, 4),
    ROUND(n.buyer_shipped_amount, 4),
    ROUND(n.buy_gross, 4),
    ROUND(n.buy_refund, 4),
    ROUND(n.buy_offset, 4),
    ROUND(n.buy_gross - n.buy_refund + n.buy_offset, 4),
    -- Долг покупателя — там же, 00060 перевернул знак.
    ROUND((n.buy_gross - n.buy_refund + n.buy_offset) - n.buyer_shipped_amount, 4),
    ROUND(n.shipment_volume, 4),
    ROUND(n.invoice_amount, 4),
    -- Тариф факт (логисты): Сумма ÷ исходящее СНТ, KG и KZ (00182).
    -- Ручной ввод (override) на дату не пересчитывается: это
    -- закреплённое значение.
    CASE
      WHEN COALESCE(n.actual_tariff_override, FALSE) THEN n.manual_actual_tariff
      WHEN n.shipment_volume > 0 THEN ROUND(n.invoice_amount / n.shipment_volume, 4)
      ELSE NULL
    END,
    -- Тариф факт (грузоотпр.): Сумма грузоотправления ÷ входящее СНТ.
    CASE
      WHEN COALESCE(n.shipper_actual_tariff_override, FALSE) THEN n.manual_shipper_tariff
      WHEN n.loading_volume > 0 THEN ROUND(n.additional_expenses / n.loading_volume, 4)
      ELSE NULL
    END
  FROM snap n;
$$;
  $f5$;

  -- ── 3. Пересчёт ────────────────────────────────────────────────────
  -- Пустой UPDATE: BEFORE-триггер пересчитает Сумму 1, AFTER-триггеры
  -- подтянут invoice_amount, тариф факт и баланс сделки.
  IF array_length(v_upd_ids, 1) > 0 THEN
    UPDATE shipment_registry sr SET round_volume = sr.round_volume WHERE sr.id = ANY (v_upd_ids);
    GET DIAGNOSTICS v_upd = ROW_COUNT;
  END IF;

  -- KZ-сделки, у которых сменился только делитель тарифа факт.
  UPDATE deals d SET actual_tariff = d.actual_tariff
   WHERE d.deal_type = 'KZ'
     AND NOT COALESCE(d.actual_tariff_override, FALSE)
     AND d.actual_tariff IS DISTINCT FROM
         CASE WHEN d.invoice_amount IS NOT NULL AND COALESCE(d.actual_shipped_volume, 0) > 0
              THEN ROUND(d.invoice_amount / d.actual_shipped_volume, 4) END;
  GET DIAGNOSTICS v_kz = ROW_COUNT;

  -- ── 4. Сверка и печать строк ───────────────────────────────────────
  FOR r IN
    SELECT sr.id, d.deal_code, sr.wagon_number, sr.loading_volume, sr.shipment_volume,
           sr.shipped_tonnage_amount AS s1, sr.supplier_railway_amount AS s2,
           sr.additional_expenses AS s3,
           COALESCE(sr.currency, d.logistics_currency, '—') AS cur
      FROM shipment_registry sr LEFT JOIN deals d ON d.id = sr.deal_id
     WHERE sr.id::TEXT IN (SELECT jsonb_object_keys(v_rows_before))
     ORDER BY d.deal_code, sr.wagon_number NULLS FIRST, sr.id
  LOOP
    IF r.s1 IS DISTINCT FROM (v_rows_before -> r.id::TEXT ->> 's1_new')::NUMERIC
       OR r.s2 IS DISTINCT FROM (v_rows_before -> r.id::TEXT ->> 's2')::NUMERIC
       OR r.s3 IS DISTINCT FROM (v_rows_before -> r.id::TEXT ->> 's3')::NUMERIC THEN
      v_bad := v_bad + 1;
      RAISE WARNING 'РАСХОЖДЕНИЕ % вагон % [id %]: Сумма 1 % (ждали %), Сумма 2 % → %, Сумма 3 % → %',
        COALESCE(r.deal_code, 'без сделки'), COALESCE(r.wagon_number, '—'), r.id,
        r.s1, v_rows_before -> r.id::TEXT ->> 's1_new',
        v_rows_before -> r.id::TEXT ->> 's2', r.s2,
        v_rows_before -> r.id::TEXT ->> 's3', r.s3;
    END IF;
    RAISE NOTICE '% | вагон % | % | вход % исх % | округл % → % | Сумма 1 % → % % | id %',
      COALESCE(r.deal_code, 'без сделки'), COALESCE(r.wagon_number, '—'),
      CASE
        WHEN r.shipment_volume IS NULL AND r.loading_volume IS NOT NULL THEN 'только входящее'
        WHEN r.shipment_volume IS NOT NULL AND r.loading_volume IS NOT NULL THEN 'оба объёма'
        ELSE 'прочее'
      END,
      COALESCE(r.loading_volume::TEXT, '—'), COALESCE(r.shipment_volume::TEXT, '—'),
      COALESCE(v_rows_before -> r.id::TEXT ->> 'ro', '—'), COALESCE(v_rows_before -> r.id::TEXT ->> 'rn', '—'),
      COALESCE(v_rows_before -> r.id::TEXT ->> 's1', '—'), COALESCE(r.s1::TEXT, '—'), r.cur,
      r.id;
  END LOOP;

  IF v_bad > 0 THEN
    RAISE EXCEPTION '00182: % строк разошлись с ожидаемым (см. WARNING выше) — ничего не применено', v_bad;
  END IF;

  -- ── 5. Сделки и итоги ──────────────────────────────────────────────
  FOR dl IN
    SELECT id, deal_code, invoice_amount, actual_tariff, supplier_balance,
           COALESCE(logistics_currency, '—') AS cur
      FROM deals
     WHERE id::TEXT IN (SELECT jsonb_object_keys(v_deal_before))
     ORDER BY deal_code
  LOOP
    IF dl.invoice_amount IS DISTINCT FROM (v_deal_before -> dl.id::TEXT ->> 'inv')::NUMERIC
       OR dl.actual_tariff IS DISTINCT FROM (v_deal_before -> dl.id::TEXT ->> 'tf')::NUMERIC
       OR dl.supplier_balance IS DISTINCT FROM (v_deal_before -> dl.id::TEXT ->> 'sup')::NUMERIC THEN
      v_deals_changed := v_deals_changed + 1;
      RAISE NOTICE '%: Сумма (логисты) % → % %; тариф факт % → %; баланс поставщика % → %',
        dl.deal_code,
        COALESCE(v_deal_before -> dl.id::TEXT ->> 'inv', '—'), COALESCE(dl.invoice_amount::TEXT, '—'), dl.cur,
        COALESCE(v_deal_before -> dl.id::TEXT ->> 'tf', '—'), COALESCE(dl.actual_tariff::TEXT, '—'),
        COALESCE(v_deal_before -> dl.id::TEXT ->> 'sup', '—'), COALESCE(dl.supplier_balance::TEXT, '—');
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(cur, s), '{}') INTO v_tot_after
    FROM (SELECT COALESCE(sr.currency, d.logistics_currency, '—') AS cur,
                 SUM(sr.shipped_tonnage_amount) AS s
            FROM shipment_registry sr LEFT JOIN deals d ON d.id = sr.deal_id
           GROUP BY 1) t;

  RAISE NOTICE 'строк с другим «округл»/Суммой 1: %, пересчитано: %, сделок изменилось: %, KZ-сделок с новым тарифом факт без смены суммы: %',
    v_rows, v_upd, v_deals_changed, v_kz;
  RAISE NOTICE 'Сумма 1 по реестру, по валютам: до % → после %', v_tot_before, v_tot_after;
END $mig$;

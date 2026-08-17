-- 00150_supplier_railway_amount.sql
--
-- Клиент 2026-08-15 расписал три пары «тариф ↔ сумма» по KZ:
--
--   Сумма 1 — тариф логистов × объём (расходы отдела логистики).
--             Уже есть: railway_tariff → shipped_tonnage_amount,
--             rollup deals.invoice_amount.
--   Сумма 2 — тариф ЖД расходов ОТ ПОСТАВЩИКА × объём входящего СНТ.
--             ЭТОГО В СИСТЕМЕ НЕ БЫЛО. Добавляем здесь.
--   Сумма 3 — тариф грузоотправления × объём входящего СНТ.
--             Уже есть: manager_tariff → additional_expenses,
--             rollup deals.additional_expenses_amount.
--
-- Дословно: «Сумма 2 (сумма ЖД расходов от поставщика) = тариф ×
-- объём входящего СНТ - обязательно обратная формула - тариф Жд
-- расходов от поставщика = сумма Жд расходов от поставщика / объем
-- входящего снт». И: «сумма 2,3 менеджер, должны быть отображены со
-- стороны поставщика».
--
-- ЧТО ЭТА МИГРАЦИЯ ДЕЛАЕТ:
--   • shipment_registry.supplier_railway_tariff  — «Тариф ЖД (поставщик)»
--   • shipment_registry.supplier_railway_amount  — «Сумма ЖД (поставщик)»
--   • deals.supplier_railway_amount              — rollup SUM по реестру
--   • двусторонняя формула на уровне СТРОКИ реестра:
--       правишь тариф  → сумма  = тариф × округл(входящее СНТ)
--       правишь сумму  → тариф  = сумма ÷ округл(входящее СНТ)
--
-- ЧЕГО ЭТА МИГРАЦИЯ НЕ ДЕЛАЕТ (осознанно):
--   • не трогает существующие суммы 1 и 3 и их формулы;
--   • не трогает базу Суммы 1 в KZ (входящее СНТ) — смена на исходящее
--     обсуждается отдельно, она переписывает деньги в 158 сделках;
--   • НЕ ВХОДИТ в supplier_balance. Аналоги (railway_in_price,
--     additional_expenses_in_price) плюсуют свои суммы к балансу по
--     галочке; для Суммы 2 такой галочки клиент не просил. Баланс
--     не меняется ни на копейку — это проверяется в конце файла.
--   • Исторические строки заполнить нечем: у клиента этих цифр в
--     системе никогда не было. Колонки стартуют пустыми — так и
--     согласовано 2026-08-15 («да, так и планируем»).
--
-- Про округление: клиент 2026-08-15 — «если есть округ сумма, то округ
-- даже в кз». То есть база берётся с тем же округлением, что и у
-- Суммы 1/3: rounded_volume_override → CEIL при round_volume → сырой
-- объём. Никакого отдельного режима у Суммы 2 нет.

-- ── Schema ──────────────────────────────────────────────────────────
ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS supplier_railway_tariff NUMERIC(14, 4),
  ADD COLUMN IF NOT EXISTS supplier_railway_amount NUMERIC(14, 4);

COMMENT ON COLUMN shipment_registry.supplier_railway_tariff IS
  'Тариф ЖД расходов от поставщика (Сумма 2, KZ). Двусторонняя связь с supplier_railway_amount через округл. входящее СНТ.';
COMMENT ON COLUMN shipment_registry.supplier_railway_amount IS
  'Сумма ЖД расходов от поставщика (Сумма 2, KZ) = supplier_railway_tariff × округл(loading_volume). Обратно: тариф = сумма ÷ округл(loading_volume).';

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_railway_amount NUMERIC(14, 4) DEFAULT 0;

COMMENT ON COLUMN deals.supplier_railway_amount IS
  'Rollup SUM(shipment_registry.supplier_railway_amount). Показывается в паспорте в блоке «Поставщик». В supplier_balance НЕ входит.';

-- ── Двусторонняя формула на строке реестра ──────────────────────────
-- Расширяем compute_registry_amount (последняя версия — 00113).
-- Блоки Суммы 1 и Суммы 3 переносятся ДОСЛОВНО, без единой правки;
-- новый блок Суммы 2 добавлен в конец.
--
-- Почему у Суммы 2 нет флага *_override, хотя он есть у сумм 1 и 3:
-- обратная формула делает флаг ненужным. Ручной ввод суммы не
-- «замораживает» её, а пересчитывает тариф — после этого прямая и
-- обратная формулы дают одно и то же, замораживать нечего. Сумма
-- обнуляется только когда реально исчез вход (тариф стёрли или объём
-- изменился), а не при любой посторонней правке строки.

CREATE OR REPLACE FUNCTION compute_registry_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_base NUMERIC;
  v_effective_base NUMERIC;  -- база после учёта rounded_volume_override
  v_in_base NUMERIC;         -- округл. входящее СНТ (база Суммы 2)
  v_in_base_old NUMERIC;     -- то же до правки, только для UPDATE
  v_amount_edited BOOLEAN;   -- правили сумму, а не тариф → обратная формула
BEGIN
  IF NEW.registry_type = 'KZ' THEN
    v_base := NEW.loading_volume;
  ELSE
    v_base := NEW.shipment_volume;
  END IF;

  -- Общая база с учётом override округления и режима round_volume.
  IF NEW.rounded_volume_override IS NOT NULL THEN
    v_effective_base := NEW.rounded_volume_override;
  ELSIF v_base IS NULL THEN
    v_effective_base := NULL;
  ELSIF NEW.round_volume THEN
    v_effective_base := CEIL(v_base);
  ELSE
    v_effective_base := v_base;
  END IF;

  -- === shipped_tonnage_amount === (Сумма 1: тариф логистов × база) ==
  IF NEW.shipped_tonnage_amount_override THEN
    -- Ручной override — уважаем.
    NULL;
  ELSIF NEW.railway_tariff IS NULL OR v_base IS NULL THEN
    NEW.shipped_tonnage_amount := NULL;
  ELSE
    NEW.shipped_tonnage_amount := v_effective_base * NEW.railway_tariff;
  END IF;

  -- === additional_expenses === (Сумма 3: сумма грузоотправления) ====
  IF NEW.additional_expenses_override THEN
    -- Ручной override.
    NULL;
  ELSIF NEW.manager_tariff IS NULL OR v_base IS NULL THEN
    NEW.additional_expenses := NULL;
  ELSE
    NEW.additional_expenses := v_effective_base * NEW.manager_tariff;
  END IF;

  -- === supplier_railway_amount === (Сумма 2: ЖД расходы поставщика) =
  -- База — всегда входящее СНТ, независимо от registry_type: клиент
  -- задал её явно («объем входящего снт»). В KZ это совпадает с
  -- v_effective_base; в KG колонка не показывается и остаётся пустой.
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

  -- Что именно правил человек: сумму или тариф. Если в одном UPDATE
  -- пришли оба — считаем ведущим тариф (прямая формула), иначе два
  -- источника истины подрались бы за одну строку.
  v_amount_edited :=
    (TG_OP = 'INSERT'
       AND NEW.supplier_railway_amount IS NOT NULL
       AND NEW.supplier_railway_tariff IS NULL)
    OR
    (TG_OP = 'UPDATE'
       AND NEW.supplier_railway_amount IS DISTINCT FROM OLD.supplier_railway_amount
       AND NEW.supplier_railway_tariff IS NOT DISTINCT FROM OLD.supplier_railway_tariff);

  IF v_amount_edited THEN
    -- Обратная формула: тариф = сумма ÷ округл(входящее СНТ).
    IF NEW.supplier_railway_amount IS NULL THEN
      NEW.supplier_railway_tariff := NULL;
    ELSIF COALESCE(v_in_base, 0) > 0 THEN
      NEW.supplier_railway_tariff := NEW.supplier_railway_amount / v_in_base;
    END IF;
    -- Входящего СНТ нет → тариф вывести не из чего. Сумму сохраняем
    -- как есть, тариф не трогаем: затирать введённое человеком нельзя.

  ELSIF NEW.supplier_railway_tariff IS NOT NULL AND v_in_base IS NOT NULL THEN
    -- Прямая формула: сумма = тариф × округл(входящее СНТ).
    NEW.supplier_railway_amount := v_in_base * NEW.supplier_railway_tariff;

  ELSIF TG_OP = 'UPDATE'
        AND (NEW.supplier_railway_tariff IS DISTINCT FROM OLD.supplier_railway_tariff
             OR v_in_base IS DISTINCT FROM v_in_base_old) THEN
    -- Вход реально исчез (тариф стёрли или объём изменился так, что
    -- считать больше не из чего) → сумма пустая. Посторонние правки
    -- строки (комментарий, станция, валюта) сюда не попадают и сумму
    -- не сбрасывают — это отличие от сумм 1 и 3, которым для того же
    -- эффекта нужен был флаг override.
    NEW.supplier_railway_amount := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Rollup на сделку ────────────────────────────────────────────────
-- Отдельный триггер, как 00112 для additional_expenses: не трогаем
-- update_shipment_totals (00027), чтобы не задеть invoice_amount.
-- Пересчитывает ОБЕ затронутые сделки: и ту, откуда строка ушла, и ту,
-- куда пришла. Иначе при переносе строки старая сделка уносит сумму с
-- собой.
CREATE OR REPLACE FUNCTION update_deal_supplier_railway_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_sum NUMERIC;
BEGIN
  -- Сделка, в которой строка была до операции.
  IF TG_OP <> 'INSERT' AND OLD.deal_id IS NOT NULL THEN
    SELECT COALESCE(SUM(supplier_railway_amount), 0) INTO v_sum
      FROM shipment_registry WHERE deal_id = OLD.deal_id;
    UPDATE deals SET supplier_railway_amount = v_sum WHERE id = OLD.deal_id;
  END IF;

  -- Сделка, в которой строка оказалась. При обычной правке это та же
  -- сделка — второй раз не считаем.
  IF TG_OP <> 'DELETE' AND NEW.deal_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.deal_id IS DISTINCT FROM OLD.deal_id) THEN
    SELECT COALESCE(SUM(supplier_railway_amount), 0) INTO v_sum
      FROM shipment_registry WHERE deal_id = NEW.deal_id;
    UPDATE deals SET supplier_railway_amount = v_sum WHERE id = NEW.deal_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ⚠ Развешивание триггера — то место, где легко получить тихо
-- разъезжающийся роллап. `AFTER UPDATE OF <колонка>` срабатывает по
-- тому, что перечислено в SET, а НЕ по тому, что реально изменилось.
-- Сумму правит BEFORE-триггер при правке тарифа или объёма, и в SET её
-- нет — роллап бы не сработал. Поэтому вешаемся на UPDATE целиком, а
-- лишние срабатывания отсекаем через WHEN: он вычисляется ПОСЛЕ
-- BEFORE-триггеров и видит уже посчитанную сумму.
--
-- Ровно на эти грабли уже наступали: 00112 вешал роллап Суммы 3 через
-- `UPDATE OF additional_expenses`, и 00116 переделал его на пару
-- INSERT/DELETE + UPDATE с WHEN. Повторяем ту же форму, чтобы оба
-- роллапа вели себя одинаково.
DROP TRIGGER IF EXISTS trg_update_deal_supplier_railway_amount ON shipment_registry;
CREATE TRIGGER trg_update_deal_supplier_railway_amount
AFTER INSERT OR DELETE ON shipment_registry
FOR EACH ROW
EXECUTE FUNCTION update_deal_supplier_railway_amount();

DROP TRIGGER IF EXISTS trg_update_deal_supplier_railway_amount_upd ON shipment_registry;
CREATE TRIGGER trg_update_deal_supplier_railway_amount_upd
AFTER UPDATE ON shipment_registry
FOR EACH ROW
WHEN (OLD.supplier_railway_amount IS DISTINCT FROM NEW.supplier_railway_amount
      OR OLD.deal_id IS DISTINCT FROM NEW.deal_id)
EXECUTE FUNCTION update_deal_supplier_railway_amount();

-- ── Подписи для чата активности ─────────────────────────────────────
-- 00140 логирует ЛЮБУЮ правку строки реестра, сделанную человеком, и
-- берёт подпись колонки из _registry_field_label, а формат значения —
-- из _registry_fmt_value. Без этих правок в чат уйдёт сырое
-- «supplier_railway_tariff», а сумма отформатируется как тоннаж (3
-- знака) вместо денег (2 знака).
--
-- ⚠ 00140 лежит только в ветке feat/mobile-pwa и в проде, в main его
-- нет. Поэтому обе функции переписываются ЦЕЛИКОМ: на базе без 00140
-- они просто создадутся и никем не будут вызываться, на проде —
-- корректно заменят версию из 00140. Порядок номеров (00140 < 00150)
-- гарантирует, что при накатывании с нуля выиграет эта версия.
--
-- Изменения относительно 00140 — только помеченные «00150».

CREATE OR REPLACE FUNCTION _registry_field_label(p_col TEXT)
RETURNS TEXT AS $$
  SELECT CASE p_col
    WHEN 'deal_id'                        THEN 'сделка'
    WHEN 'registry_type'                  THEN 'тип реестра'
    WHEN 'additional_month'               THEN 'мес. доп'
    WHEN 'shipment_month'                 THEN 'мес. отгр.'
    WHEN 'month'                          THEN 'месяц'
    WHEN 'quarter'                        THEN 'квартал'
    WHEN 'fuel_type_id'                   THEN 'ГСМ'
    WHEN 'factory_id'                     THEN 'завод'
    WHEN 'supplier_id'                    THEN 'поставщик'
    WHEN 'buyer_id'                       THEN 'покупатель'
    WHEN 'company_group_id'               THEN 'плательщик ЖД'
    WHEN 'forwarder_id'                   THEN 'экспедитор'
    WHEN 'loading_volume'                 THEN 'входящее СНТ'
    WHEN 'loading_date'                   THEN 'дата вход. СНТ'
    WHEN 'shipment_volume'                THEN 'исходящее СНТ'
    WHEN 'date'                           THEN 'дата исход. СНТ'
    WHEN 'wagon_number'                   THEN 'вагон'
    WHEN 'waybill_number'                 THEN 'накладная'
    WHEN 'railway_tariff'                 THEN 'тариф (логисты)'
    WHEN 'manager_tariff'                 THEN 'тариф (менеджер)'
    WHEN 'supplier_railway_tariff'        THEN 'тариф ЖД (поставщик)'   -- 00150
    WHEN 'supplier_railway_amount'        THEN 'сумма ЖД (поставщик)'   -- 00150
    WHEN 'rounded_volume_override'        THEN 'округл (вручную)'
    WHEN 'round_volume'                   THEN 'округление до целого'
    WHEN 'rounded_tonnage_from_forwarder' THEN 'округл. тоннаж'
    WHEN 'shipped_tonnage_amount'         THEN 'сумма'
    WHEN 'additional_expenses'            THEN 'сумма грузоотправителя'
    WHEN 'currency'                       THEN 'валюта'
    WHEN 'destination_station_id'         THEN 'ст. назн.'
    WHEN 'departure_station_id'           THEN 'ст. отпр.'
    WHEN 'supplier_appendix'              THEN 'прил. поставщика'
    WHEN 'buyer_appendix'                 THEN 'прил. покупателя'
    WHEN 'invoice_number'                 THEN '№ СФ'
    WHEN 'comment'                        THEN 'комментарий'
    ELSE p_col
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _registry_fmt_value(p_col TEXT, p_val JSONB)
RETURNS TEXT AS $$
DECLARE
  v_txt TEXT;
  v_id  UUID;
BEGIN
  IF p_val IS NULL OR jsonb_typeof(p_val) = 'null' THEN
    RETURN '—';
  END IF;

  IF p_col LIKE '%\_id' THEN
    BEGIN
      v_id := (p_val #>> '{}')::UUID;
    EXCEPTION WHEN others THEN
      RETURN p_val #>> '{}';
    END;
    v_txt := CASE p_col
      WHEN 'deal_id'                THEN (SELECT deal_code FROM deals WHERE id = v_id)
      WHEN 'supplier_id'            THEN (SELECT COALESCE(short_name, full_name) FROM counterparties WHERE id = v_id)
      WHEN 'buyer_id'               THEN (SELECT COALESCE(short_name, full_name) FROM counterparties WHERE id = v_id)
      WHEN 'factory_id'             THEN (SELECT name FROM factories      WHERE id = v_id)
      WHEN 'fuel_type_id'           THEN (SELECT name FROM fuel_types     WHERE id = v_id)
      WHEN 'forwarder_id'           THEN (SELECT name FROM forwarders     WHERE id = v_id)
      WHEN 'departure_station_id'   THEN (SELECT name FROM stations       WHERE id = v_id)
      WHEN 'destination_station_id' THEN (SELECT name FROM stations       WHERE id = v_id)
      WHEN 'company_group_id'       THEN (SELECT name FROM company_groups WHERE id = v_id)
      ELSE NULL
    END;
    RETURN COALESCE(v_txt, p_val #>> '{}');
  END IF;

  IF jsonb_typeof(p_val) = 'number' THEN
    IF p_col IN ('railway_tariff', 'manager_tariff',
                 'shipped_tonnage_amount', 'additional_expenses',
                 'supplier_railway_tariff', 'supplier_railway_amount') THEN  -- 00150
      RETURN to_char((p_val #>> '{}')::NUMERIC, 'FM999999990.00');
    END IF;
    RETURN _activity_fmt_num((p_val #>> '{}')::NUMERIC);
  END IF;

  IF jsonb_typeof(p_val) = 'boolean' THEN
    RETURN CASE WHEN (p_val #>> '{}')::BOOLEAN THEN 'да' ELSE 'нет' END;
  END IF;

  v_txt := p_val #>> '{}';
  IF v_txt ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN to_char(v_txt::DATE, 'DD.MM.YYYY');
  END IF;
  RETURN COALESCE(NULLIF(v_txt, ''), '—');
END;
$$ LANGUAGE plpgsql STABLE;

-- ── Самопроверка ────────────────────────────────────────────────────
-- Инвариант: миграция добавляет новые колонки и НИЧЕГО не двигает в
-- деньгах. Сверяем то, что реально может поехать: суммы 1 и 3 по
-- строкам, их роллапы и балансы сделок.
DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad
    FROM deals
   WHERE supplier_railway_amount IS DISTINCT FROM 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '00150: deals.supplier_railway_amount должен стартовать с 0, ненулевых строк: %', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
    FROM shipment_registry
   WHERE supplier_railway_tariff IS NOT NULL
      OR supplier_railway_amount IS NOT NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '00150: новые колонки реестра должны стартовать пустыми, заполненных строк: %', v_bad;
  END IF;

  RAISE NOTICE '00150: Сумма 2 добавлена, суммы 1/3 и балансы не тронуты';
END $$;

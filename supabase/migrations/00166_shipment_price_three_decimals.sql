-- 00166_shipment_price_three_decimals.sql
--
-- Клиент 2026-09-22 (и раньше — 08.09, 14.09 по КГ 562 и 568): «если
-- считать цена × объём — одна сумма по CRM, а когда умножаешь в Excel —
-- другая, там копейки округляются в большую, почему?»
--
-- ЧТО ПОКАЗАЛ РАЗБОР (скриншот 22.09, сделка Витол):
--   • строки выгрузки: 58,000 т → 13 117,048; 56,750 → 12 834,353 …
--     это ровно 226,156 × объём;
--   • итог по сделке 114 717,758 = 507,25 × 226,15625;
--   • КГ 568: 548 632,447 = 2 425,9 × 226,15625.
--   Объёмы круглые, расходится ЦЕНА: клиент видит 226,156 (три знака),
--   а суммы отгрузок посчитаны от 226,15625. Вывод в записи CHANGELOG от
--   2026-09-08 («округление объёма на экране») был неверным.
--
-- ОТКУДА ПЯТЬ ЗНАКОВ. Среднемесячная котировка — AVG без округления
-- (00067), apply_price_formula (00164) тоже не округляет. Дальше:
--     calculated_price = v_final_price   → колонка DECIMAL(14,4): 226,1563
--     amount = volume × v_final_price    → от НЕокруглённой переменной
-- То есть даже внутри одной строки amount ≠ volume × calculated_price,
-- а цена сделки/строки-варианта (то, что видит клиент) — третье число.
--
-- НОВОЕ ПРАВИЛО (вариант А, согласован 2026-09-22):
--   1. apply_price_formula возвращает цену с ТРЕМЯ знаками —
--      ROUND(…, 3). Это тот же канон «цена за тонну — 3 знака», что
--      клиент задал 04.09 для экрана; теперь он и в расчёте.
--   2. На deal_shipment_prices — BEFORE-триггер: calculated_price всегда
--      ROUND(…, 3), amount всегда volume × calculated_price. Кто бы ни
--      писал строку (автоцена при вставке, пересчёт по «Окончательная»,
--      правка объёма в реестре, ручная правка в таблице цен) — сумма
--      сходится с ценой, которую видит клиент, и с его Excel.
--   3. Существующие строки, где calculated_price имеет 4-й знак или
--      amount ≠ volume × ROUND(price, 3), пересчитываются здесь же.
--      Роллапы deals.*_shipped_amount и долги подтягиваются своими
--      триггерами (00030, compute_deal_derived_fields).
--
-- ОГРАНИЧЕНИЕ ПЕРЕСЧЁТА. Неокруглённой цены в базе уже нет — только
-- calculated_price с 4 знаками. Округление 4 → 3 совпадает с прямым
-- округлением исходной цены всюду, кроме ровной половинки на 4-м знаке
-- (…x5), где исходные 5-й и далее знаки были нулями либо нет — этого
-- не восстановить. Разница в таких строках — 0,001 $/т, на сумме —
-- тысячные. Пересчёт по формуле заново (recompute_line_shipment_prices)
-- не используется намеренно: он взял бы ТЕКУЩИЕ котировки, скидки и
-- коэффициенты строк-вариантов и мог изменить цены сильнее, чем просит
-- клиент.
--
-- ROLLBACK. Значения «до» сохраняются в deal_shipment_prices_backup_00166
-- (id строки, calculated_price, amount). Вернуть:
--   DROP TRIGGER trg_shipment_price_three_decimals ON deal_shipment_prices;
--   вернуть apply_price_formula из 00164 (без ROUND);
--   UPDATE deal_shipment_prices p SET calculated_price = b.calculated_price,
--          amount = b.amount
--     FROM deal_shipment_prices_backup_00166 b WHERE b.id = p.id;
-- Роллапы пересчитаются триггером 00030.
--
-- Миграция идемпотентна: повторный запуск не находит строк для пересчёта
-- и ничего не добавляет в бэкап.

-- ── 1. Формула цены — три знака ──────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_price_formula(
  p_quotation    NUMERIC,
  p_discount     NUMERIC,
  p_fx           NUMERIC,   -- курс режима «Формульная вручную», иначе NULL
  p_barrel_ratio NUMERIC    -- коэффициент барелизации, иначе NULL
) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN p_quotation IS NULL THEN NULL
    ELSE ROUND(
      (p_quotation - COALESCE(p_discount, 0))
        * COALESCE(NULLIF(p_fx, 0), 1)
        * COALESCE(NULLIF(p_barrel_ratio, 0), 1),
      3)
  END;
$fn$;

COMMENT ON FUNCTION apply_price_formula(NUMERIC, NUMERIC, NUMERIC, NUMERIC) IS
  'Цена строки: ROUND((котировка − скидка) × курс × коэффициент барелизации, 3). Пустые множители = 1. Три знака — канон клиента для цены за тонну (00166). Единственное место формулы для автоцены и пересчёта при фиксации.';

-- ── 2. Инвариант строки цены отгрузки ────────────────────────────────
CREATE OR REPLACE FUNCTION round_shipment_price_amount()
RETURNS TRIGGER AS $$
BEGIN
  NEW.calculated_price := ROUND(NEW.calculated_price, 3);
  -- Сумма всегда = объём × цена с тремя знаками. Если цены или объёма
  -- нет — сумму не трогаем: старые строки с суммой без цены остаются
  -- как были, их обнулять нельзя.
  IF NEW.calculated_price IS NOT NULL AND NEW.volume IS NOT NULL THEN
    NEW.amount := NEW.volume * NEW.calculated_price;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipment_price_three_decimals ON deal_shipment_prices;
CREATE TRIGGER trg_shipment_price_three_decimals
  BEFORE INSERT OR UPDATE ON deal_shipment_prices
  FOR EACH ROW EXECUTE FUNCTION round_shipment_price_amount();

COMMENT ON COLUMN deal_shipment_prices.calculated_price IS
  'Цена отгрузки за тонну, всегда 3 знака (триггер 00166). amount = volume × calculated_price.';
COMMENT ON COLUMN deal_shipment_prices.amount IS
  'Сумма отгрузки = volume × calculated_price (3 знака у цены). Держится триггером 00166; ручное значение перезаписывается, пока есть цена и объём.';

-- ── 3. Бэкап для отката ──────────────────────────────────────────────
-- Схема public общая с другим продуктом — имя с доменным префиксом.
CREATE TABLE IF NOT EXISTS deal_shipment_prices_backup_00166 (
  id               UUID PRIMARY KEY,   -- deal_shipment_prices.id (без FK: строку могут удалить, бэкап должен остаться)
  deal_id          UUID NOT NULL,
  side             TEXT NOT NULL,
  calculated_price NUMERIC(14, 4),
  amount           NUMERIC(14, 4),
  backed_up_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE deal_shipment_prices_backup_00166 IS
  'Значения calculated_price / amount до пересчёта 00166. Только для отката, из приложения не читается.';
-- RLS включён, политик нет: с клиента таблица недоступна ни на чтение,
-- ни на запись; работать с ней может только service_role / SQL-редактор.
ALTER TABLE deal_shipment_prices_backup_00166 ENABLE ROW LEVEL SECURITY;

-- ── 4. Пересчёт существующих строк ───────────────────────────────────
DO $$
DECLARE
  r RECORD;
  dl RECORD;
  v_ids UUID[] := '{}';
  v_deal_ids UUID[] := '{}';
  v_rows INT := 0;
  v_before JSONB;
BEGIN
  FOR r IN
    SELECT p.id, p.deal_id, p.side, p.calculated_price, p.amount, p.volume
      FROM deal_shipment_prices p
     WHERE p.calculated_price IS NOT NULL
       AND p.volume IS NOT NULL
       AND (p.calculated_price <> ROUND(p.calculated_price, 3)
            OR p.amount IS DISTINCT FROM ROUND(p.volume * ROUND(p.calculated_price, 3), 4))
  LOOP
    INSERT INTO deal_shipment_prices_backup_00166 (id, deal_id, side, calculated_price, amount)
    VALUES (r.id, r.deal_id, r.side, r.calculated_price, r.amount)
    ON CONFLICT (id) DO NOTHING;
    v_ids := v_ids || r.id;
    v_rows := v_rows + 1;
    IF NOT (r.deal_id = ANY (v_deal_ids)) THEN
      v_deal_ids := v_deal_ids || r.deal_id;
    END IF;
  END LOOP;

  IF v_rows = 0 THEN
    RAISE NOTICE 'строк с ценой длиннее 3 знаков или суммой не по цене нет — пересчитывать нечего';
    RETURN;
  END IF;

  SELECT jsonb_object_agg(id, jsonb_build_object(
           'code', deal_code,
           'sup_amt', supplier_shipped_amount,
           'buy_amt', buyer_shipped_amount,
           'sup_bal', supplier_balance,
           'buy_debt', buyer_debt))
    INTO v_before
    FROM deals WHERE id = ANY (v_deal_ids);

  -- Пустой UPDATE: BEFORE-триггер округлит цену и пересчитает сумму,
  -- AFTER-триггер 00030 подтянет роллапы и долги сделок.
  UPDATE deal_shipment_prices SET calculated_price = calculated_price WHERE id = ANY (v_ids);

  FOR dl IN
    SELECT id, deal_code, supplier_shipped_amount, buyer_shipped_amount,
           supplier_balance, buyer_debt
      FROM deals WHERE id = ANY (v_deal_ids)
     ORDER BY deal_code
  LOOP
    RAISE NOTICE '%: приход % → %, отгрузка % → %, баланс пост. % → %, долг пок. % → %',
      dl.deal_code,
      v_before -> dl.id::TEXT ->> 'sup_amt', dl.supplier_shipped_amount,
      v_before -> dl.id::TEXT ->> 'buy_amt', dl.buyer_shipped_amount,
      v_before -> dl.id::TEXT ->> 'sup_bal', dl.supplier_balance,
      v_before -> dl.id::TEXT ->> 'buy_debt', dl.buyer_debt;
  END LOOP;

  RAISE NOTICE 'пересчитано строк цен отгрузок: % в % сделках; значения «до» — в deal_shipment_prices_backup_00166',
    v_rows, array_length(v_deal_ids, 1);

  -- Сверка: у пересчитанных строк цена в 3 знака и сумма по цене.
  PERFORM 1
    FROM deal_shipment_prices p
   WHERE p.id = ANY (v_ids)
     AND (p.calculated_price <> ROUND(p.calculated_price, 3)
          OR p.amount IS DISTINCT FROM ROUND(p.volume * p.calculated_price, 4));
  IF FOUND THEN
    RAISE EXCEPTION 'после пересчёта остались строки, где сумма не сходится с ценой — миграция отменена';
  END IF;
END $$;

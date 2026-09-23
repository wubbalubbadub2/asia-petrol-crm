-- 00164_barrel_ratio.sql
--
-- Клиент (WhatsApp, 2026-09-18/19): «Можно ли по всем сделкам по нефти
-- добавить дополнительное поле — Коэффициент барелизации. Он необходим
-- для перевода котировочной цены Брент долл/баррель в цену расчёта
-- долл/тонна. Формула расчёта (предварительная и финальная): Цена нефти
-- долл/тонна = (Котировка Brent долл/баррель (среднемесячная или на
-- дату, как по договору) минус скидка в долл/баррель) * коэффициент
-- барелизации».
--
-- СОГЛАСОВАНО 2026-09-19:
--   • коэффициент живёт НА СТРОКЕ-ВАРИАНТЕ — рядом со скидкой и
--     котировкой, отдельно у поставщика и у покупателя (у приложений
--     бывают разные условия);
--   • скидка при этом вводится в долл/баррель, то есть вычитается ДО
--     умножения: (котировка − скидка) × коэффициент;
--   • исторические сделки пересчитываются по кнопке «Окончательная»
--     (тот же путь, что и обычная фиксация цены), а не молча.
--
-- ЕДИНИЦЫ И ЗНАКИ: котировка — долл/баррель, скидка — долл/баррель,
-- коэффициент — баррелей в тонне (около 7,6 для Brent), цена — долл/тонна.
-- Пустой коэффициент = формула как раньше (цена = котировка − скидка),
-- поэтому ни одна существующая сделка от этой миграции не меняется.
-- Ноль и отрицательные значения запрещены CHECK: ноль обнулил бы цену.
--
-- ЧТО МЕНЯЕТСЯ В КОДЕ. Формула цены была продублирована в четырёх местах
-- (две стороны × два режима) в autoprice_registry_insert и ещё в двух в
-- recompute_line_shipment_prices. Вместо того чтобы добавить множитель в
-- шести местах, формула вынесена в одну функцию apply_price_formula —
-- дальше её зовут все пути расчёта. autoprice_registry_update формулу не
-- считает (берёт готовую цену сделки), поэтому не трогается.
--
-- ROLLBACK: ALTER TABLE deal_supplier_lines DROP COLUMN barrel_ratio;
--           ALTER TABLE deal_buyer_lines    DROP COLUMN barrel_ratio;
--           затем вернуть прежние тела двух функций из 00071/00148.
--           Данные не пострадают: пустой коэффициент ничего не менял.

-- ── 1. Поле ──────────────────────────────────────────────────────────
ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS barrel_ratio NUMERIC(14, 6);
ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS barrel_ratio NUMERIC(14, 6);

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_supplier_lines_barrel_ratio_chk') THEN
    ALTER TABLE deal_supplier_lines
      ADD CONSTRAINT deal_supplier_lines_barrel_ratio_chk CHECK (barrel_ratio IS NULL OR barrel_ratio > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_buyer_lines_barrel_ratio_chk') THEN
    ALTER TABLE deal_buyer_lines
      ADD CONSTRAINT deal_buyer_lines_barrel_ratio_chk CHECK (barrel_ratio IS NULL OR barrel_ratio > 0);
  END IF;
END
$chk$;

COMMENT ON COLUMN deal_supplier_lines.barrel_ratio IS
  'Коэффициент барелизации (баррелей в тонне). Цена = (котировка − скидка) × коэффициент. Пусто — формула без множителя.';
COMMENT ON COLUMN deal_buyer_lines.barrel_ratio IS
  'Коэффициент барелизации (баррелей в тонне). Цена = (котировка − скидка) × коэффициент. Пусто — формула без множителя.';

-- ── 2. Единая формула цены ───────────────────────────────────────────
-- Один источник правды: и предварительная цена (её считает интерфейс),
-- и финальная (её считают функции ниже) обязаны давать одно число.
CREATE OR REPLACE FUNCTION apply_price_formula(
  p_quotation    NUMERIC,
  p_discount     NUMERIC,
  p_fx           NUMERIC,   -- курс режима «Формульная вручную», иначе NULL
  p_barrel_ratio NUMERIC    -- коэффициент барелизации, иначе NULL
) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN p_quotation IS NULL THEN NULL
    ELSE (p_quotation - COALESCE(p_discount, 0))
         * COALESCE(NULLIF(p_fx, 0), 1)
         * COALESCE(NULLIF(p_barrel_ratio, 0), 1)
  END;
$fn$;

COMMENT ON FUNCTION apply_price_formula(NUMERIC, NUMERIC, NUMERIC, NUMERIC) IS
  'Цена строки: (котировка − скидка) × курс × коэффициент барелизации. Пустые множители = 1. Единственное место формулы для автоцены и пересчёта при фиксации.';

-- ── 3. Пути расчёта читают коэффициент ───────────────────────────────
-- Тела функций перенесены из боевой базы ДОСЛОВНО; изменены только
-- строки, где считается цена, и SELECT, который читает строку-вариант.

CREATE OR REPLACE FUNCTION public.autoprice_registry_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_sup_price          NUMERIC;
  v_sup_discount       NUMERIC;
  v_sup_quotation      NUMERIC;
  v_sup_fx             NUMERIC;
  v_sup_condition      TEXT;
  v_sup_quotation_type UUID;
  v_sup_stage          TEXT;
  v_sup_ratio          NUMERIC;
  v_buy_price          NUMERIC;
  v_buy_discount       NUMERIC;
  v_buy_quotation      NUMERIC;
  v_buy_fx             NUMERIC;
  v_buy_condition      TEXT;
  v_buy_quotation_type UUID;
  v_buy_stage          TEXT;
  v_buy_ratio          NUMERIC;
  v_year               INT;
  v_month              INT;
  v_monthly_avg        NUMERIC;
  v_final_price        NUMERIC;
  v_final_quotation    NUMERIC;
BEGIN
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT y, m INTO v_year, v_month
  FROM resolve_shipment_year_month(NEW.date, NEW.shipment_month, NEW.deal_id);

  -- Supplier side: налив
  IF NEW.loading_volume IS NOT NULL THEN
    IF NEW.supplier_line_id IS NOT NULL THEN
      SELECT price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage, barrel_ratio
        INTO v_sup_price, v_sup_discount, v_sup_quotation, v_sup_fx,
             v_sup_condition, v_sup_quotation_type, v_sup_stage, v_sup_ratio
      FROM deal_supplier_lines
      WHERE id = NEW.supplier_line_id;
    ELSE
      SELECT price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage, barrel_ratio
        INTO v_sup_price, v_sup_discount, v_sup_quotation, v_sup_fx,
             v_sup_condition, v_sup_quotation_type, v_sup_stage, v_sup_ratio
      FROM deal_supplier_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    v_final_price     := v_sup_price;
    v_final_quotation := NULL;

    IF v_sup_stage = 'final' THEN
      IF v_sup_condition = 'average_month'
         AND v_sup_quotation_type IS NOT NULL
         AND v_year IS NOT NULL AND v_month IS NOT NULL THEN
        v_monthly_avg := compute_monthly_quotation_avg(v_sup_quotation_type, v_year, v_month);
        IF v_monthly_avg IS NOT NULL THEN
          v_final_quotation := v_monthly_avg;
          v_final_price     := apply_price_formula(v_monthly_avg, v_sup_discount, NULL, v_sup_ratio);
        END IF;
      ELSIF v_sup_condition = 'manual_formula'
            AND v_sup_quotation IS NOT NULL AND v_sup_fx IS NOT NULL THEN
        v_final_quotation := v_sup_quotation;
        v_final_price     := apply_price_formula(v_sup_quotation, v_sup_discount, v_sup_fx, v_sup_ratio);
      END IF;
    END IF;

    IF v_final_price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, quotation_avg, calculated_price, amount, discount
      ) VALUES (
        NEW.deal_id, 'supplier', NEW.id,
        NEW.date, NEW.loading_volume, v_final_quotation, v_final_price,
        NEW.loading_volume * v_final_price,
        v_sup_discount
      );
    END IF;
  END IF;

  -- Buyer side: отгрузка
  IF NEW.shipment_volume IS NOT NULL THEN
    IF NEW.buyer_line_id IS NOT NULL THEN
      SELECT price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage, barrel_ratio
        INTO v_buy_price, v_buy_discount, v_buy_quotation, v_buy_fx,
             v_buy_condition, v_buy_quotation_type, v_buy_stage, v_buy_ratio
      FROM deal_buyer_lines
      WHERE id = NEW.buyer_line_id;
    ELSE
      SELECT price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage, barrel_ratio
        INTO v_buy_price, v_buy_discount, v_buy_quotation, v_buy_fx,
             v_buy_condition, v_buy_quotation_type, v_buy_stage, v_buy_ratio
      FROM deal_buyer_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    v_final_price     := v_buy_price;
    v_final_quotation := NULL;

    IF v_buy_stage = 'final' THEN
      IF v_buy_condition = 'average_month'
         AND v_buy_quotation_type IS NOT NULL
         AND v_year IS NOT NULL AND v_month IS NOT NULL THEN
        v_monthly_avg := compute_monthly_quotation_avg(v_buy_quotation_type, v_year, v_month);
        IF v_monthly_avg IS NOT NULL THEN
          v_final_quotation := v_monthly_avg;
          v_final_price     := apply_price_formula(v_monthly_avg, v_buy_discount, NULL, v_buy_ratio);
        END IF;
      ELSIF v_buy_condition = 'manual_formula'
            AND v_buy_quotation IS NOT NULL AND v_buy_fx IS NOT NULL THEN
        v_final_quotation := v_buy_quotation;
        v_final_price     := apply_price_formula(v_buy_quotation, v_buy_discount, v_buy_fx, v_buy_ratio);
      END IF;
    END IF;

    IF v_final_price IS NOT NULL THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, quotation_avg, calculated_price, amount, discount
      ) VALUES (
        NEW.deal_id, 'buyer', NEW.id,
        NEW.date, NEW.shipment_volume, v_final_quotation, v_final_price,
        NEW.shipment_volume * v_final_price,
        v_buy_discount
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_line_shipment_prices(p_line_id uuid, p_side text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_price          NUMERIC;
  v_discount       NUMERIC;
  v_quotation      NUMERIC;
  v_fx             NUMERIC;
  v_condition      TEXT;
  v_quotation_type UUID;
  v_stage          TEXT;
  v_year           INT;
  v_month          INT;
  v_monthly_avg    NUMERIC;
  v_final_price    NUMERIC;
  v_final_quote    NUMERIC;
  v_volume         NUMERIC;
  v_ratio          NUMERIC;
  r                RECORD;
  v_count          INT := 0;
BEGIN
  IF p_side NOT IN ('supplier', 'buyer') THEN
    RAISE EXCEPTION 'side must be supplier or buyer, got %', p_side;
  END IF;

  IF p_side = 'supplier' THEN
    SELECT price, COALESCE(discount, 0), quotation, fx_rate,
           price_condition::TEXT, quotation_type_id, price_stage, barrel_ratio
      INTO v_price, v_discount, v_quotation, v_fx,
           v_condition, v_quotation_type, v_stage, v_ratio
    FROM deal_supplier_lines WHERE id = p_line_id;
  ELSE
    SELECT price, COALESCE(discount, 0), quotation, fx_rate,
           price_condition::TEXT, quotation_type_id, price_stage, barrel_ratio
      INTO v_price, v_discount, v_quotation, v_fx,
           v_condition, v_quotation_type, v_stage, v_ratio
    FROM deal_buyer_lines WHERE id = p_line_id;
  END IF;

  -- manual_formula needs quotation + fx_rate; other modes need price.
  IF v_price IS NULL
     AND v_condition NOT IN ('average_month', 'manual_formula') THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT sr.id, sr.date, sr.shipment_month, sr.deal_id,
           CASE WHEN p_side = 'supplier' THEN sr.loading_volume ELSE sr.shipment_volume END AS vol
    FROM shipment_registry sr
    WHERE CASE WHEN p_side = 'supplier'
               THEN sr.supplier_line_id = p_line_id
               ELSE sr.buyer_line_id    = p_line_id END
  LOOP
    v_volume := r.vol;
    IF v_volume IS NULL THEN
      CONTINUE;
    END IF;

    SELECT y, m INTO v_year, v_month
    FROM resolve_shipment_year_month(r.date, r.shipment_month, r.deal_id);

    v_final_price := v_price;
    v_final_quote := NULL;

    IF v_stage = 'final' THEN
      IF v_condition = 'average_month'
         AND v_quotation_type IS NOT NULL
         AND v_year IS NOT NULL AND v_month IS NOT NULL THEN
        v_monthly_avg := compute_monthly_quotation_avg(v_quotation_type, v_year, v_month);
        IF v_monthly_avg IS NOT NULL THEN
          v_final_quote := v_monthly_avg;
          v_final_price := apply_price_formula(v_monthly_avg, v_discount, NULL, v_ratio);
        END IF;
      ELSIF v_condition = 'manual_formula'
            AND v_quotation IS NOT NULL AND v_fx IS NOT NULL THEN
        v_final_quote := v_quotation;
        v_final_price := apply_price_formula(v_quotation, v_discount, v_fx, v_ratio);
      END IF;
    END IF;

    IF v_final_price IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE deal_shipment_prices
      SET quotation_avg = v_final_quote,
          calculated_price = v_final_price,
          discount = v_discount,
          volume = v_volume,
          amount = v_volume * v_final_price,
          shipment_date = r.date
    WHERE shipment_registry_id = r.id AND side = p_side;

    IF NOT FOUND THEN
      INSERT INTO deal_shipment_prices (
        deal_id, side, shipment_registry_id,
        shipment_date, volume, quotation_avg, calculated_price, amount, discount
      ) VALUES (
        r.deal_id, p_side, r.id,
        r.date, v_volume, v_final_quote, v_final_price,
        v_volume * v_final_price, v_discount
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

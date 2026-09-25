-- 00173_shipments_use_line_quotation.sql
--
-- Клиент 2026-09-25 (скриншот КГ/26/346, «Финальная цена — по
-- отгрузкам»): «в отгрузках должна быть котировка, которая идёт в
-- сделке, и она должна браться с месяца расчёта. Если введена вручную —
-- это остаётся, но если меняется месяц или другие поля — пересчитывается».
--
-- Это уточняет решение того же дня (00172, «месяц отгрузки»): месяц
-- отгрузки на котировку «Среднего месяца» больше не влияет.
--
-- КАК БЫЛО (00067 → 00164 → 00172). Финальная «Средний месяц»: каждая
-- отгрузка — compute_monthly_quotation_avg за месяц СВОЕЙ даты. Котировку
-- варианта («Котировка значение» в карточке), «Месяц расчёта» и
-- подкотировку пересчёт не читал. КГ/26/346: в карточке 591,587 → цена
-- 376,587, у отгрузок июнь 575,977 → 360,977.
--
-- КАК СТАЛО. Котировка отгрузок = котировка варианта
-- (line_formula_quotation):
--   1. «Котировка значение» варианта, если заполнена (подтянута по
--      «Месяцу расчёта» или вписана руками — остаётся как есть);
--   2. иначе — средняя за «Месяц расчёта» (без него — месяц сделки), по
--      выбранной подкотировке; в режиме «на дату» — котировка на дату.
-- Цена = apply_price_formula(котировка, скидка, NULL, коэффициент) —
-- ровно как «Цена» в карточке. Смена месяца / подкотировки / режима в
-- карточке подтягивает котировку заново (интерфейс, 1279293), затем
-- пересчёт отгрузок (как и раньше при финальной стадии).
-- Ручная «Цена» (00171) — по-прежнему главнее.
-- «Формульная вручную», фикс, триггер, ручная — без изменений.
--
-- ДАННЫЕ. Миграция ничего не пересчитывает. Отгрузки, которые сейчас
-- расходятся с котировкой варианта, показывает
-- scripts/formula-month-drift.sql; пересчёт — по согласованному списку:
--   SELECT recompute_line_shipment_prices(<id варианта>, 'supplier'|'buyer');
--
-- ROLLBACK. Вернуть autoprice_registry_insert из 00164 и
-- recompute_line_shipment_prices(uuid, text, uuid) из 00172; функцию
-- line_formula_quotation можно оставить — её больше никто не зовёт.

-- ── 1. Котировка варианта ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.line_formula_quotation(p_side TEXT, p_line_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  l   RECORD;
  v_y INT;
  v_m INT;
BEGIN
  IF p_line_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_side = 'supplier' THEN
    SELECT quotation, quotation_type_id, price_source, calc_mode::TEXT AS calc_mode,
           selected_month, selected_date, deal_id
      INTO l FROM deal_supplier_lines WHERE id = p_line_id;
  ELSE
    SELECT quotation, quotation_type_id, price_source, calc_mode::TEXT AS calc_mode,
           selected_month, selected_date, deal_id
      INTO l FROM deal_buyer_lines WHERE id = p_line_id;
  END IF;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 1. Котировка, которая стоит в варианте.
  IF l.quotation IS NOT NULL THEN
    RETURN l.quotation;
  END IF;

  -- 2. Пусто — считаем так же, как карточка.
  IF l.quotation_type_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF l.calc_mode = 'on_date' THEN
    IF l.selected_date IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN compute_quotation_value(l.quotation_type_id, COALESCE(l.price_source, 'price'),
                                   l.selected_date, 'on_date');
  END IF;

  IF l.selected_month ~ '^\d{4}-\d{2}$' THEN
    v_y := split_part(l.selected_month, '-', 1)::INT;
    v_m := split_part(l.selected_month, '-', 2)::INT;
  ELSE
    SELECT y, m INTO v_y, v_m
      FROM resolve_shipment_year_month(
             NULL,
             COALESCE(l.selected_month, (SELECT month FROM deals WHERE id = l.deal_id)),
             l.deal_id);
  END IF;
  IF v_y IS NULL OR v_m IS NULL THEN
    RETURN NULL;
  END IF;

  -- Без подкотировки — прежнее правило колонок (00067).
  IF l.price_source IS NULL THEN
    RETURN compute_monthly_quotation_avg(l.quotation_type_id, v_y, v_m);
  END IF;
  RETURN compute_quotation_value(l.quotation_type_id, l.price_source,
                                 make_date(v_y, v_m, 15), 'avg_month');
END;
$function$;

COMMENT ON FUNCTION public.line_formula_quotation(TEXT, UUID) IS
  'Котировка варианта для цены отгрузок «Среднего месяца» (00173): «Котировка значение», иначе средняя за «Месяц расчёта» (или месяц сделки) по подкотировке; режим «на дату» — на selected_date.';

-- ── 2. Автоцена новой отгрузки ────────────────────────────────────────
-- Тело из 00164 дословно; изменены SELECT варианта (+ id) и ветка
-- average_month.
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
  v_sup_line_id        UUID;
  v_buy_line_id        UUID;
BEGIN
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT y, m INTO v_year, v_month
  FROM resolve_shipment_year_month(NEW.date, NEW.shipment_month, NEW.deal_id);

  -- Supplier side: налив
  IF NEW.loading_volume IS NOT NULL THEN
    IF NEW.supplier_line_id IS NOT NULL THEN
      SELECT id, price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage, barrel_ratio
        INTO v_sup_line_id, v_sup_price, v_sup_discount, v_sup_quotation, v_sup_fx,
             v_sup_condition, v_sup_quotation_type, v_sup_stage, v_sup_ratio
      FROM deal_supplier_lines
      WHERE id = NEW.supplier_line_id;
    ELSE
      SELECT id, price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage, barrel_ratio
        INTO v_sup_line_id, v_sup_price, v_sup_discount, v_sup_quotation, v_sup_fx,
             v_sup_condition, v_sup_quotation_type, v_sup_stage, v_sup_ratio
      FROM deal_supplier_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    v_final_price     := v_sup_price;
    v_final_quotation := NULL;

    IF v_sup_stage = 'final' THEN
      IF v_sup_condition = 'average_month' THEN
        -- 00173: котировка варианта («Месяц расчёта»), не месяц отгрузки.
        v_monthly_avg := line_formula_quotation('supplier', v_sup_line_id);
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
      SELECT id, price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage, barrel_ratio
        INTO v_buy_line_id, v_buy_price, v_buy_discount, v_buy_quotation, v_buy_fx,
             v_buy_condition, v_buy_quotation_type, v_buy_stage, v_buy_ratio
      FROM deal_buyer_lines
      WHERE id = NEW.buyer_line_id;
    ELSE
      SELECT id, price, COALESCE(discount, 0), quotation, fx_rate,
             price_condition::TEXT, quotation_type_id, price_stage, barrel_ratio
        INTO v_buy_line_id, v_buy_price, v_buy_discount, v_buy_quotation, v_buy_fx,
             v_buy_condition, v_buy_quotation_type, v_buy_stage, v_buy_ratio
      FROM deal_buyer_lines
      WHERE deal_id = NEW.deal_id AND is_default = TRUE;
    END IF;

    v_final_price     := v_buy_price;
    v_final_quotation := NULL;

    IF v_buy_stage = 'final' THEN
      IF v_buy_condition = 'average_month' THEN
        -- 00173: котировка варианта («Месяц расчёта»), не месяц отгрузки.
        v_monthly_avg := line_formula_quotation('buyer', v_buy_line_id);
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

-- ── 3. Пересчёт отгрузок варианта ────────────────────────────────────
-- Тело из 00172 дословно; изменена ветка average_month.
CREATE OR REPLACE FUNCTION public.recompute_line_shipment_prices(p_line_id uuid, p_side text, p_registry_id uuid)
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
      -- 00172: NULL — все отгрузки варианта (как раньше), иначе одна.
      AND (p_registry_id IS NULL OR sr.id = p_registry_id)
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
      IF v_condition = 'average_month' THEN
        -- 00173: котировка варианта («Месяц расчёта»), не месяц отгрузки.
        v_monthly_avg := line_formula_quotation(p_side, p_line_id);
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

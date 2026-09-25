-- 00172_reprice_on_shipment_month.sql
--
-- Клиент 2026-09-25: «если тип цены формульная, то мы должны брать по
-- формуле, и если мы меняем данные, например месяц отгрузки, цена должна
-- пересчитаться».
--
-- Согласовано 2026-09-25:
--   • каждая отгрузка берёт среднюю котировку за месяц СВОЕЙ даты, без
--     даты — за «Месяц отгрузки» и год сделки (resolve_shipment_year_month,
--     00067 — так база и считала, правило не меняется);
--   • ручная «Цена» (00171) — исключение, пока не тронули формулу.
--
-- КАК БЫЛО. Смена даты отгрузки в реестре только переписывала
-- shipment_date у цены отгрузки (autoprice_registry_update, 00046:121-125);
-- котировка и цена оставались от старого месяца. Смену «Месяца отгрузки»
-- не отслеживал никто.
--
-- КАК СТАЛО. После смены date или shipment_month строка реестра
-- пересчитывается тем же путём, что и фиксация цены
-- (recompute_line_shipment_prices), — только она одна. Формула не
-- копируется: у пересчёта появился третий параметр «одна строка», тело
-- перенесено из 00164 ДОСЛОВНО плюс условие отбора. Двухпараметровый
-- вызов (интерфейс, фиксация) работает как раньше.
--   • Окончательная «Средний месяц» — котировка за новый месяц.
--   • Предварительная / фиксированная / ручная — «Цена» варианта, как и
--     при любом пересчёте; от месяца не зависят.
--   • Ручная «Цена» (00171) — подставит apply_manual_line_price.
--
-- ДАННЫЕ. Миграция ничего не пересчитывает: отгрузки, у которых дату
-- меняли раньше, остаются как есть до следующей правки или фиксации.
-- Список таких расхождений — отдельным запросом, до решения о пересчёте.
--
-- ROLLBACK.
--   DROP TRIGGER trg_reprice_registry_on_month ON shipment_registry;
--   двухпараметровую функцию вернуть телом из 00164; трёхпараметровую
--   можно оставить — её больше никто не вызывает.

-- ── 1. Пересчёт: вариант целиком или одна строка ────────────────────
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

CREATE OR REPLACE FUNCTION public.recompute_line_shipment_prices(p_line_id uuid, p_side text)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT public.recompute_line_shipment_prices(p_line_id, p_side, NULL::uuid);
$function$;

-- ── 2. Дата / месяц отгрузки поменялись → пересчёт этой строки ─────
CREATE OR REPLACE FUNCTION reprice_registry_row_on_month()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supplier_line_id IS NOT NULL AND NEW.loading_volume IS NOT NULL THEN
    PERFORM recompute_line_shipment_prices(NEW.supplier_line_id, 'supplier', NEW.id);
  END IF;
  IF NEW.buyer_line_id IS NOT NULL AND NEW.shipment_volume IS NOT NULL THEN
    PERFORM recompute_line_shipment_prices(NEW.buyer_line_id, 'buyer', NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reprice_registry_row_on_month() IS
  'Смена даты или «Месяца отгрузки» пересчитывает цену этой отгрузки по формуле варианта (00172).';

DROP TRIGGER IF EXISTS trg_reprice_registry_on_month ON shipment_registry;
CREATE TRIGGER trg_reprice_registry_on_month
  AFTER UPDATE OF date, shipment_month ON shipment_registry
  FOR EACH ROW
  WHEN (OLD.date IS DISTINCT FROM NEW.date
        OR OLD.shipment_month IS DISTINCT FROM NEW.shipment_month)
  EXECUTE FUNCTION reprice_registry_row_on_month();

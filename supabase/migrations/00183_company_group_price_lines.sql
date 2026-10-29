-- Варианты цены группы компаний в цепочке сделки — только KG.
--
-- Клиент 2026-10-29 (пример KG/26/736): «по группе компаний нужно так же
-- добавить варианты по ценам на каждый объём… можно привязать к вариантам
-- со стороны покупателя… чтобы вручную не вбивать объём, автоматом выходил».
-- Ответы клиента и владельца 2026-10-29:
--   1. объём привязанного варианта = отгружено по варианту покупателя
--      (Σ shipment_volume его строк реестра — то же, что «Отгружено по этому
--      варианту» у покупателя, use-deal-lines.ts fetchDealLineRollups);
--      «цены не постоянные, отгруженный объём фиксируется на цену»: две цены
--      на один вариант покупателя делятся по дате отгрузки (shipment_registry
--      .date) — у цены «действует с» (valid_from); строка без даты — в первую;
--   2. под вариантом примечание «Отгружено по этому варианту: N т · Сумма S
--      (по цене P)» — сумма только для показа, ни в какие итоги не идёт;
--   3. котировка/скидка/цена вводятся вручную, у каждого варианта свои;
--   4. удалили вариант покупателя — обнулить всё связанное (привязку, дату),
--      цена остаётся;
--   5. сверки суммы объёмов с объёмом сделки нет;
--   6. один вариант покупателя можно привязать к нескольким ценам группы;
--   7. только для KG-сделок.
--
-- «Основной» вариант (is_default) — это нынешняя цена группы: его цена,
-- котировка, комментарий, скидка и тип зеркалятся в deal_company_groups в
-- обе стороны (правка в паспорте, выгрузки Excel, форма — как раньше).
-- Денег от цены группы нигде не считается (00011 читает только id групп),
-- поэтому балансы, ДТ-КТ и маржа не меняются.
--
-- Данные: каждой группе цепочки KG-сделок — «Основной» с её текущими
-- значениями; существующие значения не меняются.
-- Откат: DROP VIEW deal_company_group_line_volumes; DROP TABLE
-- deal_company_group_lines CASCADE; DROP FUNCTION создаваемых здесь функций
-- (триггеры на deal_company_groups уходят вместе с ними).

CREATE TABLE deal_company_group_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_company_group_id UUID NOT NULL REFERENCES deal_company_groups(id) ON DELETE CASCADE,
  position INT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  quotation NUMERIC(14,4),
  quotation_comment TEXT,
  discount NUMERIC(14,4),
  price NUMERIC(14,4),
  price_kind TEXT NOT NULL DEFAULT 'preliminary' CHECK (price_kind IN ('preliminary', 'final')),
  buyer_line_id UUID REFERENCES deal_buyer_lines(id) ON DELETE SET NULL,
  valid_from DATE,
  manual_volume NUMERIC(14,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_company_group_id, position),
  -- объём привязанного варианта — из отгрузок, не вручную
  CONSTRAINT dcg_line_volume_source CHECK (buyer_line_id IS NULL OR manual_volume IS NULL),
  -- «действует с» имеет смысл только при привязке
  CONSTRAINT dcg_line_valid_from_needs_link CHECK (buyer_line_id IS NOT NULL OR valid_from IS NULL)
);

COMMENT ON TABLE deal_company_group_lines IS
  'Варианты цены группы компаний (KG). is_default — цена группы (зеркало deal_company_groups). '
  'Объём: привязка к варианту покупателя (отгружено по нему с valid_from) или manual_volume. 00183.';

CREATE UNIQUE INDEX uq_dcg_lines_default ON deal_company_group_lines (deal_company_group_id) WHERE is_default;
-- две цены на один вариант покупателя — с разных дат
CREATE UNIQUE INDEX uq_dcg_lines_link_from ON deal_company_group_lines
  (deal_company_group_id, buyer_line_id, COALESCE(valid_from, '-infinity'::date))
  WHERE buyer_line_id IS NOT NULL;
CREATE INDEX idx_dcg_lines_buyer_line ON deal_company_group_lines (buyer_line_id) WHERE buyer_line_id IS NOT NULL;

ALTER TABLE deal_company_group_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_deal_company_group_lines" ON deal_company_group_lines
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_deal_company_group_lines" ON deal_company_group_lines
  FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_deal_company_group_lines" ON deal_company_group_lines
  FOR UPDATE USING (is_writable_role());
CREATE POLICY "writable_delete_deal_company_group_lines" ON deal_company_group_lines
  FOR DELETE USING (is_writable_role());

-- ── Проверки: только KG, вариант покупателя той же сделки; отвязали — дата
--    уходит (удаление варианта покупателя: ON DELETE SET NULL идёт сюда) ──
CREATE OR REPLACE FUNCTION check_deal_company_group_line()
RETURNS TRIGGER AS $$
DECLARE
  v_deal UUID;
  v_type TEXT;
BEGIN
  SELECT d.id, d.deal_type::TEXT INTO v_deal, v_type
    FROM deal_company_groups g JOIN deals d ON d.id = g.deal_id
   WHERE g.id = NEW.deal_company_group_id;
  IF v_type IS DISTINCT FROM 'KG' THEN
    RAISE EXCEPTION 'Варианты цены группы компаний — только для KG-сделок';
  END IF;
  IF NEW.buyer_line_id IS NULL THEN
    NEW.valid_from := NULL;
  ELSIF NOT EXISTS (SELECT 1 FROM deal_buyer_lines b WHERE b.id = NEW.buyer_line_id AND b.deal_id = v_deal) THEN
    RAISE EXCEPTION 'Вариант покупателя из другой сделки';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_deal_company_group_line
  BEFORE INSERT OR UPDATE ON deal_company_group_lines
  FOR EACH ROW EXECUTE FUNCTION check_deal_company_group_line();

-- ── «Основной» → цена группы ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_company_group_from_default_line()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE deal_company_groups SET
      price = NEW.price, quotation = NEW.quotation, quotation_comment = NEW.quotation_comment,
      discount = NEW.discount, price_kind = NEW.price_kind
    WHERE id = NEW.deal_company_group_id
      AND (price, quotation, quotation_comment, discount, price_kind)
          IS DISTINCT FROM (NEW.price, NEW.quotation, NEW.quotation_comment, NEW.discount, NEW.price_kind);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_company_group_from_default_line
  AFTER INSERT OR UPDATE ON deal_company_group_lines
  FOR EACH ROW EXECUTE FUNCTION sync_company_group_from_default_line();

-- ── цена группы → «Основной» (паспорт правит deal_company_groups.price) ──
CREATE OR REPLACE FUNCTION sync_default_line_from_company_group()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE deal_company_group_lines SET
    price = NEW.price, quotation = NEW.quotation, quotation_comment = NEW.quotation_comment,
    discount = NEW.discount, price_kind = NEW.price_kind
  WHERE deal_company_group_id = NEW.id AND is_default
    AND (price, quotation, quotation_comment, discount, price_kind)
        IS DISTINCT FROM (NEW.price, NEW.quotation, NEW.quotation_comment, NEW.discount, NEW.price_kind);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_default_line_from_company_group
  AFTER UPDATE OF price, quotation, quotation_comment, discount, price_kind ON deal_company_groups
  FOR EACH ROW EXECUTE FUNCTION sync_default_line_from_company_group();

-- ── новая группа в KG-сделке → её «Основной» ─────────────────────────
CREATE OR REPLACE FUNCTION create_default_company_group_line()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM deals WHERE id = NEW.deal_id AND deal_type = 'KG') THEN
    INSERT INTO deal_company_group_lines
      (deal_company_group_id, position, is_default, quotation, quotation_comment, discount, price, price_kind)
    VALUES (NEW.id, 1, TRUE, NEW.quotation, NEW.quotation_comment, NEW.discount, NEW.price, NEW.price_kind);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_default_company_group_line
  AFTER INSERT ON deal_company_groups
  FOR EACH ROW EXECUTE FUNCTION create_default_company_group_line();

-- ── Журнал сделки. «Основной» — цена группы, её правки пишет 00096; здесь —
--    только его привязка/дата/объём и остальные варианты целиком ─────────
CREATE OR REPLACE FUNCTION log_deal_company_group_line_change()
RETURNS TRIGGER AS $$
DECLARE
  v_line deal_company_group_lines := COALESCE(NEW, OLD);
  v_deal UUID;
  v_gpos INT;
  v_label TEXT;
  v_changes TEXT[] := ARRAY[]::TEXT[];
  v_content TEXT;
BEGIN
  SELECT g.deal_id, g.position INTO v_deal, v_gpos FROM deal_company_groups g WHERE g.id = v_line.deal_company_group_id;
  IF v_deal IS NULL OR _activity_is_draft_deal(v_deal) THEN RETURN v_line; END IF;
  v_label := CASE WHEN v_line.is_default THEN 'Основной' ELSE 'вариант ' || v_line.position END;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_default THEN RETURN NEW; END IF;
    v_content := 'Добавлен вариант цены группы #' || v_gpos || ': ' || v_label
      || COALESCE(' (цена ' || _activity_fmt_num(NEW.price) || ')', '');
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.is_default THEN RETURN OLD; END IF;
    v_content := 'Удалён вариант цены группы #' || v_gpos || ': ' || v_label;
  ELSE
    IF NOT NEW.is_default THEN
      IF OLD.price IS DISTINCT FROM NEW.price THEN
        v_changes := v_changes || ('цена ' || _activity_fmt_num(OLD.price) || ' → ' || _activity_fmt_num(NEW.price));
      END IF;
      IF OLD.price_kind IS DISTINCT FROM NEW.price_kind THEN
        v_changes := v_changes || ('тип цены ' || OLD.price_kind || ' → ' || NEW.price_kind);
      END IF;
      IF OLD.quotation IS DISTINCT FROM NEW.quotation THEN
        v_changes := v_changes || ('котировка ' || _activity_fmt_num(OLD.quotation) || ' → ' || _activity_fmt_num(NEW.quotation));
      END IF;
      IF OLD.discount IS DISTINCT FROM NEW.discount THEN
        v_changes := v_changes || ('скидка ' || _activity_fmt_num(OLD.discount) || ' → ' || _activity_fmt_num(NEW.discount));
      END IF;
    END IF;
    IF OLD.buyer_line_id IS DISTINCT FROM NEW.buyer_line_id THEN
      v_changes := v_changes || ('вариант покупателя ' || COALESCE((SELECT position::TEXT FROM deal_buyer_lines WHERE id = OLD.buyer_line_id), '—')
        || ' → ' || COALESCE((SELECT position::TEXT FROM deal_buyer_lines WHERE id = NEW.buyer_line_id), '—'));
    END IF;
    IF OLD.valid_from IS DISTINCT FROM NEW.valid_from THEN
      v_changes := v_changes || ('действует с ' || COALESCE(to_char(OLD.valid_from, 'DD.MM.YYYY'), '—')
        || ' → ' || COALESCE(to_char(NEW.valid_from, 'DD.MM.YYYY'), '—'));
    END IF;
    IF OLD.manual_volume IS DISTINCT FROM NEW.manual_volume THEN
      v_changes := v_changes || ('объём ' || _activity_fmt_num(OLD.manual_volume) || ' → ' || _activity_fmt_num(NEW.manual_volume));
    END IF;
    IF array_length(v_changes, 1) IS NULL THEN RETURN NEW; END IF;
    v_content := 'Изменён вариант цены группы #' || v_gpos || ': ' || v_label
      || ' (' || array_to_string(v_changes, ', ') || ')';
  END IF;

  INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
  VALUES (v_deal, auth.uid(), 'system', v_content, jsonb_build_object(
    'row_id', v_line.id, 'deal_company_group_id', v_line.deal_company_group_id, 'position', v_line.position,
    'old', CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    'new', CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END));
  RETURN v_line;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_deal_company_group_lines_activity
  AFTER INSERT OR UPDATE OR DELETE ON deal_company_group_lines
  FOR EACH ROW EXECUTE FUNCTION log_deal_company_group_line_change();

-- ── Объём и сумма варианта ───────────────────────────────────────────
-- Привязанный: строки реестра его варианта покупателя с исходящим объёмом,
-- дата ∈ [valid_from; следующий valid_from той же группы и того же варианта
-- покупателя); строка без даты — в первую цену. Без привязки — manual_volume.
-- Сумма = round(объём × цена, 2) — только для показа.
CREATE VIEW deal_company_group_line_volumes WITH (security_invoker = true) AS
WITH linked AS (
  SELECT l.id, l.buyer_line_id, l.valid_from,
         LEAD(l.valid_from) OVER w AS next_from,
         ROW_NUMBER() OVER w AS rn
    FROM deal_company_group_lines l
   WHERE l.buyer_line_id IS NOT NULL
  WINDOW w AS (PARTITION BY l.deal_company_group_id, l.buyer_line_id ORDER BY l.valid_from NULLS FIRST)
), shipped AS (
  SELECT k.id, SUM(r.shipment_volume) AS volume
    FROM linked k
    JOIN shipment_registry r ON r.buyer_line_id = k.buyer_line_id AND r.shipment_volume IS NOT NULL
   WHERE (r.date IS NULL AND k.rn = 1)
      OR (r.date IS NOT NULL
          AND (k.valid_from IS NULL OR r.date >= k.valid_from)
          AND (k.next_from IS NULL OR r.date < k.next_from))
   GROUP BY k.id
)
SELECT l.id AS line_id,
       l.deal_company_group_id,
       g.deal_id,
       (l.buyer_line_id IS NOT NULL) AS is_linked,
       v.volume,
       ROUND(v.volume * l.price, 2) AS amount
  FROM deal_company_group_lines l
  JOIN deal_company_groups g ON g.id = l.deal_company_group_id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN l.buyer_line_id IS NULL THEN l.manual_volume
                ELSE COALESCE((SELECT s.volume FROM shipped s WHERE s.id = l.id), 0) END AS volume
  ) v;

GRANT SELECT ON deal_company_group_line_volumes TO authenticated;

-- ── Данные: «Основной» каждой группе цепочки KG-сделок ───────────────
INSERT INTO deal_company_group_lines
  (deal_company_group_id, position, is_default, quotation, quotation_comment, discount, price, price_kind)
SELECT g.id, 1, TRUE, g.quotation, g.quotation_comment, g.discount, g.price, g.price_kind
  FROM deal_company_groups g JOIN deals d ON d.id = g.deal_id
 WHERE d.deal_type = 'KG'
ON CONFLICT DO NOTHING;

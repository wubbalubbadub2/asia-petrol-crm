-- 00180: «Закупка» — у кого наша компания купила товар под сделку KG.
--
-- Клиент 2026-10-04/05: Taur Trading, НАЗС, Таур Импекс — наши компании.
-- Когда они поставщик в сделке KG, сами они купили товар у внешнего
-- продавца по своему приложению. В сделке нужно видеть «у кого купили,
-- номер приложения, объём выкупа» — БЕЗ цены, на балансы не влияет.
--
-- Правила (утверждены владельцем 2026-10-05):
--   • одна закупка питает несколько сделок; у сделки не больше одной закупки;
--   • завод и продукт закупки = завод и продукт сделки; только KG;
--   • продавец — из «Поставщиков», но не наша компания;
--   • «Продано» = сумма объёмов поставщика (supplier_contracted_volume)
--     привязанных сделок, кроме архивных / черновиков / скрытых;
--     «Остаток» = объём выкупа − продано, может уйти в минус (предупреждение,
--     не запрет);
--   • пока сделка привязана, сменить у неё поставщика / завод / продукт
--     нельзя — сначала отвязать; закупку с привязанными сделками удалить нельзя.
--
-- Схема public общая со вторым продуктом — таблица с префиксом deal_.
-- Применяется вручную в SQL-редакторе Supabase, поэтому один блок DO:
-- либо всё, либо ничего. Повторный запуск ничего не ломает.

DO $mig$
BEGIN
  -- 1. «Наша компания» у поставщика ------------------------------------
  ALTER TABLE counterparties
    ADD COLUMN IF NOT EXISTS is_own_supplier BOOLEAN NOT NULL DEFAULT FALSE;
  COMMENT ON COLUMN counterparties.is_own_supplier IS
    'Наша компания в роли поставщика (Taur Trading, НАЗС, Таур Импекс): у сделок KG с ней ведётся «Закупка» (00180).';

  -- По id, не по имени: у Taur Trading и НАЗС есть и строка-покупатель.
  UPDATE counterparties SET is_own_supplier = TRUE
   WHERE type = 'supplier' AND NOT is_own_supplier
     AND id IN ('9912c646-f611-4031-ab02-7cd9f02e5c7c',   -- Taur Trading
                'e28148f2-a0cc-4806-9dd8-8a724f734c3c',   -- НАЗС
                '4bd4a6ac-a329-4dc7-aa89-1ff847c601e1');  -- Таур Импекс

  -- 2. Таблица закупок ------------------------------------------------
  CREATE TABLE IF NOT EXISTS deal_upstream_purchases (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    our_company_id UUID NOT NULL REFERENCES counterparties(id),
    seller_id      UUID NOT NULL REFERENCES counterparties(id),
    factory_id     UUID NOT NULL REFERENCES factories(id),
    fuel_type_id   UUID NOT NULL REFERENCES fuel_types(id),
    appendix       TEXT NOT NULL CHECK (btrim(appendix) <> ''),
    volume_tons    NUMERIC(14,3) NOT NULL CHECK (volume_tons > 0),
    comment        TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID DEFAULT auth.uid(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (seller_id <> our_company_id)
  );
  COMMENT ON TABLE deal_upstream_purchases IS
    'Закупка нашей компании у внешнего продавца (у кого купили, приложение, объём выкупа). Без цены, на балансы не влияет. 00180.';
  CREATE INDEX IF NOT EXISTS idx_deal_upstream_purchases_company
    ON deal_upstream_purchases (our_company_id, factory_id, fuel_type_id);

  ALTER TABLE deal_upstream_purchases ENABLE ROW LEVEL SECURITY;
  -- Как у counterparties / deals: читать — любой вошедший, писать —
  -- admin / manager / logistics, удалять — только admin.
  DROP POLICY IF EXISTS auth_select_deal_upstream_purchases ON deal_upstream_purchases;
  CREATE POLICY auth_select_deal_upstream_purchases ON deal_upstream_purchases
    FOR SELECT USING (auth.uid() IS NOT NULL);
  DROP POLICY IF EXISTS writable_insert_deal_upstream_purchases ON deal_upstream_purchases;
  CREATE POLICY writable_insert_deal_upstream_purchases ON deal_upstream_purchases
    FOR INSERT WITH CHECK (is_writable_role());
  DROP POLICY IF EXISTS writable_update_deal_upstream_purchases ON deal_upstream_purchases;
  CREATE POLICY writable_update_deal_upstream_purchases ON deal_upstream_purchases
    FOR UPDATE USING (is_writable_role()) WITH CHECK (is_writable_role());
  DROP POLICY IF EXISTS admin_delete_deal_upstream_purchases ON deal_upstream_purchases;
  CREATE POLICY admin_delete_deal_upstream_purchases ON deal_upstream_purchases
    FOR DELETE USING (is_admin());

  DROP TRIGGER IF EXISTS trg_deal_upstream_purchases_updated ON deal_upstream_purchases;
  CREATE TRIGGER trg_deal_upstream_purchases_updated
    BEFORE UPDATE ON deal_upstream_purchases
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  DROP TRIGGER IF EXISTS trg_audit_deal_upstream_purchases ON deal_upstream_purchases;
  CREATE TRIGGER trg_audit_deal_upstream_purchases
    AFTER INSERT OR UPDATE OR DELETE ON deal_upstream_purchases
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();

  -- 3. Ссылка из сделки -------------------------------------------------
  ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS upstream_purchase_id UUID
      REFERENCES deal_upstream_purchases(id) ON DELETE RESTRICT;
  COMMENT ON COLUMN deals.upstream_purchase_id IS
    'Закупка, из которой наша компания-поставщик продаёт по этой сделке (00180). Только KG.';
  CREATE INDEX IF NOT EXISTS idx_deals_upstream_purchase
    ON deals (upstream_purchase_id) WHERE upstream_purchase_id IS NOT NULL;

  -- 4. Проверки закупки -------------------------------------------------
  EXECUTE $f$
  CREATE OR REPLACE FUNCTION check_deal_upstream_purchase()
  RETURNS TRIGGER LANGUAGE plpgsql AS $body$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM counterparties
                    WHERE id = NEW.our_company_id AND type = 'supplier' AND is_own_supplier) THEN
      RAISE EXCEPTION 'Закупку ведёт только наша компания-поставщик (галочка «Наша компания» в «Поставщиках»)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM counterparties
                    WHERE id = NEW.seller_id AND type = 'supplier' AND NOT is_own_supplier) THEN
      RAISE EXCEPTION 'Продавец в закупке — поставщик из справочника, но не наша компания'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Правка закупки не должна разойтись с уже привязанными сделками.
    IF TG_OP = 'UPDATE' AND (
         NEW.our_company_id IS DISTINCT FROM OLD.our_company_id
      OR NEW.factory_id     IS DISTINCT FROM OLD.factory_id
      OR NEW.fuel_type_id   IS DISTINCT FROM OLD.fuel_type_id) THEN
      IF EXISTS (SELECT 1 FROM deals d
                  WHERE d.upstream_purchase_id = NEW.id
                    AND (d.supplier_id  IS DISTINCT FROM NEW.our_company_id
                      OR d.factory_id   IS DISTINCT FROM NEW.factory_id
                      OR d.fuel_type_id IS DISTINCT FROM NEW.fuel_type_id)) THEN
        RAISE EXCEPTION 'К закупке привязаны сделки с другой компанией, заводом или продуктом — сначала отвяжите их'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $body$;
  $f$;

  DROP TRIGGER IF EXISTS trg_check_deal_upstream_purchase ON deal_upstream_purchases;
  CREATE TRIGGER trg_check_deal_upstream_purchase
    BEFORE INSERT OR UPDATE ON deal_upstream_purchases
    FOR EACH ROW EXECUTE FUNCTION check_deal_upstream_purchase();

  -- 5. Проверки сделки --------------------------------------------------
  EXECUTE $f$
  CREATE OR REPLACE FUNCTION check_deal_upstream_link()
  RETURNS TRIGGER LANGUAGE plpgsql AS $body$
  DECLARE
    p deal_upstream_purchases%ROWTYPE;
  BEGIN
    IF NEW.upstream_purchase_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT * INTO p FROM deal_upstream_purchases WHERE id = NEW.upstream_purchase_id;
    IF NEW.deal_type IS DISTINCT FROM 'KG' THEN
      RAISE EXCEPTION 'Закупку можно привязать только к сделке KG'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.supplier_id IS DISTINCT FROM p.our_company_id THEN
      RAISE EXCEPTION 'Поставщик сделки не совпадает с компанией закупки. Если меняете поставщика — сначала отвяжите закупку'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.factory_id IS DISTINCT FROM p.factory_id OR NEW.fuel_type_id IS DISTINCT FROM p.fuel_type_id THEN
      RAISE EXCEPTION 'Завод и продукт сделки должны совпадать с закупкой. Если меняете их — сначала отвяжите закупку'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $body$;
  $f$;

  DROP TRIGGER IF EXISTS trg_check_deal_upstream_link ON deals;
  CREATE TRIGGER trg_check_deal_upstream_link
    BEFORE INSERT OR UPDATE OF upstream_purchase_id, supplier_id, factory_id, fuel_type_id, deal_type ON deals
    FOR EACH ROW EXECUTE FUNCTION check_deal_upstream_link();

  -- 6. Лента сделки: «Закупка привязана / отвязана» ---------------------
  EXECUTE $f$
  CREATE OR REPLACE FUNCTION log_deal_upstream_link()
  RETURNS TRIGGER LANGUAGE plpgsql AS $body$
  DECLARE
    v_old TEXT;
    v_new TEXT;
  BEGIN
    -- Черновики не пишем — как в log_deal_field_changes (00088).
    IF COALESCE(NEW.is_draft, FALSE) OR COALESCE(OLD.is_draft, FALSE) THEN
      RETURN NEW;
    END IF;
    IF OLD.upstream_purchase_id IS NOT DISTINCT FROM NEW.upstream_purchase_id THEN
      RETURN NEW;
    END IF;
    SELECT COALESCE(c.short_name, c.full_name) || ', прил. ' || p.appendix INTO v_old
      FROM deal_upstream_purchases p JOIN counterparties c ON c.id = p.seller_id
     WHERE p.id = OLD.upstream_purchase_id;
    SELECT COALESCE(c.short_name, c.full_name) || ', прил. ' || p.appendix INTO v_new
      FROM deal_upstream_purchases p JOIN counterparties c ON c.id = p.seller_id
     WHERE p.id = NEW.upstream_purchase_id;
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (NEW.id, auth.uid(), 'system',
      CASE WHEN NEW.upstream_purchase_id IS NULL THEN 'Закупка отвязана' ELSE 'Закупка привязана' END,
      jsonb_build_object('field', 'upstream_purchase_id',
        'old', OLD.upstream_purchase_id, 'new', NEW.upstream_purchase_id,
        'old_label', v_old, 'new_label', v_new));
    RETURN NEW;
  END;
  $body$;
  $f$;

  DROP TRIGGER IF EXISTS trg_log_deal_upstream_link ON deals;
  CREATE TRIGGER trg_log_deal_upstream_link
    AFTER UPDATE OF upstream_purchase_id ON deals
    FOR EACH ROW EXECUTE FUNCTION log_deal_upstream_link();

  -- 7. Продано / остаток — считает база, не React ----------------------
  EXECUTE $f$
  CREATE OR REPLACE VIEW deal_upstream_purchase_totals
  WITH (security_invoker = true) AS
  SELECT p.id AS purchase_id,
         count(d.id)::int AS deal_count,
         COALESCE(sum(COALESCE(d.supplier_contracted_volume, 0)), 0)::numeric(14,3) AS sold_tons,
         (p.volume_tons - COALESCE(sum(COALESCE(d.supplier_contracted_volume, 0)), 0))::numeric(14,3) AS remaining_tons
    FROM deal_upstream_purchases p
    LEFT JOIN deals d
      ON d.upstream_purchase_id = p.id
     AND NOT COALESCE(d.is_archived, FALSE)
     AND NOT COALESCE(d.is_draft, FALSE)
     AND NOT COALESCE(d.is_hidden, FALSE)
   GROUP BY p.id, p.volume_tons;
  $f$;
  COMMENT ON VIEW deal_upstream_purchase_totals IS
    'Продано = сумма объёмов поставщика привязанных сделок (без архива / черновиков / скрытых), остаток = объём выкупа − продано (может быть < 0). 00180.';
  GRANT SELECT ON deal_upstream_purchase_totals TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON deal_upstream_purchases TO authenticated;

  RAISE NOTICE '00180: наших компаний-поставщиков — %, закупок — %',
    (SELECT count(*) FROM counterparties WHERE is_own_supplier),
    (SELECT count(*) FROM deal_upstream_purchases);
END
$mig$;

-- Откат (не выполнять вместе с миграцией):
-- DROP VIEW IF EXISTS deal_upstream_purchase_totals;
-- DROP TRIGGER IF EXISTS trg_log_deal_upstream_link ON deals;
-- DROP TRIGGER IF EXISTS trg_check_deal_upstream_link ON deals;
-- ALTER TABLE deals DROP COLUMN IF EXISTS upstream_purchase_id;
-- DROP TABLE IF EXISTS deal_upstream_purchases;
-- DROP FUNCTION IF EXISTS log_deal_upstream_link(), check_deal_upstream_link(), check_deal_upstream_purchase();
-- ALTER TABLE counterparties DROP COLUMN IF EXISTS is_own_supplier;

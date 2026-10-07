-- 00181: оплаты по закупке — сколько и когда наша компания заплатила
-- первичному поставщику.
--
-- Клиент 2026-10-07: «добавить в тот же раздел колонки — Сумма оплаты и
-- дата оплаты», после «Менеджер по продаже». Правила (утверждены
-- владельцем 2026-10-07):
--   • оплата — нашей компании первичному поставщику за закупку целиком;
--     одна закупка питает несколько сделок, поэтому у всех её сделок
--     в паспорте одна и та же оплата;
--   • оплат по закупке может быть несколько: в паспорте — сумма по
--     валюте и последняя дата;
--   • валюта указывается у каждой оплаты, без пересчёта;
--   • на балансы не влияет, в «Итого» паспорта не суммируется.
--
-- Схема public общая со вторым продуктом — префикс deal_. Применяется
-- вручную в SQL-редакторе Supabase: один блок DO, повторный запуск
-- ничего не ломает.

DO $mig$
BEGIN
  CREATE TABLE IF NOT EXISTS deal_upstream_purchase_payments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- RESTRICT: закупку с оплатами удалить нельзя — сначала удалить оплаты,
    -- чтобы деньги не пропадали молча вместе с закупкой.
    purchase_id  UUID NOT NULL REFERENCES deal_upstream_purchases(id) ON DELETE RESTRICT,
    amount       NUMERIC(16,2) NOT NULL CHECK (amount > 0),
    currency     TEXT NOT NULL CHECK (currency IN ('USD', 'KZT', 'KGS', 'RUB')),
    payment_date DATE NOT NULL,
    comment      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   UUID DEFAULT auth.uid(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  COMMENT ON TABLE deal_upstream_purchase_payments IS
    'Оплаты нашей компании первичному поставщику по закупке (deal_upstream_purchases). Без пересчёта валют, на балансы не влияет. 00181.';
  CREATE INDEX IF NOT EXISTS idx_deal_upstream_purchase_payments_purchase
    ON deal_upstream_purchase_payments (purchase_id, payment_date);

  ALTER TABLE deal_upstream_purchase_payments ENABLE ROW LEVEL SECURITY;
  -- Как у закупок (00180): читать — любой вошедший, писать — admin /
  -- manager / logistics, удалять — только admin.
  DROP POLICY IF EXISTS auth_select_deal_upstream_purchase_payments ON deal_upstream_purchase_payments;
  CREATE POLICY auth_select_deal_upstream_purchase_payments ON deal_upstream_purchase_payments
    FOR SELECT USING (auth.uid() IS NOT NULL);
  DROP POLICY IF EXISTS writable_insert_deal_upstream_purchase_payments ON deal_upstream_purchase_payments;
  CREATE POLICY writable_insert_deal_upstream_purchase_payments ON deal_upstream_purchase_payments
    FOR INSERT WITH CHECK (is_writable_role());
  DROP POLICY IF EXISTS writable_update_deal_upstream_purchase_payments ON deal_upstream_purchase_payments;
  CREATE POLICY writable_update_deal_upstream_purchase_payments ON deal_upstream_purchase_payments
    FOR UPDATE USING (is_writable_role()) WITH CHECK (is_writable_role());
  DROP POLICY IF EXISTS admin_delete_deal_upstream_purchase_payments ON deal_upstream_purchase_payments;
  CREATE POLICY admin_delete_deal_upstream_purchase_payments ON deal_upstream_purchase_payments
    FOR DELETE USING (is_admin());

  DROP TRIGGER IF EXISTS trg_deal_upstream_purchase_payments_updated ON deal_upstream_purchase_payments;
  CREATE TRIGGER trg_deal_upstream_purchase_payments_updated
    BEFORE UPDATE ON deal_upstream_purchase_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  DROP TRIGGER IF EXISTS trg_audit_deal_upstream_purchase_payments ON deal_upstream_purchase_payments;
  CREATE TRIGGER trg_audit_deal_upstream_purchase_payments
    AFTER INSERT OR UPDATE OR DELETE ON deal_upstream_purchase_payments
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();

  -- Итог по закупке и валюте — считает база, не React.
  EXECUTE $f$
  CREATE OR REPLACE VIEW deal_upstream_purchase_payment_totals
  WITH (security_invoker = true) AS
  SELECT purchase_id,
         currency,
         count(*)::int              AS payment_count,
         sum(amount)::numeric(16,2) AS paid_amount,
         max(payment_date)          AS last_payment_date
    FROM deal_upstream_purchase_payments
   GROUP BY purchase_id, currency;
  $f$;
  COMMENT ON VIEW deal_upstream_purchase_payment_totals IS
    'Оплачено по закупке в разрезе валюты: сумма, число оплат, последняя дата. 00181.';
  GRANT SELECT ON deal_upstream_purchase_payment_totals TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON deal_upstream_purchase_payments TO authenticated;

  RAISE NOTICE '00181: оплат по закупкам — %', (SELECT count(*) FROM deal_upstream_purchase_payments);
END
$mig$;

-- Откат (не выполнять вместе с миграцией):
-- DROP VIEW IF EXISTS deal_upstream_purchase_payment_totals;
-- DROP TABLE IF EXISTS deal_upstream_purchase_payments;

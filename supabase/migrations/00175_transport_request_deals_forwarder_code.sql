-- 00175_transport_request_deals_forwarder_code.sql
--
-- Клиент 2026-09-28 (на dev):
--   1. при создании заявки на перевозку выбирается сделка; по умолчанию —
--      «сделка не создана»;
--   2. в списке заявок — фильтр «сделка не создана», найти и привязать;
--   3. одна заявка может относиться к нескольким сделкам (пример — 2);
--   4. код экспедитора в справочнике.
--
-- Отменяет решение 25.08 («не нужно добавлять связь», 00153:13-14): связь
-- заявки со сделкой теперь нужна. Связь — отдельной таблицей, потому что
-- сделок у заявки может быть несколько. Нет строк — «сделка не создана».
--
-- Идемпотентна: повторный прогон ничего не ломает.

CREATE TABLE IF NOT EXISTS transport_request_deals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES transport_requests(id) ON DELETE CASCADE,
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (request_id, deal_id)
);
CREATE INDEX IF NOT EXISTS idx_transport_request_deals_deal
  ON transport_request_deals(deal_id);

COMMENT ON TABLE transport_request_deals IS
  'Сделки заявки на перевозку (клиент 2026-09-28). Нет строк — «сделка не создана».';

ALTER TABLE transport_request_deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_select_transport_request_deals ON transport_request_deals;
CREATE POLICY auth_select_transport_request_deals ON transport_request_deals
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS writable_insert_transport_request_deals ON transport_request_deals;
CREATE POLICY writable_insert_transport_request_deals ON transport_request_deals
  FOR INSERT WITH CHECK (is_writable_role());
DROP POLICY IF EXISTS writable_delete_transport_request_deals ON transport_request_deals;
CREATE POLICY writable_delete_transport_request_deals ON transport_request_deals
  FOR DELETE USING (is_writable_role());

ALTER TABLE forwarders ADD COLUMN IF NOT EXISTS code TEXT;
COMMENT ON COLUMN forwarders.code IS 'Код экспедитора (клиент 2026-09-28).';

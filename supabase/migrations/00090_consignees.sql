-- Грузополучатели — клиентский справочник, аналог forwarders.
--
-- В отличие от counterparties (которые покупатели/поставщики со всей
-- финансовой обвязкой), грузополучатель — это просто получатель груза
-- по ЖД накладной. Часто совпадает с покупателем, но не всегда — может
-- быть отдельным юр.лицом со своим БИН/ИИН.

CREATE TABLE IF NOT EXISTS consignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  bin_iin TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE consignees ENABLE ROW LEVEL SECURITY;

-- Тот же шаблон что и для forwarders/factories: все аутентифицированные
-- читают, writable-роли (admin/manager/logistics/finance — см.
-- is_writable_role в 00010 / 00082) пишут, удаляет только админ.
CREATE POLICY "auth_select_consignees" ON consignees
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_consignees" ON consignees
  FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_consignees" ON consignees
  FOR UPDATE USING (is_writable_role());
CREATE POLICY "admin_delete_consignees" ON consignees
  FOR DELETE USING (is_admin());

-- 00111_finance_becomes_readonly.sql
--
-- Клиент 2026-07-09: писать в системе могут только admin / manager /
-- logistics. Финансист / бухгалтер / трейдер / readonly — только
-- просмотр и Excel.
--
-- Раньше (миграция 00082) финансист был в writable-списке. Убираем.

CREATE OR REPLACE FUNCTION is_writable_role()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager', 'logistics')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

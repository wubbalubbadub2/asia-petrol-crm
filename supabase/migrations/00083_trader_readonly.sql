-- Roll back trader from writable roles.
--
-- Client decision (29.05.2026): «Трейдеры и Бухгалтеры — только смотреть и
-- выгружать Excel-файлы. Паспорта и котировки. Остальное — менять, вводить
-- данные — им не нужно».
--
-- So trader becomes read-only globally, like accounting and readonly. Only
-- admin / manager / logistics / finance can INSERT/UPDATE.
-- The role itself stays in the enum (existing users keep it).

CREATE OR REPLACE FUNCTION is_writable_role()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager', 'logistics', 'finance')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

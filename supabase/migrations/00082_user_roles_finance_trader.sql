-- Add «Финансист» and «Трейдер» as user roles, both with manager-level access.
--
-- Both roles get exactly the same RLS rights as `manager` — they can read all
-- reference/operational data and INSERT/UPDATE everything `is_writable_role()`
-- covers (deals, applications, payments, attachments, etc). Only `admin` can
-- DELETE or create/edit users.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot be wrapped in a BEGIN/COMMIT block
-- alongside code that uses the new value — Postgres won't see the value
-- inside the same transaction it was added. So the enum changes run as
-- top-level statements, and only the function rewrite is wrapped.
-- IF NOT EXISTS makes the migration idempotent.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'finance';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'trader';

CREATE OR REPLACE FUNCTION is_writable_role()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager', 'logistics', 'finance', 'trader')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

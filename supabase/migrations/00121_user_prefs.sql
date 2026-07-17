-- 00121_user_prefs.sql
--
-- Клиент 2026-07-17: «скрывать ненужные столбцы по желанию… чтобы у
-- каждого не отображалось то, что сделал другой, оставались изменения
-- по их ID» + «самостоятельно делать закрепление столбцов».
--
-- Личные настройки интерфейса per-user: ключ-значение JSONB. Первый
-- потребитель — паспорт сделок (key = 'passport_columns':
-- { hidden: string[], pinUntil: string | null }). Настройки едут за
-- аккаунтом на любом устройстве и не влияют на других пользователей.
--
-- RLS: каждый видит и пишет только свои строки. Роль не важна —
-- финансист/бухгалтер read-only по бизнес-данным, но свои настройки
-- интерфейса менять может.

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE user_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_prefs_own ON user_prefs;
CREATE POLICY user_prefs_own ON user_prefs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION touch_user_prefs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_prefs_updated ON user_prefs;
CREATE TRIGGER trg_user_prefs_updated
  BEFORE UPDATE ON user_prefs
  FOR EACH ROW EXECUTE FUNCTION touch_user_prefs_updated_at();

-- 00122_fx_rates.sql
-- Курсы нацбанков для конвертации отчётов в USD/KZT (клиент, ТЗ
-- «Обработка сбор по валюте»). rate = «1 base = rate quote».
-- USD/KZT — НБ РК; USD/KGS — НБ КР. Конвертация пивотит через USD.

CREATE TABLE IF NOT EXISTS fx_rates (
  date           DATE NOT NULL,
  base_currency  TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate           NUMERIC(18,6) NOT NULL,
  source         TEXT NOT NULL,           -- 'nbrk' | 'nbkr' | 'manual'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (date, base_currency, quote_currency)
);

ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;

-- Чтение — любой аутентифицированный (отчёты). Запись — только
-- админ (ручная правка) через канонический хелпер is_admin() проекта
-- (00010_rls_policies). service-role загрузчик RLS обходит в любом случае.
DROP POLICY IF EXISTS fx_rates_read ON fx_rates;
CREATE POLICY fx_rates_read ON fx_rates
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fx_rates_admin_write ON fx_rates;
CREATE POLICY fx_rates_admin_write ON fx_rates
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

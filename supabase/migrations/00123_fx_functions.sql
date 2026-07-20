-- 00123_fx_functions.sql
-- Конвертация валют для отчётов. Пивот через USD:
--   KZT→USD ÷ курс НБ РК; KGS→USD ÷ курс НБ КР; далее USD→target ×.
-- Нет даты у события → среднемесячный курс (=СРЗНАЧ за месяц).

CREATE OR REPLACE FUNCTION month_num(p TEXT) RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(trim(p))
    WHEN 'январь' THEN 1 WHEN 'февраль' THEN 2 WHEN 'март' THEN 3
    WHEN 'апрель' THEN 4 WHEN 'май' THEN 5 WHEN 'июнь' THEN 6
    WHEN 'июль' THEN 7 WHEN 'август' THEN 8 WHEN 'сентябрь' THEN 9
    WHEN 'октябрь' THEN 10 WHEN 'ноябрь' THEN 11 WHEN 'декабрь' THEN 12
    ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION fx_rate(p_base TEXT, p_quote TEXT, p_date DATE)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT rate FROM fx_rates
   WHERE base_currency = p_base AND quote_currency = p_quote AND date <= p_date
   ORDER BY date DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fx_rate_month(p_base TEXT, p_quote TEXT, p_year INT, p_month INT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT AVG(rate) FROM fx_rates
   WHERE base_currency = p_base AND quote_currency = p_quote
     AND EXTRACT(YEAR FROM date) = p_year AND EXTRACT(MONTH FROM date) = p_month;
$$;

CREATE OR REPLACE FUNCTION fx_convert(p_amount NUMERIC, p_from TEXT, p_to TEXT, p_date DATE)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE v_usd NUMERIC; v_r NUMERIC;
BEGIN
  IF p_amount IS NULL THEN RETURN NULL; END IF;
  IF p_from = p_to THEN RETURN p_amount; END IF;
  IF p_from = 'USD' THEN v_usd := p_amount;
  ELSE
    v_r := fx_rate('USD', p_from, p_date);
    IF v_r IS NULL OR v_r = 0 THEN RETURN NULL; END IF;
    v_usd := p_amount / v_r;
  END IF;
  IF p_to = 'USD' THEN RETURN v_usd; END IF;
  v_r := fx_rate('USD', p_to, p_date);
  IF v_r IS NULL THEN RETURN NULL; END IF;
  RETURN v_usd * v_r;
END $$;

CREATE OR REPLACE FUNCTION fx_convert_month(p_amount NUMERIC, p_from TEXT, p_to TEXT, p_year INT, p_month INT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE v_usd NUMERIC; v_r NUMERIC;
BEGIN
  IF p_amount IS NULL THEN RETURN NULL; END IF;
  IF p_from = p_to THEN RETURN p_amount; END IF;
  IF p_from = 'USD' THEN v_usd := p_amount;
  ELSE
    v_r := fx_rate_month('USD', p_from, p_year, p_month);
    IF v_r IS NULL OR v_r = 0 THEN RETURN NULL; END IF;
    v_usd := p_amount / v_r;
  END IF;
  IF p_to = 'USD' THEN RETURN v_usd; END IF;
  v_r := fx_rate_month('USD', p_to, p_year, p_month);
  IF v_r IS NULL THEN RETURN NULL; END IF;
  RETURN v_usd * v_r;
END $$;

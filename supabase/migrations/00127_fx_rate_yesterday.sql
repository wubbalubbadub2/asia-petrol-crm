-- 00127_fx_rate_yesterday.sql
--
-- Уточнение клиента 2026-07-22: «если мы показываем данные на сегодня,
-- то берём курс вчерашнего дня, так как сегодня курс ещё не
-- зафиксировался и в течение дня может меняться. Для всех дат начиная
-- со вчера и ранее курс уже зафиксирован — берём курс того дня.»
--
-- Клиентский отчёт «Сбор по валюте» реализует это же правило в TS
-- (src/lib/fx/rates.ts). Здесь повторяем в SQL, чтобы помесячный
-- «Анализ по валюте» считал так же — иначе два отчёта разойдутся на
-- сегодняшних событиях.
--
-- Загрузку курсов не трогаем: сегодняшний курс продолжаем сохранять,
-- кламп происходит только на чтении.

CREATE OR REPLACE FUNCTION fx_rate(p_base TEXT, p_quote TEXT, p_date DATE)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT rate FROM fx_rates
   WHERE base_currency = p_base
     AND quote_currency = p_quote
     AND date <= LEAST(p_date, CURRENT_DATE - 1)
   ORDER BY date DESC LIMIT 1;
$$;

-- Среднемесячный курс тоже не должен видеть незафиксированный
-- сегодняшний курс — иначе среднее за текущий месяц «дрожит» в
-- течение дня.
CREATE OR REPLACE FUNCTION fx_rate_month(p_base TEXT, p_quote TEXT, p_year INT, p_month INT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT AVG(rate) FROM fx_rates
   WHERE base_currency = p_base
     AND quote_currency = p_quote
     AND date <= CURRENT_DATE - 1
     AND EXTRACT(YEAR FROM date) = p_year
     AND EXTRACT(MONTH FROM date) = p_month;
$$;

-- 00133_dtkt_flip_saldo_sign_convention.sql
--
-- Клиент 2026-07-30 (ДТ-КТ Логистика): «сальдо должно быть минусовым и
-- красным, если должны нам; плюсовым, если мы должны». Это разворот
-- решения 2026-07-22 («знаки не трогаем») — теперь клиент явно выбрал
-- конвенцию «− = нам должны / + = мы должны».
--
-- Сальдо в ДТ-КТ считается в UI (dt-kt/page.tsx, computeSaldo) — в БД оно
-- не хранится; функция compute_dt_kt_balance (00011) не используется.
-- Формула UI разворачивается на противоположный знак в том же коммите.
--
-- Единственное хранимое поле-«сальдо» — opening_balance («Сальдо на 1
-- янв.»). Чтобы обе колонки («Сальдо на 1 янв.» и итоговое «Сальдо») были
-- в одной конвенции, разово переворачиваем знак сохранённых значений.
-- Смысл записей сохраняется: значение, которое раньше означало «нам
-- должны 257 617,55» (хранилось +257617.55), теперь хранится как
-- −257617.55 и по-прежнему означает «нам должны 257 617,55», но в новой
-- конвенции. opening_balance читается ТОЛЬКО этим UI (проверено grep) —
-- триггеров/роллапов, зависящих от его знака, нет.
--
-- ВНИМАНИЕ: это разовый флип знака. НЕ применять повторно — второй прогон
-- вернёт старую конвенцию. Rollback = повторный прогон этого же UPDATE.

DO $$
DECLARE
  v_rows INT;
  v_sample NUMERIC;
BEGIN
  UPDATE dt_kt_logistics
     SET opening_balance = -opening_balance
   WHERE opening_balance IS NOT NULL
     AND opening_balance <> 0;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  SELECT opening_balance INTO v_sample
  FROM dt_kt_logistics
  WHERE opening_balance IS NOT NULL AND opening_balance <> 0
  ORDER BY ABS(opening_balance) DESC
  LIMIT 1;

  RAISE NOTICE 'ДТ-КТ: знак opening_balance перевёрнут у % строк; макс. по модулю теперь = %', v_rows, v_sample;
END $$;

-- 00126_dt_kt_payment_sync.sql
--
-- Клиент 2026-07-22 (PTC - Operator / ОМИ / 2026): «Паспорт сумму оплат
-- неверно считает, несколько раз обновляла данные — так и остаются
-- неверными, по факту 727791».
--
-- Проверка БД подтвердила:
--   dt_kt_logistics.payment            = 458 117.80  (5 оплат)
--   SUM(dt_kt_payments.amount)         = 727 792.30  (11 оплат)
-- Вторая расхождённая запись: PTC - Operator / ОРТ →
--   payment = 3 498 807.44 против SUM = 5 584 197.56 (23 оплаты).
--
-- Причина: dt_kt_logistics.payment — денормализованный итог, который
-- заполнялся ОДИН раз при создании записи (диалог «Добавить запись
-- ДТ-КТ» складывал введённые оплаты). Дальнейшее добавление / правка /
-- удаление строк в dt_kt_payments (панель «Оплаты» в таблице) итог
-- не пересчитывало — ни на клиенте, ни в БД. Отсюда «обновляю, а
-- цифра не меняется»: она и не должна была меняться, она хранимая.
--
-- Фикс: payment становится производной величиной, которую держит
-- триггер — ровно как additional_expenses_amount на сделках (00112).
-- Плюс backfill по всем записям + assert, что расхождений не осталось.
--
-- Валюты складываются наивно (как и раньше в UI): смешанные валюты в
-- одном экспедиторе — известное ограничение, отдельная задача.

-- ── Rollup-функция ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_dt_kt_payment_total()
RETURNS TRIGGER AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Новый/текущий владелец платежа
  v_id := COALESCE(NEW.dt_kt_id, OLD.dt_kt_id);
  IF v_id IS NOT NULL THEN
    UPDATE dt_kt_logistics
       SET payment = COALESCE((
             SELECT SUM(amount) FROM dt_kt_payments WHERE dt_kt_id = v_id
           ), 0)
     WHERE id = v_id;
  END IF;

  -- Платёж перевесили на другую запись ДТ-КТ — пересчитать и старую.
  IF TG_OP = 'UPDATE'
     AND OLD.dt_kt_id IS NOT NULL
     AND OLD.dt_kt_id IS DISTINCT FROM NEW.dt_kt_id THEN
    UPDATE dt_kt_logistics
       SET payment = COALESCE((
             SELECT SUM(amount) FROM dt_kt_payments WHERE dt_kt_id = OLD.dt_kt_id
           ), 0)
     WHERE id = OLD.dt_kt_id;
  END IF;

  RETURN NULL; -- AFTER-триггер, возвращаемое значение игнорируется
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dt_kt_payment_total ON dt_kt_payments;

-- Без OF-clause намеренно: любая правка строки оплаты обязана
-- пересчитать итог (урок 00115 — «AFTER UPDATE OF col» не срабатывает,
-- если колонку поменял BEFORE-триггер, а не SET-list).
CREATE TRIGGER trg_dt_kt_payment_total
AFTER INSERT OR UPDATE OR DELETE
ON dt_kt_payments
FOR EACH ROW
EXECUTE FUNCTION update_dt_kt_payment_total();

-- ── Backfill ───────────────────────────────────────────────────
UPDATE dt_kt_logistics l
   SET payment = COALESCE((
         SELECT SUM(amount) FROM dt_kt_payments p WHERE p.dt_kt_id = l.id
       ), 0);

-- ── Assert: расхождений не осталось ────────────────────────────
DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT COUNT(*) INTO v_bad
    FROM dt_kt_logistics l
   WHERE COALESCE(l.payment, 0) IS DISTINCT FROM COALESCE((
           SELECT SUM(amount) FROM dt_kt_payments p WHERE p.dt_kt_id = l.id
         ), 0);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'dt_kt payment backfill failed: % записей всё ещё расходятся', v_bad;
  END IF;
END $$;

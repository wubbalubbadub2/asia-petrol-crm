-- 00156_activity_log_offsets.sql
--
-- Журнал активности сделки говорил про взаимозачёты старым языком.
-- Найдено 27.08.2026 при проверке взаимозачётов в браузере: в ленте
-- сделки KZ/26/147 висело
--
--     «Перезачет поставщику: -66358495.820»
--
-- тогда как соседняя строка, которую рисует фронт из metadata, читалась
-- как «Оплата поставщику: −66 358 495,82 ₸». Разница в том, что строки
-- по самой таблице deal_payments фронт печатает как есть — их текст
-- целиком собирает вот этот триггер.
--
-- Что было не так:
--   1. 'offset' подписывался «Перезачет». Сущность переименована в
--      «Взаимозачёт» ещё в 00145, в интерфейсе слова «Перезачет» нет.
--   2. Сумма шла через _activity_fmt_num — формат для ТОНН: три знака
--      после точки и без разделителя разрядов. Для денег нужно два
--      знака и группировка, как везде в продукте.
--   3. Валюта не печаталась вовсе, когда в строке NULL, — а NULL там
--      значит «валюта сделки», и это самый частый случай.
--   4. Удаление и правка всегда назывались «оплата», даже если удалили
--      взаимозачёт.
--   5. Смена типа писалась по-английски: «тип offset → payment».
--   6. Ни вид взаимозачёта, ни встречная сделка в журнал не попадали —
--      а с 00156 взаимозачёт правится ещё и из паспорта, так что «кто
--      и на какую сделку его повесил» — ровно то, что нужно в аудите.
--
-- Исторические записи НЕ переписываются: журнал — аудит, задним числом
-- он не меняется. Правило действует на записи, созданные после этой
-- миграции.

-- =====================================================================
-- 1. Вспомогательные форматтеры
-- =====================================================================

-- Деньги: два знака, разделитель разрядов — неразрывный пробел,
-- минус — U+2212, как в formatAmount на фронте.
-- _activity_fmt_num НЕ трогаем: он форматирует тонны в логах реестра,
-- и три знака после точки там осмысленны.
CREATE OR REPLACE FUNCTION _activity_fmt_money(p NUMERIC)
RETURNS TEXT AS $$
DECLARE
  v_body TEXT;
  v_int  TEXT;
  v_frac TEXT;
BEGIN
  IF p IS NULL THEN RETURN '—'; END IF;
  v_body := to_char(round(abs(p), 2), 'FM999999999999990.00');
  v_int  := split_part(v_body, '.', 1);
  v_frac := split_part(v_body, '.', 2);
  -- Группируем по три справа налево: разворачиваем, ставим маркер после
  -- каждых трёх цифр, за которыми ещё есть цифра, разворачиваем обратно.
  v_int := reverse(regexp_replace(reverse(v_int), '(\d{3})(?=\d)', '\1~', 'g'));
  v_int := replace(v_int, '~', chr(160));
  RETURN CASE WHEN p < 0 THEN chr(8722) ELSE '' END || v_int || ',' || v_frac;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Символ валюты — тот же список, что в src/lib/constants/currencies.ts.
-- Неизвестный код возвращаем как есть, чтобы не потерять информацию.
CREATE OR REPLACE FUNCTION _activity_currency_symbol(p_code TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE p_code
    WHEN 'USD' THEN '$'
    WHEN 'KZT' THEN '₸'
    WHEN 'KGS' THEN 'сом'
    WHEN 'RUB' THEN '₽'
    ELSE p_code END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Подписи типа строки. Род разный («оплата» женского, «взаимозачёт» и
-- «возврат» мужского), поэтому глагол берём отдельной функцией.
CREATE OR REPLACE FUNCTION _activity_payment_kind(p_type TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE p_type
    WHEN 'refund' THEN 'Возврат'
    WHEN 'offset' THEN 'Взаимозачёт'
    ELSE 'Оплата' END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Строчный вариант задан ЯВНО, а не через lower(): при локали C
-- lower() не трогает кириллицу, и текст журнала зависел бы от локали
-- кластера — на локальном Postgres выходило «Изменён Взаимозачёт».
CREATE OR REPLACE FUNCTION _activity_payment_kind_lower(p_type TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE p_type
    WHEN 'refund' THEN 'возврат'
    WHEN 'offset' THEN 'взаимозачёт'
    ELSE 'оплата' END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- «Удалена оплата» / «Удалён взаимозачёт» — согласование по роду.
CREATE OR REPLACE FUNCTION _activity_payment_verb(p_type TEXT, p_verb TEXT)
RETURNS TEXT AS $$
BEGIN
  -- p_verb: 'удал' | 'измен'. Оплата — женский род, остальные мужской.
  RETURN p_verb || CASE WHEN COALESCE(p_type, 'payment') = 'payment' THEN 'ена' ELSE 'ён' END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION _activity_offset_kind(p_kind TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE p_kind
    WHEN 'bilateral'  THEN '2-х сторонний'
    WHEN 'trilateral' THEN '3-х сторонний'
    ELSE NULL END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================================
-- 2. Триггерная функция журнала по deal_payments
-- =====================================================================
-- Полная замена версии из 00100. Структура и метаданные сохранены,
-- переписаны только тексты; в metadata добавлены реквизиты
-- взаимозачёта (00145), которых там не было.

CREATE OR REPLACE FUNCTION log_deal_payments_change()
RETURNS TRIGGER AS $$
DECLARE
  v_user      UUID := auth.uid();
  v_deal_id   UUID := COALESCE(NEW.deal_id, OLD.deal_id);
  v_content   TEXT;
  v_metadata  JSONB;
  v_changes   TEXT[] := ARRAY[]::TEXT[];
  v_side      TEXT;
  v_kind      TEXT;
  v_cur       TEXT;
  v_tail      TEXT;
  v_counter   TEXT;
BEGIN
  IF v_deal_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF _activity_is_draft_deal(v_deal_id) THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    v_side := CASE WHEN NEW.side = 'supplier' THEN 'поставщику' ELSE 'покупателя' END;
    v_kind := _activity_payment_kind(NEW.payment_type);
    -- NULL в строке означает «валюта сделки» — достаём её, иначе самый
    -- частый случай остался бы вообще без валюты.
    SELECT COALESCE(NEW.currency,
                    CASE WHEN NEW.side = 'supplier' THEN d.supplier_currency ELSE d.buyer_currency END)
      INTO v_cur
      FROM deals d WHERE d.id = NEW.deal_id;

    -- Хвост взаимозачёта: вид и встречная сделка.
    v_tail := '';
    IF NEW.payment_type = 'offset' THEN
      IF _activity_offset_kind(NEW.offset_kind) IS NOT NULL THEN
        v_tail := v_tail || ', ' || _activity_offset_kind(NEW.offset_kind);
      END IF;
      IF NEW.counterparty_deal_id IS NOT NULL THEN
        SELECT d.deal_code INTO v_counter FROM deals d WHERE d.id = NEW.counterparty_deal_id;
        v_tail := v_tail || ', встречная сделка ' || COALESCE(v_counter, '—');
      END IF;
    END IF;

    v_content := v_kind || ' ' || v_side
      || ': ' || _activity_fmt_money(NEW.amount)
      || COALESCE(' ' || _activity_currency_symbol(v_cur), '')
      || COALESCE(' (' || to_char(NEW.payment_date, 'DD.MM.YYYY') || ')', '')
      || v_tail;
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'side', NEW.side,
      'payment_type', NEW.payment_type,
      'amount', NEW.amount,
      'currency', NEW.currency,
      'payment_date', NEW.payment_date,
      'description', NEW.description,
      'offset_kind', NEW.offset_kind,
      'counterparty_deal_id', NEW.counterparty_deal_id,
      'mirror_of', NEW.mirror_of
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'payment', v_content, v_metadata);

  ELSIF TG_OP = 'DELETE' THEN
    v_side := CASE WHEN OLD.side = 'supplier' THEN 'поставщику' ELSE 'покупателя' END;
    SELECT COALESCE(OLD.currency,
                    CASE WHEN OLD.side = 'supplier' THEN d.supplier_currency ELSE d.buyer_currency END)
      INTO v_cur
      FROM deals d WHERE d.id = OLD.deal_id;
    v_content := _activity_payment_verb(OLD.payment_type, 'Удал') || ' '
      || _activity_payment_kind_lower(OLD.payment_type) || ' ' || v_side
      || ': ' || _activity_fmt_money(OLD.amount)
      || COALESCE(' ' || _activity_currency_symbol(v_cur), '');
    v_metadata := jsonb_build_object(
      'row_id', OLD.id,
      'side', OLD.side,
      'payment_type', OLD.payment_type,
      'amount', OLD.amount,
      'currency', OLD.currency,
      'payment_date', OLD.payment_date,
      'description', OLD.description,
      'offset_kind', OLD.offset_kind,
      'counterparty_deal_id', OLD.counterparty_deal_id,
      'mirror_of', OLD.mirror_of
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'payment', v_content, v_metadata);

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.amount IS DISTINCT FROM NEW.amount THEN
      v_changes := v_changes || ('сумма ' || _activity_fmt_money(OLD.amount) || ' → ' || _activity_fmt_money(NEW.amount));
    END IF;
    IF OLD.payment_date IS DISTINCT FROM NEW.payment_date THEN
      v_changes := v_changes || ('дата ' || COALESCE(to_char(OLD.payment_date, 'DD.MM.YYYY'), '—') || ' → ' || COALESCE(to_char(NEW.payment_date, 'DD.MM.YYYY'), '—'));
    END IF;
    IF OLD.currency IS DISTINCT FROM NEW.currency THEN
      v_changes := v_changes || ('валюта ' || COALESCE(_activity_currency_symbol(OLD.currency), '—') || ' → ' || COALESCE(_activity_currency_symbol(NEW.currency), '—'));
    END IF;
    IF OLD.payment_type IS DISTINCT FROM NEW.payment_type THEN
      v_changes := v_changes || ('тип ' || _activity_payment_kind_lower(OLD.payment_type) || ' → ' || _activity_payment_kind_lower(NEW.payment_type));
    END IF;
    -- Вид взаимозачёта и встречная сделка (00145): раньше их правку
    -- журнал не замечал вовсе.
    IF OLD.offset_kind IS DISTINCT FROM NEW.offset_kind THEN
      v_changes := v_changes || ('вид ' || COALESCE(_activity_offset_kind(OLD.offset_kind), '—')
                                 || ' → ' || COALESCE(_activity_offset_kind(NEW.offset_kind), '—'));
    END IF;
    IF OLD.counterparty_deal_id IS DISTINCT FROM NEW.counterparty_deal_id THEN
      v_changes := v_changes || ('встречная сделка '
        || COALESCE((SELECT d.deal_code FROM deals d WHERE d.id = OLD.counterparty_deal_id), '—')
        || ' → '
        || COALESCE((SELECT d.deal_code FROM deals d WHERE d.id = NEW.counterparty_deal_id), '—'));
    END IF;
    IF OLD.side IS DISTINCT FROM NEW.side THEN
      v_changes := v_changes || ('сторона ' || OLD.side || ' → ' || NEW.side);
    END IF;
    IF OLD.description IS DISTINCT FROM NEW.description THEN
      v_changes := v_changes || ('описание изменено'::TEXT);
    END IF;

    IF array_length(v_changes, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    v_side := CASE WHEN NEW.side = 'supplier' THEN 'поставщику' ELSE 'покупателя' END;
    v_content := _activity_payment_verb(NEW.payment_type, 'Измен') || ' '
      || _activity_payment_kind_lower(NEW.payment_type) || ' ' || v_side
      || ' (' || array_to_string(v_changes, ', ') || ')';
    v_metadata := jsonb_build_object(
      'row_id', NEW.id,
      'side', NEW.side,
      'old', jsonb_build_object(
        'amount', OLD.amount,
        'currency', OLD.currency,
        'payment_date', OLD.payment_date,
        'payment_type', OLD.payment_type,
        'description', OLD.description,
        'offset_kind', OLD.offset_kind,
        'counterparty_deal_id', OLD.counterparty_deal_id
      ),
      'new', jsonb_build_object(
        'amount', NEW.amount,
        'currency', NEW.currency,
        'payment_date', NEW.payment_date,
        'payment_type', NEW.payment_type,
        'description', NEW.description,
        'offset_kind', NEW.offset_kind,
        'counterparty_deal_id', NEW.counterparty_deal_id
      )
    );
    INSERT INTO deal_activity (deal_id, user_id, type, content, metadata)
    VALUES (v_deal_id, v_user, 'payment', v_content, v_metadata);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

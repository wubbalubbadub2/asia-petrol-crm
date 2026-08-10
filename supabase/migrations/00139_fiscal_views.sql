-- Представления для экрана реестра фискальных документов (СНТ и ЭСФ).
--
-- Схема таблиц — 00138. Здесь только два представления и досылка
-- комментариев, которые были дописаны в 00138 уже после его применения
-- на боевой базе (текст в БД отстал от репозитория).
--
-- Оба представления с префиксом fiscal_ намеренно: схема public в этом
-- проекте общая со вторым продуктом (Kaspi-аналитика продавца), там
-- живут products / orders / competitors / reviews и ещё два десятка
-- таблиц. Короткие имена вроде counterparty занимать нельзя.

-- ── Досылка комментариев из 00138 ──────────────────────────────────
COMMENT ON COLUMN fiscal_document.direction_code IS
  'Направление как пришло из 1С, мужской род. Парного *_code у поля нет — это и есть исходное значение. ВНИМАНИЕ: направление не определяет роль сторон, см. own_party_role_code.';
COMMENT ON COLUMN fiscal_document.own_party_role_code IS
  'Роль нашей стороны (supplier / recipient) как её отдала обработка. Выводить её из direction_code НЕЛЬЗЯ: с версии обработки 1.5.0 у СНТ на ввоз направление «Исходящий» (документ выписан нами в ИС ЭСФ), а роль recipient (товар получаем мы). Ни CHECK, ни триггера, связывающего эти две колонки, здесь нет — и появиться не должно.';

-- ── Гранты на таблицы 00138 ────────────────────────────────────────
-- 00138 положился на одни политики RLS и не тронул гранты. Supabase
-- через ALTER DEFAULT PRIVILEGES выдаёт anon и authenticated права на
-- каждую новую таблицу схемы public, поэтому anon получил гранты на все
-- три — включая landing с реквизитами договоров, адресами складов,
-- свидетельствами по НДС контрагентов и ФИО подписантов.
--
-- Данные при этом не утекали: RLS отсекала строки, анонимный запрос
-- возвращал пустой массив. Но защита держалась на одном рубеже —
-- политике. Анонимный ключ лежит в клиентском бандле и доступен
-- любому, кто открыл сайт, поэтому у него не должно быть даже права
-- обратиться к таблице.
--
-- service_role здесь не упоминается намеренно: REVOKE его не трогает,
-- загрузчик продолжает писать как писал.
REVOKE ALL ON integration_1c_payload FROM anon, authenticated;
REVOKE ALL ON fiscal_document        FROM anon, authenticated;
REVOKE ALL ON fiscal_document_line   FROM anon, authenticated;

-- Авторизованным — только чтение. Дальше их сужает RLS: landing видят
-- одни админы, реестр и строки — любой вошедший. Писать не может никто,
-- кроме service_role: политик на запись нет, и грантов теперь тоже.
GRANT SELECT ON integration_1c_payload TO authenticated;
GRANT SELECT ON fiscal_document        TO authenticated;
GRANT SELECT ON fiscal_document_line   TO authenticated;

-- ── Каноническое имя контрагента по БИНу ───────────────────────────
-- Один и тот же контрагент приезжает из 1С под разными написаниями:
-- в первой выгрузке 37 БИНов из 207 имеют больше одного варианта,
-- рекорд — 4 («Акционерное общество "Международный аэропорт Алматы"»,
-- «АО "Международный Аэропорт Алматы"», …). Группировать и искать
-- нужно по БИНу, показывать — одно имя.
--
-- Каноническим считаем самое частое написание. Тай-брейк по алфавиту,
-- иначе при равном счёте имя прыгало бы от запроса к запросу.
--
-- security_invoker = true: представление исполняется с правами
-- вызывающего, поэтому RLS базовой fiscal_document продолжает
-- действовать. Без этого флага представление шло бы от владельца и
-- отдавало бы данные мимо политик.
CREATE OR REPLACE VIEW fiscal_counterparty
WITH (security_invoker = true) AS
WITH per_name AS (
  SELECT counterparty_identifier,
         counterparty_name,
         count(*) AS name_count
    FROM fiscal_document
   WHERE counterparty_identifier IS NOT NULL
     AND counterparty_name IS NOT NULL
   GROUP BY 1, 2
),
canon AS (
  SELECT DISTINCT ON (counterparty_identifier)
         counterparty_identifier,
         counterparty_name
    FROM per_name
   ORDER BY counterparty_identifier, name_count DESC, counterparty_name ASC
),
totals AS (
  SELECT counterparty_identifier,
         count(*)                              AS doc_count,
         count(DISTINCT counterparty_name)     AS name_variants,
         min(registration_date)                AS first_document_at,
         max(registration_date)                AS last_document_at
    FROM fiscal_document
   WHERE counterparty_identifier IS NOT NULL
   GROUP BY 1
)
SELECT t.counterparty_identifier,
       COALESCE(c.counterparty_name, t.counterparty_identifier) AS canonical_name,
       t.name_variants,
       t.doc_count,
       t.first_document_at,
       t.last_document_at
  FROM totals t
  LEFT JOIN canon c USING (counterparty_identifier);

COMMENT ON VIEW fiscal_counterparty IS
  'Контрагенты фискальных документов, по одной строке на БИН/ИИН. canonical_name — самое частое написание имени (тай-брейк по алфавиту). Имена из документов для группировки непригодны. Нерезиденты без идентификатора сюда не попадают: у них группировать нечего, в UI они показываются по имени с пометкой «нерезидент». security_invoker = true — RLS базовой таблицы действует.';

REVOKE ALL ON fiscal_counterparty FROM anon, authenticated;
GRANT SELECT ON fiscal_counterparty TO authenticated;

-- ── Отклонённые документы: сознательное окно сквозь RLS ────────────
-- ВНИМАНИЕ. Это представление НАМЕРЕННО обходит RLS базовой таблицы
-- integration_1c_payload, у которой политика чтения — только is_admin().
-- Оно создано БЕЗ security_invoker, то есть исполняется с правами
-- владельца, а владелец (postgres) политики базовой таблицы обходит.
--
-- Зачем. Часть документов выгрузки отклоняется загрузчиком (в первом
-- файле — 8 СНТ на ввоз, у которых поставщик-нерезидент без БИН РК,
-- на 792 321 594 ₸). В реестре их нет, и человек, сверяющий экран
-- с журналом 1С, обнаружит расхождение и пойдёт искать ошибку в
-- реестре, которой там нет. Поэтому счётчик и причина должны быть
-- видны КАЖДОМУ авторизованному пользователю, а не только админу.
--
-- Чем ограничено окно. Семь колонок перечислены явно, никаких
-- select * и никаких дополнительных полей из payload. В сыром
-- payload лежат реквизиты договоров, адреса складов, свидетельства
-- по НДС контрагентов и ФИО подписантов — ничего этого сюда не
-- попадает и попасть не должно. Состав колонок закреплён тестом
-- supabase/tests/09_fiscal_views.test.sql: ровно семь, любое
-- расширение роняет тест.
--
-- direction_code сюда не входит намеренно: у отклонённых это ровно
-- то поле, которое вводит в заблуждение (у СНТ на ввоз оно
-- «Исходящий», хотя товар получаем мы, — в этом и состоит дефект
-- карты полей в обработке 1С). Смысл несёт operation_kind_code.
CREATE OR REPLACE VIEW fiscal_rejected_document AS
SELECT p.registration_number,
       p.doc_kind,
       p.payload ->> 'operation_kind_code'          AS operation_kind_code,
      (p.payload ->> 'registration_date')::timestamp AS registration_date,
      (p.payload ->> 'total_amount')::numeric        AS total_amount,
       p.payload ->> 'currency_code'                AS currency_code,
       p.reject_reason
  FROM integration_1c_payload p
 WHERE p.ingest_status = 'rejected';

COMMENT ON VIEW fiscal_rejected_document IS
  'Документы выгрузки 1С, которые загрузчик отклонил. СОЗНАТЕЛЬНОЕ ОКНО СКВОЗЬ RLS: базовая integration_1c_payload доступна только админам, это представление — любому авторизованному, потому что расхождение реестра с журналом 1С должен видеть тот, кто сверяет, а не только админ. Ровно семь колонок, состав закреплён тестом 09_fiscal_views. Расширять список полями из payload нельзя: там персональные и договорные данные.';

-- Порядок важен: REVOKE снимает дефолтные гранты Supabase (их получают
-- и anon, и authenticated), GRANT возвращает доступ только
-- авторизованным. CREATE POLICY здесь бессмысленен — у представлений
-- нет RLS, доступ управляется исключительно грантами.
REVOKE ALL ON fiscal_rejected_document FROM anon, authenticated;
GRANT SELECT ON fiscal_rejected_document TO authenticated;

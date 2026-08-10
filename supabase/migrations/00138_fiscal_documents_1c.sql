-- Фискальные документы из 1С: СНТ и ЭСФ (выгрузка ИС ЭСФ).
--
-- Источник: обработка выгрузки из файловой базы 1С (payload-N.json).
-- Первый боевой файл — ARKAPROF, 6987 документов и 11196 товарных строк
-- за 2020-05-02 … 2026-06-17.
--
-- Три слоя:
--   integration_1c_payload  — landing, сырой документ в jsonb, дедуп
--                             по sha256 канонического JSON;
--   fiscal_document         — нормализованный реестр;
--   fiscal_document_line    — товарные строки.
--
-- Таблицы позже переезжают в отдельный репозиторий интеграции, поэтому
-- их имена зафиксированы владельцем и меняться не должны.
--
-- ── Решения владельца, зафиксированные здесь ───────────────────────
--
-- 1. Ключ документа — (source_org_code, doc_kind, registration_number),
--    где source_org_code это БИН из own_party.identifier САМОГО
--    документа. Не source.base_ref: там имя каталога файловой базы
--    («АРК»), оно зависит от способа развёртывания и ключом быть не
--    может. Документ без own_party.identifier отклоняется — в первом
--    файле таких 8 (все с нерезидентом-поставщиком без БИН).
--
-- 2. Ключ строки — (document_id, line_no), НЕ (document_id,
--    snt_line_no). Причина в комментарии к fiscal_document_line.snt_line_no.
--
-- 3. Перечисления. У полей 1С есть пара: без суффикса — синоним для
--    показа, с суффиксом _code — имя значения из метаданных. Логика
--    читает ТОЛЬКО *_code. Проверенные расхождения в первом файле:
--      doc_type   «Исправленная (аннулированная, отклоненная)» → «Исправленная» (64 док.)
--      doc_type   «На возврат товаров»                         → «ВозвратТоваров» (1 док.)
--      status     «Отправленный»                               → «Созданный» (143 док.)
--      status     «Не просмотрен»                              → «НеПросмотрен» (92 док.)
--    Поэтому *_label хранится отдельно и в условиях не участвует.
--
-- 4. Наименования не ключ. Один БИН 200240037215 встретился в файле
--    под 46 написаниями («АРҚА ПРОФ», «Арка Проф», «АркаПроф»,
--    «ТОО ТОО "Арка Проф"», «Арко-Проф»). Группировка и поиск — по БИНу.
--
-- 5. Единицы не приводятся. quantity и net_weight на одной строке
--    приходят в РАЗНЫХ единицах (наблюдалось 59.744 т и 59744 кг, всего
--    253 строки с отношением ≈1000). Ни БД, ни UI их не сверяют и не
--    пересчитывают. Суммы — в валюте документа (currency_code,
--    fx_rate), пересчёта в тенге нет.
--
-- 6. Числовые типы — голый NUMERIC без масштаба. Значения кладутся
--    ровно как пришли; numeric(20,2) молча округлил бы цену
--    с большим числом знаков.

-- ── Landing ────────────────────────────────────────────────────────
-- Одна строка = одна версия одного документа. Если документ изменился
-- в 1С (сменилось состояние, исправились суммы), sha256 другой и
-- появляется НОВАЯ строка — история версий сохраняется целиком.
-- Повторная выгрузка того же содержимого новой строки не создаёт,
-- только двигает last_seen_at.
CREATE TABLE IF NOT EXISTS integration_1c_payload (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_sha256      TEXT NOT NULL UNIQUE,
  payload             JSONB NOT NULL,

  -- Разобранные из payload координаты. NULL у отклонённых документов.
  source_org_code     TEXT,
  doc_kind            TEXT,
  registration_number TEXT,

  -- Метаданные файла-источника. Справочно, ключом НЕ являются.
  file_org_code       TEXT,
  file_base_ref       TEXT,
  config_version      TEXT,
  processing_version  TEXT,

  ingest_status       TEXT NOT NULL CHECK (ingest_status IN ('accepted', 'rejected')),
  reject_reason       TEXT,

  ingest_run_id       UUID,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT integration_1c_payload_reject_reason_ck
    CHECK ((ingest_status = 'rejected') = (reject_reason IS NOT NULL))
);

COMMENT ON TABLE integration_1c_payload IS
  'Landing-слой выгрузки 1С: сырой документ как пришёл. Дедуп по sha256 канонического JSON, поэтому изменение документа в 1С даёт новую строку — версии не затираются.';
COMMENT ON COLUMN integration_1c_payload.content_sha256 IS
  'sha256 от канонического JSON документа: ключи отсортированы рекурсивно, сериализация без пробелов. Иначе хеш прыгал бы от порядка полей, который 1С не гарантирует.';
COMMENT ON COLUMN integration_1c_payload.file_base_ref IS
  'source.base_ref из файла («АРК») — имя каталога файловой базы. Зависит от способа развёртывания, ключом быть не может. Хранится только для разбора инцидентов.';
COMMENT ON COLUMN integration_1c_payload.reject_reason IS
  'no_own_identifier — нет own_party.identifier; snt_line_without_snt_line_no — у строки СНТ пуст НомерСтрокиСНТ.';

CREATE INDEX IF NOT EXISTS idx_integration_1c_payload_doc
  ON integration_1c_payload (source_org_code, doc_kind, registration_number);
CREATE INDEX IF NOT EXISTS idx_integration_1c_payload_rejected
  ON integration_1c_payload (ingest_status, last_seen_at DESC)
  WHERE ingest_status = 'rejected';

-- ── Реестр ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fiscal_document (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload_id          UUID REFERENCES integration_1c_payload(id),

  source_org_code     TEXT NOT NULL,
  doc_kind            TEXT NOT NULL CHECK (doc_kind IN ('snt', 'esf')),
  registration_number TEXT NOT NULL,

  -- Без часового пояса намеренно. 1С отдаёт «2023-05-05T09:57:12» без
  -- смещения; это местное время оператора. TIMESTAMPTZ заставил бы
  -- Postgres домыслить зону (на Supabase — UTC) и сдвинул бы все
  -- отметки времени регистрации на пять часов. Храним как пришло.
  registration_date   TIMESTAMP NOT NULL,
  issue_date          DATE,
  shipment_date       DATE,

  -- У direction парного *_code в выгрузке нет — приходит одна строка
  -- в мужском роде. CHECK нужен, чтобы «Входящая» уронила загрузку
  -- громко, а не выпала тихо из вкладок реестра.
  direction_code      TEXT NOT NULL CHECK (direction_code IN ('Входящий', 'Исходящий')),

  doc_type_code       TEXT NOT NULL,
  doc_type_label      TEXT,
  status_code         TEXT NOT NULL,
  status_label        TEXT,
  state_code          TEXT NOT NULL,
  state_label         TEXT,
  operation_kind_code TEXT,
  operation_kind_label TEXT,

  own_party_name         TEXT,
  own_party_role_code    TEXT,
  counterparty_identifier TEXT,
  counterparty_name       TEXT,
  counterparty_role_code  TEXT,

  total_amount        NUMERIC,
  currency_code       TEXT NOT NULL,
  fx_rate             NUMERIC NOT NULL,

  related_registration_number     TEXT,
  related_snt_registration_number TEXT,
  doc_number_display  TEXT,

  is_void       BOOLEAN NOT NULL
    GENERATED ALWAYS AS (state_code IN ('Аннулирован', 'Отозван')) STORED,
  is_superseded BOOLEAN NOT NULL DEFAULT false,
  line_count    INT NOT NULL DEFAULT 0,

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fiscal_document_key_uniq
    UNIQUE (source_org_code, doc_kind, registration_number)
);

COMMENT ON TABLE fiscal_document IS
  'Нормализованный реестр СНТ и ЭСФ из 1С. Ключ — (source_org_code, doc_kind, registration_number).';
COMMENT ON COLUMN fiscal_document.source_org_code IS
  'БИН нашей стороны: own_party.identifier ИЗ ДОКУМЕНТА. Не source.org_code и не source.base_ref из шапки файла.';
COMMENT ON COLUMN fiscal_document.own_party_name IS
  'Наименование нашей стороны как его написали в документе. Только для показа: один БИН встретился в первом файле под 46 написаниями. Ни группировать, ни искать по нему нельзя.';
COMMENT ON COLUMN fiscal_document.counterparty_name IS
  'Наименование контрагента как в документе. Только для показа — у 38 из 207 контрагентов больше одного написания. Ключ контрагента — counterparty_identifier (БИН/ИИН). У нерезидентов он пуст.';
COMMENT ON COLUMN fiscal_document.doc_type_label IS
  'Синоним для показа. В условиях НЕ участвует: в первом файле «Исправленная (аннулированная, отклоненная)» соответствует коду «Исправленная», «На возврат товаров» — коду «ВозвратТоваров».';
COMMENT ON COLUMN fiscal_document.direction_code IS
  'Направление как пришло из 1С, мужской род. Парного *_code у поля нет — это и есть исходное значение. ВНИМАНИЕ: направление не определяет роль сторон, см. own_party_role_code.';
COMMENT ON COLUMN fiscal_document.own_party_role_code IS
  'Роль нашей стороны (supplier / recipient) как её отдала обработка. Выводить её из direction_code НЕЛЬЗЯ: с версии обработки 1.5.0 у СНТ на ввоз направление «Исходящий» (документ выписан нами в ИС ЭСФ), а роль recipient (товар получаем мы). Ни CHECK, ни триггера, связывающего эти две колонки, здесь нет — и появиться не должно.';
COMMENT ON COLUMN fiscal_document.is_void IS
  'Аннулирован или отозван. Считается из state_code ∈ {Аннулирован, Отозван} — вычисляемая колонка, чтобы загрузчик и UI не могли разойтись с правилом. Внимание: состояние «АннулированПриОтзывеСНТ» в это множество НЕ входит (в первом файле 10 документов, флаг источника подтверждает false).';
COMMENT ON COLUMN fiscal_document.is_superseded IS
  'Документ исправлен более поздним: существует документ той же организации и того же вида, у которого related_registration_number равен нашему registration_number. Выставляется загрузчиком после вставки всей пачки.';
COMMENT ON COLUMN fiscal_document.related_registration_number IS
  'Регистрационный номер документа, который ЭТОТ документ исправляет. В первом файле заполнен у 309 документов, все 309 ссылок разрешились внутри файла.';
COMMENT ON COLUMN fiscal_document.related_snt_registration_number IS
  'Только у ЭСФ: регистрационный номер связанной СНТ. В первом файле заполнен у 1078 ЭСФ, все разрешились.';
COMMENT ON COLUMN fiscal_document.doc_number_display IS
  'Человекочитаемый номер: НомерСНТ у СНТ, Номер у ЭСФ. Не уникален — «225» встретился у трёх разных СНТ за 2023–2025, у ЭСФ 2713 различных номеров на 4626 документов. Только для показа.';
COMMENT ON COLUMN fiscal_document.total_amount IS
  'Сумма в валюте документа (currency_code), без пересчёта в тенге. fx_rate хранится справочно.';

CREATE INDEX IF NOT EXISTS idx_fiscal_document_registry
  ON fiscal_document (source_org_code, doc_kind, direction_code,
                      is_superseded, is_void, registration_date DESC);
CREATE INDEX IF NOT EXISTS idx_fiscal_document_counterparty
  ON fiscal_document (counterparty_identifier, registration_date DESC);
CREATE INDEX IF NOT EXISTS idx_fiscal_document_regnum
  ON fiscal_document (registration_number);
CREATE INDEX IF NOT EXISTS idx_fiscal_document_related
  ON fiscal_document (source_org_code, doc_kind, related_registration_number)
  WHERE related_registration_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_document_related_snt
  ON fiscal_document (source_org_code, related_snt_registration_number)
  WHERE related_snt_registration_number IS NOT NULL;

-- ── Товарные строки ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fiscal_document_line (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES fiscal_document(id) ON DELETE CASCADE,

  table_name    TEXT NOT NULL,
  line_no       INT NOT NULL,
  snt_line_no   INT,

  pin_code      TEXT,
  name          TEXT,
  source_lot_id TEXT,

  quantity        NUMERIC,
  unit            TEXT,
  net_weight      NUMERIC,
  storage_unit    TEXT,
  conversion_rate NUMERIC,

  price      NUMERIC,
  amount_net NUMERIC,
  amount     NUMERIC,
  vat_amount NUMERIC,

  CONSTRAINT fiscal_document_line_key_uniq UNIQUE (document_id, line_no)
);

COMMENT ON TABLE fiscal_document_line IS
  'Товарные строки документа: ДанныеПоНефтепродуктам у СНТ, Товары у ЭСФ.';
COMMENT ON COLUMN fiscal_document_line.line_no IS
  'Порядковый номер строки табличной части 1С (НомерСтроки). Уникален внутри документа у всех 6987 документов первого файла, поэтому он и взят ключом строки.';
COMMENT ON COLUMN fiscal_document_line.snt_line_no IS
  'Номер позиции в ИС ЭСФ (НомерСтрокиСНТ). У СНТ обязателен, у ЭСФ всегда пуст.
   ВНИМАНИЕ: внутри документа НЕ уникален, уникальный индекс на (document_id, snt_line_no) ставить нельзя — он отклонял бы нормальные документы.
   Позиция бланка = ГРУППА строк с одним snt_line_no. 1С раскладывает одну позицию по записям-остаткам виртуального склада (см. source_lot_id): в первом файле СНТ KZ-SNT-3020-200240037215-20251221-50229974 содержит 88 строк с двумя значениями snt_line_no (41 и 47). Внутри группы совпадают товар, ПИН-код, ТН ВЭД, единица, ставка НДС и ЦЕНА; различаются только источник и количество.
   Свод позиции: сумма quantity и сумма amount по группе. Арифметика точная — цена × Σколичество сходится с Σamount_net до копеек округления, ΣНДС и Σamount сходятся ровно.';
COMMENT ON COLUMN fiscal_document_line.source_lot_id IS
  'ДополнительныйИдентификатор строки — партия (запись остатка) на виртуальном складе ИС ЭСФ. Входящая СНТ партию создаёт, исходящая с неё списывает, поэтому один идентификатор связывает приход с расходом: в первом файле 879 из 1378 партий встретились ровно в двух СНТ, рекорд — 17 СНТ за две недели. Прослеживаемость партии.';
COMMENT ON COLUMN fiscal_document_line.quantity IS
  'Количество в единице unit. С net_weight НЕ связано и НЕ сверяется: на одной строке они приходят в разных единицах (т и кг).';
COMMENT ON COLUMN fiscal_document_line.net_weight IS
  'Вес нетто в своей единице (обычно кг), как пришёл. Не приводить к quantity.';

CREATE INDEX IF NOT EXISTS idx_fiscal_document_line_document
  ON fiscal_document_line (document_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_document_line_position
  ON fiscal_document_line (document_id, snt_line_no);
CREATE INDEX IF NOT EXISTS idx_fiscal_document_line_lot
  ON fiscal_document_line (source_lot_id)
  WHERE source_lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_document_line_pin
  ON fiscal_document_line (pin_code)
  WHERE pin_code IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────────
-- Пишет только загрузчик под service role, который RLS обходит.
-- Политик на INSERT/UPDATE/DELETE намеренно нет: через анонимный или
-- пользовательский ключ эти таблицы не изменяемы вообще.
ALTER TABLE integration_1c_payload  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_document         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_document_line    ENABLE ROW LEVEL SECURITY;

-- Сырой payload — только админам: там реквизиты договоров, адреса
-- складов, ФИО подписантов и прочее, чего в реестре нет.
CREATE POLICY "admin_select_integration_1c_payload" ON integration_1c_payload
  FOR SELECT USING (is_admin());

CREATE POLICY "auth_select_fiscal_document" ON fiscal_document
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_select_fiscal_document_line" ON fiscal_document_line
  FOR SELECT USING (auth.uid() IS NOT NULL);

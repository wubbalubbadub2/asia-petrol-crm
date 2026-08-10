-- Полный бланк СНТ в реестре: разложить в колонки то, что до сих пор
-- лежало только в сыром payload.
--
-- До этой миграции реестр показывал 22 поля шапки из 99 заполненных и
-- 14 колонок товарной части из 30. Остальное было в
-- integration_1c_payload.payload — а она закрыта политикой is_admin(),
-- то есть рядовому менеджеру недоступна вовсе.
--
-- Именование колонок следует РАЗДЕЛАМ И НОМЕРАМ ПОЛЕЙ печатного бланка
-- СНТ, а не внутренним именам обработки 1С. Клиент сверяет экран с
-- печатной формой, и подписи должны совпадать с тем, что он там видит.
-- Соответствие «поле бланка → поле выгрузки» указано в комментарии к
-- каждой колонке.
--
-- Перевыгрузка из 1С не требуется: данные уже в landing, их разбирает
-- повторный прогон загрузчика с ключом --refresh.

-- ── Раздел A. Общий раздел ─────────────────────────────────────────
ALTER TABLE fiscal_document
  ADD COLUMN IF NOT EXISTS import_kind        TEXT,
  ADD COLUMN IF NOT EXISTS export_kind        TEXT,
  ADD COLUMN IF NOT EXISTS movement_kind      TEXT,
  ADD COLUMN IF NOT EXISTS has_ethyl_alcohol  BOOLEAN,
  ADD COLUMN IF NOT EXISTS has_wine_material  BOOLEAN,
  ADD COLUMN IF NOT EXISTS has_beer           BOOLEAN,
  ADD COLUMN IF NOT EXISTS has_alcohol        BOOLEAN,
  ADD COLUMN IF NOT EXISTS has_oil_products   BOOLEAN,
  ADD COLUMN IF NOT EXISTS has_biofuel        BOOLEAN,
  ADD COLUMN IF NOT EXISTS has_tobacco        BOOLEAN,
  ADD COLUMN IF NOT EXISTS has_marked_goods   BOOLEAN,
  ADD COLUMN IF NOT EXISTS has_export_control BOOLEAN;

COMMENT ON COLUMN fiscal_document.import_kind IS 'Поле 7 бланка «Ввоз товаров на территорию РК» (ВидВвоза). Пример: «7.1 Ввоз за исключением 7.2-7.5».';
COMMENT ON COLUMN fiscal_document.export_kind IS 'Поле 8 бланка «Вывоз товаров с территории РК» (ВидВывоза).';
COMMENT ON COLUMN fiscal_document.movement_kind IS 'Поле 9 бланка «Перемещение товаров» (ВидПеремещения).';
COMMENT ON COLUMN fiscal_document.has_oil_products IS 'Поле 10.5 бланка «Нефтепродукты» (ЕстьНефтепродукты). Соседние has_* — остальные подпункты 10.x и поля 11–12.';

-- ── Раздел B. Реквизиты поставщика ─────────────────────────────────
-- Поставщик и получатель хранятся ЯВНО, как в бланке. Существующие
-- own_party_* / counterparty_* — это абстракция обработки 1С («наша
-- сторона» и «контрагент»), она зависит от направления и в самом
-- документе не встречается. Обе пары нужны: первая для показа бланка,
-- вторая для группировки реестра по контрагенту.
ALTER TABLE fiscal_document
  ADD COLUMN IF NOT EXISTS supplier_identifier        TEXT,
  ADD COLUMN IF NOT EXISTS supplier_name              TEXT,
  ADD COLUMN IF NOT EXISTS supplier_is_nonresident    BOOLEAN,
  ADD COLUMN IF NOT EXISTS supplier_branch_bin        TEXT,
  ADD COLUMN IF NOT EXISTS supplier_country_code      TEXT,
  ADD COLUMN IF NOT EXISTS supplier_ship_country_code TEXT,
  ADD COLUMN IF NOT EXISTS supplier_address           TEXT,
  ADD COLUMN IF NOT EXISTS supplier_warehouse_id      TEXT,
  ADD COLUMN IF NOT EXISTS supplier_warehouse_name    TEXT;

COMMENT ON COLUMN fiscal_document.supplier_identifier IS 'Поле 13 бланка «ИИН/БИН» поставщика (ПоставщикИдентификатор).';
COMMENT ON COLUMN fiscal_document.supplier_name IS 'Поле 14 бланка «Наименование поставщика/отправителя» (ПоставщикНаименование).';
COMMENT ON COLUMN fiscal_document.supplier_is_nonresident IS 'Поле 13.1 бланка «Нерезидент» (ПоставщикНерезидент).';
COMMENT ON COLUMN fiscal_document.supplier_branch_bin IS 'Поле 15 бланка «БИН структурного подразделения» (ПоставщикБИНСтруктурногоПодразделения).';
COMMENT ON COLUMN fiscal_document.supplier_country_code IS 'Поле 18 бланка «Код страны регистрации поставщика» (ПоставщикКодСтраны).';
COMMENT ON COLUMN fiscal_document.supplier_ship_country_code IS 'Поле 19 бланка «Код страны отправки/отгрузки» (ПоставщикКодСтраныОтправки).';
COMMENT ON COLUMN fiscal_document.supplier_address IS 'Поле 20 бланка «Фактический адрес отправки/отгрузки» (АдресОтправки).';
COMMENT ON COLUMN fiscal_document.supplier_warehouse_id IS 'Поле 21 бланка «Идентификационный номер (ID) склада» отправки (СкладОтправкиИдентификатор).';
COMMENT ON COLUMN fiscal_document.supplier_warehouse_name IS 'Название склада отправки в 1С (СкладОтправитель). В бланке не печатается.';

-- ── Раздел C. Реквизиты получателя ─────────────────────────────────
ALTER TABLE fiscal_document
  ADD COLUMN IF NOT EXISTS recipient_identifier           TEXT,
  ADD COLUMN IF NOT EXISTS recipient_name                 TEXT,
  ADD COLUMN IF NOT EXISTS recipient_is_nonresident       BOOLEAN,
  ADD COLUMN IF NOT EXISTS recipient_branch_bin           TEXT,
  ADD COLUMN IF NOT EXISTS recipient_country_code         TEXT,
  ADD COLUMN IF NOT EXISTS recipient_delivery_country_code TEXT,
  ADD COLUMN IF NOT EXISTS recipient_address              TEXT,
  ADD COLUMN IF NOT EXISTS recipient_warehouse_id         TEXT,
  ADD COLUMN IF NOT EXISTS recipient_warehouse_name       TEXT,
  ADD COLUMN IF NOT EXISTS recipient_is_retailer          BOOLEAN;

COMMENT ON COLUMN fiscal_document.recipient_identifier IS 'Поле 22 бланка «ИИН/БИН» получателя (ПолучательИдентификатор).';
COMMENT ON COLUMN fiscal_document.recipient_name IS 'Поле 23 бланка «Наименование получателя» (ПолучательНаименование).';
COMMENT ON COLUMN fiscal_document.recipient_is_nonresident IS 'Поле 22.1 бланка «Нерезидент» (ПолучательНерезидент).';
COMMENT ON COLUMN fiscal_document.recipient_country_code IS 'Поле 27 бланка «Код страны регистрации получателя» (ПолучательКодСтраны).';
COMMENT ON COLUMN fiscal_document.recipient_delivery_country_code IS 'Поле 28 бланка «Код страны доставки/поставки» (ПолучательКодСтраныДоставки).';
COMMENT ON COLUMN fiscal_document.recipient_address IS 'Поле 29 бланка «Фактический адрес доставки/поставки» (АдресДоставки).';
COMMENT ON COLUMN fiscal_document.recipient_warehouse_id IS 'Поле 30 бланка «Идентификационный номер (ID) склада» доставки (СкладДоставкиИдентификатор).';

-- ── Раздел D. Грузоотправитель и грузополучатель ───────────────────
-- Это ОТДЕЛЬНЫЕ стороны от поставщика и получателя: в экспортных
-- цепочках именно они показывают фактический маршрут груза.
ALTER TABLE fiscal_document
  ADD COLUMN IF NOT EXISTS shipper_identifier       TEXT,
  ADD COLUMN IF NOT EXISTS shipper_name             TEXT,
  ADD COLUMN IF NOT EXISTS shipper_country_code     TEXT,
  ADD COLUMN IF NOT EXISTS shipper_is_nonresident   BOOLEAN,
  ADD COLUMN IF NOT EXISTS shipper_note             TEXT,
  ADD COLUMN IF NOT EXISTS consignee_identifier     TEXT,
  ADD COLUMN IF NOT EXISTS consignee_name           TEXT,
  ADD COLUMN IF NOT EXISTS consignee_country_code   TEXT,
  ADD COLUMN IF NOT EXISTS consignee_is_nonresident BOOLEAN,
  ADD COLUMN IF NOT EXISTS consignee_note           TEXT;

COMMENT ON COLUMN fiscal_document.shipper_identifier IS 'Поле 31 бланка «ИИН/БИН» грузоотправителя (ГрузоотправительИдентификатор).';
COMMENT ON COLUMN fiscal_document.shipper_name IS 'Поле 32 бланка «Наименование грузоотправителя» (ГрузоотправительНаименование).';
COMMENT ON COLUMN fiscal_document.shipper_country_code IS 'Поле 33 бланка «Код страны отправки» (ГрузоотправительКодСтраныОтправки).';
COMMENT ON COLUMN fiscal_document.consignee_identifier IS 'Поле 34 бланка «ИИН/БИН» грузополучателя (ГрузополучательИдентификатор).';
COMMENT ON COLUMN fiscal_document.consignee_name IS 'Поле 35 бланка «Наименование грузополучателя» (ГрузополучательНаименование).';
COMMENT ON COLUMN fiscal_document.consignee_country_code IS 'Поле 36 бланка «Код страны доставки» (ГрузополучательКодСтраныОтправки).';
COMMENT ON COLUMN fiscal_document.shipper_note IS 'Раздел D1a бланка «Дополнительные сведения» грузоотправителя (ГрузоотправительДополнительныеСведения).';
COMMENT ON COLUMN fiscal_document.consignee_note IS 'Раздел D1b бланка «Дополнительные сведения» грузополучателя (ГрузополучательДополнительныеСведения).';

-- ── Раздел E. Сведения по перевозке ────────────────────────────────
ALTER TABLE fiscal_document
  ADD COLUMN IF NOT EXISTS carrier_name        TEXT,
  ADD COLUMN IF NOT EXISTS carrier_identifier  TEXT,
  ADD COLUMN IF NOT EXISTS transport_road      BOOLEAN,
  ADD COLUMN IF NOT EXISTS transport_rail      BOOLEAN,
  ADD COLUMN IF NOT EXISTS transport_air       BOOLEAN,
  ADD COLUMN IF NOT EXISTS transport_sea       BOOLEAN,
  ADD COLUMN IF NOT EXISTS transport_pipeline  BOOLEAN,
  ADD COLUMN IF NOT EXISTS transport_other     BOOLEAN,
  ADD COLUMN IF NOT EXISTS vehicle_number      TEXT,
  ADD COLUMN IF NOT EXISTS trailer_number      TEXT,
  ADD COLUMN IF NOT EXISTS wagon_number        TEXT,
  ADD COLUMN IF NOT EXISTS seal_number         TEXT;

COMMENT ON COLUMN fiscal_document.carrier_name IS 'Поле 37 бланка «Наименование перевозчика» (ПеревозчикНаименование).';
COMMENT ON COLUMN fiscal_document.carrier_identifier IS 'Поле 38 бланка «ИИН/БИН» перевозчика (ПеревозчикИдентификатор).';
COMMENT ON COLUMN fiscal_document.transport_rail IS 'Поле 39.b бланка «железнодорожный» (ЖелезнодорожныйТранспорт). Соседние transport_* — подпункты a, c, d, e, f.';
COMMENT ON COLUMN fiscal_document.wagon_number IS 'Поле 39.b.1 бланка «номер вагона» (НомерВагона). МОЖЕТ СОДЕРЖАТЬ НЕСКОЛЬКО НОМЕРОВ через запятую: одна СНТ покрывает целый состав.';
COMMENT ON COLUMN fiscal_document.vehicle_number IS 'Поле 39.a.1 бланка «государственный номер АТС» (НомерТС).';
COMMENT ON COLUMN fiscal_document.trailer_number IS 'Поле 39.a.2 бланка «государственный номер прицепа» (ГосномерПрицепа).';

-- ── Раздел F. Договор (контракт) на поставку товара ────────────────
-- ВНИМАНИЕ: поле 41 бланка озаглавлено «40.a Договор (контракт) ИЛИ
-- ПРИЛОЖЕНИЕ К ДОГОВОРУ» — что туда вписано, решает выписывающая
-- организация. В базе Арқа Проф это номер договора («78-14-2121-1»,
-- «АРК 8»), в других базах может быть номер приложения. Считать это
-- поле гарантированно договором нельзя.
ALTER TABLE fiscal_document
  ADD COLUMN IF NOT EXISTS contract_number         TEXT,
  ADD COLUMN IF NOT EXISTS contract_date           DATE,
  ADD COLUMN IF NOT EXISTS contract_text           TEXT,
  ADD COLUMN IF NOT EXISTS contract_registry_number TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms           TEXT,
  ADD COLUMN IF NOT EXISTS delivery_terms          TEXT,
  ADD COLUMN IF NOT EXISTS without_contract        BOOLEAN;

COMMENT ON COLUMN fiscal_document.contract_number IS 'Поле 41 бланка «Номер» в разделе F, озаглавленном «40.a Договор (контракт) ИЛИ ПРИЛОЖЕНИЕ К ДОГОВОРУ» (ДоговорПоставкиНомер). Что именно вписано — договор или приложение — решает выписывающая организация.';
COMMENT ON COLUMN fiscal_document.contract_date IS 'Поле 42 бланка «Дата договора (контракта)» (ДоговорПоставкиДата).';
COMMENT ON COLUMN fiscal_document.contract_registry_number IS 'Поле 42.1 бланка «Учетный номер» (УникальныйНомерВалютногоКонтроля). Номер валютного контроля, у экспортных поставок.';
COMMENT ON COLUMN fiscal_document.contract_text IS 'Полный текст договора из 1С: «Договор поставки № 78-14-2121-1 от 28.12.2023г.» (ДоговорПоставки). В бланке не печатается.';
COMMENT ON COLUMN fiscal_document.payment_terms IS 'Поле 43 бланка «Условия оплаты по договору» (ДоговорПоставкиУсловияОплаты).';
COMMENT ON COLUMN fiscal_document.delivery_terms IS 'Поле 44 бланка «Условия поставки (ИНКОТЕРМС)» (ДоговорПоставкиУсловияПоставки).';
COMMENT ON COLUMN fiscal_document.without_contract IS 'Поле 40.b бланка «Без договора (контракта)» (БезДоговора).';

-- ── Разделы L, M, N. Отпуск, приёмка, отметки ОГД ──────────────────
ALTER TABLE fiscal_document
  ADD COLUMN IF NOT EXISTS issued_by_name       TEXT,
  ADD COLUMN IF NOT EXISTS signature_type       TEXT,
  ADD COLUMN IF NOT EXISTS author               TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at          TIMESTAMP,
  ADD COLUMN IF NOT EXISTS accepted_by_identifier TEXT,
  ADD COLUMN IF NOT EXISTS accepted_by_name     TEXT,
  ADD COLUMN IF NOT EXISTS revoked_at           TIMESTAMP,
  ADD COLUMN IF NOT EXISTS proxy_release_number TEXT,
  ADD COLUMN IF NOT EXISTS proxy_release_date   DATE,
  ADD COLUMN IF NOT EXISTS proxy_receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS proxy_receipt_date   DATE,
  ADD COLUMN IF NOT EXISTS driver_name          TEXT,
  ADD COLUMN IF NOT EXISTS driver_iin           TEXT,
  ADD COLUMN IF NOT EXISTS ogd_code_dispatch    TEXT,
  ADD COLUMN IF NOT EXISTS ogd_code_delivery    TEXT;

COMMENT ON COLUMN fiscal_document.issued_by_name IS 'Поле 82 бланка «Ф.И.О. лица, оформившего СНТ» (ФИОВыписывающегоСНТ).';
COMMENT ON COLUMN fiscal_document.accepted_at IS 'Поле 85 бланка «Дата приема/отклонения товара» (ДатаПриема).';
COMMENT ON COLUMN fiscal_document.accepted_by_name IS 'Поле 86 бланка «Ф.И.О. лица, принявшего товар» (ФИОПодтвердившегоСНТ).';
COMMENT ON COLUMN fiscal_document.proxy_release_number IS 'Поле 83.1 бланка «Номер доверенности» на отпуск (НомерДоверенностиОтпуск).';
COMMENT ON COLUMN fiscal_document.proxy_receipt_number IS 'Поле 86.2 бланка «Номер доверенности» на приёмку (НомерДоверенностиПриемка).';
COMMENT ON COLUMN fiscal_document.driver_name IS 'Поле 90.3 бланка «Ф.И.О. водителя/представителя компании» (ФИОВодителя).';
COMMENT ON COLUMN fiscal_document.driver_iin IS 'Поле 90.4 бланка «ИИН водителя/представителя компании» (ИИНВодителя).';
COMMENT ON COLUMN fiscal_document.ogd_code_dispatch IS 'Раздел N бланка, код ОГД отправки (КодОГДОтправкиG6).';
COMMENT ON COLUMN fiscal_document.ogd_code_delivery IS 'Раздел N бланка, код ОГД доставки (КодОГДДоставкиG6).';

-- ── Служебные поля 1С (в бланке не печатаются) ─────────────────────
ALTER TABLE fiscal_document
  ADD COLUMN IF NOT EXISTS source_doc_basis   TEXT,
  ADD COLUMN IF NOT EXISTS source_doc_number  TEXT,
  ADD COLUMN IF NOT EXISTS source_ref         TEXT,
  ADD COLUMN IF NOT EXISTS source_identifier  TEXT,
  ADD COLUMN IF NOT EXISTS source_organization TEXT,
  ADD COLUMN IF NOT EXISTS status_note        TEXT,
  ADD COLUMN IF NOT EXISTS matching_status    TEXT,
  ADD COLUMN IF NOT EXISTS extra_tables       JSONB;

COMMENT ON COLUMN fiscal_document.source_doc_basis IS 'Документ-основание в 1С: «Поступление ТМЗ и услуг 000000…», «Реализация ТМЗ и услуг …» (ДокументОснование). В бланке не печатается.';
COMMENT ON COLUMN fiscal_document.status_note IS 'Пояснение к состоянию из 1С (Причина): «Доступ на выписку СНТ запрещён…», «SNT_FIXED_CREATED», текст ошибки ИС ЭСФ.';
COMMENT ON COLUMN fiscal_document.extra_tables IS 'Табличные части документа, кроме товарной: ТоварыВС (118 СНТ первой выгрузки) и ДанныеОГрузе1_2 — путевой лист, ТТН, ФИО водителя, маршрут, время выезда и прибытия (19 СНТ). Ключ объекта = имя табличной части в 1С.';

-- ── Товарная часть: раздел G1 бланка ───────────────────────────────
ALTER TABLE fiscal_document_line
  ADD COLUMN IF NOT EXISTS origin_sign          TEXT,
  ADD COLUMN IF NOT EXISTS tnved_code           TEXT,
  ADD COLUMN IF NOT EXISTS unit_code            TEXT,
  ADD COLUMN IF NOT EXISTS product_identifier   TEXT,
  ADD COLUMN IF NOT EXISTS vat_rate             TEXT,
  ADD COLUMN IF NOT EXISTS vat_rate_percent     NUMERIC,
  ADD COLUMN IF NOT EXISTS without_vat          BOOLEAN,
  ADD COLUMN IF NOT EXISTS excise_rate          TEXT,
  ADD COLUMN IF NOT EXISTS excise_rate_amount   NUMERIC,
  ADD COLUMN IF NOT EXISTS excise_amount        NUMERIC,
  ADD COLUMN IF NOT EXISTS product_1c_name      TEXT,
  ADD COLUMN IF NOT EXISTS origin_source        TEXT,
  ADD COLUMN IF NOT EXISTS declaration_number   TEXT,
  ADD COLUMN IF NOT EXISTS declaration_position TEXT,
  ADD COLUMN IF NOT EXISTS product_name_eaeu    TEXT,
  ADD COLUMN IF NOT EXISTS extra_info           TEXT;

COMMENT ON COLUMN fiscal_document_line.origin_sign IS 'Колонка 2 раздела G1 «Признак происхождения товара» (ПризнакПроисхождения).';
COMMENT ON COLUMN fiscal_document_line.tnved_code IS 'Колонка 4 раздела G1 «Код товара (ТН ВЭД ЕАЭС)» (КодТНВЭД).';
COMMENT ON COLUMN fiscal_document_line.excise_rate IS 'Колонка 10 раздела G1 «Ставка акциза» (СтавкаАкциза).';
COMMENT ON COLUMN fiscal_document_line.excise_amount IS 'Колонка 11 раздела G1 «Сумма акциза» (СуммаАкциза).';
COMMENT ON COLUMN fiscal_document_line.vat_rate IS 'Колонка 12 раздела G1 «НДС. Ставка» (СтавкаНДС). Текстом, как в документе: «12%».';
COMMENT ON COLUMN fiscal_document_line.product_identifier IS 'Колонка 15 раздела G1 «Идентификатор товара в ИС ЭСФ» (ИдентификаторТовара). Пример: «19.20.25.01-2710192100<386556880>{18500034245}» — в фигурных скобках повторяется код товара из колонки 18.';
COMMENT ON COLUMN fiscal_document_line.declaration_number IS 'Колонка 16 раздела G1 «№ ЗВТ ДТ №СТ-1 или СТ-KZ, первичной СНТ» (НомерЗаявленияВРамкахТС).';
COMMENT ON COLUMN fiscal_document_line.declaration_position IS 'Колонка 17 раздела G1 «№ товарной позиции из ЗВТ ДТ №СТ-1 или СТ-KZ, первичной СНТ» (НомерПозицииВДекларацииИлиЗаявлении).';
COMMENT ON COLUMN fiscal_document_line.extra_info IS 'Колонка 19 раздела G1 «Дополнительная информация» (ДополнительнаяИнформация).';
COMMENT ON COLUMN fiscal_document_line.product_1c_name IS 'Внутреннее наименование номенклатуры в 1С (Товар): «Керосин ТС-1 (18500034245 )». В бланке не печатается — там колонка 3 «Наименование товара».';
COMMENT ON COLUMN fiscal_document_line.origin_source IS 'Источник происхождения строки в ИС ЭСФ (ИсточникПроисхождения): «СНТ/Керосин ТС-1 (18500034245 )/2710192100/480 930 131». Хвост числа — партия виртуального склада, она же source_lot_id.';

-- pin_code существовал с 00138 под именем из выгрузки; уточняем, какое
-- поле бланка он представляет.
COMMENT ON COLUMN fiscal_document_line.pin_code IS 'Колонка 18 раздела G1 бланка «Код товара» (ПинКод). Это НЕ ТН ВЭД — тот в колонке 4, см. tnved_code. В выгрузке Арқа Проф 23 различных значения длиной 11 или 12 знаков; то же значение повторяется в фигурных скобках внутри product_identifier.';

-- ── Индексы под то, по чему будут искать ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_fiscal_document_contract
  ON fiscal_document (source_org_code, contract_number)
  WHERE contract_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_document_carrier
  ON fiscal_document (carrier_identifier)
  WHERE carrier_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_document_shipper
  ON fiscal_document (shipper_identifier)
  WHERE shipper_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_document_consignee
  ON fiscal_document (consignee_identifier)
  WHERE consignee_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_document_line_tnved
  ON fiscal_document_line (tnved_code)
  WHERE tnved_code IS NOT NULL;

-- Номер вагона: обычный btree. Он покрывает поиск по документам с одним
-- вагоном (а таких большинство) и сортировку. Индекса под поиск
-- подстрокой здесь СОЗНАТЕЛЬНО нет: он потребовал бы расширения
-- pg_trgm, которое ни одна миграция репозитория не включает, — и такая
-- зависимость уронила бы применение миграций на голом Postgres, где
-- гоняется db-джоба CI. Когда поиск по части номера понадобится,
-- расширение включаем отдельной миграцией, осознанно.
CREATE INDEX IF NOT EXISTS idx_fiscal_document_wagon
  ON fiscal_document (wagon_number)
  WHERE wagon_number IS NOT NULL;

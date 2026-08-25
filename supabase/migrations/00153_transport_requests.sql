-- 00153_transport_requests.sql
--
-- Заявки на перевозку — новый раздел. ТЗ клиента «Автоматическое
-- формирование заявки» + образец «Заявка 520 тн Темир-Карабалта от ОРТ»
-- (внутри 455 тн / 7 вц) + макет формы, обсуждение 25.08.2026.
--
-- ЧТО ЭТО. Исходящая заявка: наша компания просит у железной дороги
-- вагоны под перевозку. Не путать с существующим разделом «Заявки»
-- (таблица applications, 00004) — там ВХОДЯЩАЯ заявка от покупателя с
-- PDF, письмом-источником и распределением объёма по сделкам. Разные
-- документы, разное направление, поэтому отдельные таблицы.
--
-- Связи со сделкой нет намеренно (клиент 25.08: «не нужно добавлять
-- связь»). Заявка живёт раньше вагонов и сама по себе.
--
-- ПРЕФИКС transport_ обязателен: схема public делится со вторым
-- продуктом на этом же проекте Supabase.
--
-- ХРАНИЛИЩЕ ФАЙЛОВ. Бакеты и политики storage.objects в этом проекте
-- заводятся руками в дашборде (см. историю deal-attachments в 00065),
-- миграциями не управляются — иначе джоба CI, где схемы storage нет,
-- падала бы на ровном месте. Эта миграция создаёт только строки-ссылки;
-- бакеты `transport-templates` и `transport-request-files` нужно
-- создать закрытыми (public = false) до первой загрузки.

-- ═══════════════════════════════════════════════════════════════
-- 1. Справочник перевозчиков ЖД
-- ═══════════════════════════════════════════════════════════════
-- В образце «АО «КТЖ - Грузовые перевозки»». Клиент 25.08: значение
-- может меняться, поэтому список, а не константа в коде.

CREATE TABLE IF NOT EXISTS transport_carriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE transport_carriers ENABLE ROW LEVEL SECURITY;

-- Тот же шаблон, что у forwarders/consignees: читают все
-- аутентифицированные, пишут writable-роли (admin/manager/logistics/
-- finance — is_writable_role в 00010 / 00082), удаляет только админ.
CREATE POLICY "auth_select_transport_carriers" ON transport_carriers
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_transport_carriers" ON transport_carriers
  FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_transport_carriers" ON transport_carriers
  FOR UPDATE USING (is_writable_role());
CREATE POLICY "admin_delete_transport_carriers" ON transport_carriers
  FOR DELETE USING (is_admin());

CREATE TRIGGER trg_transport_carriers_updated BEFORE UPDATE ON transport_carriers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 2. Маршруты — упорядоченная цепочка станций
-- ═══════════════════════════════════════════════════════════════
-- В образце: «Темир (660308) - Турксиб-эксп. (704402) – Турксиб-эксп.
-- (715106) – Карабалта (715905)». Коды НЕ дублируются в маршруте: они
-- уже лежат в stations.code, и печатная строка собирается из станций.
-- Одна станция может встречаться в маршруте дважды под разными кодами
-- (Турксиб-эксп.), поэтому уникальность — по позиции, а не по станции.

CREATE TABLE IF NOT EXISTS transport_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transport_route_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  station_id UUID NOT NULL REFERENCES stations(id),
  position INT NOT NULL,
  UNIQUE (route_id, position)
);

CREATE INDEX IF NOT EXISTS idx_transport_route_stations_route
  ON transport_route_stations(route_id, position);

ALTER TABLE transport_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_route_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_transport_routes" ON transport_routes
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_transport_routes" ON transport_routes
  FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_transport_routes" ON transport_routes
  FOR UPDATE USING (is_writable_role());
CREATE POLICY "admin_delete_transport_routes" ON transport_routes
  FOR DELETE USING (is_admin());

-- Строки маршрута правятся вместе с маршрутом, поэтому удалять их
-- может та же роль, что и редактировать: иначе изменить порядок
-- станций смог бы только админ.
CREATE POLICY "auth_select_transport_route_stations" ON transport_route_stations
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_transport_route_stations" ON transport_route_stations
  FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_transport_route_stations" ON transport_route_stations
  FOR UPDATE USING (is_writable_role());
CREATE POLICY "writable_delete_transport_route_stations" ON transport_route_stations
  FOR DELETE USING (is_writable_role());

CREATE TRIGGER trg_transport_routes_updated BEFORE UPDATE ON transport_routes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 3. Шаблоны компаний
-- ═══════════════════════════════════════════════════════════════
-- Клиент 25.08: админ загружает готовую заявку компании — с её шапкой,
-- подписью и печатью. Названия строк таблицы задаём мы (эталонный
-- файл), поэтому разбирать чужую разметку и сопоставлять строки не
-- нужно: подстановка идёт по нашим же названиям.
--
-- История замен сохраняется: заявка, отправленная в марте, и через год
-- должна открываться на том бланке, на котором её отправляли. Активный
-- шаблон у компании ровно один — это стережёт частичный уникальный
-- индекс.

CREATE TABLE IF NOT EXISTS transport_company_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_group_id UUID NOT NULL REFERENCES company_groups(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  original_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  uploaded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_template_one_active
  ON transport_company_templates(company_group_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_transport_templates_company
  ON transport_company_templates(company_group_id, created_at DESC);

ALTER TABLE transport_company_templates ENABLE ROW LEVEL SECURITY;

-- Шаблон содержит подпись и печать, поэтому загрузка и замена — только
-- админ (клиент 25.08). Читать нужно всем, кто формирует заявки.
CREATE POLICY "auth_select_transport_templates" ON transport_company_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin_insert_transport_templates" ON transport_company_templates
  FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "admin_update_transport_templates" ON transport_company_templates
  FOR UPDATE USING (is_admin());
CREATE POLICY "admin_delete_transport_templates" ON transport_company_templates
  FOR DELETE USING (is_admin());

-- ═══════════════════════════════════════════════════════════════
-- 4. Сама заявка
-- ═══════════════════════════════════════════════════════════════
-- Хранится ВЫБОР из справочников, а не переписанные из них строки:
-- клиент 25.08 — «все что можно лучше тянуть со справочника». Тексты
-- собираются при формировании документа, поэтому правка названия
-- станции или грузополучателя не оставляет старых копий в заявках.
--
-- Исключение — etsng_code и gng_code: коды продукта приходят из
-- справочника ГСМ, но в заявке иногда отличаются от справочного
-- значения, поэтому лежат полями со значением по умолчанию из ГСМ.

CREATE TABLE IF NOT EXISTS transport_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Внутренний номер, в документ не печатается: в образце номера нет,
  -- только дата. Нужен, чтобы заявки различались в списке и в поиске.
  request_year INT NOT NULL,
  request_number INT NOT NULL,

  -- Дата составления заявления (клиент 25.08), по умолчанию сегодня.
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued')),

  -- Наша компания и бланк, на котором заявка сформирована.
  company_group_id UUID NOT NULL REFERENCES company_groups(id),
  template_id UUID REFERENCES transport_company_templates(id),

  -- Строки 1-2 документа. Вагоны подсказываются как тонны ÷ 60 и
  -- правятся вручную (клиент 25.08), поэтому хранятся отдельным полем,
  -- а не выводятся формулой.
  fuel_type_id UUID REFERENCES fuel_types(id),
  tonnage DECIMAL(14,4),
  wagons INT,

  -- Строка 3.
  cargo_purpose TEXT CHECK (cargo_purpose IN ('export', 'import', 'domestic')),

  -- Строки 4-6. Код станции в заявке не хранится — берётся из
  -- stations.code, чтобы не разъезжался со справочником.
  destination_station_id UUID REFERENCES stations(id),
  siding TEXT,

  -- Строка 7.
  carrier_id UUID REFERENCES transport_carriers(id),

  -- Строки 8-11. Код, ОКПО и адрес получателя переехали в справочник
  -- (см. раздел 6 ниже), здесь только ссылка.
  consignee_id UUID REFERENCES consignees(id),

  -- Строка 12: коды продукта, по умолчанию из справочника ГСМ.
  etsng_code TEXT,
  gng_code TEXT,

  -- Строка 13.
  special_marks TEXT,

  -- Строка 14: грузоотправитель — завод (клиент 25.08).
  consignor_factory_id UUID REFERENCES factories(id),

  -- Строка 15: принадлежность вагонов — экспедитор (клиент 25.08).
  wagon_owner_forwarder_id UUID REFERENCES forwarders(id),

  -- Строка 16: две оплаты в одной ячейке документа. КЗХ — экспедитор,
  -- КРГ — грузополучатель (в образце это получатель груза, а не
  -- экспедитор, поэтому ссылка на consignees).
  forwarder_kzh_id UUID REFERENCES forwarders(id),
  payer_krg_consignee_id UUID REFERENCES consignees(id),

  -- Строка 17.
  route_id UUID REFERENCES transport_routes(id),

  -- Строка 18: в образце покупателем стоит сама компания-заявитель,
  -- поэтому по умолчанию подставляется она, но поле остаётся выбором.
  buyer_id UUID REFERENCES counterparties(id),

  -- Строка 19.
  period_month INT CHECK (period_month BETWEEN 1 AND 12),
  period_year INT,

  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (request_year, request_number)
);

CREATE INDEX IF NOT EXISTS idx_transport_requests_company
  ON transport_requests(company_group_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transport_requests_date
  ON transport_requests(date DESC);

ALTER TABLE transport_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_transport_requests" ON transport_requests
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_transport_requests" ON transport_requests
  FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_transport_requests" ON transport_requests
  FOR UPDATE USING (is_writable_role());
CREATE POLICY "admin_delete_transport_requests" ON transport_requests
  FOR DELETE USING (is_admin());

CREATE TRIGGER trg_transport_requests_updated BEFORE UPDATE ON transport_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Нумерация: счётчик по годам, как у сделок (deal_sequences) ──
CREATE TABLE IF NOT EXISTS transport_request_sequences (
  year INT PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
);

ALTER TABLE transport_request_sequences ENABLE ROW LEVEL SECURITY;

-- Счётчиком управляет только триггер (SECURITY DEFINER), напрямую
-- пишет в него никто: иначе номера начнут расходиться.
CREATE POLICY "auth_select_transport_request_sequences" ON transport_request_sequences
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION assign_transport_request_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT;
BEGIN
  IF NEW.request_number IS NOT NULL AND NEW.request_year IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_year := EXTRACT(YEAR FROM COALESCE(NEW.date, CURRENT_DATE))::INT;

  -- ON CONFLICT DO UPDATE берёт блокировку строки счётчика, поэтому
  -- две одновременные заявки не получат один номер.
  INSERT INTO transport_request_sequences (year, last_number)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_number = transport_request_sequences.last_number + 1
  RETURNING last_number INTO NEW.request_number;

  NEW.request_year := v_year;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transport_requests_number
  BEFORE INSERT ON transport_requests
  FOR EACH ROW EXECUTE FUNCTION assign_transport_request_number();

-- ═══════════════════════════════════════════════════════════════
-- 5. Сформированные файлы
-- ═══════════════════════════════════════════════════════════════
-- Клиент 25.08: «хранить и так же чтобы они могли открыть/скопировать
-- уже готовый сформированный файл». Храним каждую выгрузку — по ней
-- видно, какой именно документ ушёл контрагенту, а копирование заявки
-- делается из её полей, а не из файла.

CREATE TABLE IF NOT EXISTS transport_request_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES transport_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('word', 'pdf')),
  file_path TEXT NOT NULL,
  original_name TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transport_request_files_request
  ON transport_request_files(request_id, created_at DESC);

ALTER TABLE transport_request_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_transport_request_files" ON transport_request_files
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_transport_request_files" ON transport_request_files
  FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "admin_delete_transport_request_files" ON transport_request_files
  FOR DELETE USING (is_admin());

-- ═══════════════════════════════════════════════════════════════
-- 6. Реквизиты переезжают в справочники
-- ═══════════════════════════════════════════════════════════════
-- Клиент 25.08: «все что можно лучше тянуть со справочника». Пока код,
-- ОКПО и адрес получателя лежат в самой заявке (так сделано в
-- applications 00004), обещание «выбрал из списка и не набирал»
-- невыполнимо: три поля пришлось бы вбивать заново каждый раз.

ALTER TABLE consignees ADD COLUMN IF NOT EXISTS code_4 TEXT;
ALTER TABLE consignees ADD COLUMN IF NOT EXISTS okpo TEXT;
ALTER TABLE consignees ADD COLUMN IF NOT EXISTS address TEXT;

COMMENT ON COLUMN consignees.code_4 IS 'Код грузополучателя в заявке на перевозку (в образце 5669)';
COMMENT ON COLUMN consignees.okpo   IS 'Код ОКПО получателя (в образце 26737181)';
COMMENT ON COLUMN consignees.address IS 'Адрес грузополучателя для заявки';

-- Полное наименование для печати: в справочнике продукт зовётся
-- коротко («Мазут М-100»), а в заявке печатается «Мазут топочный марки
-- М-100». Коды ЕТСНГ и ГНГ — свойство продукта, а не заявки.
ALTER TABLE fuel_types ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE fuel_types ADD COLUMN IF NOT EXISTS etsng_code TEXT;
ALTER TABLE fuel_types ADD COLUMN IF NOT EXISTS gng_code TEXT;

COMMENT ON COLUMN fuel_types.full_name  IS 'Полное наименование для печати в заявке (Мазут топочный марки М-100)';
COMMENT ON COLUMN fuel_types.etsng_code IS 'Код ЕТСНГ (в образце 221066)';
COMMENT ON COLUMN fuel_types.gng_code   IS 'Код ГНГ (в образце 27101967)';

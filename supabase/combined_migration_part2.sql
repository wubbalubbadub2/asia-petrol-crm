-- Asia Petrol CRM: Row-Level Security Policies

-- Enable RLS on all tables
ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE forwarders ENABLE ROW LEVEL SECURITY;
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_product_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_monthly_averages ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_company_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE dt_kt_logistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE surcharges ENABLE ROW LEVEL SECURITY;
ALTER TABLE snt_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE esf_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_years ENABLE ROW LEVEL SECURITY;

-- Helper: check if current user has a writable role
CREATE OR REPLACE FUNCTION is_writable_role()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager', 'logistics')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- All authenticated users can SELECT all reference/operational data
-- (бухгалтерия and readonly users need read access)

-- Reference tables: everyone reads, writable roles modify
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'counterparties', 'company_groups', 'factories', 'forwarders',
    'stations', 'fuel_types', 'regions', 'profiles',
    'quotation_product_types', 'quotations', 'quotation_monthly_averages',
    'deal_sequences', 'archive_years'
  ] LOOP
    EXECUTE format('CREATE POLICY "auth_select_%s" ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', tbl, tbl);
    EXECUTE format('CREATE POLICY "writable_insert_%s" ON %I FOR INSERT WITH CHECK (is_writable_role())', tbl, tbl);
    EXECUTE format('CREATE POLICY "writable_update_%s" ON %I FOR UPDATE USING (is_writable_role())', tbl, tbl);
    EXECUTE format('CREATE POLICY "admin_delete_%s" ON %I FOR DELETE USING (is_admin())', tbl, tbl);
  END LOOP;
END $$;

-- Deals: same pattern but with archive protection
CREATE POLICY "auth_select_deals" ON deals FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_deals" ON deals FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_deals" ON deals FOR UPDATE USING (
  is_writable_role()
  AND (
    NOT is_archived
    OR is_admin()
  )
);
CREATE POLICY "admin_delete_deals" ON deals FOR DELETE USING (is_admin());

-- Deal company groups, application_deals: follow deal access
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'deal_company_groups', 'application_deals', 'deal_attachments'
  ] LOOP
    EXECUTE format('CREATE POLICY "auth_select_%s" ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', tbl, tbl);
    EXECUTE format('CREATE POLICY "writable_insert_%s" ON %I FOR INSERT WITH CHECK (is_writable_role())', tbl, tbl);
    EXECUTE format('CREATE POLICY "writable_update_%s" ON %I FOR UPDATE USING (is_writable_role())', tbl, tbl);
    EXECUTE format('CREATE POLICY "admin_delete_%s" ON %I FOR DELETE USING (is_admin())', tbl, tbl);
  END LOOP;
END $$;

-- Operational tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'applications', 'shipment_registry', 'dt_kt_logistics',
    'tariffs', 'surcharges', 'snt_documents', 'esf_documents'
  ] LOOP
    EXECUTE format('CREATE POLICY "auth_select_%s" ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', tbl, tbl);
    EXECUTE format('CREATE POLICY "writable_insert_%s" ON %I FOR INSERT WITH CHECK (is_writable_role())', tbl, tbl);
    EXECUTE format('CREATE POLICY "writable_update_%s" ON %I FOR UPDATE USING (is_writable_role())', tbl, tbl);
    EXECUTE format('CREATE POLICY "admin_delete_%s" ON %I FOR DELETE USING (is_admin())', tbl, tbl);
  END LOOP;
END $$;
-- Asia Petrol CRM: Database Functions

-- Auto-generate deal number
CREATE OR REPLACE FUNCTION generate_deal_number(p_type deal_type, p_year INT)
RETURNS INT AS $$
DECLARE
  v_number INT;
BEGIN
  INSERT INTO deal_sequences (deal_type, year, last_number)
  VALUES (p_type, p_year, 1)
  ON CONFLICT (deal_type, year)
  DO UPDATE SET last_number = deal_sequences.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

-- Refresh monthly quotation averages
CREATE OR REPLACE FUNCTION refresh_quotation_averages(p_product_type_id UUID, p_year INT, p_month INT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO quotation_monthly_averages (product_type_id, year, month, avg_price, avg_fob_med, avg_fob_rotterdam, avg_cif_nwe, avg_combined)
  SELECT
    product_type_id, p_year, p_month,
    AVG(price),
    AVG(price_fob_med),
    AVG(price_fob_rotterdam),
    AVG(price_cif_nwe),
    AVG(COALESCE(price_cif_nwe, price) + COALESCE(price_fob_rotterdam, price)) / 2
  FROM quotations
  WHERE product_type_id = p_product_type_id
    AND EXTRACT(YEAR FROM date) = p_year
    AND EXTRACT(MONTH FROM date) = p_month
    AND price IS NOT NULL
  GROUP BY product_type_id
  ON CONFLICT (product_type_id, year, month)
  DO UPDATE SET
    avg_price = EXCLUDED.avg_price,
    avg_fob_med = EXCLUDED.avg_fob_med,
    avg_fob_rotterdam = EXCLUDED.avg_fob_rotterdam,
    avg_cif_nwe = EXCLUDED.avg_cif_nwe,
    avg_combined = EXCLUDED.avg_combined,
    updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- Aggregate shipment data into deal passport
CREATE OR REPLACE FUNCTION refresh_deal_shipment_totals(p_deal_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE deals SET
    buyer_shipped_volume = sub.total_volume,
    buyer_shipped_amount = sub.total_amount,
    supplier_shipped_amount = sub.total_amount
  FROM (
    SELECT
      deal_id,
      COALESCE(SUM(shipment_volume), 0) as total_volume,
      COALESCE(SUM(shipped_tonnage_amount), 0) as total_amount
    FROM shipment_registry
    WHERE deal_id = p_deal_id
    GROUP BY deal_id
  ) sub
  WHERE deals.id = sub.deal_id;
END;
$$ LANGUAGE plpgsql;

-- Auto-refresh deal totals when shipment_registry changes
CREATE OR REPLACE FUNCTION trg_refresh_deal_on_shipment()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.deal_id IS NOT NULL THEN
      PERFORM refresh_deal_shipment_totals(OLD.deal_id);
    END IF;
    RETURN OLD;
  ELSE
    IF NEW.deal_id IS NOT NULL THEN
      PERFORM refresh_deal_shipment_totals(NEW.deal_id);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.deal_id IS DISTINCT FROM NEW.deal_id AND OLD.deal_id IS NOT NULL THEN
      PERFORM refresh_deal_shipment_totals(OLD.deal_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shipment_refresh_deal
  AFTER INSERT OR UPDATE OR DELETE ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION trg_refresh_deal_on_shipment();

-- Compute DT-KT balance
CREATE OR REPLACE FUNCTION compute_dt_kt_balance(
  p_forwarder_id UUID,
  p_company_group_id UUID,
  p_year INT
) RETURNS DECIMAL AS $$
DECLARE
  v_record dt_kt_logistics%ROWTYPE;
  v_shipped_amount DECIMAL;
BEGIN
  SELECT * INTO v_record FROM dt_kt_logistics
  WHERE forwarder_id = p_forwarder_id
    AND company_group_id = p_company_group_id
    AND year = p_year;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(shipped_tonnage_amount), 0)
  INTO v_shipped_amount
  FROM shipment_registry sr
  JOIN deals d ON sr.deal_id = d.id
  JOIN deal_company_groups dcg ON dcg.deal_id = d.id
  WHERE sr.forwarder_id = p_forwarder_id
    AND dcg.company_group_id = p_company_group_id
    AND EXTRACT(YEAR FROM sr.date) = p_year;

  RETURN v_record.opening_balance
    + v_shipped_amount
    - v_record.payment
    - v_record.refund
    + v_record.fines
    + v_record.surcharge_preliminary
    + v_record.ogem;
END;
$$ LANGUAGE plpgsql;

-- Lookup planned tariff by criteria
CREATE OR REPLACE FUNCTION lookup_tariff(
  p_dest_station_id UUID,
  p_dep_station_id UUID,
  p_forwarder_id UUID,
  p_fuel_type_id UUID,
  p_month TEXT,
  p_year INT
) RETURNS DECIMAL AS $$
DECLARE
  v_tariff DECIMAL;
BEGIN
  SELECT planned_tariff INTO v_tariff
  FROM tariffs
  WHERE destination_station_id = p_dest_station_id
    AND departure_station_id = p_dep_station_id
    AND forwarder_id = p_forwarder_id
    AND fuel_type_id = p_fuel_type_id
    AND month = p_month
    AND year = p_year
  LIMIT 1;

  RETURN v_tariff;
END;
$$ LANGUAGE plpgsql;
-- Asia Petrol CRM: Seed Reference Data (from Карточка.xlsx СПР sheet)

-- Regions
INSERT INTO regions (name) VALUES ('Север'), ('Юг');

-- Factories
INSERT INTO factories (name) VALUES
  ('ПКОП'), ('АНПЗ'), ('ПНХЗ'), ('Базис Ойл'), ('Стандарт ресурсиз'),
  ('КМНПЗ'), ('Мини НПЗ (Казыкурт)'), ('ШХК'), ('АГПЗ'), ('Танеко'), ('РФ');

-- Forwarders
INSERT INTO forwarders (name) VALUES
  ('PTC - Operator'), ('Прологистик'), ('UE-LOGISTIC'), ('TK Logistic group'),
  ('Нет экспедитора');

-- Fuel types with default colors
INSERT INTO fuel_types (name, sulfur_percent, color, sort_order) VALUES
  ('ВГО', NULL, '#8B5CF6', 1),
  ('ВГО 2%', '2%', '#7C3AED', 2),
  ('Авиакеросин', NULL, '#06B6D4', 3),
  ('АИ-92', NULL, '#22C55E', 4),
  ('АИ-92 К4', NULL, '#16A34A', 5),
  ('АИ-92 К5', NULL, '#15803D', 6),
  ('Аи-95', NULL, '#3B82F6', 7),
  ('АИ-98', NULL, '#2563EB', 8),
  ('Бензол', NULL, '#F59E0B', 9),
  ('Газ', NULL, '#EF4444', 10),
  ('Газовый конденсат', NULL, '#F97316', 11),
  ('ДТ', NULL, '#A855F7', 12),
  ('Кокс', NULL, '#6B7280', 13),
  ('Легкий дистиллят', NULL, '#EC4899', 14),
  ('Мазут', NULL, '#78716C', 15),
  ('Метанол', NULL, '#14B8A6', 16),
  ('МТБЭ', NULL, '#F43F5E', 17),
  ('Нафта', NULL, '#84CC16', 18),
  ('Нефрас', NULL, '#D946EF', 19),
  ('Нефть', NULL, '#1D4ED8', 20),
  ('Печное топливо', NULL, '#B45309', 21),
  ('Судовое топливо', NULL, '#0369A1', 22),
  ('Тяжелый дистиллят', NULL, '#BE185D', 23);

-- Suppliers
INSERT INTO counterparties (type, full_name, short_name) VALUES
  ('supplier', 'ТОО "Sunkar Oil Product"', 'Sunkar Oil Product'),
  ('supplier', 'ТОО "Phystech II"', 'Phystech II'),
  ('supplier', 'ТОО "Блиц Продукт"', 'Блиц Продукт'),
  ('supplier', 'ТОО "Петро Казахстан Ойл Продактс"', 'Петро Казахстан Ойл Продактс'),
  ('supplier', 'Euro Energy FZ', 'Euro Energy FZ'),
  ('supplier', 'ТОО "Джунда"', 'Джунда'),
  ('supplier', 'ТОО "Кумколь ойл"', 'Кумколь ойл'),
  ('supplier', 'ТОО "Sky Oil Company"', 'Sky Oil Company');

-- Buyers
INSERT INTO counterparties (type, full_name, short_name) VALUES
  ('buyer', 'ТОО "Джунда"', 'Джунда'),
  ('buyer', 'PRIME STANDARD PETROLEUM LTD', 'PRIME STANDARD PETROLEUM'),
  ('buyer', 'КПК нефть и газ', 'КПК нефть и газ'),
  ('buyer', 'Alcagesta DMCC', 'Alcagesta DMCC'),
  ('buyer', 'ИП Нуров', 'ИП Нуров'),
  ('buyer', 'ТОО "Жан Ойл Продакс"', 'Жан Ойл Продакс'),
  ('buyer', 'ИП Кенжеханов', 'ИП Кенжеханов'),
  ('buyer', 'ТОО "Каз Петрол Трейд"', 'Каз Петрол Трейд'),
  ('buyer', 'Аэропорт Алматы', 'Аэропорт Алматы'),
  ('buyer', 'Sinooil', 'Sinooil');

-- Company groups
INSERT INTO company_groups (name) VALUES
  ('Singularity Trading Gmbh'),
  ('Fuel Sapply Company'),
  ('Progressive oil trading'),
  ('Арка проф'),
  ('Арлан-22'),
  ('Geowax'),
  ('Брент трейдинг'),
  ('Бетта');

-- Stations (commonly used)
INSERT INTO stations (name, type) VALUES
  ('Карабалта', 'both'),
  ('Мерке', 'both'),
  ('Галаба эксп', 'destination'),
  ('ст. Текесу', 'departure'),
  ('ст. Тендык', 'departure'),
  ('ст. Павлодар - Порт', 'departure'),
  ('ст. Арысь 1', 'departure'),
  ('Ахунбабаева', 'destination'),
  ('Парто-Цкали', 'destination'),
  ('Пойма', 'both'),
  ('Нурхает', 'destination'),
  ('Узень', 'departure'),
  ('Каинды', 'destination'),
  ('Бишкек-1', 'destination'),
  ('Жинишке', 'destination'),
  ('Круглое поле', 'departure'),
  ('Аллагуват', 'departure'),
  ('Белкол', 'departure'),
  ('Аса', 'departure'),
  ('Бадам', 'departure');

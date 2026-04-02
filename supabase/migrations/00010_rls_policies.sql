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

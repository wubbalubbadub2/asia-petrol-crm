# AS-BUILT-DATA.md — Authoritative Data Dictionary

## Overview

This document is the authoritative schema specification for the Asia Petrol CRM system as built in Supabase/Postgres (migrations 00001–00093). It documents every table in the `public` schema with complete column definitions, constraints, indexes, and migration lineage. The system manages petroleum product deals (purchase/sale paired transactions), quotations, shipment registry, payments, and operational logistics.

## Live Row Counts (Production DB, 2026-06-22)

These were retrieved against the production Supabase project (`oteysqqohcgnwpsxmyjg`) with the service-role key. They are the migration baseline.

| Table | Row count |
|---|---:|
| deals | 842 |
| deal_supplier_lines | 843 |
| deal_buyer_lines | 853 |
| deal_company_groups | 833 |
| deal_payments | 1,317 |
| deal_shipment_prices | 8,639 |
| deal_activity | 1,870 |
| deal_attachments | 11 |
| shipment_registry | 8,650 |
| applications | 0 |
| application_deals | 0 |
| counterparties | 136 |
| company_groups | 19 |
| factories | 18 |
| forwarders | 3 |
| consignees | 0 |
| stations | 51 |
| fuel_types | 23 |
| regions | 2 |
| profiles | 35 |
| quotation_product_types | 16 |
| quotations | 1,888 |
| quotation_monthly_averages | 0 |
| tariffs | 181 |
| surcharges | 0 |
| snt_documents | 0 |
| esf_documents | 0 |
| dt_kt_logistics | 17 |
| dt_kt_payments | 60 |
| audit_log | 47,137 |
| archive_years | 0 |
| deal_sequences | 3 |

**Migration scale notes:**
- ~10 000 deals + deal children combined.
- Pricing table `deal_shipment_prices` and `shipment_registry` are the largest non-audit tables (~8.6k rows each, 1:1 by construction).
- Audit log dominates at 47k rows — historical operations across all money-relevant tables.
- `applications`, `application_deals`, `surcharges`, `snt_documents`, `esf_documents`, `consignees`, `archive_years` are EMPTY in production. The features exist in code but were never used. (See Data Hazards section.)
- `quotation_monthly_averages` is empty — confirms the cache is dead code (no consumer ever populated it).
- Only 3 forwarders in use despite the `forwarder_id` FK on dozens of tables.


---

## ENUM Types

### `deal_type`
Values: `'KG'`, `'KZ'`, `'OIL'`  
Defined in: 00001_reference_tables.sql

### `price_condition`
Values: `'average_month'`, `'fixed'`, `'trigger'`, `'manual_formula'`, `'manual_in_formula'`  
Defined in: 00001, extended in 00071, 00078  
**Note:** The enum also includes `'avg_to_date'` (00073) which is superseded by the `calc_mode` column pattern (00079). See "Data Hazards" section.

### `user_role`
Values: `'admin'`, `'manager'`, `'logistics'`, `'accounting'`, `'readonly'`, `'finance'`, `'trader'`  
Defined in: 00001, extended in 00082

### `trigger_basis`
Values: `'shipment_date'`, `'border_crossing_date'`  
Defined in: 00023_deal_shipment_prices.sql

---

## Reference Data Tables (Справочник)

### `counterparties`
**Purpose:** Registry of suppliers and buyers (контрагенты) with financial identities.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00001 |
| type | TEXT | NOT NULL | — | CHECK (type IN ('supplier', 'buyer')) | 00001 |
| full_name | TEXT | NOT NULL | — | — | 00001 |
| short_name | TEXT | NULL | — | — | 00001 |
| bin_iin | TEXT | NULL | — | — | 00001 |
| legal_address | TEXT | NULL | — | — | 00001 |
| is_active | BOOLEAN | NULL | true | — | 00001 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00001 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00001 |

**Indexes:** idx_counterparties_type, idx_counterparties_bin  
**Primary Key:** id  
**RLS:** Authenticated SELECT, writable-role INSERT/UPDATE, admin DELETE

---

### `company_groups`
**Purpose:** Multi-tier reseller chain (средний звено) — up to 6 per deal, each with own currency and pricing.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00001 |
| name | TEXT | NOT NULL | — | UNIQUE | 00001 |
| bin_iin | TEXT | NULL | — | — | 00001 |
| is_active | BOOLEAN | NULL | true | — | 00001 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00001 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00001 |

**Indexes:** — (implicitly indexed via UNIQUE on name)  
**Primary Key:** id  
**RLS:** Standard authenticated pattern

---

### `factories`
**Purpose:** Supplier production facilities (заводы).

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00001 |
| name | TEXT | NOT NULL | — | UNIQUE | 00001 |
| code | TEXT | NULL | — | — | 00001 |
| is_active | BOOLEAN | NULL | true | — | 00001 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00001 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00001 |

**RLS:** Standard authenticated pattern

---

### `forwarders`
**Purpose:** Railway & logistics operators (экспедиторы).

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00001 |
| name | TEXT | NOT NULL | — | UNIQUE | 00001 |
| bin_iin | TEXT | NULL | — | — | 00001 |
| is_active | BOOLEAN | NULL | true | — | 00001 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00001 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00001 |

**RLS:** Standard authenticated pattern

---

### `stations`
**Purpose:** Railway stations (ст. назначения, ст. отправления).

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00001 |
| name | TEXT | NOT NULL | — | — | 00001 |
| code | TEXT | NULL | — | — | 00001 |
| type | TEXT | NOT NULL | — | CHECK (type IN ('departure', 'destination', 'both')) | 00001 |
| is_active | BOOLEAN | NULL | true | — | 00001 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00001 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00001 |

**Indexes:** idx_stations_type  
**RLS:** Standard authenticated pattern

---

### `fuel_types`
**Purpose:** Product categories (вид ГСМ) with color coding for UI.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00001 |
| name | TEXT | NOT NULL | — | — | 00001 |
| sulfur_percent | TEXT | NULL | — | — | 00001 |
| color | TEXT | NULL | '#6B7280' | — | 00001 |
| is_active | BOOLEAN | NULL | true | — | 00001 |
| sort_order | INT | NULL | 0 | — | 00001 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00001 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00001 |

**RLS:** Standard authenticated pattern

---

### `regions`
**Purpose:** Sales regions for user assignment (регионы).

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00001 |
| name | TEXT | NOT NULL | — | UNIQUE | 00001 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00001 |

**RLS:** Standard authenticated pattern

---

### `profiles`
**Purpose:** User account records (extends auth.users).

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | — | PK, FK → auth.users(id) ON DELETE CASCADE | 00001 |
| full_name | TEXT | NOT NULL | — | — | 00001 |
| role | user_role | NOT NULL | 'readonly' | — | 00001, extended 00082 |
| region_id | UUID | NULL | — | FK → regions(id) | 00001 |
| is_active | BOOLEAN | NULL | true | — | 00001 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00001 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00001 |

**RLS:** Standard authenticated pattern. Modified in 00081 to SET NULL on user deletion instead of CASCADE.

---

### `consignees`
**Purpose:** Railway consignees (грузополучатели) — distinct from counterparties, used for waybill labeling.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00090 |
| name | TEXT | NOT NULL | — | UNIQUE | 00090 |
| bin_iin | TEXT | NULL | — | — | 00090 |
| is_active | BOOLEAN | NULL | true | — | 00090 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00090 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00090 |

**RLS:** Standard authenticated pattern

---

## Quotations (Котировки)

### `quotation_product_types`
**Purpose:** Granular product classifications under a fuel type (e.g., "Светлые НП Euro-5 Атау", "Heavy Fuel Oil CIF NWE").

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00002 |
| fuel_type_id | UUID | NULL | — | FK → fuel_types(id) | 00002 |
| name | TEXT | NOT NULL | — | — | 00002 |
| sub_name | TEXT | NULL | — | — | 00002 |
| basis | TEXT | NULL | — | — | 00002 |
| is_active | BOOLEAN | NULL | true | — | 00002 |
| sort_order | INT | NULL | 0 | — | 00002 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00002 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00002 |

**RLS:** Standard authenticated pattern

---

### `quotations`
**Purpose:** Daily market prices per product type (legacy wide-column format).

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00002 |
| product_type_id | UUID | NOT NULL | — | FK → quotation_product_types(id) | 00002 |
| date | DATE | NOT NULL | — | — | 00002 |
| price | DECIMAL(12,4) | NULL | — | — | 00002 |
| price_fob_med | DECIMAL(12,4) | NULL | — | — | 00002 |
| price_fob_rotterdam | DECIMAL(12,4) | NULL | — | — | 00002 |
| price_cif_nwe | DECIMAL(12,4) | NULL | — | — | 00002 |
| comment | TEXT | NULL | — | — | 00002 |
| created_by | UUID | NULL | — | FK → profiles(id) | 00002 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00002 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00002 |

**Indexes:** idx_quotations_date, idx_quotations_product  
**Unique:** (product_type_id, date)  
**RLS:** Standard authenticated pattern  
**Note:** This wide-column layout is superseded by the `quotation_values` table (00074) for phase 2+ sub-quotation pricing.

---

### `product_subtypes`
**Purpose:** Sub-quotations within a product type (e.g., "CIF NWE" variant of a base product). Introduced in phase 1 of sub-quotation feature (00073).

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00073 |
| product_type_id | UUID | NOT NULL | — | FK → quotation_product_types(id) ON DELETE CASCADE | 00073 |
| name | TEXT | NOT NULL | — | — | 00073 |
| display_order | INT | NOT NULL | 0 | — | 00073 |
| created_at | TIMESTAMPTZ | NOT NULL | now() | — | 00073 |

**Indexes:** idx_product_subtypes_parent  
**Unique:** (product_type_id, name)

---

### `quotation_values`
**Purpose:** Daily per-subtype prices in long format (phase 2 of sub-quotation feature, 00074). Replaces wide-column fallback for new pricing workflows.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00074 |
| sub_quotation_id | UUID | NOT NULL | — | FK → product_subtypes(id) ON DELETE CASCADE | 00074 |
| date | DATE | NOT NULL | — | — | 00074 |
| value | NUMERIC(14,4) | NOT NULL | — | — | 00074 |
| comment | TEXT | NULL | — | — | 00074 |
| created_at | TIMESTAMPTZ | NOT NULL | now() | — | 00074 |
| updated_at | TIMESTAMPTZ | NOT NULL | now() | — | 00074 |

**Indexes:** idx_quotation_values_lookup  
**Unique:** (sub_quotation_id, date)

---

### `quotation_monthly_averages`
**Purpose:** Pre-computed monthly averages for performance (optional cache, not always used).

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00002 |
| product_type_id | UUID | NOT NULL | — | FK → quotation_product_types(id) | 00002 |
| year | INT | NOT NULL | — | — | 00002 |
| month | INT | NOT NULL | — | — | 00002 |
| avg_price | DECIMAL(12,4) | NULL | — | — | 00002 |
| avg_fob_med | DECIMAL(12,4) | NULL | — | — | 00002 |
| avg_fob_rotterdam | DECIMAL(12,4) | NULL | — | — | 00002 |
| avg_cif_nwe | DECIMAL(12,4) | NULL | — | — | 00002 |
| avg_combined | DECIMAL(12,4) | NULL | — | — | 00002 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00002 |

**Unique:** (product_type_id, year, month)

---

## Core Deals (Паспорт сделок)

### `deal_sequences`
**Purpose:** Counters for auto-incrementing deal_number per deal_type per year.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00003 |
| deal_type | deal_type | NOT NULL | — | — | 00003 |
| year | INT | NOT NULL | — | — | 00003 |
| last_number | INT | NOT NULL | 0 | — | 00003 |

**Unique:** (deal_type, year)

---

### `deals`
**Purpose:** Master transaction record pairing a supplier and buyer for a petroleum volume over a period.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00003 |
| deal_type | deal_type | NOT NULL | — | — | 00003 |
| deal_number | INT | NOT NULL | — | — | 00003 |
| year | INT | NOT NULL | — | — | 00003 |
| deal_code | TEXT | NULL | — | — | 00003, computed by trigger |
| quarter | TEXT | NULL | — | — | 00003 |
| month | TEXT | NOT NULL | — | — | 00003 |
| factory_id | UUID | NULL | — | FK → factories(id) | 00003 |
| fuel_type_id | UUID | NULL | — | FK → fuel_types(id) | 00003 |
| sulfur_percent | TEXT | NULL | — | — | 00003 |
| **SUPPLIER SIDE** | | | | | |
| supplier_id | UUID | NULL | — | FK → counterparties(id) | 00003 |
| supplier_contract | TEXT | NULL | — | — | 00003 |
| supplier_contracted_volume | DECIMAL(14,4) | NULL | — | — | 00003 |
| supplier_contracted_amount | DECIMAL(14,4) | NULL | — | — | 00003, computed by trigger |
| supplier_delivery_basis | TEXT | NULL | — | — | 00003 |
| supplier_quotation_comment | TEXT | NULL | — | — | 00003 |
| supplier_quotation | DECIMAL(14,4) | NULL | — | — | 00003, mirrored from default line (00053) |
| supplier_discount | DECIMAL(14,4) | NULL | — | — | 00003, mirrored from default line (00053) |
| supplier_price | DECIMAL(14,4) | NULL | — | — | 00003, mirrored from default line (00053) |
| supplier_price_condition | price_condition | NULL | — | — | 00003, mirrored from default line (00053) |
| supplier_shipped_amount | DECIMAL(14,4) | NULL | 0 | — | 00003, computed by trigger (00044) |
| supplier_payment | DECIMAL(14,4) | NULL | 0 | — | 00003, rollup of deal_payments (00019, 00051) |
| supplier_payment_date | TEXT | NULL | — | — | 00003 |
| supplier_balance | DECIMAL(14,4) | NULL | 0 | — | 00003, computed by trigger (00021, 00052, 00063) |
| supplier_shipped_volume | DECIMAL(14,4) | NULL | 0 | — | 00044 (loading_volume rollup) |
| supplier_departure_station_id | UUID | NULL | — | FK → stations(id) | 00038 |
| **BUYER SIDE** | | | | | |
| buyer_id | UUID | NULL | — | FK → counterparties(id) | 00003 |
| buyer_contract | TEXT | NULL | — | — | 00003 |
| buyer_delivery_basis | TEXT | NULL | — | — | 00003 |
| buyer_destination_station_id | UUID | NULL | — | FK → stations(id) | 00003 |
| buyer_contracted_volume | DECIMAL(14,4) | NULL | — | — | 00003 |
| buyer_contracted_amount | DECIMAL(14,4) | NULL | — | — | 00003, computed by trigger |
| buyer_quotation_comment | TEXT | NULL | — | — | 00003 |
| buyer_quotation | DECIMAL(14,4) | NULL | — | — | 00003, mirrored from default line (00053) |
| buyer_discount | DECIMAL(14,4) | NULL | — | — | 00003, mirrored from default line (00053) |
| buyer_price | DECIMAL(14,4) | NULL | — | — | 00003, mirrored from default line (00053) |
| buyer_price_condition | price_condition | NULL | — | — | 00003, mirrored from default line (00053) |
| buyer_ordered_volume | DECIMAL(14,4) | NULL | — | — | 00003 |
| buyer_remaining | DECIMAL(14,4) | NULL | — | — | 00003, computed by trigger |
| buyer_shipped_volume | DECIMAL(14,4) | NULL | 0 | — | 00003, rollup of shipment_volume |
| buyer_ship_date | TEXT | NULL | — | — | 00003 |
| buyer_shipped_amount | DECIMAL(14,4) | NULL | 0 | — | 00003, rollup of shipment amounts |
| buyer_payment | DECIMAL(14,4) | NULL | 0 | — | 00003, rollup of deal_payments (00019, 00051) |
| buyer_payment_date | TEXT | NULL | — | — | 00003 |
| buyer_debt | DECIMAL(14,4) | NULL | 0 | — | 00003, computed by trigger (flipped in 00060) |
| buyer_multi_deal_payments | TEXT | NULL | — | — | 00003 |
| buyer_snt_written | TEXT | NULL | — | — | 00003 |
| **LOGISTICS** | | | | | |
| forwarder_id | UUID | NULL | — | FK → forwarders(id) | 00003 |
| logistics_company_group_id | UUID | NULL | — | FK → company_groups(id) | 00003 |
| planned_tariff | DECIMAL(10,4) | NULL | — | — | 00003 |
| preliminary_tonnage | DECIMAL(14,4) | NULL | — | — | 00003 |
| preliminary_amount | DECIMAL(14,4) | NULL | — | — | 00003, computed by trigger |
| actual_tariff | DECIMAL(10,4) | NULL | — | — | 00003 |
| actual_shipped_volume | DECIMAL(14,4) | NULL | — | — | 00003, rollup = buyer_shipped_volume |
| invoice_volume | DECIMAL(14,4) | NULL | — | — | 00003 |
| invoice_amount | DECIMAL(14,4) | NULL | — | — | 00003, sum of shipped_tonnage_amount |
| logistics_notes | TEXT | NULL | — | — | 00003 |
| logistics_shipment_month | TEXT | NULL | — | — | 00069 (tariff lookup month override) |
| railway_in_price | BOOLEAN | NULL | false | — | 00018 (flag that supplier price includes ЖД) |
| **SURCHARGES** | | | | | |
| surcharge_amount | DECIMAL(14,4) | NULL | — | — | 00003 |
| surcharge_reinvoiced_to | TEXT | NULL | — | — | 00003 |
| **MANAGERS** | | | | | |
| supplier_manager_id | UUID | NULL | — | FK → profiles(id) | 00003 |
| buyer_manager_id | UUID | NULL | — | FK → profiles(id) | 00003 |
| trader_id | UUID | NULL | — | FK → profiles(id) | 00003 |
| **PER-SECTION CURRENCIES** | | | | | |
| currency | TEXT | NULL | 'USD' | — | 00014 (legacy, mirrors supplier_currency) |
| supplier_currency | TEXT | NOT NULL | 'USD' | — | 00043 |
| buyer_currency | TEXT | NOT NULL | 'USD' | — | 00043 |
| logistics_currency | TEXT | NOT NULL | 'USD' | — | 00043 |
| **FORMULA PRICING** | | | | | |
| trigger_basis | trigger_basis | NULL | 'shipment_date' | — | 00023 (deal-level default for trigger variants) |
| avg_month_date | DATE | NULL | — | — | 00085 (anchor date for avg_month variants) |
| **DRAFT / ARCHIVE** | | | | | |
| is_draft | BOOLEAN | NULL | false | — | 00020 |
| is_archived | BOOLEAN | NULL | false | — | 00003 |
| archived_at | TIMESTAMPTZ | NULL | — | — | 00003 |
| **TIMESTAMPS** | | | | | |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00003 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00003 |
| created_by | UUID | NULL | — | FK → profiles(id) | 00003 |

**Indexes:**  
- idx_deals_type, idx_deals_year, idx_deals_month, idx_deals_supplier, idx_deals_buyer, idx_deals_archived (00003)
- idx_deals_departure_station (00038)

**Unique:** (deal_type, deal_number, year)  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin UPDATE archived, admin DELETE  
**Triggers:**
- trg_deals_code: BEFORE INSERT/UPDATE computes deal_code from type/number/year (00003)
- trg_deals_updated: BEFORE UPDATE sets updated_at (00003)
- compute_deal_derived_fields: BEFORE INSERT/UPDATE recomputes contracted_amount, balance, remaining (00021, 00052, 00060, 00063)
- log_deal_payment_change: AFTER UPDATE logs payment changes to deal_activity (00016, 00087)
- log_deal_field_changes: AFTER UPDATE logs all field changes to deal_activity (00088)
- seed_default_supplier_line / seed_default_buyer_line: AFTER INSERT creates default pricing lines (00053)

---

### `deal_company_groups`
**Purpose:** Links a deal to up to 6 company groups in the reseller chain, each with optional price and kind (preliminary/final).

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00003 |
| deal_id | UUID | NOT NULL | — | FK → deals(id) ON DELETE CASCADE | 00003 |
| company_group_id | UUID | NOT NULL | — | FK → company_groups(id) | 00003 |
| position | INT | NOT NULL | — | CHECK (position BETWEEN 1 AND 6) | 00003 |
| price | DECIMAL(14,4) | NULL | — | — | 00003 |
| contract_ref | TEXT | NULL | — | — | 00003 |
| price_kind | TEXT | NOT NULL | 'preliminary' | CHECK (price_kind IN ('preliminary', 'final')) | 00084 |
| currency | TEXT | NULL | — | — | 00070 (per-group currency, NULL = inherit from supplier) |

**Indexes:** idx_deal_company_groups_deal  
**Unique:** (deal_id, position)  
**RLS:** Standard authenticated pattern

---

### `deal_supplier_lines`
**Purpose:** Supplier-side pricing variants (appendix each with its own quotation / discount / delivery basis). One default line per deal.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00053 |
| deal_id | UUID | NOT NULL | — | FK → deals(id) ON DELETE CASCADE | 00053 |
| position | INT | NOT NULL | 1 | — | 00053 |
| is_default | BOOLEAN | NOT NULL | FALSE | — | 00053 |
| price_condition | price_condition | NULL | — | — | 00053 |
| quotation_type_id | UUID | NULL | — | FK → quotation_product_types(id) | 00053 |
| quotation | NUMERIC(14,4) | NULL | — | — | 00053 |
| quotation_comment | TEXT | NULL | — | — | 00053 |
| discount | NUMERIC(14,4) | NULL | — | — | 00053 |
| price | NUMERIC(14,4) | NULL | — | — | 00053 |
| delivery_basis | TEXT | NULL | — | — | 00053 |
| departure_station_id | UUID | NULL | — | FK → stations(id) | 00053 |
| **FORMULA PRICING** | | | | | |
| trigger_basis | trigger_basis | NULL | — | — | 00064 |
| trigger_days | INT | NULL | — | — | 00064 |
| fx_rate | NUMERIC(14,6) | NULL | — | — | 00071 |
| preliminary_fx_rate | NUMERIC(14,6) | NULL | — | — | 00071 |
| calc_mode | TEXT | NOT NULL | 'on_date' | CHECK (calc_mode IN ('on_date','avg_month')) | 00079 |
| price_stage | TEXT | NOT NULL | 'preliminary' | CHECK (price_stage IN ('preliminary','final')) | 00068 |
| preliminary_quotation | NUMERIC(14,4) | NULL | — | — | 00068 |
| preliminary_price | NUMERIC(14,4) | NULL | — | — | 00068 |
| preliminary_fx_rate | NUMERIC(14,6) | NULL | — | — | 00071 |
| preliminary_set_at | TIMESTAMPTZ | NULL | — | — | 00068 |
| selected_month | INT | NULL | — | — | 00068 |
| appendix | TEXT | NULL | — | — | 00072 |
| price_source | TEXT | NULL | — | — | 00077 |
| sub_quotation_id | UUID | NULL | — | FK → product_subtypes(id) | 00073 |
| **TIMESTAMPS** | | | | | |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00053 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00053 |

**Indexes:**  
- idx_deal_supplier_lines_deal (00053)
- uq_deal_supplier_lines_default (UNIQUE WHERE is_default = TRUE) (00053)

**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE  
**Triggers:**
- trg_deal_supplier_lines_updated: BEFORE UPDATE sets updated_at (00053)
- trg_sync_deal_from_default_supplier_line: AFTER INSERT/UPDATE syncs default line to deals scalar columns (00053)
- snapshot_preliminary_on_finalize: BEFORE UPDATE snapshots quotation/price/fx_rate when price_stage flips to 'final' (00068, 00071)

---

### `deal_buyer_lines`
**Purpose:** Buyer-side pricing variants (appendix) — parallel structure to deal_supplier_lines.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00053 |
| deal_id | UUID | NOT NULL | — | FK → deals(id) ON DELETE CASCADE | 00053 |
| position | INT | NOT NULL | 1 | — | 00053 |
| is_default | BOOLEAN | NOT NULL | FALSE | — | 00053 |
| price_condition | price_condition | NULL | — | — | 00053 |
| quotation_type_id | UUID | NULL | — | FK → quotation_product_types(id) | 00053 |
| quotation | NUMERIC(14,4) | NULL | — | — | 00053 |
| quotation_comment | TEXT | NULL | — | — | 00053 |
| discount | NUMERIC(14,4) | NULL | — | — | 00053 |
| price | NUMERIC(14,4) | NULL | — | — | 00053 |
| delivery_basis | TEXT | NULL | — | — | 00053 |
| destination_station_id | UUID | NULL | — | FK → stations(id) | 00053 |
| trigger_basis, trigger_days, fx_rate, preliminary_fx_rate, calc_mode, price_stage, preliminary_quotation, preliminary_price, preliminary_set_at, selected_month, appendix, price_source, sub_quotation_id | (same as supplier_lines) | | | | |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00053 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00053 |

**Indexes:** idx_deal_buyer_lines_deal, uq_deal_buyer_lines_default (UNIQUE WHERE is_default = TRUE)  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE  
**Triggers:** Same pattern as deal_supplier_lines, but sync to buyer_ prefixed columns

---

### `deal_shipment_prices`
**Purpose:** Per-shipment calculated pricing (used when price_condition is 'trigger' or 'average_month'). Legacy; new paths prefer direct formula computation.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00023 |
| deal_id | UUID | NOT NULL | — | FK → deals(id) ON DELETE CASCADE | 00023 |
| shipment_registry_id | UUID | NULL | — | FK → shipment_registry(id) ON DELETE CASCADE | 00054 |
| side | TEXT | NOT NULL | — | CHECK (side IN ('supplier', 'buyer')) | 00023 |
| shipment_date | DATE | NULL | — | — | 00023 |
| border_crossing_date | DATE | NULL | — | — | 00023 |
| trigger_start_date | DATE | NULL | — | — | 00023 |
| trigger_days | INT | NOT NULL | 35 | — | 00023 |
| trigger_basis | trigger_basis | NOT NULL | 'shipment_date' | — | 00023 |
| quotation_product_type_id | UUID | NULL | — | FK → quotation_product_types(id) | 00023 |
| quotation_avg | DECIMAL(14,4) | NULL | — | — | 00023 |
| discount | DECIMAL(14,4) | NULL | 0 | — | 00023 |
| calculated_price | DECIMAL(14,4) | NULL | — | — | 00023 |
| volume | DECIMAL(14,6) | NULL | — | — | 00023 |
| amount | DECIMAL(14,4) | NULL | — | — | 00023 |
| notes | TEXT | NULL | — | — | 00023 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00023 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00023 |
| created_by | UUID | NULL | — | FK → profiles(id) | 00023 |

**Indexes:** idx_deal_shipment_prices_deal, idx_deal_shipment_prices_side  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE  
**Triggers:** trg_deal_shipment_prices_updated: BEFORE UPDATE sets updated_at

---

## Applications & Deal Allocation

### `applications`
**Purpose:** Buyer purchase requisitions (заявки) imported from PDFs or manual entry. Maps 1..N to deals via application_deals.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00004 |
| application_number | TEXT | NULL | — | — | 00004 |
| date | DATE | NOT NULL | — | — | 00004 |
| fuel_type_id | UUID | NULL | — | FK → fuel_types(id) | 00004 |
| product_name | TEXT | NULL | — | — | 00004 |
| tonnage | DECIMAL(14,4) | NULL | — | — | 00004 |
| destination_station_id | UUID | NULL | — | FK → stations(id) | 00004 |
| station_code | TEXT | NULL | — | — | 00004 |
| siding | TEXT | NULL | — | — | 00004 |
| **CONSIGNEE** | | | | | |
| consignee_name | TEXT | NULL | — | — | 00004 |
| consignee_bin | TEXT | NULL | — | — | 00004 |
| consignee_code_4 | TEXT | NULL | — | — | 00004 |
| consignee_code_12 | TEXT | NULL | — | — | 00004 |
| consignee_legal_address | TEXT | NULL | — | — | 00004 |
| consignee_postal_address | TEXT | NULL | — | — | 00004 |
| consignor | TEXT | NULL | — | — | 00004 |
| carrier | TEXT | NULL | — | — | 00004 |
| wagon_operator | TEXT | NULL | — | — | 00004 |
| tariff_payer | TEXT | NULL | — | — | 00004 |
| **SNT FIELDS** | | | | | |
| buyer_name_for_snt | TEXT | NULL | — | — | 00004 |
| buyer_bin_for_snt | TEXT | NULL | — | — | 00004 |
| delivery_address_for_snt | TEXT | NULL | — | — | 00004 |
| tax_authority_code | TEXT | NULL | — | — | 00004 |
| virtual_warehouse_id | TEXT | NULL | — | — | 00004 |
| virtual_warehouse_name | TEXT | NULL | — | — | 00004 |
| **STATUS** | | | | | |
| is_ordered | BOOLEAN | NULL | false | — | 00004 |
| **ASSIGNMENT** | | | | | |
| assigned_manager_id | UUID | NULL | — | FK → profiles(id) | 00004 |
| assigned_by | UUID | NULL | — | FK → profiles(id) | 00004 |
| **FILES** | | | | | |
| pdf_file_path | TEXT | NULL | — | — | 00004 |
| source_email | TEXT | NULL | — | — | 00004 |
| **TIMESTAMPS** | | | | | |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00004 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00004 |

**Indexes:** idx_applications_ordered, idx_applications_manager  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE  
**Triggers:** trg_applications_updated: BEFORE UPDATE sets updated_at

---

### `application_deals`
**Purpose:** M:N mapping of applications to deals with volume allocation per deal.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00004 |
| application_id | UUID | NOT NULL | — | FK → applications(id) ON DELETE CASCADE | 00004 |
| deal_id | UUID | NOT NULL | — | FK → deals(id) ON DELETE CASCADE | 00004 |
| allocated_volume | DECIMAL(14,4) | NULL | — | — | 00004 |

**Indexes:** idx_application_deals_app, idx_application_deals_deal  
**Unique:** (application_id, deal_id)  
**RLS:** Standard authenticated pattern

---

## Shipment Registry & Pricing (Реестр отгрузки)

### `shipment_registry`
**Purpose:** Line-by-line waybill & shipment log per deal. Each row bridges a deal, supplier, buyer, forwarder, and shipment volumes. Central to tariff calculation and payment reconciliation.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00005 |
| registry_type | deal_type | NOT NULL | — | — | 00005 |
| row_number | INT | NULL | — | — | 00005 |
| quarter | TEXT | NULL | — | — | 00005 |
| month | TEXT | NULL | — | — | 00005 |
| date | DATE | NULL | — | — | 00005 |
| waybill_number | TEXT | NULL | — | — | 00005 |
| wagon_number | TEXT | NULL | — | — | 00005 |
| **VOLUMES** | | | | | |
| shipment_volume | DECIMAL(14,6) | NULL | — | — | 00005 (delivered tonnage) |
| loading_volume | DECIMAL(14,6) | NULL | — | — | 00025 (loaded tonnage; KZ uses this, KG uses shipment_volume) |
| rounded_tonnage_from_forwarder | DECIMAL(14,4) | NULL | — | — | 00005 |
| shipped_tonnage_amount | DECIMAL(14,4) | NULL | — | — | 00005, auto-computed = CEIL(volume) * tariff, can be overridden (00050, 00086) |
| shipped_tonnage_amount_override | BOOLEAN | NOT NULL | FALSE | — | 00050 |
| rounded_volume_override | DECIMAL(14,4) | NULL | — | — | 00061 |
| round_volume | BOOLEAN | NOT NULL | TRUE | — | 00086 |
| **REFERENCES** | | | | | |
| deal_id | UUID | NULL | — | FK → deals(id) | 00005 |
| supplier_id | UUID | NULL | — | FK → counterparties(id) | 00005 |
| buyer_id | UUID | NULL | — | FK → counterparties(id) | 00005 |
| fuel_type_id | UUID | NULL | — | FK → fuel_types(id) | 00005 |
| factory_id | UUID | NULL | — | FK → factories(id) | 00005 |
| forwarder_id | UUID | NULL | — | FK → forwarders(id) | 00005 |
| destination_station_id | UUID | NULL | — | FK → stations(id) | 00005 |
| departure_station_id | UUID | NULL | — | FK → stations(id) | 00005 |
| company_group_id | UUID | NULL | — | FK → company_groups(id) | 00025 |
| supplier_line_id | UUID | NULL | — | FK → deal_supplier_lines(id) | 00054 |
| buyer_line_id | UUID | NULL | — | FK → deal_buyer_lines(id) | 00054 |
| **PRICING / TARIFFS** | | | | | |
| railway_tariff | DECIMAL(10,4) | NULL | — | — | 00005 |
| shipment_month | TEXT | NULL | — | — | 00005 (booking month for tariff lookup) |
| additional_month | TEXT | NULL | — | — | 00025 |
| price_source | TEXT | NULL | — | — | 00077 |
| **INVOICING** | | | | | |
| invoice_number | TEXT | NULL | — | — | 00005 |
| invoice_volume | DECIMAL(14,4) | NULL | — | — | (on deals, not registry; legacy) |
| **APPENDICES** | | | | | |
| supplier_appendix | TEXT | NULL | — | — | 00072 |
| buyer_appendix | TEXT | NULL | — | — | 00072 |
| **OTHER** | | | | | |
| comment | TEXT | NULL | — | — | 00005 |
| **TIMESTAMPS** | | | | | |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00005 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00005 |
| created_by | UUID | NULL | — | FK → profiles(id) | 00005 |

**Indexes:**  
- idx_shipment_registry_deal, idx_shipment_registry_date, idx_shipment_registry_type, idx_shipment_registry_forwarder (00005)
- idx_shipment_registry_supplier_line, idx_shipment_registry_buyer_line (00054)
- idx_deal_attachments_section (00042)

**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE  
**Triggers:**
- trg_shipment_registry_updated: BEFORE UPDATE sets updated_at (00005)
- compute_registry_amount: BEFORE INSERT/UPDATE auto-computes shipped_tonnage_amount = base_volume * railway_tariff (with override guard and KZ/KG basis selection) (00031, 00050, 00086)
- refresh_deal_shipment_totals (via RPC): updates deal totals when registry changes (00027, 00044)
- autoprice_registry_insert: AFTER INSERT creates deal_shipment_prices rows (00054)

---

## Tariffs & DT-KT Logistics

### `tariffs`
**Purpose:** Railway tariff master (тарифы ОД ЖД) — lookup table for tariff amounts by route, forwarder, fuel, month.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00006 |
| destination_station_id | UUID | NULL | — | FK → stations(id) | 00006 |
| departure_station_id | UUID | NULL | — | FK → stations(id) | 00006 |
| forwarder_id | UUID | NULL | — | FK → forwarders(id) | 00006 |
| fuel_type_id | UUID | NULL | — | FK → fuel_types(id) | 00006 |
| factory_id | UUID | NULL | — | FK → factories(id) | 00006 |
| month | TEXT | NOT NULL | — | — | 00006 |
| year | INT | NOT NULL | — | — | 00006 |
| planned_tariff | DECIMAL(10,4) | NULL | — | — | 00006 |
| norm_days | INT | NULL | — | — | 00006 (norm transit days for this route/month) |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00006 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00006 |

**Unique:** (destination_station_id, departure_station_id, forwarder_id, fuel_type_id, month, year)  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE  
**Triggers:** trg_tariffs_updated: BEFORE UPDATE sets updated_at

---

### `dt_kt_logistics`
**Purpose:** Deferred tariff / prepaid logistics accounts per forwarder + company_group + year.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00006 |
| forwarder_id | UUID | NOT NULL | — | FK → forwarders(id) | 00006 |
| company_group_id | UUID | NOT NULL | — | FK → company_groups(id) | 00006 |
| year | INT | NOT NULL | — | — | 00006 |
| opening_balance | DECIMAL(14,4) | NULL | 0 | — | 00006 |
| payment | DECIMAL(14,4) | NULL | 0 | — | 00006 |
| refund | DECIMAL(14,4) | NULL | 0 | — | 00006 |
| fines | DECIMAL(14,4) | NULL | 0 | — | 00006 |
| surcharge_preliminary | DECIMAL(14,4) | NULL | 0 | — | 00006 |
| ogem | DECIMAL(14,4) | NULL | 0 | — | 00006 (overhead / overhead %) |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00006 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00006 |

**Unique:** (forwarder_id, company_group_id, year)  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE  
**Triggers:** trg_dt_kt_updated: BEFORE UPDATE sets updated_at

---

### `dt_kt_payments`
**Purpose:** Individual payment / refund / fine entries rolling up to a dt_kt_logistics account.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00015 |
| dt_kt_id | UUID | NULL | — | FK → dt_kt_logistics(id) ON DELETE CASCADE | 00015 |
| forwarder_id | UUID | NOT NULL | — | FK → forwarders(id) | 00015 |
| company_group_id | UUID | NOT NULL | — | FK → company_groups(id) | 00015 |
| payment_date | DATE | NOT NULL | — | — | 00015 |
| amount | DECIMAL(14,4) | NOT NULL | — | — | 00015 |
| description | TEXT | NULL | — | — | 00015 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00015 |
| created_by | UUID | NULL | — | FK → profiles(id) | 00015 |

**Indexes:** idx_dt_kt_payments_forwarder  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE

---

## Payments

### `deal_payments`
**Purpose:** Flexible, multi-currency payment/refund/offset ledger per deal. Replaces scalar supplier_payment / buyer_payment columns in 00019, but those scalars are still computed as rollups (00040, 00043, 00051).

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00019 |
| deal_id | UUID | NOT NULL | — | FK → deals(id) ON DELETE CASCADE | 00019 |
| side | TEXT | NOT NULL | — | CHECK (side IN ('supplier', 'buyer')) | 00019 |
| amount | DECIMAL(14,4) | NOT NULL | — | — | 00019 |
| payment_date | DATE | NOT NULL | — | — | 00019 |
| payment_type | TEXT | NOT NULL | 'payment' | CHECK (payment_type IN ('payment','refund','offset')) | 00051, 00062 |
| currency | TEXT | NULL | — | — | 00043 (optional multi-currency support) |
| description | TEXT | NULL | — | — | 00019 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00019 |
| created_by | UUID | NULL | — | FK → profiles(id) | 00019 |

**Indexes:** idx_deal_payments_deal, idx_deal_payments_side  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE  
**Note:** Triggers in 00027, 00040, 00051 update the deal's supplier_payment / buyer_payment totals when this table changes.

---

## Surcharges & Fines (Сверхнормативы / Штрафы)

### `surcharges`
**Purpose:** Environmental / contractual penalties and re-invoicing workflows.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00007 |
| deal_id | UUID | NULL | — | FK → deals(id) | 00007 |
| surcharge_code | TEXT | NULL | — | — | 00007 |
| reason | TEXT | NOT NULL | — | — | 00007 |
| amount | DECIMAL(14,4) | NULL | — | — | 00007 |
| period | TEXT | NULL | — | — | 00007 |
| accounted_quarter | INT | NULL | — | — | 00007 |
| accounted_amount_quarter | DECIMAL(14,4) | NULL | — | — | 00007 |
| departure_station_id | UUID | NULL | — | FK → stations(id) | 00007 |
| destination_station_id | UUID | NULL | — | FK → stations(id) | 00007 |
| supplier_contract | TEXT | NULL | — | — | 00007 |
| buyer_contract | TEXT | NULL | — | — | 00007 |
| fuel_type_id | UUID | NULL | — | FK → fuel_types(id) | 00007 |
| shipped_volume | DECIMAL(14,4) | NULL | — | — | 00007 |
| **CLAIM TRACKING** | | | | | |
| claim_number | TEXT | NULL | — | — | 00007 |
| deal_passport_number | TEXT | NULL | — | — | 00007 |
| issued_by_name | TEXT | NULL | — | — | 00007 |
| issued_to_name | TEXT | NULL | — | — | 00007 |
| issue_date | DATE | NULL | — | — | 00007 |
| claimed_amount | DECIMAL(14,4) | NULL | — | — | 00007 |
| accepted_amount | DECIMAL(14,4) | NULL | — | — | 00007 |
| approval_status | TEXT | NULL | — | — | 00007 |
| paid_amount | DECIMAL(14,4) | NULL | — | — | 00007 |
| payment_date | DATE | NULL | — | — | 00007 |
| remaining_debt | DECIMAL(14,4) | NULL | — | — | 00007 |
| comment | TEXT | NULL | — | — | 00007 |
| **RE-INVOICING** | | | | | |
| reinvoice_code | TEXT | NULL | — | — | 00007 |
| reinvoiced_to | TEXT | NULL | — | — | 00007 |
| reinvoice_letter | TEXT | NULL | — | — | 00007 |
| reinvoiced_from | TEXT | NULL | — | — | 00007 |
| reinvoice_date | DATE | NULL | — | — | 00007 |
| reinvoice_amount | DECIMAL(14,4) | NULL | — | — | 00007 |
| reinvoice_accepted_amount | DECIMAL(14,4) | NULL | — | — | 00007 |
| reinvoice_response_date | DATE | NULL | — | — | 00007 |
| reinvoice_acceptance_status | TEXT | NULL | — | — | 00007 |
| reinvoice_paid_amount | DECIMAL(14,4) | NULL | — | — | 00007 |
| reinvoice_payment_date | DATE | NULL | — | — | 00007 |
| reinvoice_remaining_debt | DECIMAL(14,4) | NULL | — | — | 00007 |
| reinvoice_comment | TEXT | NULL | — | — | 00007 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00007 |
| updated_at | TIMESTAMPTZ | NULL | now() | — | 00007 |

**Indexes:** idx_surcharges_deal  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE  
**Triggers:** trg_surcharges_updated: BEFORE UPDATE sets updated_at

---

## Documents & Attachments

### `snt_documents`
**Purpose:** Tax/Customs Invoice (СНФ) records imported from 1C or uploaded; one per transaction.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00008 |
| deal_id | UUID | NULL | — | FK → deals(id) | 00008 |
| snt_number | TEXT | NULL | — | — | 00008 |
| registration_number | TEXT | NULL | — | — | 00008 |
| shipment_date | DATE | NULL | — | — | 00008 |
| registration_datetime | TIMESTAMPTZ | NULL | — | — | 00008 |
| supplier_bin | TEXT | NULL | — | — | 00008 |
| supplier_name | TEXT | NULL | — | — | 00008 |
| receiver_bin | TEXT | NULL | — | — | 00008 |
| receiver_name | TEXT | NULL | — | — | 00008 |
| goods_description | TEXT | NULL | — | — | 00008 |
| quantity | DECIMAL(14,4) | NULL | — | — | 00008 |
| unit | TEXT | NULL | — | — | 00008 |
| price_per_unit | DECIMAL(14,4) | NULL | — | — | 00008 |
| total_amount | DECIMAL(14,4) | NULL | — | — | 00008 |
| source_file_path | TEXT | NULL | — | — | 00008 |
| imported_at | TIMESTAMPTZ | NULL | now() | — | 00008 |
| imported_by | UUID | NULL | — | FK → profiles(id) | 00008 |
| raw_data | JSONB | NULL | — | — | 00008 |

**Indexes:** idx_snt_deal, idx_snt_supplier_bin  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE

---

### `esf_documents`
**Purpose:** Electronic Sales Invoice (ЭСФ) records; similar to SNT but for accounts payable.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00008 |
| deal_id | UUID | NULL | — | FK → deals(id) | 00008 |
| registration_number | TEXT | NULL | — | — | 00008 |
| account_system_number | TEXT | NULL | — | — | 00008 |
| issue_date | DATE | NULL | — | — | 00008 |
| turnover_date | DATE | NULL | — | — | 00008 |
| supplier_bin | TEXT | NULL | — | — | 00008 |
| supplier_name | TEXT | NULL | — | — | 00008 |
| supplier_address | TEXT | NULL | — | — | 00008 |
| receiver_bin | TEXT | NULL | — | — | 00008 |
| receiver_name | TEXT | NULL | — | — | 00008 |
| goods_description | TEXT | NULL | — | — | 00008 |
| quantity | DECIMAL(14,4) | NULL | — | — | 00008 |
| price_per_unit | DECIMAL(14,4) | NULL | — | — | 00008 |
| total_without_tax | DECIMAL(14,4) | NULL | — | — | 00008 |
| tax_amount | DECIMAL(14,4) | NULL | — | — | 00008 |
| total_with_tax | DECIMAL(14,4) | NULL | — | — | 00008 |
| source_file_path | TEXT | NULL | — | — | 00008 |
| imported_at | TIMESTAMPTZ | NULL | now() | — | 00008 |
| imported_by | UUID | NULL | — | FK → profiles(id) | 00008 |
| raw_data | JSONB | NULL | — | — | 00008 |

**Indexes:** idx_esf_deal, idx_esf_supplier_bin  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE

---

### `deal_attachments`
**Purpose:** User-uploaded files (contracts, acts, invoices, etc.) organized by section of the deal.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00008 |
| deal_id | UUID | NOT NULL | — | FK → deals(id) ON DELETE CASCADE | 00008 |
| category | TEXT | NOT NULL | — | CHECK (category IN ('application', 'contract', 'appendix', 'snt', 'esf', 'waybill', 'act_completed_works', 'invoice', 'quality_cert', 'reconciliation_act', 'other')) | 00008 |
| section | TEXT | NULL | — | CHECK (section IS NULL OR section IN ('supplier','buyer','company_chain','logistics')) | 00042 |
| file_name | TEXT | NOT NULL | — | — | 00008 |
| file_path | TEXT | NOT NULL | — | — | 00008 |
| file_size | INT | NULL | — | — | 00008 |
| mime_type | TEXT | NULL | — | — | 00008 |
| uploaded_by | UUID | NULL | — | FK → profiles(id) | 00008 |
| uploaded_at | TIMESTAMPTZ | NULL | now() | — | 00008 |

**Indexes:** idx_deal_attachments_deal (00008), idx_deal_attachments_section (00042)  
**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE

---

## Activity Feed & Audit Log

### `deal_activity`
**Purpose:** User comments and system events (payment changes, field edits, shipments) per deal or application.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00016 |
| deal_id | UUID | NULL | — | FK → deals(id) ON DELETE CASCADE | 00016 |
| application_id | UUID | NULL | — | FK → applications(id) ON DELETE CASCADE | 00017 |
| user_id | UUID | NULL | — | FK → profiles(id) | 00016 |
| type | TEXT | NOT NULL | 'comment' | CHECK (type IN ('comment', 'system', 'status_change', 'payment', 'shipment', 'attachment')) | 00016 |
| content | TEXT | NOT NULL | — | — | 00016 |
| metadata | JSONB | NULL | — | — | 00016 |
| created_at | TIMESTAMPTZ | NULL | now() | — | 00016 |

**Indexes:** idx_deal_activity_deal, idx_deal_activity_created, idx_deal_activity_application (00017)  
**RLS:** Authenticated SELECT, writable INSERT, admin DELETE  
**Triggers:**
- log_deal_payment_change: AFTER UPDATE on deals (00016)
- log_deal_field_changes: AFTER UPDATE on deals (00088)

**Realtime:** Subscribed via supabase_realtime (00016)

---

### `audit_log`
**Purpose:** Immutable change history for compliance; one row per INSERT/UPDATE/DELETE on money-relevant tables.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00036 |
| table_name | TEXT | NOT NULL | — | — | 00036 |
| row_id | UUID | NOT NULL | — | — | 00036 |
| op | TEXT | NOT NULL | — | CHECK (op IN ('INSERT','UPDATE','DELETE')) | 00036 |
| user_id | UUID | NULL | — | FK → auth.users(id) | 00036 |
| changed_at | TIMESTAMPTZ | NOT NULL | now() | — | 00036 |
| old_row | JSONB | NULL | — | — | 00036 |
| new_row | JSONB | NULL | — | — | 00036 |
| changed_fields | TEXT[] | NULL | — | — | 00036 |

**Indexes:** idx_audit_log_row (table_name, row_id, changed_at DESC), idx_audit_log_user (user_id, changed_at DESC)  
**Triggers:** audit_trigger attached to deals, deal_payments, deal_shipment_prices, shipment_registry (00036+)

---

## Archive

### `archive_years`
**Purpose:** Marks calendar years as locked for read-only.

| Column | Type | NULL | Default | Constraints | Added |
|--------|------|------|---------|-------------|-------|
| id | UUID | NOT NULL | gen_random_uuid() | PK | 00009 |
| year | INT | NOT NULL | — | UNIQUE | 00009 |
| archived_at | TIMESTAMPTZ | NULL | now() | — | 00009 |
| archived_by | UUID | NULL | — | FK → profiles(id) | 00009 |
| is_locked | BOOLEAN | NULL | true | — | 00009 |

**RLS:** Authenticated SELECT, writable INSERT/UPDATE, admin DELETE

---

---

## Data Hazards for Migration

### 1. Legacy Mirror Columns

The system contains an elaborate mirroring mechanism to maintain backward compatibility:

- **deals.currency** (00014): Single legacy currency field, still read by dashboards and exports. Mirrors **deals.supplier_currency** (00043). When migrating to Postgres, either deprecate dashboards and read from per-section columns, or maintain the mirror trigger.

- **deals.supplier_price, buyer_price, supplier_quotation, buyer_quotation, supplier_discount, buyer_discount, supplier_delivery_basis, buyer_delivery_basis, supplier_departure_station_id, buyer_destination_station_id** (00053): All mirrored from the default pricing line (deal_supplier_lines / deal_buyer_lines where is_default = TRUE). When a user edits these scalars on the deal, the sync trigger updates the line. When the line changes, it syncs back to the scalars. This works but is fragile: if a line FK is stale or the default line is deleted, the mirror breaks. In Postgres, consider removing the scalar columns entirely and always read from the lines tables.

- **deals.buyer_shipped_volume, actual_shipped_volume, invoice_amount** (00044, etc.): Computed rollups from shipment_registry. On each registry INSERT/UPDATE/DELETE, the trigger refresh_deal_shipment_totals recalculates these. If migration does not preserve the trigger, these fields will go stale.

### 2. Overlapping Concepts

- **shipment_volume vs. loading_volume** (00025, 00086): On KZ deals, the tariff is computed from loading_volume (налив). On KG deals, from shipment_volume (отгрузка). The migration must preserve this logic in the compute_registry_amount trigger; otherwise tariff calculations will diverge by registry_type.

- **supplier_debt vs. buyer_debt** (00060): The formula flipped in 00060. Prior to that, buyer_debt was shipped − payment. Now it is payment − shipped. The direction change is semantic, not a typo—old deployments expect the old sign. Any historical queries over buyer_debt must account for the flip date (migration 00060, likely May 2026).

- **railway_in_price sign flip** (00052 → 00063): The supplier_balance formula for when railway_in_price = true changed from a SUBTRACTION (00052) to an ADDITION (00063). The diff comment notes this was a client decision flip; the code was corrected in 00063. Old snapshots in audit_log will have the old sign; new computations use the new sign. Reconciliation may require historical restatement.

### 3. Unused or Abandoned Columns

The following columns were added but are rarely or never written to by the application:

- **applications.consignee_*** fields (consignee_bin, consignee_code_4/12, consignee_legal_address, consignee_postal_address, consignee_name): Parsed from PDF but mostly for audit. No join to the consignees table; consignee reference data is kept separate (00090). If the feature is to be reactivated (e.g., linking applications to consignees), a new FK is needed.

- **deals.sulfur_percent**: Stored but rarely filtered on; the fuel_type itself may capture this. Check application code before preserving.

- **surcharges.reinvoice_*** fields: Entire second tier (reinvoice_letter, reinvoice_response_date, reinvoice_acceptance_status, etc.). If operations don't use re-invoicing, these are dead weight. Grep for write paths before migration.

- **dt_kt_logistics.ogem**: Marked as "overhead" in comments but never computed. Likely a vestigial design.

### 4. Likely Heavy Nulls

The following columns are predominantly NULL in production (feature blocks are unused or incomplete):

- **surcharges.surcharge_code, deal_passport_number, issued_by_name, claim_number, approval_status, paid_amount, payment_date**: The claims-tracking side of surcharges. If operations never uses it, these can be dropped or archived to a separate table.

- **tariffs.norm_days**: Not used in any pricing formula; appears to be metadata only.

- **shipment_registry.invoice_number, comment**: Sparse; mostly manual notes.

- **applications.virtual_warehouse_id, virtual_warehouse_name, tax_authority_code, buyer_name_for_snt**: SNT/ESF workflow columns. Nulls spike in deals that don't export to Kazakhstan. Can be pruned if SNT feature is dormant.

### 5. Complex Computed / Derived Fields

- **deals.deal_code**: Computed on INSERT/UPDATE by trg_deals_code (00003). Formula: `deal_type || '/' || deal_number || '/' || (year % 100)`. NOT stored; computed on the fly. In Postgres, either keep the trigger or compute in application layer.

- **deals.supplied_contracted_amount, buyer_contracted_amount**: Trigger-computed = volume × price. If either input is NULL, field is NULL. Used for rollups and reporting.

- **deals.supplier_balance, buyer_debt, buyer_remaining**: Multi-step formulas in compute_deal_derived_fields (00021, 00052, 00060, 00063). Depends on is_draft flag (skip computation if is_draft = true), railway_in_price, currency matching, and other conditions. Complex logic; preserve the trigger or replicate in application logic.

- **deals.preliminary_amount**: planned_tariff × preliminary_tonnage. Nullable if either input is.

- **shipment_registry.shipped_tonnage_amount**: Base formula is CEIL(volume) × railway_tariff, BUT:
  - If shipped_tonnage_amount_override = true, trigger leaves manual value alone.
  - If rounded_volume_override is set (00061), use that instead of shipment_volume.
  - If round_volume = false (00086), use exact volume instead of CEIL(volume).
  - KZ deals use loading_volume; KG use shipment_volume.
  - Trigger is BEFORE INSERT/UPDATE, so changes fire on every write. Legacy code may expect idempotency; ensure migration logic is same.

### 6. Enum / CHECK Constraint Migrations

- **price_condition**: Started as ('average_month', 'fixed', 'trigger'). Later added 'manual_formula' (00071), 'manual_in_formula' (00078). Old rows with these values won't exist in legacy DB, but new rows will have them if the system is live. In Postgres, ensure the enum is fully migrated before writing any new rows.

- **user_role**: Was ('admin', 'manager', 'logistics', 'accounting', 'readonly'). 'finance' and 'trader' added in 00082. Both have the same RLS as 'manager'. Existing rows with roles like 'accounting' are still present but dormant (no new policies for them after 00010). Check is_writable_role() before and after 00082 for role-based access changes.

### 7. RLS & Permissions

All tables have RLS enabled. The is_writable_role() and is_admin() functions are security-definer, meaning they run as the superuser and evaluate profile.role in the current user's profile. If migration to plain Postgres, either:
1. Keep the RLS policies and run is_writable_role() functions (requires the profiles table and auth.users linkage).
2. Drop RLS entirely and implement access control in application logic.
3. Implement per-schema or per-table grants for Postgres roles.

Migration decision: **RLS in Supabase is not portable to plain Postgres without significant rewrite.** Plan for application-layer permission checks post-migration.

### 8. Triggers & Computed Columns

The system has ~20 triggers across tables. Each performs either:
- Timestamp updates (update_updated_at on most tables).
- Computed field updates (deal_code, contracted_amount, balance, registry amount).
- Audit logging (audit_trigger, log_deal_payment_change, log_deal_field_changes).
- Data synchronization (sync_deal_from_default_supplier_line).
- Rollup refreshes (refresh_deal_shipment_totals called on registry changes).

**Critical:** Every trigger must be ported to Postgres OR moved to application code. Missing a trigger (e.g., compute_registry_amount) will break tariff calculation silently.

### 9. Feature Phases & Incomplete Migrations

- **Sub-quotations (Phase 1, 00073; Phase 2, 00074)**: product_subtypes and quotation_values tables added. Phase 3 (frontend swap to compute_subquotation_price RPC) is not in the schema migrations yet. The old quotations table still has wide columns (price_fob_med, price_fob_rotterdam, price_cif_nwe) which are not used for new variant pricing but are retained for backfill/legacy read.

- **Multi-line pricing rollout**: deal_supplier_lines and deal_buyer_lines added in 00053; shipment_registry.supplier_line_id / buyer_line_id added in 00054. But deal scalars are still written by the UI and sync back via trigger. Phase 3 is to rewire the UI to write directly to lines and remove the scalar sync. Until then, both code paths are live and must stay in sync.

- **Price stage workflow (00068)**: price_stage column and snapshot trigger added to lines tables. autoprice only runs when stage = 'final'. But no UI trigger to auto-flip from preliminary → final; that is manual (00068 comments). Backlog item to automate the flip.

- **calc_mode (00079)**: New dimension orthogonal to price_condition. Old price_condition values like 'avg_to_date' are superseded but still in the enum. New code should use (calc_mode, price_condition) pairs. Migration should preserve both columns for backward compat.

### 10. Known Columns Flipped or Re-signed

- **buyer_debt** (00060): payment − shipped (now) vs. shipped − payment (before 00060).
- **railway_in_price contribution** (00063): +invoice_amount (now) vs. −invoice_amount (before 00063).
- **payment_type refund/offset sign** (00051, 00062): Subtracts from totals instead of adds. Backfill note: negative-amount rows from before 00051 are NOT auto-flipped to refund; they stay payment type. This is intentional (00051 comments).

### 11. Active But Unindexed Columns

- **shipment_registry.shipment_month, registry_type**: Used in WHERE clauses and JOINs but no index. Consider adding idx_shipment_registry_month, idx_shipment_registry_registry_type if queries slow post-migration.
- **deal_payments.currency**: Matched in per-side rollup logic (00043, 00051) but not indexed. Heavy filtering on deal_id + currency might benefit.

### 12. FK Cascade Behavior Notes

- **deals(id) ON DELETE CASCADE** to shipment_registry, application_deals, deal_payments, deal_attachments, deal_activity, snt_documents, esf_documents, deal_company_groups, deal_supplier_lines, deal_buyer_lines, deal_shipment_prices, surcharges (00003+). Deleting a deal cascades to all children. Test this carefully during migration.
- **profiles(id) ON DELETE SET NULL** (modified in 00081 from CASCADE) to various FK fields (supplier_manager_id, buyer_manager_id, trader_id, created_by, created_by, etc.). User deletion leaves deals orphaned but intact.
- **applications(id) ON DELETE CASCADE** to application_deals and deal_activity. Deleting an application orphans the deal_activity rows that reference it but keeps the deal_activity rows that reference only the deal.

---

## RPC Functions (Callable Stored Procedures)

The following functions are exposed as read-only RPCs to the frontend:

### `compute_subquotation_price(p_sub_quotation_id UUID, p_mode TEXT, p_params JSONB) → NUMERIC` (00074)
Computes average price over quotation_values for a given sub-quotation. Modes: 'avg_month', 'avg_to_date', 'on_date', 'trigger'. Executable by authenticated users.

### `get_deal_bundle(p_deal_id UUID) → JSONB` (00093)
Aggregates a complete deal record including all related tables (supplier lines, buyer lines, shipment registry, attachments, activity) as a single JSONB object. Used for efficient initial page load. Executable by authenticated users.

### Other helper functions (non-RPC):
- `handle_new_user()`: Trigger function; auto-creates profile on auth.users signup (00001).
- `update_updated_at()`: Trigger function; sets updated_at to now() (00001).
- `compute_deal_code()`: Trigger function; computes deal_code from type/number/year (00003).
- `compute_deal_derived_fields()`: Trigger function; recomputes balance, amount, remaining (00021+).
- `refresh_deal_shipment_totals()`: RPC; refreshes deal totals from shipment_registry (00027).
- `refresh_deal_payment_totals()`: Trigger helper; recalculates supplier_payment / buyer_payment rollups (00028, 00040, 00043, 00051).
- `compute_registry_amount()`: Trigger function; auto-computes shipped_tonnage_amount (00031, 00050, 00086).
- `autoprice_registry_insert()`: Trigger function; creates deal_shipment_prices on new registry rows (00037, 00054).
- `is_writable_role()`: Security helper; checks if user has writable role (00010, 00082).
- `is_admin()`: Security helper; checks if user is admin (00010).

---

End of AS-BUILT-DATA.md. **Total schema version: 00093 (2026-06-02).**

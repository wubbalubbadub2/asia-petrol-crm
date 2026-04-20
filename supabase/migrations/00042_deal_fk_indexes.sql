-- Bug uncovered by the qa-audit index sweep (2026-04-20):
-- migration 00003 created `deals` with eleven FK columns but only
-- supplier_id + buyer_id got an index. The new /deals filter row
-- (added 2026-04-20 client feedback) queries `factory_id`,
-- `fuel_type_id`, `forwarder_id`, `logistics_company_group_id`,
-- `buyer_destination_station_id`, `supplier_manager_id`,
-- `buyer_manager_id`, and `trader_id` — all currently table-scans.
--
-- Adding the missing indexes is pure-additive: zero behavioural
-- change, no downtime, faster filter queries, faster joins on the
-- dashboard financial summary. `CREATE INDEX IF NOT EXISTS` so the
-- migration is safe to re-run in any environment.

CREATE INDEX IF NOT EXISTS idx_deals_factory_id            ON deals(factory_id);
CREATE INDEX IF NOT EXISTS idx_deals_fuel_type_id          ON deals(fuel_type_id);
CREATE INDEX IF NOT EXISTS idx_deals_forwarder_id          ON deals(forwarder_id);
CREATE INDEX IF NOT EXISTS idx_deals_logistics_company_gr  ON deals(logistics_company_group_id);
CREATE INDEX IF NOT EXISTS idx_deals_dest_station_id       ON deals(buyer_destination_station_id);
CREATE INDEX IF NOT EXISTS idx_deals_supplier_manager_id   ON deals(supplier_manager_id);
CREATE INDEX IF NOT EXISTS idx_deals_buyer_manager_id      ON deals(buyer_manager_id);
CREATE INDEX IF NOT EXISTS idx_deals_trader_id             ON deals(trader_id);

-- Composite index for the most common dashboard query:
-- "all active deals in year X" → the year + is_archived pair.
-- Speeds up the dashboard KPI load as volumes grow.
CREATE INDEX IF NOT EXISTS idx_deals_year_archived ON deals(year, is_archived);

-- Same deal for shipment_registry: migration 00005 indexed deal_id,
-- date, registry_type, forwarder_id but left five FKs bare. The
-- registry page groups by (factory, supplier, buyer, fuel_type) and
-- filters by station_id pairs — all currently table-scanning.
CREATE INDEX IF NOT EXISTS idx_shipment_registry_factory_id
  ON shipment_registry(factory_id);
CREATE INDEX IF NOT EXISTS idx_shipment_registry_fuel_type_id
  ON shipment_registry(fuel_type_id);
CREATE INDEX IF NOT EXISTS idx_shipment_registry_supplier_id
  ON shipment_registry(supplier_id);
CREATE INDEX IF NOT EXISTS idx_shipment_registry_buyer_id
  ON shipment_registry(buyer_id);
CREATE INDEX IF NOT EXISTS idx_shipment_registry_dep_station_id
  ON shipment_registry(departure_station_id);
CREATE INDEX IF NOT EXISTS idx_shipment_registry_dest_station_id
  ON shipment_registry(destination_station_id);

-- Client request: when logistics selects a deal in the registry, auto-fill
-- the departure station. Until now the deal only stored the buyer's
-- destination station (buyer_destination_station_id from 00003); the
-- supplier's departure station lived only on individual shipment rows,
-- so each registry entry had to pick it manually.
--
-- Adding supplier_departure_station_id to deals lets registry forms
-- inherit it in one place. Nullable — existing deals carry on without it
-- and the registry form falls back to manual entry.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_departure_station_id UUID
  REFERENCES stations(id);

CREATE INDEX IF NOT EXISTS idx_deals_departure_station
  ON deals(supplier_departure_station_id);

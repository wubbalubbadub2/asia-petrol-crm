-- Bulk-fill empty railway_tariff on shipment_registry from the Тарифы
-- reference. Mirrors the auto-lookup the inline / bulk-add UI runs at
-- insert time, applied retroactively. Safe to re-run any time the user
-- adds new entries to the tariffs reference and wants empty registry
-- rows populated.
--
-- Match keys (all six required to identify a unique tariff):
--   departure_station_id, destination_station_id, fuel_type_id,
--   forwarder_id, month, year
-- The registry row's own field wins when present; otherwise we fall
-- back to the parent deal's field. Year always comes from the deal.
--
-- Side effects via trigger chain:
--   shipment_registry UPDATE → compute_registry_amount (00031)
--     populates shipped_tonnage_amount = CEIL(shipment_volume) * tariff
--   → trg_shipment_refresh_deal (00011 / 00027 / 00044)
--     refreshes deals.invoice_amount, buyer/supplier_shipped_volume
--   → autoprice_registry_update (00045 / 00046)
--     keeps deal_shipment_prices auto-rows in sync
-- so all downstream surfaces (registry, DT-KT, passport) self-correct.

UPDATE shipment_registry sr
SET railway_tariff = t.planned_tariff
FROM deals d, tariffs t
WHERE sr.deal_id          = d.id
  AND sr.railway_tariff   IS NULL
  AND t.departure_station_id   = COALESCE(sr.departure_station_id,  d.supplier_departure_station_id)
  AND t.destination_station_id = COALESCE(sr.destination_station_id, d.buyer_destination_station_id)
  AND t.fuel_type_id      = COALESCE(sr.fuel_type_id, d.fuel_type_id)
  AND t.forwarder_id      = COALESCE(sr.forwarder_id, d.forwarder_id)
  AND t.month             = COALESCE(sr.shipment_month, d.month)
  AND t.year              = d.year
  AND t.planned_tariff    IS NOT NULL;

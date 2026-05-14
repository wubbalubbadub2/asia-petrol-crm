-- Tariff-lookup month override on the logistics block.
--
-- Background (product spec, 2026-05-14):
-- The `tariffs` table is keyed by (departure_station_id,
-- destination_station_id, fuel_type_id, forwarder_id, month, year).
-- Today the front-end looks up the planned tariff using `deals.month`
-- — but the actual shipment can fall in a different month than the
-- deal's own calendar month (e.g. deal signed in январе, ships in
-- марте with a different tariff). Without a month override the
-- planned_tariff ends up with the wrong number from the wrong month.
--
-- New column: `logistics_shipment_month TEXT` on `deals`. Nullable.
-- When set, the tariff lookup uses it instead of `deals.month`. When
-- null, behavior is unchanged (falls back to `deals.month`).
--
-- Mirrors the «selected_month» pattern on deal_supplier_lines /
-- deal_buyer_lines from migration 00068 — same UX shape, same logic.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS logistics_shipment_month TEXT;

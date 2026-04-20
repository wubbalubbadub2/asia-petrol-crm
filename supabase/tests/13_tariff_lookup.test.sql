-- Test: lookup_tariff returns planned_tariff for an exact route match (mig 00011)
--
-- The UI calls this to auto-fill railway_tariff when creating a
-- shipment_registry row. It's an exact-match lookup across six
-- dimensions (dest station, dep station, forwarder, fuel type,
-- month, year) — any mismatch returns NULL.

BEGIN;

DO $$
DECLARE
  v_dest       UUID := gen_random_uuid();
  v_dep        UUID := gen_random_uuid();
  v_fw         UUID := gen_random_uuid();
  v_fuel       UUID := gen_random_uuid();
  v_fuel_other UUID := gen_random_uuid();
  v_tariff     DECIMAL;
BEGIN
  INSERT INTO stations (id, name) VALUES
    (v_dest, 'T-Dest'),
    (v_dep,  'T-Dep');
  INSERT INTO forwarders (id, name)  VALUES (v_fw,         'T-Forwarder');
  INSERT INTO fuel_types (id, name)  VALUES
    (v_fuel,       'T-Fuel'),
    (v_fuel_other, 'T-OtherFuel');

  -- Exact match row.
  INSERT INTO tariffs (destination_station_id, departure_station_id,
                       forwarder_id, fuel_type_id, month, year,
                       planned_tariff)
  VALUES (v_dest, v_dep, v_fw, v_fuel, 'январь', 2099, 1234.5);

  -- Same-route other month → ignored.
  INSERT INTO tariffs (destination_station_id, departure_station_id,
                       forwarder_id, fuel_type_id, month, year,
                       planned_tariff)
  VALUES (v_dest, v_dep, v_fw, v_fuel, 'февраль', 2099, 9999);

  -- Matching call returns the stored value.
  v_tariff := lookup_tariff(v_dest, v_dep, v_fw, v_fuel, 'январь', 2099);
  IF v_tariff <> 1234.5 THEN
    RAISE EXCEPTION 'exact match: expected 1234.5, got %', v_tariff;
  END IF;

  -- Wrong fuel type → NULL.
  v_tariff := lookup_tariff(v_dest, v_dep, v_fw, v_fuel_other, 'январь', 2099);
  IF v_tariff IS NOT NULL THEN
    RAISE EXCEPTION 'fuel mismatch should return NULL, got %', v_tariff;
  END IF;

  -- Wrong month → NULL.
  v_tariff := lookup_tariff(v_dest, v_dep, v_fw, v_fuel, 'март', 2099);
  IF v_tariff IS NOT NULL THEN
    RAISE EXCEPTION 'month mismatch should return NULL, got %', v_tariff;
  END IF;

  -- Wrong year → NULL.
  v_tariff := lookup_tariff(v_dest, v_dep, v_fw, v_fuel, 'январь', 2100);
  IF v_tariff IS NOT NULL THEN
    RAISE EXCEPTION 'year mismatch should return NULL, got %', v_tariff;
  END IF;
END $$;

ROLLBACK;

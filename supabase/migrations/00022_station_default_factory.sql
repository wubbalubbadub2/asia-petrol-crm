-- Add default factory mapping to stations
-- Excel: IF(station="ст. Текесу","ПКОП", IF(station="ст. Тендык","АНПЗ", ...))

ALTER TABLE stations ADD COLUMN IF NOT EXISTS default_factory_id UUID REFERENCES factories(id);

-- Seed known station-to-factory mappings
UPDATE stations SET default_factory_id = (SELECT id FROM factories WHERE name = 'ПКОП' LIMIT 1)
  WHERE name IN ('ст. Текесу', 'Текесу');

UPDATE stations SET default_factory_id = (SELECT id FROM factories WHERE name = 'АНПЗ' LIMIT 1)
  WHERE name IN ('ст. Тендык', 'Тендык');

UPDATE stations SET default_factory_id = (SELECT id FROM factories WHERE name = 'КМНПЗ' LIMIT 1)
  WHERE name IN ('ст. Белкуль', 'Белкуль', 'Белкол');

UPDATE stations SET default_factory_id = (SELECT id FROM factories WHERE name = 'ПНХЗ' LIMIT 1)
  WHERE name IN ('ст. Павлодар - Порт', 'Павлодар - Порт', 'Павлодар-Порт');

UPDATE stations SET default_factory_id = (SELECT id FROM factories WHERE name = 'АГПЗ' LIMIT 1)
  WHERE name IN ('Аса');

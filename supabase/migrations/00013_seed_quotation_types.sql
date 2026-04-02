-- Seed quotation product types from Карточка.xlsx Котировки sheet
-- These are the 16 commodity price types tracked daily

INSERT INTO quotation_product_types (name, sub_name, basis, sort_order) VALUES
  ('ГАЗОЙЛЬ 0,1%', 'Средняя', 'CIF NWE', 1),
  ('ВГО 0,5-0,6%', 'Средняя', 'CIF NWE/Basis ARA', 2),
  ('ВГО 2%', 'Средняя', NULL, 3),
  ('МАЗУТ 0,5% Marine Fuel', 'Средняя', 'CIF NWE', 4),
  ('МАЗУТ 1,0% Fuel oil', 'Средняя', 'CIF NWE', 5),
  ('МАЗУТ 3,5%', 'Средняя', 'CIF NWE', 6),
  ('МАЗУТ 1,0% FOB NWE', 'Средняя', 'FOB NWE', 7),
  ('МАЗУТ 1,0% FOB Rotterdam', 'Средняя', 'FOB Rotterdam', 8),
  ('МАЗУТ 3,5% FOB NWE', 'Средняя', 'FOB NWE', 9),
  ('МАЗУТ 3,5% FOB Rotterdam', 'Средняя', 'FOB Rotterdam', 10),
  ('Eurobob', 'Средняя', 'FOB Rotterdam', 11),
  ('Prem Unl 10 ppm', 'Средняя', 'FOB MED', 12),
  ('НАФТА', 'Средняя', 'CIF NWE', 13),
  ('ULSD 10 ppm', 'Средняя', 'CIF NWE/Basis ARA', 14),
  ('Jet', 'Средняя', 'CIF NWE', 15),
  ('BRENT DTD (Platts)', 'Crude Oil Marketwire', NULL, 16);

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

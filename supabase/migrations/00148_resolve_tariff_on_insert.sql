-- 00148_resolve_tariff_on_insert.sql
--
-- Клиент 2026-08-13: «в реестре тариф логистов не подтягивается».
-- Диагностика на вагоне 76220292: ставка для маршрута/месяца/ГСМ/
-- экспедитора в справочнике ЕСТЬ, а railway_tariff в строке пуст.
--
-- Причина. Подбор тарифа по справочнику висел только на ИЗМЕНЕНИИ
-- строки (00132 → 00134, BEFORE UPDATE с условием на ключевые поля).
-- На СОЗДАНИИ строки не срабатывал ничего. Пропагация со стороны
-- справочника (00117) тоже не помогает: она реагирует на правку самих
-- тарифов, а не на появление новой строки реестра.
--
-- Отсюда типичный сценарий: ставку завели в понедельник, вагон внесли
-- во вторник — и тариф не подставился, потому что искать его было
-- некому. Дальше строка живёт пустой, пока кто-нибудь случайно не
-- тронет месяц, экспедитора, станцию, ГСМ или сделку.
--
-- Функция reresolve_registry_tariff_on_key_change (00134) обращается
-- только к NEW и к сделке, к OLD не обращается — поэтому годится для
-- INSERT без изменений. Ручные строки (railway_tariff_override) она,
-- как и раньше, не трогает.

-- ── 1. Подбор тарифа при создании строки ─────────────────────────────
-- Имя начинается с trg_key_, а BEFORE-триггеры выполняются по алфавиту,
-- поэтому тариф встанет ДО trg_registry_compute_amount и сумма
-- посчитается уже по нему.

DROP TRIGGER IF EXISTS trg_key_resolve_tariff_ins ON shipment_registry;
CREATE TRIGGER trg_key_resolve_tariff_ins
  BEFORE INSERT ON shipment_registry
  FOR EACH ROW
  EXECUTE FUNCTION reresolve_registry_tariff_on_key_change();

-- ── 2. Догоняем строки, которые уже созданы пустыми ──────────────────
-- Трогаем ТОЛЬКО строки без тарифа и без ручной пометки: там, где
-- значение уже стоит, оно могло быть выставлено осознанно, и менять
-- его задним числом нельзя.
--
-- Внимание: заполнение тарифа пересчитает сумму строки, а через неё —
-- «Сумму ЖД» сделки. Это и есть желаемое поведение (клиент ждёт, что
-- ставка из справочника дойдёт до реестра), но деньги при этом
-- сдвинутся. Поэтому миграция печатает, сколько строк затронула.

DO $$
DECLARE
  v_rows INT;
BEGIN
  WITH resolved AS (
    SELECT sr.id,
           (SELECT t.planned_tariff
              FROM tariffs t
             WHERE t.departure_station_id   = COALESCE(sr.departure_station_id,   d.supplier_departure_station_id)
               AND t.destination_station_id = COALESCE(sr.destination_station_id, d.buyer_destination_station_id)
               AND t.fuel_type_id           = COALESCE(sr.fuel_type_id,           d.fuel_type_id)
               AND t.forwarder_id           = COALESCE(sr.forwarder_id,           d.forwarder_id)
               AND t.month                  = COALESCE(sr.shipment_month,         d.month)
               AND t.year                   = d.year
               AND t.planned_tariff IS NOT NULL
             ORDER BY t.planned_tariff
             LIMIT 1) AS tariff
      FROM shipment_registry sr
      JOIN deals d ON d.id = sr.deal_id
     WHERE sr.railway_tariff IS NULL
       AND COALESCE(sr.railway_tariff_override, FALSE) = FALSE
  )
  UPDATE shipment_registry sr
     SET railway_tariff = r.tariff
    FROM resolved r
   WHERE sr.id = r.id
     AND r.tariff IS NOT NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'тариф подставлен в % строк реестра, которые были пустыми', v_rows;
END $$;

-- 00104_dedupe_registry_wagon_waybill.sql
--
-- Client 2026-07-03 (уточнение): «мы должны отловить только случай
-- когда внутри одной сделки по одному вагону и одной накладной есть
-- две строки: в одной строке есть и входящее и исходящее снт, в
-- другой только одно из них. Это и есть дубликат. Не придумывай
-- вещи сам».
--
-- Точное правило (никаких других домыслов):
--
--   Ключ группы:  (deal_id, wagon_number, waybill_number)
--   Все три должны быть НЕ NULL. Разные сделки — не наш кейс.
--   Разные вагоны/накладные — не наш кейс.
--
--   Группа = ДУБЛЬ если в ней одновременно:
--     • ≥1 «полная»    строка — loading_volume НЕ NULL AND shipment_volume НЕ NULL
--     • ≥1 «частичная» строка — ровно один из двух объёмов NULL (XOR)
--
--   Что делаем: DELETE частичные. Полные оставляем как есть.
--
-- Что НЕ трогаем (легальные кейсы, не дубли по правилу клиента):
--   • Две частичные строки в группе (клиент намеренно разнёс
--     входящее и исходящее СНТ на две записи).
--   • Одна строка в группе.
--   • Разные deal_id / wagon / waybill.
--   • Строки с NULL deal_id — клиент явно сказал «внутри одной
--     сделки», а NULL не сделка.
--
-- Structure — 2 фазы:
--
--   PHASE 1 — Preview. Обычный SELECT (не DO), возвращает РЯДЫ
--             прямо в Results. По каждой строке-кандидату видна
--             её роль (ПОЛНАЯ / ЧАСТИЧНАЯ). Ничего не пишет в БД.
--
--   PHASE 2 — DELETE частичных строк. Wrapped in /* ... */ — не
--             запускается автоматически. Разкомментировать вручную
--             после проверки Phase 1.
--
-- Никаких UNIQUE-индексов — двух намеренных частичных строк это
-- нормальный кейс, индекс на (deal_id, wagon, waybill) сломал бы его.
-- Защиту от повторного создания дублей делаем в приложении, не в БД.

-- ────────────────────────────────────────────────────────────────
-- PHASE 1 — PREVIEW (всегда прогоняется, только SELECT).
--
-- Показывает по каждой строке-кандидату её роль в кластере.
-- Сначала группируем и находим кластеры, которые точно
-- соответствуют определению дубля, потом раскрываем все строки
-- этих кластеров с меткой.
-- ────────────────────────────────────────────────────────────────

WITH duplicate_groups AS (
  SELECT deal_id, wagon_number, waybill_number
  FROM shipment_registry
  WHERE deal_id       IS NOT NULL
    AND wagon_number  IS NOT NULL
    AND waybill_number IS NOT NULL
  GROUP BY deal_id, wagon_number, waybill_number
  HAVING
      COUNT(*) FILTER (
        WHERE loading_volume IS NOT NULL AND shipment_volume IS NOT NULL
      ) >= 1
      AND COUNT(*) FILTER (
        WHERE (loading_volume IS NULL) <> (shipment_volume IS NULL)
      ) >= 1
)
SELECT
  d.deal_code               AS сделка,
  sr.wagon_number           AS вагон,
  sr.waybill_number         AS накладная,
  sr.date                   AS дата,
  sr.loading_volume         AS входящее,
  sr.shipment_volume        AS исходящее,
  CASE
    WHEN sr.loading_volume IS NOT NULL AND sr.shipment_volume IS NOT NULL
      THEN 'ПОЛНАЯ (оставить)'
    WHEN (sr.loading_volume IS NULL) <> (sr.shipment_volume IS NULL)
      THEN 'ЧАСТИЧНАЯ (удалить)'
    ELSE 'ПУСТАЯ (не тронем)'
  END                       AS вердикт,
  sr.id                     AS row_id,
  sr.created_at             AS создана
FROM shipment_registry sr
JOIN duplicate_groups dg
  ON dg.deal_id       = sr.deal_id
 AND dg.wagon_number  = sr.wagon_number
 AND dg.waybill_number = sr.waybill_number
LEFT JOIN deals d ON d.id = sr.deal_id
ORDER BY d.deal_code, sr.wagon_number, sr.waybill_number, sr.created_at;

-- ────────────────────────────────────────────────────────────────
-- PHASE 2 — DELETE частичных строк.
--
-- По правилу клиента: если в группе (deal_id, wagon, waybill) есть
-- полная строка И есть частичная — частичная удаляется. Групп без
-- полной строки не трогаем.
--
-- Раскомментируйте, удалив /* и */ вокруг блока, и запустите файл
-- ещё раз ПОСЛЕ того как посмотрели вывод Phase 1 и убедились что
-- список — то что вы хотите удалить.
-- ────────────────────────────────────────────────────────────────

-- ⇩⇩⇩ УДАЛИТЬ ЭТУ СТРОКУ + СТРОКУ /* внизу, ЧТОБЫ ВКЛЮЧИТЬ УДАЛЕНИЕ ⇩⇩⇩
/*

DO $$
DECLARE
  v_deleted INT;
BEGIN
  WITH duplicate_groups AS (
    SELECT deal_id, wagon_number, waybill_number
    FROM shipment_registry
    WHERE deal_id       IS NOT NULL
      AND wagon_number  IS NOT NULL
      AND waybill_number IS NOT NULL
    GROUP BY deal_id, wagon_number, waybill_number
    HAVING
        COUNT(*) FILTER (
          WHERE loading_volume IS NOT NULL AND shipment_volume IS NOT NULL
        ) >= 1
        AND COUNT(*) FILTER (
          WHERE (loading_volume IS NULL) <> (shipment_volume IS NULL)
        ) >= 1
  )
  DELETE FROM shipment_registry sr
  USING duplicate_groups dg
  WHERE sr.deal_id        = dg.deal_id
    AND sr.wagon_number   = dg.wagon_number
    AND sr.waybill_number = dg.waybill_number
    -- Только частичная строка: XOR по NULL-статусу двух объёмов.
    -- Полная (обе НЕ NULL) остаётся. Пустая (обе NULL) остаётся —
    -- по правилу клиента её не трогаем.
    AND (sr.loading_volume IS NULL) <> (sr.shipment_volume IS NULL);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Удалено частичных строк: %', v_deleted;
END $$;

*/
-- ⇧⇧⇧ УДАЛИТЬ СТРОКУ ВЫШЕ (*/) — ЧТОБЫ ВКЛЮЧИТЬ УДАЛЕНИЕ ⇧⇧⇧

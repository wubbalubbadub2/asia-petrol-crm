-- 00104_dedupe_registry_wagon_waybill.sql
--
-- Client 2026-07-03 (уточнение №2): «все колонки в реестре должны
-- быть одинаковыми чтобы это считалось дублем — даты и суммы тоже».
--
-- Точное правило (никаких других домыслов):
--
--   Ключ группы:  (deal_id, wagon_number, waybill_number, date)
--   Все четыре должны быть НЕ NULL.
--
--   Группа = ДУБЛЬ если в ней одновременно:
--     • ≥1 «полная»    строка — loading_volume НЕ NULL AND shipment_volume НЕ NULL
--     • ≥1 «частичная» строка — ровно один из двух объёмов NULL (XOR),
--       ПРИЧЁМ ненулевой объём частичной строки РАВЕН соответствующему
--       объёму полной строки. Если суммы отличаются — это разные
--       отгрузки, не дубль.
--
--   Что делаем: DELETE частичные с совпадающей суммой. Полные и любые
--   частичные с ДРУГОЙ суммой оставляем.
--
-- Что НЕ трогаем (легальные кейсы):
--   • Разные даты в одном (deal, wagon, waybill) — разные события.
--   • Разные суммы (например, полная=169.4, частичная=80.6 —
--     разные физические факты, случайно совпал вагон+накладная).
--   • Две частичные строки без полной (клиент намеренно разнёс
--     входящее и исходящее СНТ).
--   • Одна строка в группе.
--   • Строки с NULL в любом из ключей.
--
-- Structure — 2 фазы:
--
--   PHASE 1 — Preview. SELECT рядами, показывает по каждой строке-
--             кандидату её роль (ПОЛНАЯ / ЧАСТИЧНАЯ). Zero writes.
--
--   PHASE 2 — DELETE частичных строк. Wrapped in /* ... */ —
--             разкомментировать после проверки Phase 1.

-- ────────────────────────────────────────────────────────────────
-- PHASE 1 — PREVIEW.
-- ────────────────────────────────────────────────────────────────

WITH duplicate_groups AS (
  SELECT deal_id, wagon_number, waybill_number, date,
         MAX(loading_volume)  FILTER (WHERE loading_volume IS NOT NULL AND shipment_volume IS NOT NULL) AS full_loading,
         MAX(shipment_volume) FILTER (WHERE loading_volume IS NOT NULL AND shipment_volume IS NOT NULL) AS full_shipment
  FROM shipment_registry
  WHERE deal_id       IS NOT NULL
    AND wagon_number  IS NOT NULL
    AND waybill_number IS NOT NULL
    AND date          IS NOT NULL
  GROUP BY deal_id, wagon_number, waybill_number, date
  HAVING
    -- Требуем ХОТЯ БЫ ОДНУ полную строку.
    COUNT(*) FILTER (
      WHERE loading_volume IS NOT NULL AND shipment_volume IS NOT NULL
    ) >= 1
    -- И ХОТЯ БЫ ОДНУ частичную строку с совпадающей ненулевой суммой.
    -- Проверяем что найдётся partial где ненулевой объём равен полному.
    AND EXISTS (
      SELECT 1
      FROM shipment_registry sr2
      WHERE sr2.deal_id       = shipment_registry.deal_id
        AND sr2.wagon_number  = shipment_registry.wagon_number
        AND sr2.waybill_number = shipment_registry.waybill_number
        AND sr2.date          = shipment_registry.date
        AND (sr2.loading_volume IS NULL) <> (sr2.shipment_volume IS NULL)
    )
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
      -- Частичная удаляется ТОЛЬКО если её ненулевой объём совпадает
      -- с объёмом полной строки. Иначе оставляем — это разные события.
      AND (
        (sr.loading_volume IS NOT NULL AND sr.loading_volume = dg.full_loading)
        OR (sr.shipment_volume IS NOT NULL AND sr.shipment_volume = dg.full_shipment)
      )
      THEN 'ЧАСТИЧНАЯ (удалить)'
    ELSE 'ОСТАВИТЬ (сумма не совпадает или не относится к дублю)'
  END                       AS вердикт,
  sr.id                     AS row_id,
  sr.created_at             AS создана
FROM shipment_registry sr
JOIN duplicate_groups dg
  ON dg.deal_id       = sr.deal_id
 AND dg.wagon_number  = sr.wagon_number
 AND dg.waybill_number = sr.waybill_number
 AND dg.date          = sr.date
LEFT JOIN deals d ON d.id = sr.deal_id
ORDER BY d.deal_code, sr.wagon_number, sr.waybill_number, sr.date, sr.created_at;

-- ────────────────────────────────────────────────────────────────
-- PHASE 2 — DELETE.
--
-- Раскомментируйте после проверки Phase 1.
-- ────────────────────────────────────────────────────────────────

-- ⇩⇩⇩ УДАЛИТЬ ЭТУ СТРОКУ + СТРОКУ /* внизу, ЧТОБЫ ВКЛЮЧИТЬ УДАЛЕНИЕ ⇩⇩⇩
/*

DO $$
DECLARE
  v_deleted INT;
BEGIN
  WITH duplicate_groups AS (
    SELECT deal_id, wagon_number, waybill_number, date,
           MAX(loading_volume)  FILTER (WHERE loading_volume IS NOT NULL AND shipment_volume IS NOT NULL) AS full_loading,
           MAX(shipment_volume) FILTER (WHERE loading_volume IS NOT NULL AND shipment_volume IS NOT NULL) AS full_shipment
    FROM shipment_registry
    WHERE deal_id       IS NOT NULL
      AND wagon_number  IS NOT NULL
      AND waybill_number IS NOT NULL
      AND date          IS NOT NULL
    GROUP BY deal_id, wagon_number, waybill_number, date
    HAVING
      COUNT(*) FILTER (WHERE loading_volume IS NOT NULL AND shipment_volume IS NOT NULL) >= 1
  )
  DELETE FROM shipment_registry sr
  USING duplicate_groups dg
  WHERE sr.deal_id        = dg.deal_id
    AND sr.wagon_number   = dg.wagon_number
    AND sr.waybill_number = dg.waybill_number
    AND sr.date           = dg.date
    -- Только частичная строка (XOR по NULL у двух объёмов)
    AND (sr.loading_volume IS NULL) <> (sr.shipment_volume IS NULL)
    -- И её ненулевой объём должен совпадать с полной строкой.
    -- Если сумма отличается — это другое событие, не трогаем.
    AND (
      (sr.loading_volume IS NOT NULL AND sr.loading_volume = dg.full_loading)
      OR (sr.shipment_volume IS NOT NULL AND sr.shipment_volume = dg.full_shipment)
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Удалено частичных строк-дублей: %', v_deleted;
END $$;

*/
-- ⇧⇧⇧ УДАЛИТЬ СТРОКУ ВЫШЕ (*/) — ЧТОБЫ ВКЛЮЧИТЬ УДАЛЕНИЕ ⇧⇧⇧

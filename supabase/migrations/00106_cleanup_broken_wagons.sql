-- 00106_cleanup_broken_wagons.sql
--
-- Клиент 2026-07-08 показал сделку KZ/26/160 с 3 строками для 24.06,
-- из которых 2 корректных не были — там в `wagon_number` лежит
-- десятичное число (напр. "63,05"), а реальный номер вагона уехал
-- в `waybill_number`. Причина: bug в parseBulkWagons при висящем табе
-- на конце пасты (см. commit по фиксу парсера).
--
-- Такие строки узнаются по:
--   • wagon_number содержит "," или "."
--   • И НЕТ ни loading_volume, ни shipment_volume (чистый мусор,
--     не восстанавливаемая частичная строка).
--
-- Что делаем:
--   Phase 1 (SELECT) — preview всех подозрительных строк по всей БД.
--   Phase 2 (DELETE) — удаляем только те, у которых нет объёма
--                      (чистый мусор). Строки с caveat (запятая в
--                      wagon НО есть объём или waybill) оставляем
--                      для ручного разбора — их мало.
--
-- Запускать: скопировать Phase 1, посмотреть — если ок,
-- раскомментировать Phase 2 и запустить.

-- ────────────────────────────────────────────────────────────────
-- PHASE 1 — PREVIEW
-- ────────────────────────────────────────────────────────────────

SELECT
  d.deal_code                                  AS сделка,
  sr.date                                       AS дата,
  sr.wagon_number                               AS вагон_испорчен,
  sr.waybill_number                             AS накладная,
  sr.loading_volume                             AS вход,
  sr.shipment_volume                            AS исход,
  CASE
    WHEN sr.loading_volume IS NULL
     AND sr.shipment_volume IS NULL
      THEN 'УДАЛИТЬ (чистый мусор)'
    ELSE 'ОСТАВИТЬ (есть объём, ручная проверка)'
  END                                           AS вердикт,
  sr.id                                         AS row_id,
  sr.created_at                                 AS создана
FROM shipment_registry sr
LEFT JOIN deals d ON d.id = sr.deal_id
WHERE sr.wagon_number IS NOT NULL
  AND sr.wagon_number ~ '[,\.]'
ORDER BY d.deal_code, sr.date, sr.created_at;

-- ────────────────────────────────────────────────────────────────
-- PHASE 2 — DELETE (раскомментировать после проверки Phase 1)
-- ────────────────────────────────────────────────────────────────

/*

DO $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM shipment_registry
  WHERE wagon_number IS NOT NULL
    AND wagon_number ~ '[,\.]'
    AND loading_volume IS NULL
    AND shipment_volume IS NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Удалено мусорных строк (wagon с запятой, объём NULL): %', v_deleted;
END $$;

*/

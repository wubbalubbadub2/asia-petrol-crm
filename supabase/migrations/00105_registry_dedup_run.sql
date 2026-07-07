-- 00105_registry_dedup_run.sql
--
-- Follow-up к 00104. Клиент 2026-07-07 показал что в KG/26/036
-- (и в других сделках) до сих пор задвоенные строки:
--   • Импорт СНТ создал 6 строк {loading=X, shipment=NULL}.
--   • Импорт ЭСФ создал ещё 6 строк {loading=X, shipment=X}.
-- Обе партии — одна и та же (deal, wagon, waybill, date, loading).
--
-- Причина живучести дублей: 00104 корректно их описывал, но Phase 2
-- (сам DELETE) был обёрнут в /* ... */ и никогда не выполнялся.
-- Этот файл — Phase 2 в чистом виде, без preview и без комментариев.
-- Копипастнуть в Supabase SQL Editor и Run.
--
-- Правило удаления (строгое, подтверждённое клиентом):
--   Ключ группы = (deal_id, wagon_number, waybill_number, date),
--   все четыре NOT NULL.
--   В группе есть ≥1 «полная» строка (оба объёма не NULL).
--   Удаляем «частичные» строки (XOR-NULL по объёмам), у которых
--   ненулевой объём совпадает с соответствующим объёмом полной.
--
-- Что НЕ трогается:
--   • Разные даты в одном (deal, wagon, waybill).
--   • Суммы отличаются (partial=X, full=Y, X≠Y).
--   • Две частичные без полной.
--   • Одиночные строки.
--   • Строки с NULL в любом из ключей.

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
    HAVING COUNT(*) FILTER (WHERE loading_volume IS NOT NULL AND shipment_volume IS NOT NULL) >= 1
  )
  DELETE FROM shipment_registry sr
  USING duplicate_groups dg
  WHERE sr.deal_id        = dg.deal_id
    AND sr.wagon_number   = dg.wagon_number
    AND sr.waybill_number = dg.waybill_number
    AND sr.date           = dg.date
    AND (sr.loading_volume IS NULL) <> (sr.shipment_volume IS NULL)
    AND (
      (sr.loading_volume IS NOT NULL AND sr.loading_volume = dg.full_loading)
      OR (sr.shipment_volume IS NOT NULL AND sr.shipment_volume = dg.full_shipment)
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Удалено частичных строк-дублей: %', v_deleted;
END $$;

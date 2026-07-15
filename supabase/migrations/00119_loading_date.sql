-- 00119_loading_date.sql
--
-- Клиент 2026-07-15: «давай в реестре разделим даты входящего и
-- исходящего СНТ. У каждого будет своя колонка с датой».
--
-- До сих пор у строки реестра была одна дата (`date`, «дата отгр.»).
-- Клиент ранее подтвердил (2026-07-16, KG/26/487): существующие даты
-- в основном относятся к ИСХОДЯЩЕМУ СНТ. Поэтому:
--   • `date` остаётся датой исходящего СНТ (semantics не меняется —
--     на ней сидит resolve_shipment_year_month, autoprice shipment_date
--     и сортировка);
--   • новая колонка `loading_date` — дата входящего СНТ.
--
-- Backfill: строкам с заполненным входящим СНТ (loading_volume)
-- копируем дату — до сих пор одна дата обслуживала обе стороны, и
-- в detail-экспорте она уже показывалась как «Дата вход. СНТ» при
-- наличии тоннажа. Пустой налив → loading_date остаётся NULL.

ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS loading_date DATE;

COMMENT ON COLUMN shipment_registry.loading_date IS
  'Дата входящего СНТ (клиент 2026-07-15). `date` — дата исходящего СНТ.';

-- Backfill тихий: audit (толстые JSONB-снимки ~7000 строк) и activity
-- (никаких видимых пользователю изменений) глушим на время UPDATE.
-- Rollup-триггеры guarded (00116) — no-op, оставляем включёнными.
ALTER TABLE shipment_registry DISABLE TRIGGER trg_audit_shipment_registry;
ALTER TABLE shipment_registry DISABLE TRIGGER trg_shipment_registry_activity;

UPDATE shipment_registry
   SET loading_date = date
 WHERE loading_date IS NULL
   AND loading_volume IS NOT NULL
   AND date IS NOT NULL;

ALTER TABLE shipment_registry ENABLE TRIGGER trg_audit_shipment_registry;
ALTER TABLE shipment_registry ENABLE TRIGGER trg_shipment_registry_activity;

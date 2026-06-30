-- 00103_renumber_kg_26_454_to_445.sql
--
-- One-off data fix. Client request 2026-06-30 после инцидента Supabase
-- (auth/postgres timeouts утром). Во время сбоя generate_deal_number
-- успел сдвинуться на 10 шагов, пока пользователи безуспешно пытались
-- сохранить сделки — KG/26/444 → KG/26/454, а между ними 9 «пустых»
-- номеров (445–453). Оператор подтвердил, что по KG/26/454 ещё нет
-- внешних документов / выгрузки в 1С, можно переименовать в 445.
--
-- Что делаем:
--   1. UPDATE deals.deal_number 454 → 445. Триггер trg_deals_code
--      (00039) автоматически пересчитает deal_code в 'KG/26/445'.
--   2. UPDATE deal_sequences.last_number = 445. Следующая
--      generate_deal_number вернёт 446 — нумерация продолжится плотно.
--
-- Безопасность:
--   • shipment_registry / deal_shipment_prices / deal_*_lines /
--     deal_activity связаны с сделкой по deal_id (UUID), не по
--     deal_code. Переименование номера не ломает связи.
--   • UNIQUE(deal_type, deal_number, year) — 445 свободен.
--   • Активити-лог сделки (00088 log_deal_field_changes) запишет
--     «deal_number 454 → 445» в ленту — это и есть наш аудит-след.

-- 1. Renumber the deal. deal_code будет пересчитан BEFORE-UPDATE
--    триггером trg_deals_code → 'KG/26/445'.
UPDATE deals
SET deal_number = 445
WHERE deal_type = 'KG'
  AND year       = 2026
  AND deal_number = 454;

-- 2. Откатить счётчик к 445. Следующая аллокация вернёт 446.
UPDATE deal_sequences
SET last_number = 445
WHERE deal_type = 'KG'
  AND year       = 2026;

-- 3. Sanity checks.
DO $$
DECLARE
  v_code TEXT;
  v_seq  INT;
BEGIN
  SELECT deal_code INTO v_code FROM deals
  WHERE deal_type='KG' AND year=2026 AND deal_number=445;
  IF v_code IS DISTINCT FROM 'KG/26/445' THEN
    RAISE EXCEPTION 'expected KG/26/445, got %', v_code;
  END IF;

  IF EXISTS (SELECT 1 FROM deals
             WHERE deal_type='KG' AND year=2026 AND deal_number=454) THEN
    RAISE EXCEPTION 'KG/26/454 still exists after rename';
  END IF;

  SELECT last_number INTO v_seq FROM deal_sequences
  WHERE deal_type='KG' AND year=2026;
  IF v_seq <> 445 THEN
    RAISE EXCEPTION 'deal_sequences.last_number expected 445, got %', v_seq;
  END IF;
END $$;

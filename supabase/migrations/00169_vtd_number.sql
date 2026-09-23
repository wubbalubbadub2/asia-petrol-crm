-- 00169_vtd_number.sql
--
-- Клиент 2026-09-23: «ВТД — нужно добавить сюда же в реестр отгрузки KG,
-- столбец по ВТД вставить в паспорте в раздел поставщик между столбцами
-- Взаимозачет и Баланс, добавить фильтр по ВТД».
--
-- Уточнено с владельцем продукта 2026-09-23:
--   • ВТД — НОМЕР ДОКУМЕНТА у отгрузки, как «№ ЖД накл.» или «№ СФ»:
--     текст, вписывает логист по вагону. Не деньги, в балансах и суммах
--     не участвует.
--   • В паспорте колонка СОБИРАЕТСЯ С ОТГРУЗОК сделки, своего поля у
--     сделки нет.
--
-- ЧТО ДОБАВЛЯЕТСЯ:
--   • shipment_registry.vtd_number — сам номер, по строке;
--   • deals.vtd_numbers — свод по сделке: различные номера её отгрузок,
--     по алфавиту, через запятую. Это РОЛЛАП, руками не заполняется.
--     Нужен, чтобы паспорт и фильтр не ходили за строками реестра по
--     каждой сделке: их там сотни на экране.
--
-- Денег не касается: ни одной формулы, ни одного пересчёта сумм. Роллап
-- обновляется тем же приёмом, что и остальные своды реестра (00112,
-- 00150): AFTER-триггер на shipment_registry пересчитывает одну сделку,
-- при переносе строки — обе.

ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS vtd_number TEXT;

COMMENT ON COLUMN shipment_registry.vtd_number IS
  'ВТД — номер документа по вагону (текст, вводит логист). Клиент 2026-09-23. В деньгах не участвует; свод по сделке — deals.vtd_numbers.';

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS vtd_numbers TEXT;

COMMENT ON COLUMN deals.vtd_numbers IS
  'Роллап: различные ВТД отгрузок сделки, по алфавиту, через запятую. Только для показа в паспорте и фильтра; руками не заполняется (00169).';

-- ── Пересчёт свода по одной сделке ───────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_deal_vtd_numbers(p_deal_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER AS $fn$
  UPDATE deals d
     SET vtd_numbers = NULLIF((
       SELECT string_agg(v, ', ' ORDER BY v)
         FROM (
           SELECT DISTINCT btrim(sr.vtd_number) AS v
             FROM shipment_registry sr
            WHERE sr.deal_id = p_deal_id
              AND btrim(COALESCE(sr.vtd_number, '')) <> ''
         ) s
     ), '')
   WHERE d.id = p_deal_id
     AND d.vtd_numbers IS DISTINCT FROM NULLIF((
       SELECT string_agg(v, ', ' ORDER BY v)
         FROM (
           SELECT DISTINCT btrim(sr.vtd_number) AS v
             FROM shipment_registry sr
            WHERE sr.deal_id = p_deal_id
              AND btrim(COALESCE(sr.vtd_number, '')) <> ''
         ) s
     ), '');
$fn$;

CREATE OR REPLACE FUNCTION refresh_deal_vtd_numbers_trg()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_deal_vtd_numbers(OLD.deal_id);
    RETURN OLD;
  END IF;

  PERFORM refresh_deal_vtd_numbers(NEW.deal_id);
  -- Строку могли перенести в другую сделку — старую тоже пересчитываем.
  IF TG_OP = 'UPDATE' AND OLD.deal_id IS DISTINCT FROM NEW.deal_id THEN
    PERFORM refresh_deal_vtd_numbers(OLD.deal_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deal_vtd_numbers_ins ON shipment_registry;
CREATE TRIGGER trg_deal_vtd_numbers_ins
  AFTER INSERT OR DELETE ON shipment_registry
  FOR EACH ROW EXECUTE FUNCTION refresh_deal_vtd_numbers_trg();

-- На UPDATE — только когда поменялся сам номер или сделка строки.
DROP TRIGGER IF EXISTS trg_deal_vtd_numbers_upd ON shipment_registry;
CREATE TRIGGER trg_deal_vtd_numbers_upd
  AFTER UPDATE ON shipment_registry
  FOR EACH ROW
  WHEN (NEW.vtd_number IS DISTINCT FROM OLD.vtd_number
        OR NEW.deal_id IS DISTINCT FROM OLD.deal_id)
  EXECUTE FUNCTION refresh_deal_vtd_numbers_trg();

-- ── Первичное заполнение ─────────────────────────────────────────────
-- Колонка только что появилась, поэтому номеров ещё нет ни у одной
-- строки и свод везде пустой. Проход оставлен намеренно: он делает
-- миграцию идемпотентной и защищает от случая, когда номера зальют
-- отдельным запросом до применения триггеров.
DO $$
DECLARE
  v_deals INT := 0;
BEGIN
  PERFORM refresh_deal_vtd_numbers(d.id)
     FROM deals d
    WHERE EXISTS (
      SELECT 1 FROM shipment_registry sr
       WHERE sr.deal_id = d.id AND btrim(COALESCE(sr.vtd_number, '')) <> ''
    );
  SELECT count(*) INTO v_deals FROM deals WHERE vtd_numbers IS NOT NULL;
  RAISE NOTICE 'сделок со сводом ВТД: %', v_deals;
END $$;

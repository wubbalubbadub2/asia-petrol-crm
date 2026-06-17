-- Производительность списка сделок (perf-аудит 2026-06-17).
--
-- Узкое место /deals: запрос
--     SELECT ... FROM deals
--     WHERE deal_type=$1 AND year=$2
--       AND (is_draft IS NULL OR is_draft = false)
--     ORDER BY deal_number
-- использует одностолбцовые индексы idx_deals_type / idx_deals_year +
-- bitmap-OR + filesort. На больших таблицах это сотни мс на стороне
-- PG.
--
-- Делаем два изменения:
--   1) бэкфилл is_draft NULL → false + NOT NULL DEFAULT false. Это
--      превращает «is_draft IS NULL OR is_draft = false» в простой
--      «is_draft = false», который индекс может покрыть.
--   2) compound partial index по (deal_type, year, deal_number) для
--      не-архивных не-черновиков. План становится Index Scan без
--      сортировки.

ALTER TABLE deals
  ALTER COLUMN is_draft SET DEFAULT false;

UPDATE deals SET is_draft = false WHERE is_draft IS NULL;

ALTER TABLE deals
  ALTER COLUMN is_draft SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deals_list_path
  ON deals(deal_type, year, deal_number)
  WHERE is_archived = false AND is_draft = false;

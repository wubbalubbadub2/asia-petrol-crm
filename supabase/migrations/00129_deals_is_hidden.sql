-- 00129: add `is_hidden` flag to deals.
--
-- Client request (2026-07-24): allow manually hiding unwanted deals in the
-- passport. This is a separate concept from `is_archived`, which drives its own
-- archive workflow/page; `is_hidden` is a lightweight manual toggle. The UI that
-- reads this column is implemented separately.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

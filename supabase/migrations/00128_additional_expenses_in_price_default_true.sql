-- 00128: default `additional_expenses_in_price` to TRUE for new deals.
--
-- Client request (2026-07-24): the "Грузоотправитель в цене" flag should
-- default ON so грузоотправитель always adds to the balance; it is unchecked
-- only in the rare cases where it should NOT be added. Previously the column
-- defaulted to FALSE, forcing users to remember to enable it on every deal.
--
-- Only the default for future inserts changes. Existing rows are intentionally
-- left untouched (no UPDATE) so historical/manual choices are preserved.

ALTER TABLE deals ALTER COLUMN additional_expenses_in_price SET DEFAULT TRUE;

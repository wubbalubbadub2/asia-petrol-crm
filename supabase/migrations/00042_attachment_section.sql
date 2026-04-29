-- Split deal attachments by section. Until now the deal page had a single
-- documents block; the client wants a separate attachments block under
-- Поставщик / Покупатель / Цепочка компании / Логистика so each side has
-- its own contracts/appendices/etc.
--
-- `category` keeps meaning "тип документа" (Договор, СНТ, ЭСФ, Заявка…).
-- The new `section` column is the orthogonal axis: which part of the deal.

ALTER TABLE deal_attachments
  ADD COLUMN section TEXT
    CHECK (section IS NULL OR section IN ('supplier','buyer','company_chain','logistics'));

-- Backfill any pre-existing rows. The new UI only renders four sections —
-- a NULL section would make legacy files invisible. Default to 'supplier'
-- as a safe assumption (договор поставщика is the most common первый upload).
-- If the assignment is wrong for a particular row, an admin can reassign
-- via direct SQL or a future "переместить в раздел" action.
UPDATE deal_attachments SET section = 'supplier' WHERE section IS NULL;

CREATE INDEX idx_deal_attachments_section ON deal_attachments (deal_id, section);

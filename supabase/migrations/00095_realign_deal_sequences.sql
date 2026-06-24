-- 00095_realign_deal_sequences.sql
--
-- The deal_sequences.last_number counter drifts away from the actual
-- MAX(deal_number) over time because every draft deal (is_draft=true)
-- increments the sequence on creation and then gets deleted when the
-- operator abandons the form. Operator screenshot 2026-06-24: KZ/2026
-- list ends at KZ/26/206 but a new deal opened as KZ/26/341. Same
-- gap on KG.
--
-- Fix: realign every (deal_type, year) pair to the max actual deal
-- number (excluding drafts — they don't represent real bookings).
-- Drafts that were never saved are also deleted as a side cleanup so
-- the next allocation can reuse those numbers if needed. Existing
-- saved deals retain their numbers — no renumbering.

-- 1. Clear abandoned drafts. They never made it to the list view and
--    were holding sequence slots.
DELETE FROM deals
WHERE COALESCE(is_draft, FALSE) = TRUE
  AND created_at < NOW() - INTERVAL '1 hour';

-- 2. Realign sequence counters to the max real deal number per
--    (deal_type, year). COALESCE handles the case where a (type, year)
--    has no deals — sequence resets to 0 so next allocation is 1.
UPDATE deal_sequences ds
SET last_number = COALESCE((
  SELECT MAX(deal_number)
  FROM deals d
  WHERE d.deal_type = ds.deal_type
    AND d.year = ds.year
    AND COALESCE(d.is_draft, FALSE) = FALSE
), 0);

-- 3. Insert any missing (deal_type, year) rows. If a deal exists for
--    a combination that has no sequence row, generate_deal_number()
--    would mis-allocate. Add the row with last_number = MAX(deal_number).
INSERT INTO deal_sequences (deal_type, year, last_number)
SELECT d.deal_type, d.year, MAX(d.deal_number)
FROM deals d
WHERE COALESCE(d.is_draft, FALSE) = FALSE
GROUP BY d.deal_type, d.year
ON CONFLICT (deal_type, year) DO NOTHING;

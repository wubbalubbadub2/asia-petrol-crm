-- Per-group currency on the deal's company chain.
--
-- Each link in the company chain can be billed in its own currency
-- (e.g. supplier in USD, middle company in KZT, end buyer in KGS).
-- Until now we displayed every group's price suffixed with the
-- supplier-side currency symbol, which is wrong when the link
-- diverges. New nullable column `currency` lets the manager pick the
-- currency for that specific link; NULL means «inherit from supplier»
-- which keeps existing rows visually unchanged.

ALTER TABLE deal_company_groups
  ADD COLUMN IF NOT EXISTS currency TEXT;

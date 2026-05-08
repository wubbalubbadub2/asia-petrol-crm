-- Wipe dangling deal_attachments rows.
--
-- The storage bucket `deal-attachments` had no INSERT policy on
-- storage.objects until 2026-05-08, so EVERY upload from the browser
-- was silently rejected with 403/RLS. handleUpload logged the warning
-- but still inserted the DB row, which caused the UI to show files
-- that did not exist. Confirmed by direct Supabase Storage inspection:
-- the bucket is empty, but `deal_attachments` had hundreds of rows.
--
-- Now that the policies are in place and handleUpload no longer
-- creates an orphan row on storage failure, clear the table so users
-- start from a clean slate. They will re-upload via the existing UI.
--
-- This is destructive but contained: every row in this table points at
-- a non-existent storage object, so the rows have zero recoverable
-- data. The original file metadata (file_name, category, uploaded_at)
-- is also lost — but it referred to files that the user never
-- successfully attached.

DELETE FROM deal_attachments;

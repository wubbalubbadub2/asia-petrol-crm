-- Bootstrap an admin so /settings/users is reachable for the first time.
-- The user-management UI (admin createUser, role updates, password reset)
-- requires `profiles.role = 'admin'` at the server-action guard
-- (requireAdmin() in src/app/(dashboard)/settings/users/actions.ts). Without
-- at least one admin, there is no in-app path to grant the first admin role.
--
-- Idempotent: if the profile doesn't exist yet (user hasn't signed up) or is
-- already admin, this is a no-op. Re-running the migration is safe.

UPDATE profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'shynggys.islam@gmail.com')
  AND role IS DISTINCT FROM 'admin';

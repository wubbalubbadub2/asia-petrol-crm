---
name: project-verify
description: Verify a completed change in this repository before claiming success, committing, or opening a pull request. Use after features, bug fixes, refactors, migrations, financial changes, or integration work.
---

# Project verification

Do not edit merely to make a check green until you understand the failure.

1. Inspect:
   - `git status --short`
   - `git diff --stat`
   - `git diff`
2. State the intended behavior and map changed files to it.
3. Run the narrowest relevant tests first.
4. Run:
   - `npm run lint`
   - `npm test`
   - `npm run typecheck`
   - `npm run build`
5. If `supabase/`, RLS, triggers, migrations, calculations, balances, or generated database types changed:
   - apply all migrations to a disposable local database using the repository's CI procedure
   - run `./supabase/tests/run.sh`
6. If a critical user flow changed and credentials/environment are available, run the relevant Playwright test.
7. Re-read the diff after automated formatting or generated-file changes.
8. Report:
   - exact commands
   - pass/fail/skip
   - skipped checks and why
   - unresolved risk
   - whether the change is safe to commit or open as a PR

Never say "done," "fixed," or "verified" when a required check failed or was not run.

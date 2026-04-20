# Database tests

These tests assert that triggers, functions, and RLS policies behave
correctly. Written as plain PL/pgSQL scripts — no extensions required.
Each `.test.sql` file is self-contained: it sets up its own fixtures,
performs the operation under test, raises a clean exception on failure,
and cleans up after itself.

## Running locally

Point `DATABASE_URL` at any Postgres with all migrations applied
(easiest: the Supabase CLI shadow database):

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres" \
  ./supabase/tests/run.sh
```

The runner executes every `*.test.sql` in this directory. First error
fails the whole suite (non-zero exit).

## Writing a new test

1. Create `NN_short_name.test.sql` (numeric prefix keeps order stable).
2. Wrap each case in a `DO $$ ... $$` block so assertions that fail
   raise immediately.
3. Use `PERFORM` for setup statements you don't care about the result of.
4. End every block with `ROLLBACK`-safe cleanup (we wrap the whole file
   in a transaction, so you usually don't need explicit cleanup).

## Why not pgTAP?

pgTAP is the industry standard but adds a build-time extension
dependency and requires `pg_prove` in CI. DO blocks with
`RAISE EXCEPTION` catch the same bugs with zero extra tooling. If we
ever need TAP-formatted output, pgTAP is a drop-in upgrade.

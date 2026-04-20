#!/usr/bin/env bash
# Run every *.test.sql in this directory against $DATABASE_URL.
# First failure aborts the whole suite with non-zero exit.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set. Example:" >&2
  echo "  export DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres'" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Tests run without an authenticated user (auth.uid() returns NULL in CI),
# so RLS policies that require is_writable_role() would reject every
# insert. Disable row security for the test session — this matches the
# intent: we're asserting trigger/constraint behaviour, not RLS.
# Separate test files cover the RLS policy matrix (future Phase 1.4).
export PGOPTIONS="-c row_security=off"

fail=0
for f in "$here"/*.test.sql; do
  name="$(basename "$f")"
  printf "\e[36m▶ %s\e[0m\n" "$name"
  if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" > /dev/null; then
    printf "\e[31m✗ %s FAILED\e[0m\n" "$name"
    fail=1
    break
  fi
  printf "\e[32m✓ %s passed\e[0m\n" "$name"
done

if [[ $fail -ne 0 ]]; then
  exit 1
fi

echo "All DB tests passed."

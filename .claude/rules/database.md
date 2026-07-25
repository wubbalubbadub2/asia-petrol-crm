---
paths:
  - "supabase/**"
  - "src/lib/supabase/**"
  - "src/lib/hooks/**"
  - "src/lib/types/database.ts"
---

# Database and Supabase rules

- Read the relevant `ARCHITECTURE.md` and `AS-BUILT-SUPABASE-DEPENDENCIES.md` sections first.
- Treat RLS as the authorization boundary. New tables need SELECT/INSERT/UPDATE/DELETE policies consistent with roles.
- Migrations are immutable and append-only. Determine the current highest migration number before creating the next one.
- Keep financial rollups and derived truth in PostgreSQL when concurrency or multiple clients can affect correctness.
- Make migrations idempotent only when that matches the repository convention; do not hide partial-application errors.
- Consider existing rows, nullability, backfill cost, constraints, indexes, trigger recursion, delete behavior, and rollback/recovery.
- Update generated types and every affected select/insert/update path.
- Run the migration sequence and database test suite before completion.

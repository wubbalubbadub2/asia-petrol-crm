# scripts/migration

Migration tooling for **Old System → New System** (see `docs/MIGRATION-PLAN.md`).
Lives inside the current repo for now; will move to the new repo later.

## `profile.sql` + `profile.ts` — Pre-M2 profiling (the gate, §1)

Read-only profiler that answers all 10 profiling questions from
`MIGRATION-PLAN.md §1`, each with **counts** and **up to 20 sample rows**, and
writes one markdown report to `docs/reports/profiling-<date>.md`.

- **`profile.sql`** — the single source of truth for every query, as tagged
  read-only blocks (`-- @block q<N>.<kind>.<slug> | <title>`). `kind` ∈
  `count | sample | assert | note | meta`.
- **`profile.ts`** — parses the blocks, enforces read-only, executes against a
  copy, masks counterparty names, and renders the report.

### Hard rules enforced

1. **Strictly read-only.** Every block must start with `SELECT`/`WITH` (static
   check) and everything runs inside a single `READ ONLY` transaction —
   PostgreSQL rejects any INSERT/UPDATE/DELETE/DDL. Per-block `SAVEPOINT`s isolate
   failures so a schema mismatch is *reported*, not fatal.
2. **Copy only, never live production.** Refuses to run unless
   `PROFILE_TARGET_IS_COPY=true`. Point it at a `pg_dump`-restored copy.
3. **Connection string via env var**, never committed (`.env` is git-ignored).
4. **Masking.** Counts are exact and unmasked. In sample rows, counterparty
   identities are replaced with `C-001, C-002, …` (stable within a report).
   Nothing else is anonymized.
5. **Discrepancies, not guesses.** If a question can't be answered because the
   copy's schema differs from AS-BUILT expectations (e.g. missing `auth`/`storage`
   schema, no stored-converted money columns), the report says so explicitly.

### Run

```bash
# 1. Restore a production copy somewhere disposable (pg_dump → restore).
# 2. Configure the connection:
cp scripts/migration/.env.example scripts/migration/.env
#    edit .env: set PROFILE_DATABASE_URL and PROFILE_TARGET_IS_COPY=true
# 3. Install tooling deps (once):
npm install
# 4. Profile:
npm run profile:migration
#    → docs/reports/profiling-<YYYY-MM-DD>.md
```

### What each question covers

| Q | Topic | Key source columns |
|---|---|---|
| 1 | Quotation shape | `quotations.price*`, `quotation_monthly_averages.avg_*` |
| 2 | Pricing lines | `deal_*_lines.is_default / price_condition / calc_mode / price_source`, scalar `deals.*_price*` |
| 3 | Natural keys | `shipment_registry.wagon_number / waybill_number / date` |
| 4 | Money | currency columns; `deal_payments.currency` vs side currency; negatives; stored-converted check |
| 5 | Dates | out-of-range dates (2020–2030) per column; null event dates on money rows |
| 6 | Payment TEXT dates | `deals.supplier_payment_date / buyer_payment_date` (TEXT) vs `deal_payments` |
| 7 | Audit | null actors; the 00097/00098 doubled-totals burst (2026-06-24 16:23–16:24Z) |
| 8 | Flags | `additional_expenses_in_price`, `railway_in_price`, `is_hidden`, override flags |
| 9 | Users | `auth.users` bcrypt census, activity; `profiles.role` distribution |
| 10 | Volumes | row counts per table; attachments MB (`deal_attachments`, `storage.objects`) |

Findings feed the transform rules (§3) and the expected-divergence ledger (§5).

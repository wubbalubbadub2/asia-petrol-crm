---
paths:
  - "src/lib/calculations/**"
  - "src/components/deals/**"
  - "src/components/registry/**"
  - "src/app/**/deals/**"
  - "src/app/**/registry/**"
  - "src/app/**/dt-kt/**"
  - "src/app/api/export/**"
  - "supabase/migrations/**"
---

# Finance and logistics rules

For every calculation or workflow change, write down before coding:

1. Business event that triggers the calculation.
2. Authoritative source fields and tables.
3. Formula and sign convention.
4. Currency, unit, rounding, and date basis.
5. Null, missing, duplicate, reversal, correction, and deletion behavior.
6. Historical-data and backfill behavior.
7. Acceptance scenarios with concrete numbers.

Never use a UI display formula as the source of truth for balances. Verify supplier and buyer sign conventions independently. Add at least one normal case, boundary case, and correction/reversal regression test.

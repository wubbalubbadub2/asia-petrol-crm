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

## Test inventory (as of 2026-04-20 qa-audit sweep)

| # | File | Covers |
|---|---|---|
| 01 | `derived_fields` | `compute_deal_derived_fields` (mig 00021): contracted amount, balance, debt, remaining, preliminary amount |
| 02 | `registry_rollup` | Registry → deal rollup + `CEIL(vol) × tariff` invoice amount (mig 00011, 00027, 00031) |
| 03 | `pricing_rollup` | `deal_shipment_prices` → deal shipped amounts (mig 00030) |
| 04 | `audit_log` | `audit_trigger` per-row change logging, updated_at-only noise filter (mig 00036) |
| 05 | `payment_rollup_currency` | `refresh_deal_payment_totals` currency filtering + deal currency flip (mig 00028, 00040) |
| 06 | `deal_code_format` | `compute_deal_code` TYPE/YY/NNN formatting + 4-digit lpad-truncation ceiling (mig 00039) |
| 07 | `rls_matrix` | Admin/manager/readonly policy matrix + archive-protection carve-out (mig 00010) |
| 08 | `registry_autoprice` | Shipment insert → auto-spawned `deal_shipment_prices`, volume/date propagation, CASCADE delete (mig 00037) |
| 09 | `deal_number_sequence` | `generate_deal_number` monotonic per-(type, year) counter (mig 00011) |

## Bugs surfaced during this sweep

- **[fixed in mig 00041]** `refresh_deal_shipment_totals` and `refresh_deal_esf_totals` didn't zero their rolled-up totals when the last source row for a deal was deleted (same shape as the already-fixed payment/price rollups from migs 00028/00030).
- **[documented, open]** `LPAD(deal_number::text, 3, '0')` truncates the fourth digit — silent collision past 999 deals/year for one deal_type. Not a problem at current volumes; raise to 4 digits before it matters.
- **[documented, open]** `refresh_deal_shipment_totals` and `refresh_deal_esf_totals` both write to `invoice_amount` / `invoice_volume`. The trigger-firing order decides which wins. Needs a focused PR to pick an authoritative source.
- **[documented, open]** `dt_kt_logistics.payment` is a plain column; there's no trigger summing `dt_kt_payments` into it. Manual edits and child-payment inserts can diverge.
- **[documented, open]** Archive protection on `deals` doesn't cascade: child-table policies (`deal_payments`, `shipment_registry`, `deal_shipment_prices`, …) only check `is_writable_role()`, so a manager can still insert rows under an archived deal. See the last DO block of `07_rls_matrix` for the assertion that documents this.

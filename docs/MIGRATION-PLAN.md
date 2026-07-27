# MIGRATION-PLAN.md — Old System → New System

Governs everything under `scripts/migration/` and the M8/M9 milestones. Strategy:
**rehearsed migration** — profiled early, mapped completely, rehearsed on production
copies at every milestone from M3, executed at cutover as a routine. Nothing is
discovered at M8.

Source of truth for the old schema: AS-BUILT-DATA/LOGIC + DELTA + CHANGELOG (through
the freeze). Target: DATA-MODEL.md. Old UUID primary keys are **preserved** so
cross-references and the event baseline stay traceable.

---

## 1. Pre-M2 profiling (the gate)

A read-only script (`scripts/migration/profile.sql` + `profile.ts`) run against a
production copy. No writes. Output: one markdown report committed to `/docs/reports/`.
It must answer, with counts and samples:

1. **Quotation shape** — distinct per-basis columns actually populated per product
   type; rows where «Среднее» was stored vs derivable; null distribution per column.
2. **Pricing lines** — deals with 0 / 1 / >1 default variants per side; scalar-vs-
   default-line divergence census (the dual-write drift the triggers were hiding);
   legacy price_mode value distribution (incl. «manual», dead enums).
3. **Natural keys** — wagon/waybill formatting census: leading zeros, spaces,
   punctuation, Cyrillic/Latin mixes; duplicate (deal, wagon, waybill, date) groups
   surviving after 00104–05; null key components.
4. **Money** — currency census per table; payments whose currency ≠ side currency
   (the R-CUR-3 silently-dropped set — these become included after migration);
   negative amounts by kind; rows whose stored converted values disagree with
   recomputation from fx_rates (divergence ledger input).
5. **Dates** — outliers outside 2020–2030 per table (the year-226 class), null
   event dates on money rows.
6. **Payment TEXT dates** — confirm the 8-of-792 census; any rows where TEXT dates
   disagree with deal_payments.
7. **Audit** — events with null actor; the 00097/00098 doubled-totals window rows.
8. **Flags** — additional_expenses_in_price true/false distribution (feeds the open
   client question); railway_in_price distribution; override flags census.
9. **Users** — hash algorithm check (bcrypt portability), active accounts, role
   distribution vs v1 capability seeds.
10. **Volumes** — row counts per table vs the AS-BUILT baseline (drift since
    extraction), attachment count + total MB in Supabase storage.

Findings feed two artifacts: the **transform rules** below (amended if reality
disagrees) and the **expected-divergence ledger** (§5).

## 2. Mapping (old → new)

| Old | New | Notes |
|---|---|---|
| `deals` (≈90 scalars) | `deal` + `deal_side`×2 + `logistics_terms` + config refs | identity/lifecycle/product → deal; per-side commercial fields → deal_side; Логистика block → logistics_terms |
| `deal_supplier_lines` / `deal_buyer_lines` | `pricing_variant` | side discriminator; **variants are the truth** — scalar price fields are dropped; if profiling shows scalar≠default-line, the LINE wins and the divergence is logged |
| `deal_company_groups` | `chain_position` (+ `group_entity` refs) | position order kept; prices → MoneyNative `[confidential]` |
| `shipment_registry` | `shipment` | canonical-key normalization applied; source=manual; import linkage where batch info survives |
| `deal_payments` | `payment` | kinds mapped; mismatched-currency payments now INCLUDED (divergence ledger); TEXT date fields dropped |
| `quotations` (wide) | `quotation` per (type, date) | each populated basis column → its series; «Среднее» NOT migrated — recomputed |
| `quotation_product_types` | same + currency/unit (default USD/t) | |
| `fx_rates` | `fx_rate` | source: cron rows → nbrk, выгрузка rows → 1c, hand rows → manual |
| `tariffs` | `tariff` | pre-00117 manual values arrive as book values (accepted, documented) |
| `dt_kt_logistics` / `dt_kt_payments` | same shape | parent payment recomputed, not copied |
| `applications`, SNT/ESF, surcharges, consignees (empty) | fresh tables | no data movement |
| `audit_log` + `deal_activity` | `event` | best-effort mapping; null actors → `system:legacy`; **plus one baseline snapshot event per migrated aggregate** (deal, shipment set, payment set) so post-migration state is event-reconstructible (U21) |
| Supabase Auth users | `user` | bcrypt hashes ported; verify with profiling #9; fallback = one-time reset for failures |
| Supabase Storage objects | MinIO | same key layout under `deals/{id}/...`; checksum verify |

## 3. Transform rules

- **Lifecycle**: `is_draft=true → draft`; `archived=true → archived`; else `active`.
  No deal is auto-closed/fulfilled at migration — the evaluator runs after load and
  *suggests*; humans confirm post-cutover.
- **Numbering**: `deal_number_counter` seeded to MAX(number) per (type, year).
- **Price modes**: legacy `manual` → `fixed`; dead enums (`avg_to_date`,
  `manual_in_formula`) must be absent (profiling asserts) or halt.
- **Money backfill**: transactional rows freeze both legs from `fx_rate` at their
  event date (D12 rules); where the old stored converted value differs from the
  recomputed one beyond 0.01, keep the recomputed value and write the pair to the
  divergence ledger. Planning values load as MoneyNative only.
- **Preliminary/final**: lines marked final get a `price_snapshot` synthesized from
  their stored values (inputs marked `legacy-migrated`), `current_snapshot_id` set.
- **Dates**: outliers quarantined to a review table; the row loads with the date
  NULL + flagged, never a guessed date.
- **Overrides**: existing override flags carried verbatim; cleared-value semantics
  already NULL in source post-00110.
- **Hidden/defaults**: `is_hidden` carried; `additional_expenses_in_price` values
  preserved exactly (open client question defaults to preserve).

## 4. Mechanics

Idempotent, restartable, ordered: reference → users/capabilities → deals →
variants/snapshots → shipments → payments → fx → dt-kt → documents/attachments →
events/baseline. Each phase: load-to-staging → transform → upsert by preserved UUID
→ per-phase validation → checkpoint. A full run on the rehearsal copy must complete
in one evening; runtime is measured at every rehearsal.

## 5. Validation harness + expected-divergence ledger

`scripts/migration/validate.ts` compares old vs new **per deal**: shipped volumes &
amounts, paid totals per side, supplier balance, buyer debt, additional expenses,
row counts per child table — writing a diff report. A diff is a FAILURE unless it
matches the ledger:

1. Margin on cross-currency deals — new converts, old subtracted raw (AS-MONEY-08).
2. Payments with side-currency mismatch — now included in totals (AS-MONEY-07);
   profiling #4 pre-lists every affected deal.
3. Scalar-vs-line drift — line wins; profiling #2 pre-lists.
4. Recomputed FX divergences beyond 0.01 (money backfill rule).
5. «Среднее» recomputed values where old stored ones were stale.

Everything else must match to the kopeck/kg. Buyer debt matches production sign —
NO divergence expected there. Operator sign-off: a stratified sample (20 deals: KG/KZ
× active/archived × cross-currency/single) reviewed by the client's operator against
the old UI, checklist per deal.

## 6. Rehearsal cadence

- **By M3**: first full rehearsal on an anonymized prod copy → the fixture that
  every later milestone's tests run against.
- **Every milestone M4–M7**: re-run migration + validation on a fresh copy; new
  tables joining scope (fx, deferral, dt-kt, is_hidden) enter as their modules land.
- **M8**: final rehearsal = dress rehearsal, timed, with the operator sample.

## 7. Cutover runbook (M9)

1. Announce freeze window; old system → read-only (Supabase: revoke writes).
2. Changelog drained check — every entry folded or consciously dropped.
3. Final backup: pg_dump + storage snapshot (kept ≥90 days).
4. Run migration against live data; run validation; ledger-only diffs.
5. Operator sample sign-off (same 20-deal checklist).
6. New system live; **numbering ownership transfers now** — counters re-seeded from
   final MAX; during any parallel-run period before this moment the OLD system owns
   numbering and the new system shadows read-only.
7. Old system stays read-only and reachable for 30 days (comparison window), then
   archived.
8. Rollback plan (first 48h): new system → read-only, old system write access
   restored, incident review before retry. Data created only in the new system in
   that window is exported for manual re-entry — kept small by cutting over at a
   week boundary after the operator's day ends.

@AGENTS.md

# Operating contract

Keep this file short. Read detailed documentation only when the task touches it.

## Context routing

Before editing:

- Product behavior or scope: read the relevant section of `PRODUCT.md` and `SPEC.md`.
- Architecture, data flow, RLS, triggers, or migrations: read the relevant section of `ARCHITECTURE.md` and the matching `AS-BUILT-*.md`.
- UI or visual changes: read `DESIGN.md`.
- Recent behavior or schema evolution: inspect `CHANGELOG-SINCE-EXTRACTION.md`, `DELTA-SINCE-EXTRACTION.md`, and relevant recent commits.
- Next.js behavior: follow `AGENTS.md` and read the relevant bundled Next.js documentation before coding.

Do not load every document into context by default.

## Design System

Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Route by risk, not by habit

- Tiny and obvious: implement directly.
- Clear multi-file change: use Plan mode, state acceptance criteria, then implement.
- Ambiguous business process, financial calculation, status transition, permission change, integration, or migration: first use the `process-analyst` agent, then get the rules and acceptance scenarios approved before implementation.
- Do not create two parallel planning artifacts (e.g. Superpowers plan plus a separate spec proposal) for the same change.
- Use isolated worktrees for parallel or non-trivial changes.

## Domain invariants

- PostgreSQL is authoritative for money, balances, rollups, and permissions. Do not duplicate authoritative financial logic in React.
- RLS is the authorization firewall. Every new table or write path requires explicit RLS review.
- Existing migrations are append-only. Never rewrite an applied migration.
- Never silently change formula semantics, rounding, currency, units, source dates, status transitions, or historical-data behavior.
- For finance or logistics behavior, explicitly identify: source fields, formula, units, currency, rounding, effective date, exceptions, and audit impact.
- Preserve Russian-language, dense, keyboard-efficient workflows. This is an operational CRM, not a marketing UI.
- Never delete, overwrite, or backfill production data without an explicit migration and rollback/recovery plan.

## Implementation discipline

- Follow existing code patterns and make the smallest coherent change.
- Do not refactor unrelated code.
- Prefer focused files and testable boundaries.
- Add regression tests before or with bug fixes.
- For schema changes, update migrations, generated/database types, queries, validation, tests, and documentation together.
- Record material schema or behavior changes in `CHANGELOG-SINCE-EXTRACTION.md`.

## Verification

Before claiming completion:

1. Inspect `git diff` for accidental scope.
2. Run the smallest relevant test first.
3. Run `npm run verify`.
4. Run database tests for migrations, triggers, RLS, or financial calculations.
5. Run Playwright for changed user-critical flows when the environment supports it.
6. Report the exact commands and outcomes. Never infer success from code inspection.

Use `/project-verify` for the repository verification workflow and `/code-review` for every non-trivial PR.

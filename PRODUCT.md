# Asia Petrol CRM — Product Overview

A full-stack operational CRM for a Kazakhstan-based petroleum trading company. Phase 1 retired an 86-column Excel workbook that had become the single source of truth for deals, shipments, tariffs, payments, and multi-currency balances. Phase 2 extends the platform toward 1С integration, банковский учёт, аналитика просрочек, mobile, and verified reporting. Phase 3 closes the loop on documents and treasury.

Engineering-side details live in `ARCHITECTURE.md`. This document describes **what the product does**, for **whom**, **what's delivered vs. planned**, and **how the pieces fit together**.

---

## Who it's for

- **Managers** — open and negotiate deals, track margins, approve prices, watch buyer debts.
- **Logistics** — assemble shipment chains, register wagons, reconcile налив vs отгрузка, manage railway tariffs, track carrier balances (ДТ-КТ).
- **Accountants** — reconcile multi-currency payments, check invoice amounts against registry totals, export to 1С.
- **Traders** — set daily quotations, work trigger pricing, model deal margin before commitment.
- **Finance directors / CFO** — credit-line consumption, repayment calendars, cash balances across group companies (Phase 2).
- **Admins** — onboard users, manage reference data, access archive, control deletes.

All users are Russian-speaking power users. They spend full workdays in the tool. UI density and keyboard-first workflows beat prettiness. Phase 2 extends usable surface to tablet / phone for managers in transit and logistics on the склад.

---

## Business context

The company trades refined petroleum products (ДТ, АИ-92, АИ-95, мазут, etc.) across two pipelines:

- **KG (Экспорт)** — shipments leaving Kazakhstan to buyers in Kyrgyzstan, Russia, etc. Priced in USD typically; often against commodity quotations (Platts-style triggers).
- **KZ (Внутренний)** — domestic Kazakhstan trades. Priced in KZT; simpler pricing conditions.

Every deal has:
- A supplier side (refinery or trader we buy from)
- A buyer side (end-buyer or trader we sell to)
- A **company chain** of 1–6 intermediate groups (our LLCs + partner LLCs that own the contract at each handoff)
- A **logistics block** (forwarder, railway tariff, volumes planned vs shipped)
- A **pricing condition**: Триггер (monthly trigger against a quotation), Фикс (fixed per ton), Средний месяц (monthly average of a quotation), or Ручной (manual override)

Seven group companies operate under the corporate umbrella (Арқа Проф, Progressive Oil Trading, Inter Profit, Prima Petroleum, Samal Petrotrading, Cronos Trade, Арлан-22), each with its own BIN, contracts, and bank accounts. Aggregate credit-line exposure across Forte Bank / БЦК / Даму runs to ~1.5 млрд ₸.

Phase 1 replaced:
- The master Excel "passport" (one giant row per deal, 86 columns across supplier / chain / buyer / logistics)
- Per-month wagon registries (one sheet per month, per pipeline)
- Daily quotation sheets + monthly-average derivations
- ДТ-КТ logistics ledger (forwarder carries balances across months)
- Tariff tables (cost to ship between station pairs by product and forwarder)
- Basic SNT / ЭСФ document registers (Kazakhstan fiscal documents)

Phase 2 adds what Phase 1 deliberately left out: 1С-driven volume distribution, банковский учёт, просрочки aналитика, РВС ресурсная справка, mobile, verified reports. Phase 3 closes document workflow, trader onboarding, treasury, and двустороннюю 1С-интеграцию.

---

## Project phases

| Phase | Status | Budget | Timeline | Scope summary |
|---|---|---|---|---|
| **1** | **Delivered** | 5 400 000 ₸ | Shipped | 12 операционных модулей · 40 миграций · multi-currency · RLS · real-time · inline-edit |
| **2** | **Offered** | 8 100 000 ₸ | 16 недель (4 спринта) | 8 блоков: 1С · РВС · банки · просрочки · штрафы · банкинг · mobile · отчёты |
| **3** | **Deferred** | TBD | — | Документооборот · трейдерский workflow · казначейство · внутригрупповые займы · двусторонний 1С API |

### Phase 1 — delivered

The 12 sidebar modules (detailed below). Everything the operational team needs to run deals, log shipments, capture payments, and trace money without touching Excel. Implemented over ~3 months. Foundation for every subsequent phase.

### Phase 2 — 8 блоков (8 100 000 ₸ · 16 недель)

Framed from the client's `2-этап.docx`. This is **1С integration**, not just file ingestion — Phase 1 already has basic `/import` for SNT/ЭСФ uploads. Phase 2 turns those uploads into a structured sync pipeline with auto-distribution, reconciliation, and live сальдо.

| # | Блок | Budget | Weeks | What it is |
|---|---|---|---|---|
| 1 | **Интеграция с 1С** | 1 200 000 ₸ | 1–4 | Parse 1С Excel exports (СНТ/ЭСФ) → auto-match wagon № to сделка → distribute volumes by criteria (primary key: № сделки) → drive план/факт сальдо for forwarders день-в-день. Conflict-resolution UI when one wagon could belong to multiple deals. Replaces manual re-entry from 1С into паспорт. |
| 2 | **Ресурсная справка** | 450 000 ₸ | 5–6 | РВС tank fill per завод (АНП, ПНХЗ, ПКОП): остаток, план поступлений, план отгрузок, отклонение план/факт. Auto-decrement on SNT register. Tied to deal reservation. |
| 3 | **Банковский модуль** | 2 000 000 ₸ | 5–10 | Credit lines (Forte Bank / БЦК / Даму): договоры, транши, ставки, лимиты. Repayment calendar with day-level план/факт, просрочка in days, highlight states. Snapshot-on-any-date view. Dashboard of limit consumption per company group. |
| 4 | **Аналитика просрочек** | 750 000 ₸ | 9–11 | Срок оплаты on every deal; auto-computed due date. Overdue registry with day buckets (до 7 / 7–14 / 14+ / 90+), filter + drill-down, colored indicators. Daily email/Telegram alerts to responsible managers for new and critical arrears. |
| 5 | **Штрафы / сверхнормативы** | 450 000 ₸ | 3–4 | Kanban workflow on top of the existing `surcharges` table: Новая → В работе → Согласована → Оплачена. Link to forwarder сверхнормативы and простои. Quarterly roll-up by deal. Document attach. |
| 6 | **Банкинг — остатки** | 650 000 ₸ | 10–11 | Cash balances dashboard across 7 group companies × 3+ банков × accounts × currencies. Manual entry or bank-statement xlsx import. Multi-currency with daily-rate conversion. Balance history for планирование. |
| 7 | **Мобильная адаптация** | 1 900 000 ₸ | 12–14 | Responsive vёрстка for Паспорт / Реестр / ДТ-КТ / Календарь / Просрочки. Mobile action cards (confirm отгрузка, add payment, accept штраф). PWA install. Touch-preserved inline-edit. |
| 8 | **Сводные отчёты** | 700 000 ₸ | 13–14 | Preset templates on 1С-verified data: отгрузки (план/факт), оплаты + cash-flow forecast 30/60/90, маржинальность, просрочки, залоги. Export to Excel and PDF. One-click email attach. |

Total of block budgets: 8 053 000 ₸, rounded up to **8 100 000 ₸** for document simplicity (~631 часов команды). Sprint cadence: 4 спринта × 4 недели with poсприн­товая приёмка; two blocks (Banking, Mobile) are the critical-path heavyweights.

### Phase 3 — deferred (TBD)

From the client's docx. Five headline deliverables, rephrased for clarity:

- **End-to-end document circuit.** Track оригиналы per deal — receipt status, отсрочка / просрочка on delivery, hard gate on deal closure until every department confirms originals are in hand.
- **Trader onboarding surface.** Structured deal-intake table for traders, with sign-off workflow before a deal lands on a manager's desk — replaces ad-hoc Slack/WhatsApp hand-offs.
- **Treasury / ПП integration.** Payments auto-linked from казначейство's Платежные поручения so accountants don't re-key confirmed bank transfers into the deal payment lists.
- **Intra-group loan ledger.** Track займы between the 7 group companies with corrections when account balances shift.
- **Two-way 1С API.** Graduate Phase 2's file-based sync to a direct API link, plus integrations with other back-office systems for reporting + action auditing across the group.

No budget or timeline committed; sequenced after Phase 2 acceptance.

---

## Feature modules (Phase 1, delivered)

The sidebar groups features into 12 sections, each backed by a top-level route. Modules that get extended in Phase 2 are tagged inline.

### 1. Главная — Dashboard (`/`)

Read-only home screen with KPIs and charts:

- Totals: active deals, this-month volumes, open debts
- Charts (Recharts): deal count by month, shipped volume by fuel, payment status split
- Quick filters by pipeline (KG / KZ)
- Links into the major modules

Pulls aggregated data via `use-deals`, `use-registry`, `use-quotations` hooks.

> **Phase 2 extension (Block 8):** this page becomes an entry point into the Сводные отчёты section with preset templates and export actions.

### 2. Справочник — Reference data (`/spravochnik`)

Master data that every other module keys on. Each sub-route is a `CrudTable<T>` with inline edit dialogs:

- **Поставщики** (suppliers) — counterparties with BIN, contacts, default currency
- **Покупатели** (buyers) — same shape, `side = 'buyer'`
- **Группы компании** (company groups) — the LLCs that form a chain; extra columns for BIN, default forwarder
- **Заводы** (factories) — loading points; linked to default stations
- **Экспедиторы** (forwarders) — railway carriers
- **Станции** (stations) — railway stations with default factory link
- **Виды топлива** (fuel types) — with colored dot swatches for the UI
- **Менеджеры** (managers) — internal users for deal ownership

Every deal, shipment, tariff, and payment references these tables by FK, so the UI is a tight autocomplete experience instead of free-text.

### 3. Котировки — Quotations (`/quotations`)

Daily commodity price grid. Two tabs:

- **Котировки** — a wide calendar-style grid. Rows = days in the selected month. Columns come from `quotation-columns.ts` — 16 per-product configurations each with 2–5 columns (e.g., Gasoil CIF NWE has Mean, Low, High, +/−, Basis). User picks a product from a selector; grid shows the month's rows; cells are inline-editable numbers.
- **Свод КОТ** — monthly averages derived from the daily rows. Refreshed server-side via `refresh_quotation_averages` (a Postgres function wired to a button). Feeds trigger/average-month pricing for deals.

Data flows into `deal_trigger_prices` when a deal picks a quotation + month + trigger condition.

Includes a **Price Calculator** component — punch in a quotation, discount, and volume; see what the per-ton and total come out to, without committing to a deal. Useful during negotiation.

### 4. Сделки — Deals (`/deals`)

The core module. Two views:

- **List** — `/deals/page.tsx`; filterable list of deals with status chips and quick actions. Filters by pipeline, month, supplier, buyer, status, deal code.
- **Passport** — `/deals/passport-kg` and `/deals/passport-kz`; the full 30+ column monospaced table that mirrors the Excel "паспорт сделок". Sections: Сделка · Поставщик · Группы · Покупатель · Логистика. Every cell is click-to-edit.
- **Detail** — `/deals/[id]/page.tsx`. A single deal's full workspace:
  - Identity block (code, type, month, status, currency, manager)
  - Company chain visualizer (`deal-company-chain.tsx`) with drag-reorder and inline margin math
  - Supplier side (`contract`, delivery basis, quotation, discount, price, volumes, payments)
  - Buyer side (same shape)
  - Logistics (forwarder, planned tariff, preliminary tonnage, invoice volume/amount)
  - **Trigger prices** panel (`deal-trigger-prices.tsx`) — per-month pricing rows for Триггер/Фикс/Средний месяц modes; each row inline-editable
  - **Payments** panel (`deal-payments.tsx`) — list of payments with per-row currency; multi-currency totals rendered as "1 200 000 ₸ + 5 000 $"
  - **Shipments** panel (`deal-shipments.tsx`) — grouped view of the registry rows that roll up into this deal
  - **Activity feed** (`deal-activity-feed.tsx`) — real-time chat + system messages. Subscribes to `deal_activity` via Supabase Realtime. System messages fire from DB triggers (payment added, price changed, status changed).
- **New deal** — `/deals/new/page.tsx`. Multi-step form with `react-hook-form` + `zod`. Can save as draft (`00020_deal_draft_status.sql`).

**Pricing conditions** (`price-formation.ts`):

| Condition | How price is computed |
|---|---|
| Триггер | `quotation_value + discount` on the day of trigger |
| Фикс | Single `price` field, stays constant |
| Средний месяц | Monthly average from `quotation_monthly_averages` × volume |
| Ручной | Operator types the final price; no formula applied |

**Deal code format** (`00039_deal_code_1c_format.sql`) — generated by DB to match 1С accounting numbering so the two systems can be cross-referenced without a mapping table. This mapping is the key enabler for Phase 2 Block 1 — wagons coming from 1С tie back to deals through the shared code.

**Derived fields** — `deals` has columns like `supplier_contracted_amount`, `buyer_debt`, `supplier_balance`, `preliminary_amount` computed by a `BEFORE INSERT/UPDATE` trigger (00021). The UI never computes money — the DB does, atomically.

> **Phase 2 extension (Block 4):** new field **срок оплаты** on each side + auto-computed due date, feeding the overdue registry and daily alerts.

### 5. Заявки — Applications (`/applications`)

Buyer orders against deals. An application selects a deal (or multiple via `application_deals`), captures the volume requested, shipment window, and delivery basis, then toggles an "заказано" flag. Activity feed mirrors the deal's (`application_activity` table, migration 00017).

### 6. Реестр отгрузки — Shipment Registry (`/registry`)

Per-wagon shipment log. Grouped by (deal, forwarder, stations, fuel, month). Rendered as an expandable list — each group shows aggregates, expand to see individual wagons. Two pipeline tabs (KG / KZ).

Every row in `shipment_registry` carries 20+ columns:
- Identity: `registry_type`, `deal_id`, `company_group_id`, `forwarder_id`, `factory_id`
- Logistics: `departure_station_id`, `destination_station_id`, `fuel_type_id`
- Volumes: `shipment_volume` (what we shipped), `loading_volume` (what the factory loaded to us)
- Pricing: `railway_tariff` (plan/actual), `shipped_tonnage_amount` (auto = CEIL(vol) × tariff, via trigger 00031)
- Documents: `wagon_number`, `waybill_number`, `invoice_number` (№ СФ)
- Currency: per-row `currency` override (migration 00033)
- Dates: `date`, `month` (формирования), `shipment_month`

**Add record** dialog:
- Pick a deal → auto-fills ГСМ, завод, экспедитор, станции, ж/д тариф (via `lookup_tariff` from the tariffs table, keyed on the deal's месяц формирования)
- **Bulk paste** textarea — paste Excel rows, see live preview with per-row errors. Parser in `bulk-wagons.ts` handles tab/space/multi-space separators, comma decimals, DD.MM.YYYY / DD/MM/YYYY / ISO dates, header auto-skip.
- **Налив / Отгрузка toggle** — one volume column in the paste; operator picks which DB field it maps to.

**Inline edits** on every column directly in the group expansion (`EC`, `EN`, `ED`, `EM`, `ES` components for text/number/date/month/select cells).

**Rollup to deals**: `AFTER INSERT/UPDATE/DELETE` trigger (00027) recomputes `deals.invoice_amount` and `deals.actual_shipped_volume` whenever registry rows change.

> **Phase 2 extension (Block 1):** wagons arriving from 1С SNT exports auto-populate this table without manual paste, matching № сделки by criteria and surfacing ambiguous wagons for resolution. Manual paste remains as a fallback.

### 7. ДТ-КТ Логистика — Carrier ledger (`/dt-kt`)

Two-entry bookkeeping for forwarders. Each `dt_kt_logistics` row is a forwarder's running balance in a reporting currency; each `dt_kt_payments` row is an individual payment against it, with its own currency (migration 00034).

- Добавить — start a new ledger line for a forwarder + deal context
- Per-record payment drawer — add/edit payments with currency override
- **Сальдо** (balance) — difference between `amount_due` and sum of payments; with migration 00040 (payment rollup by currency), the computation groups by the deal's reporting currency and uses on-demand FX conversion for mixed-currency reconciliation

Replaces a sheet where the company tracked "how much do we still owe РЖД for this month's shipments."

> **Phase 2 extension (Block 1):** сальдо becomes **оперативное** — updated день-в-день from 1С-derived SNT shipments rather than waiting on end-of-month manual tallies.

### 8. Тарифы — Railway tariffs (`/tariffs`)

The tariff table: cost per ton to ship from station A to station B by forwarder + fuel + month + year. Inline-editable; search/filter by any axis.

Consumed by:
- `lookup_tariff` function (migration 00011) — called from registry's add-dialog and from deal creation
- `shipment_registry` auto-compute trigger (00031): `shipped_tonnage_amount = CEIL(volume) × tariff`

Tariff is effectively the single most referenced reference table in the system.

### 9. Сверхнормативы — Surcharges (`/surcharges`)

Overage/penalty claims from forwarders when demurrage or extra services happen at a station. `surcharges` table has 40+ columns covering the claim workflow: date, station, wagon, reason, amount, claim status, settlement date, notes. Dedicated page with inline edits and filters.

> **Phase 2 extension (Block 5):** kanban view over the same table (Новая → В работе → Согласована → Оплачена → Отклонена), document attach, quarterly roll-up by deal.

### 10. Импорт — Excel / SNT / ЭСФ Import (`/import`)

Three tabs for bulk document loading:

- **СНТ** — Сопроводительная накладная на товары (KZ fiscal document). Parser (`snt-parser.ts`) reads the 1С-exported xlsx with fixed-cell layout; inserts into `snt_documents` table.
- **ЭСФ** — Электронная счёт-фактура (KZ e-invoice). Same pattern; `esf_documents` table. Triggers a basic aggregation (migration 00024) that updates the linked deal.
- **Реестр** — bulk registry load. Template includes both volume columns (`объем отгрузки`, `Налив тонн`). Ad-hoc exports with only one column fall back to the **Налив / Отгрузка toggle** to decide where the volume goes.

UX: step 1 upload → step 2 preview + toggle + map columns → submit. Rows without any volume signal are dropped with a counter ("пропущено 3 строки").

> **Phase 2 extension (Block 1):** this page transitions from manual-import to 1С-sync pipeline. The parser output drives automatic wagon → сделка distribution rather than just landing rows in `snt_documents` for later linking. Conflict-resolution UI handles wagons that could belong to multiple deals, with decision history preserved.

### 11. Архив — Archive (`/archive`)

Admin-only. Year-partitioned snapshots of closed-out deals. `archive_years` table holds per-year metadata (quarters closed, lock status). UI shows a year picker + read-only deal list.

### 12. Настройки — Settings (`/settings`)

Admin-only. User management (`/settings/users`). Uses `profiles` table + `auth.users` to toggle roles (`admin`, `manager`, `logistics`, `accountant`, `readonly`).

---

## Cross-cutting capabilities

### Multi-currency

USD, KZT, KGS, RUB — hard-coded in `src/lib/constants/currencies.ts` with symbols. Every money table has a `currency` column at the appropriate grain:

| Table | Grain | Migration |
|---|---|---|
| `deals.currency` | per-deal | 00014 |
| `deal_payments.currency` | per-payment | 00019 + 00034 |
| `shipment_registry.currency` | per-shipment override | 00033 |
| `dt_kt_logistics.currency` | per-record | baseline |
| `dt_kt_payments.currency` | per-payment | 00034 |

Display is currency-aware throughout (e.g., `currencySymbol(code)`, grouping totals by currency code). No FX conversion in Phase 1 — users see per-currency buckets side-by-side. Migration 00040 introduced on-demand rate conversion for ДТ-КТ saldo only. Phase 2 Block 6 generalizes this into a daily-rate FX table used across banking balances.

### Multi-role permissions

Set in `profiles.role`, enforced at the DB via `00010_rls_policies.sql`:

- `admin` — full read/write/delete on everything
- `manager`, `logistics` — read/write on operational tables; no deletes
- `accountant` — read/write on payments; read on deals
- `readonly` — SELECT only

RLS is the authz boundary. The UI does role-gate some routes (`adminOnly: true` in nav items), but even if a user navigates to `/settings/users` by hand, the queries fail server-side.

### Audit log

`audit_log` table (migration 00036) captures INSERT/UPDATE/DELETE on every money-relevant table with user, timestamp, before/after JSON, and a diff array of changed field names. `AuditHistory` component (`src/components/shared/audit-history.tsx`) renders a drawer inside deal detail showing recent changes.

### Real-time collaboration

Supabase Realtime subscribes to:
- `deal_activity` — chat + system messages per deal
- `application_activity` — same for applications

Payments, price changes, and status flips emit rows into these activity tables via DB triggers (migration 00016, 00017). Clients viewing the same deal see updates within 1-2s without manual refresh.

> **Phase 2 extension (Block 4):** адресные notifications — daily email / Telegram digest for overdue accounts, new critical arrears, and upcoming trigger dates.

### Optimistic inline edits

The UI adopts an Excel-first mindset — click-to-edit everywhere. Pattern:

1. Cell renders as `<button>` showing formatted value.
2. Click → swap to `<input>` with `autoFocus`.
3. `onBlur` → diff, call `updateX(id, { field: newValue })`, hook reloads.
4. A `useRef(pendingVal)` holds the typed value across the brief async gap so the UI doesn't flicker back.

Five cell primitives (`EC`, `EN`, `ED`, `EM`, `ES`) are reused across the registry, tariffs, DT-KT, and surcharges pages. Deal detail uses richer versions (`Field`, `EditableSelect`).

> **Phase 2 extension (Block 7):** the pattern gets touch-preserved — tap-to-edit, keyboard-aware input types, mobile-friendly date / select pickers.

### Bulk paste / Excel parity

Operators think in spreadsheets. Every module that ingests data supports paste-from-Excel:

- Registry → `parseBulkWagons` (wagon, volume, date, waybill)
- Import page → sheet upload + column map
- Tariffs → paste supported via the same pattern (station A tab station B tab forwarder tab fuel tab month tab amount)

### Reports & export (Phase 1 baseline)

`exceljs` server-side builders under `src/app/api/export/` generate ad-hoc Excel exports. Phase 1 includes only the structural endpoints — no preset report templates, no PDF, no scheduled digests.

> **Phase 2 (Block 8)** delivers the full reporting module: preset templates (отгрузки план/факт, оплаты, маржа, просрочки, залоги, ДТ-КТ), Excel + PDF export, attach-to-email flow.

---

## Data model (high level)

```
counterparties (supplier/buyer)    company_groups (our + partner LLCs)
        │                                       │
        │                          ┌────────────┴────────────┐
        └────────┐                 │   deal_company_groups   │
                 │                 │   (chain, 1..6 rows)    │
                 ▼                 └────────────┬────────────┘
            ┌─────────────────────────────────────┐
            │                deals                │
            │  identity · 2 sides · pricing mode  │
            │  currency · logistics · derived $$  │
            └─┬──────────┬──────────┬──────────┬──┘
              │          │          │          │
              ▼          ▼          ▼          ▼
        deal_shipment   deal_     deal_     applications
        _prices       payments  trigger_   (buyer orders)
        (per-month    (per-pay) prices
         pricing)
              │                    │
              └─── rollup ────┐    └─── pulls from ────┐
                              ▼                         ▼
                         deals.supplier_shipped_amount
                         deals.buyer_shipped_amount     quotations
                                                         │
                         shipment_registry ──rollup──►  quotation_
                         (per-wagon, 20+ cols,          monthly_
                          multi-currency)                averages

         tariffs (station × fuel × forwarder × month)  ← lookup from registry + new deals
         dt_kt_logistics + dt_kt_payments               ← forwarder ledger
         surcharges                                     ← overage claims
         snt_documents / esf_documents                  ← fiscal imports
         deal_activity / application_activity           ← chat + system messages
         audit_log                                      ← change history
         archive_years                                  ← year-partition snapshots
```

40 migrations, no squashes. The sequence is the history: 1–13 are the initial schema, 14+ are incremental evolutions from client feedback. See `ARCHITECTURE.md` for the annotated list.

**Phase 2 adds (new tables, not yet implemented):**
- `rvs_inventory` + `rvs_movements` (Block 2 — ресурсная справка)
- `credit_agreements`, `credit_tranches`, `repayment_schedule` (Block 3 — банки)
- `bank_accounts`, `bank_balances`, `exchange_rates_daily` (Block 6 — банкинг)
- Extensions to `deals` (`payment_terms_days`) and `surcharges` (`workflow_status`) for Blocks 4 and 5.

---

## Key business workflows (Phase 1)

### Workflow A: Opening a new deal

1. Manager clicks **Новая сделка** in `/deals`.
2. Multi-step form: pick pipeline → supplier side → buyer side → chain → logistics → pricing condition.
3. Pricing:
   - Триггер → pick a `quotation_product_type` + discount; monthly rows get created on trigger dates.
   - Фикс → one price field.
   - Средний месяц → quotation + month selector; price resolves from `quotation_monthly_averages`.
   - Ручной → free number.
4. Save as draft (`00020_deal_draft_status.sql`) or publish. Deal code auto-generates (1С format).
5. Derived fields populate via trigger (contracted amount, preliminary amount).

### Workflow B: Logging shipments

1. Logistics opens `/registry`, picks pipeline tab.
2. Either:
   - **Ad-hoc**: clicks **Новая запись** → picks deal → auto-fills context → pastes tab-separated wagons → picks Налив vs Отгрузка → submits.
   - **Into existing group**: expands a group → **Массово** button → paste under the group's context.
3. DB:
   - `compute_registry_amount` trigger computes `shipped_tonnage_amount = CEIL(volume) × tariff` per row.
   - `refresh_deal_shipment_totals` trigger sums registry rows into `deals.actual_shipped_volume` + `deals.invoice_amount`.
4. The deal detail page (if open in another tab) reflects the new totals without a manual refresh.

### Workflow C: Reconciling payments

1. Accountant opens a deal detail → Payments tab → adds a payment with date, amount, currency.
2. `deal_payments` insert → trigger updates `deals.supplier_payment` / `buyer_payment` (migration 00028 + 00040 for currency-aware rollup).
3. `deal_activity` receives a system row; real-time subscribers see it instantly.
4. Balance recomputes: `supplier_balance = supplier_shipped_amount − supplier_payment`, rendered in the currency of the deal (other-currency payments shown as addenda).

### Workflow D: Carrier settlement

1. Logistics opens `/dt-kt`, filters by forwarder + month.
2. Each row = one logistics line. Expand → see payments drawer.
3. Saldo shows in the record's currency using `to_currency(...)` when payments are mixed-currency (post-00040).
4. Export for end-of-month reconciliation.

### Workflow E: Monthly quotation roll-up

1. Trader enters daily quotations in `/quotations` → Котировки tab throughout the month.
2. At end of month, clicks **Refresh averages** on Свод КОТ tab → server calls `refresh_quotation_averages`.
3. `quotation_monthly_averages` populates → any deal priced "Средний месяц" on next view shows the new resolved price.

### Workflow F: SNT / ЭСФ ingestion (Phase 1)

1. Accountant exports SNT from 1С as xlsx.
2. Uploads to `/import` → SNT tab → preview → import.
3. `snt_documents` rows created. `esf_documents` aggregation trigger (migration 00024) cross-links matching ЭСФ rows to their deals.

> Phase 2 Block 1 replaces the "manual preview + import" half of this flow with structured parsing + automatic wagon → сделка distribution, driven by № сделки as the primary matching key. Conflict-resolution UI handles ambiguous wagons.

---

## Technical foundation (short)

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript, Tailwind 4 |
| UI primitives | shadcn (Base-UI flavor), `@tanstack/react-table`, `@tanstack/react-virtual`, `recharts` |
| Forms | `react-hook-form` + `zod` (complex flows); `useState` elsewhere |
| Client data | Custom hooks over `@supabase/supabase-js` + `@supabase/ssr` |
| Backend | Supabase (Postgres + Auth + Realtime + Storage) |
| Auth | Supabase email/password; client-side `<AuthGuard>` + RLS at DB |
| Excel | `xlsx` (read), `exceljs` (write) |
| Testing | Vitest (unit), Playwright (e2e scaffold) |
| Hosting | Vercel (app) + Supabase Cloud (DB) |

See `ARCHITECTURE.md` for the engineering deep-dive (hook patterns, trigger strategy, RLS model, repo layout).

See `DESIGN.md` for the visual system (Amber 600 accent, JetBrains Mono for numbers, 28px table rows, dark Slate sidebar).

Phase 2 adds: scheduled jobs (pg_cron / edge functions) for daily FX rates, overdue-alert digests, and repayment-calendar recompute; a daily FX rates table; mobile-breakpoint layouts; preset report templates; conflict-resolution UI primitives.

---

## Roles & permissions

| Role | Read | Write | Delete | Admin routes |
|---|---|---|---|---|
| `admin` | all | all | all | yes |
| `manager` | all | deals, applications, registry, payments | no | no |
| `logistics` | all | registry, tariffs, surcharges, DT-KT | no | no |
| `accountant` | all | payments, SNT/ЭСФ docs | no | no |
| `readonly` | all | — | — | no |

Enforced at DB level via `is_writable_role()` / `is_admin()` helpers in `00010_rls_policies.sql`. The UI hides admin-only routes via `adminOnly: true` in `nav-items.ts`, but that's convenience, not security.

Phase 2 does not change the role model; it adds new tables that inherit the same policy pattern (reads open to authenticated, writes gated by `is_writable_role()`, deletes admin-only).

---

## Out of scope across all phases

These are deliberate omissions, not backlog items. None are on the roadmap for Phase 1, 2, or 3.

- **Full i18n** — Russian only. `src/i18n/` exists as a stub. Target users are Russian-speaking; cost of translating 86-column passport headers exceeds value.
- **Dark mode** — light theme only. All-day office use, consistent screen calibration across the team.
- **Realtime presence on inline edits** — sub-10 user team with last-write-wins semantics. Conflict risk is low; the audit log is the reconciliation path.
- **Native mobile apps (iOS/Android)** — Phase 2 ships a PWA, which satisfies the "работа в дороге" use case without store submissions or separate codebases.
- **Multi-tenant / multi-company SaaS isolation** — this is an in-house deployment for one trading group; not a product to resell.
- **Trading-strategy automation** — the CRM records human decisions; it does not generate or execute trades.

---

## Document index

- `PRODUCT.md` — this file — phases, modules, workflows, roadmap
- `ARCHITECTURE.md` — code organization, stack, hooks, triggers, RLS
- `DESIGN.md` — typography, colors, spacing, component patterns
- `AGENTS.md` — build/agent conventions (Next.js 16 has breaking changes — read before touching framework code)
- `CLAUDE.md` — project memory hooks for Claude Code
- `README.md` — Next.js template boilerplate (unchanged, to avoid confusing Vercel's starter UX)
- `../phase2_offer_handoff.md` — commercial offer handoff, block-by-block content, pricing rationale, Gantt
- `../phase 2/2-этап.docx` — client's original Phase 2 requirements

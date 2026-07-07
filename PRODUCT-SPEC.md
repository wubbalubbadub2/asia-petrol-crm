# Asia Petrol CRM — Product Requirements

A pure product/business specification of the Asia Petrol / Singularity Trading CRM. This document describes what the product does for its users, the rules it enforces, and the workflows it supports. It contains no references to the underlying technology, data storage, or implementation.

---

## 1. Product Overview

### 1.1 What it is

Asia Petrol CRM is the operating system for a petroleum-products trading desk. It replaces a stack of ~86-column Excel workbooks that the desk had previously used to run every part of a fuel-trade — from negotiating a deal, through tracking each railway shipment, to settling logistics accounts at year-end.

### 1.2 Who uses it

All users are staff of one Kazakhstan-based trading company. Russian is the working language. Five professional groups use the system daily:

- **Traders / commercial managers** — owners of deals; record prices, volumes, counterparties.
- **Logistics staff** — record shipments, manage tariffs and forwarder ledgers.
- **Finance / accounting** — track payments, reconcile balances.
- **Administrators** — provision users, lock years, manage reference data.
- **Read-only viewers** — read everything, export to Excel for offline analysis.

Users typically spend full working days inside the tool. There is no external customer access and no public sign-up.

### 1.3 The jobs the product does

1. **Manage deal passports** — the central record of one trading transaction (supplier, optional chain of intermediaries, buyer, logistics).
2. **Track physical shipments** — every railway waybill / wagon / tonne booked against a deal.
3. **Maintain a daily reference-price book ("quotations")** for ~16 petroleum products, and use those prices to derive contract prices automatically.
4. **Run a logistics ledger ("ДТ-КТ")** — opening balance, payments, fines, overages, OGEM fee, net saldo per (forwarder × company group × year).
5. **Capture buyer purchase orders ("заявки")** from PDFs and allocate them to deals.
6. **Maintain the reference book** of counterparties, fuel types, railway stations, forwarders, factories, intermediary company groups, consignees, and staff.
7. **Hold railway tariffs** by route × forwarder × product × month.
8. **Track overage / penalty claims ("сверхнормативы")** with a re-invoicing workflow.
9. **Import** shipment registers, SNT and ESF documents from Excel.
10. **Export** styled deal passports and quotation sheets back to Excel.
11. **Maintain an immutable audit trail** of all money-affecting actions and a chat-style activity feed per deal.

### 1.4 The shape of the product

Three persistent UI areas, in order of operator time spent:

- A **deals** workspace with three top-level tabs: full deal list, Паспорт KG (export), Паспорт KZ (domestic).
- An **operations** workspace with shipment registry, applications, logistics ledger, tariffs, overages.
- A **reference & admin** workspace with the справочник, quotations, import wizard, settings, archive.

A dashboard home page shows KPI cards and aggregate charts.

---

## 2. Users & Roles

### 2.1 Roles

Seven roles exist:

| Role | Intent |
|---|---|
| Administrator | Full control; only role that can manage users, archive deals, edit archived deals, and lock years |
| Manager (commercial) | Owns deals; full read/write on operational data |
| Logistics | Same write surface as manager, focused on shipments / tariffs / forwarder settlement |
| Finance | Same write surface as manager, focused on payments and reconciliation |
| Accounting | Read-only; can export Excel |
| Read-only viewer | Read-only |
| Trader | Originally writable; has been reclassified as read-only (a contradiction exists between the stated business rule and the technical enforcement — see Open Questions) |

Region assignment exists on staff profiles but is not used to scope what a user can see (every authenticated user sees every record).

### 2.2 What each role can do

| Module | Read | Edit | Delete |
|---|---|---|---|
| Reference data (counterparties, fuel types, stations, forwarders, factories, company groups, consignees, staff) | Everyone | Writable roles | Administrator |
| Deals (parent record) | Everyone | Writable roles, **except archived deals — administrator only** | Administrator |
| Deal child records (pricing variants, payments, attachments, per-shipment prices) | Everyone | Writable roles | Writable roles (recent change — used to be admin-only) |
| Applications | Everyone | Writable roles | Administrator |
| Shipment registry | Everyone | Writable roles | Administrator |
| Tariffs | Everyone | Writable roles | Administrator |
| Overages / surcharges | Everyone | Writable roles | Administrator |
| Logistics ledger (ДТ-КТ) and its payments | Everyone | Writable roles | Administrator |
| SNT / ESF documents | Everyone | Writable roles | Administrator |
| Quotations and product types | Everyone | Writable roles | Administrator |
| Deal activity feed (chat / timeline) | Everyone | Anyone authenticated can post; system events are auto-posted | Administrator |
| Audit log | Everyone (view-only) | Nobody (system writes only) | Nobody |
| Users (create / edit / reset password / delete) | Administrators only | Administrators only | Administrators only |
| Year archive locking | — | Administrators only | Administrators only |

### 2.3 Login & session

- Users sign in with email + password only.
- There is no self-serve password reset; only an administrator can set a new password.
- New users are created by an administrator, who supplies email, full name, role, and an initial password (minimum 6 characters). The user's email is marked verified at creation.
- Sessions persist across browser visits via a secure cookie. The session auto-extends as long as the user is active; otherwise the user is redirected to the login screen.
- There is no hardcoded admin bypass and no shared service account exposed to operators.

### 2.4 Activity & audit (what users see)

Two distinct streams:

- **Deal activity feed** — per-deal timeline visible on the deal detail page. Mixes user chat messages with system events: payment recorded, field changed, file uploaded, deal archived, shipment added. System events include both the old and new value where applicable and use human-readable labels for counterparties and other linked entities. The feed updates in real time across users.
- **Audit log** — administrative view of every change to money-relevant records (deals, payments, per-shipment prices, shipment registry, logistics ledger). Captures the full before/after state, the user who made the change, and the list of fields that changed. It is read-only for everyone — the system writes it, and nothing else can.

Reference-data changes (e.g. renaming a counterparty) are not recorded in the audit log by design.

---

## 3. Core Domain Concepts

Below are the business entities the system manages, described conceptually.

### 3.1 Counterparty

A supplier or a buyer (one record describes one party that plays one role). Carries legal name, short name, Kazakhstan tax identifier (БИН/ИИН), legal address, and an active/inactive flag.

### 3.2 Company group (intermediary)

A trading entity that sits between supplier and buyer in a chain — typically a related-party reseller. Same identifying fields as a counterparty.

### 3.3 Factory

A production / supply point named on the supplier side of a deal.

### 3.4 Forwarder

A railway logistics operator that ships product on behalf of the trading company.

### 3.5 Consignee

A railway consignee, often a separate legal entity from the buyer (used in waybills and tax forms).

### 3.6 Railway station

A departure point, destination point, or both. Stations are referenced by deals, tariffs, the shipment registry, and applications.

### 3.7 Fuel type

A product category (e.g. ВГО 0,5-0,6%, Газойль 0,1%, Мазут 1,0%) with sulphur content and a colour code for visual marking.

### 3.8 Quotation product type

A more granular sub-classification used only by the quotations module. A fuel type can have several quotation product types (e.g. ВГО splits into ВГО 0,5-0,6% and ВГО 2%). Each one matches a single Excel quotation sheet.

### 3.9 Daily quotation

A reference price for one (quotation product type, calendar date). Stores up to four price bases — CIF NWE / Basis ARA, FOB MED, FOB Rotterdam, plus the formula-derived "Среднее" — plus an operator comment. The set of bases shown depends on the product type (see §4.8).

### 3.10 Deal

The central transaction record. A deal has:

- An identity: deal type (KG export / KZ domestic / OIL), deal number, year, and a printable code in the form `TYPE/YY/NNN` (e.g. `KZ/26/123`).
- A period: quarter and Russian month name.
- A product: factory, fuel type, sulphur content.
- A supplier side: counterparty, contract, contracted volume and amount, delivery basis, quotation/discount/price, departure station, shipped volume and amount, payment running totals and last payment date, currency, manager.
- An optional chain of up to **six intermediary company groups** (positions 1 through 6), each with its own contract reference, price, currency, and a "preliminary vs final" stage flag.
- A buyer side: counterparty, contract, delivery basis, destination station, contracted volume and amount, quotation/discount/price, ordered volume, remaining volume, shipped volume and amount, payment running totals, currency, manager.
- A logistics block: forwarder, intermediary company group used for logistics settlement, planned tariff, preliminary tonnage and amount, actual tariff, actual shipped volume, invoice volume and amount, "railway in price" flag, trigger basis, currency, free-text notes.
- A surcharge block: amount and the party it is re-invoiced to.
- Staff assignments: trader, supplier-side manager, buyer-side manager.
- Lifecycle flags: draft / active / archived (see §5.1).

### 3.11 Supplier pricing variant / buyer pricing variant

A deal can carry several pricing variants per side ("lines") — for example, the supplier might have a default quote plus an alternative quote on a different basis or station. Each variant carries its own quotation product type, quotation value, discount, computed price, delivery basis, departure (or destination) station, and an "appendix" identifier (e.g. "Приложение №1") for contract reference. Variants also carry a pricing stage (preliminary / final), a calculation mode (fixed price / monthly average / trigger window / manual formula with foreign-exchange rate), and an optional explicit month for monthly-average lookup.

The default variant on each side is what is displayed in the deal's main fields; switching it propagates the change to those main fields.

### 3.12 Shipment register entry

A physical shipment fact: registry type (KG / KZ), date, waybill number, wagon number, shipment volume, loading volume, departure and destination stations, fuel type, supplier, buyer, factory, forwarder, optional intermediary company group, optional links to deal and to specific supplier/buyer pricing variants, railway tariff, computed shipped tonnage amount, override flags, currency, invoice number, comment, and optional "supplier appendix" / "buyer appendix" tags.

### 3.13 Per-shipment price

For each shipment that is priced from a deal, the system holds one auto-generated price row per side (supplier and buyer): the quotation product type, the quotation average used, discount, computed price, volume, and resulting amount. Plus a trigger window (start date, days, basis) for trigger-based pricing.

### 3.14 Payment

A single payment entry on a deal: side (supplier or buyer), amount, payment date, free-text description, currency, and a type (payment / refund / offset).

### 3.15 Logistics ledger entry (ДТ-КТ)

One ledger per (forwarder × intermediary company group × year), with: opening balance, total payment, refund, fines, surcharge preliminary, OGEM fee. The ledger row links to detail-level logistics payments.

### 3.16 Logistics payment

A single payment entry on a logistics ledger: date, amount, currency, description.

### 3.17 Tariff

A railway rate per route (departure station × destination station) × forwarder × fuel type × month × year, with a planned tariff value and optional normative days.

### 3.18 Overage / surcharge

A penalty claim record: reason, amount, period, route, claim metadata (number, dates, issued by, issued to, claimed/accepted/paid amounts, approval status, payment date, remaining debt, comment) and an optional re-invoicing block carrying the same lifecycle a second time (re-invoice code, dates, amounts, acceptance status, payment, remaining debt).

The re-invoicing block exists in the data model but is largely unused by the form today — operators currently track only the claim block.

### 3.19 Application (заявка)

A buyer purchase order: application number, date, fuel type, product name, tonnage, destination station, station code, siding, full consignee details (name, БИН, two consignee codes, legal and postal address), railway parties (consignor, carrier, wagon operator, tariff payer), SNT-specific fields (buyer name and БИН for SNT, delivery address for SNT, tax authority code, virtual warehouse), an "ordered" flag, assigned manager and assigner, the source PDF, and the source email address.

An application can be linked to one or several deals with an allocated volume per link.

### 3.20 SNT / ESF document

Tax-document records imported from the company's 1C accounting system. SNT (товарно-транспортная накладная) and ESF (электронная счёт-фактура) are similar structures, both carrying registration number, dates, supplier and receiver BIN/name, goods description, quantity, unit, prices, and totals. ESF additionally holds tax-amount fields.

### 3.21 Attachment

A user-uploaded file attached to a deal. Each file is tagged with:

- A **category**: application, contract, appendix, SNT, ESF, waybill, act of completed works, invoice, quality certificate, reconciliation act, or other.
- A **section**: supplier, buyer, logistics, or other.
- A filename, size, mime type, uploader, upload time.

### 3.22 Year archive

A marker indicating that a calendar year is locked. Only administrators can lock or unlock a year.

---

## 4. Business Rules

### 4.1 Deal identification

- **Numbers** are issued from per-(deal type, year) counters and never roll over years. Two deals with the same deal number must differ in either type or year.
- **Deal code** is auto-formatted as `TYPE/YY/NNN` (e.g. `KZ/26/123`) and re-derived whenever the underlying fields change.
- **Default currency** at creation depends on deal type: KG → USD, KZ → KZT, OIL → USD.

### 4.2 Derived deal totals

These quantities are computed by the system and not entered by hand:

- Supplier contracted amount = supplier contracted volume × supplier price.
- Buyer contracted amount = buyer contracted volume × buyer price.
- Supplier balance = supplier shipped amount − supplier payment.
- Buyer debt = buyer payment − buyer shipped amount. (The sign convention was reversed at one point; downstream reports may need re-verification.)
- Buyer remaining = buyer contracted volume − buyer ordered volume.
- Preliminary amount = planned tariff × preliminary tonnage.

The system rolls these forward on every relevant change.

### 4.3 Currency rules

- Every deal carries three independent currencies: **supplier currency, buyer currency, logistics currency**. A legacy single deal-level currency is mirrored from the supplier currency for backward compatibility with older reports.
- At deal creation, the operator picks one currency and the system mirrors it into all three side currencies. The operator can then override any of them.
- **Payment, shipment and intermediary-group currencies can each override the side currency** they belong to. If a row leaves currency unset, it inherits the relevant side currency.
- A payment is rolled up into the deal's running supplier-payment or buyer-payment total **only if it matches the deal's currency on that side** (or has no currency set, in which case it inherits). Mismatched-currency payments are silently excluded from the side total. (See Open Questions — is this intended or should FX conversion apply?)
- Margin display in the company chain visualisation is shown only when supplier, buyer, and forwarder are all in the same currency; otherwise it is hidden.

### 4.4 The default-variant invariant

Every deal must always have exactly one default pricing variant on the supplier side and one on the buyer side. On deal creation, the system seeds a default variant from the deal-level fields. Whenever a default variant is updated, its key fields (price condition, quotation, discount, price, delivery basis, station) are mirrored back into the deal-level fields. When the operator edits the deal-level fields directly, the change is mirrored into the default variant.

### 4.5 Payments

- A payment row has a **side** (supplier or buyer), an **amount**, a **payment date**, an optional **description**, an optional **currency**, and a **type**.
- Types: **payment** (default), **refund**, **offset** (взаимозачёт).
- Refunds and offsets reduce the running side total. The operator may also enter a negative payment amount directly — this is preserved deliberately.
- The deal's running supplier-payment and buyer-payment totals are recalculated on every payment add, edit, or removal.

### 4.6 Shipment register & auto-pricing

- For each shipment row, the system computes **shipped tonnage amount = CEIL(shipment volume) × railway tariff** by default. The operator can override this amount or disable the CEIL rounding per row.
- Whenever a shipment is added, the system creates up to two **per-shipment price rows** (one for the supplier side, one for the buyer side), tied to the shipment.
- The pricing formula depends on the variant's **calculation mode**:
  - **Fixed / manual** — copy the variant's price.
  - **Monthly average** with the variant flipped to *final* — use the monthly average of the chosen quotation product type for the shipment's resolved month.
  - **Manual formula** — use the variant's price with the variant's stored foreign-exchange rate.
  - **Trigger** — currently not fully wired; falls back to the variant's price.
- The "resolved month" comes from an explicit override on the shipment, then from the shipment date, then from the deal's month.
- When a shipment's volume or date is edited, the matching per-shipment price row's volume and date are updated automatically, but the price is **not** overwritten — manual price corrections are preserved.
- If a shipment's station changes, the system re-points the shipment to the matching pricing variant for that station and re-fires pricing.
- The deal's totals (shipped volume and amount on each side) are refreshed on every shipment change.
- When a deal-level price or a variant's price changes, auto-priced rows for that side are repriced in volume × price terms, but operator-corrected prices stay intact.

### 4.7 Pricing stage (preliminary → final)

- Each pricing variant carries a stage flag: **preliminary** (default) or **final**.
- When the operator flips a variant from preliminary to final, the system snapshots the current quotation and price into "preliminary quotation" and "preliminary price" fields and stamps the time. This preserves an audit trail of what the contract looked like before it was firmed up.
- After flipping to final, the operator can ask the system to "refire pricing" — every shipment under that variant has its per-shipment price recomputed using the new stage rules.

### 4.8 Quotations — column layouts per product

Each quotation product type maps to one of seven column layouts. The Среднее column is auto-calculated whenever the operator edits any of the source bases.

| Layout | Products | Columns |
|---|---|---|
| Full | Газойль 0,1%, Мазут 1,0% Fuel oil, Мазут 3,5%, Нафта, Jet, default for unknown | CIF NWE / Basis ARA, FOB MED, FOB Rotterdam, **Среднее = avg(CIF NWE, FOB Rotterdam)**, Комментарии |
| Cargo-barge | ВГО 0,5-0,6%, ВГО 2% | CIF NWE Cargo, FOB Rotterdam barge, **Среднее = avg(CIF NWE Cargo, FOB Rotterdam barge)**, Комментарии |
| Single FOB Rotterdam | Eurobob, Мазут 0,5% Marine Fuel ("FOB Rotterdam barge" label) | FOB Rotterdam, Комментарии |
| Single FOB Rotterdam with sulphur tag | Мазут 1,0% FOB Rotterdam, Мазут 3,5% FOB Rotterdam | FOB Rotterdam 1,0% / 3,5%, Комментарии |
| Single FOB NWE | Мазут 1,0% FOB NWE, Мазут 3,5% FOB NWE | FOB NWE, Комментарии |
| Single FOB MED | Prem Unl 10 ppm | FOB MED Italy, Комментарии |
| CIF + FOB MED | ULSD 10 ppm | CIF NWE / Basis ARA, FOB MED Italy, Комментарии (no Среднее) |
| BRENT | BRENT DTD (Platts) | мин, макс, **сред = avg(мин, макс)**, Комментарии |

A formula column requires at least two non-null source values; otherwise it is blank.

### 4.9 Quotations — daily entry

- The daily-entry view shows **one month at a time per product**.
- A row is shown only if it already has data **or** the operator has explicitly added that day via a date picker. If the month is empty, the view falls back to listing every weekday so the operator can start filling in. Weekend days never appear automatically but can be added explicitly.
- Dates display as `01.06.2026`. Numbers display with **3 decimals and a comma decimal separator** (`896,500`).
- The footer block on each daily-entry sheet shows:
  - One row of column averages directly under the Среднее column.
  - One labelled row per editable base column (e.g. "Среднее CIF NWE Cargo", "Среднее FOB Rotterdam barge") with the value placed in the **first numeric column**. This matches the operator's source spreadsheets exactly.

### 4.10 Quotations — summary view ("Свод КОТ")

- A matrix with one row per product and three sub-columns per month (Ср / Фикс / Тр) plus a Year column.
- **Ср** = monthly average of the daily quotations, where each day's value is the first non-null among (Среднее, CIF NWE, FOB Rotterdam, FOB MED).
- **Фикс** = the quotation on a configurable "fix day" (default 15) of the month; blank if no quotation exists on that exact day.
- **Тр** = the average over a configurable "trigger window" (default 35 days) starting from day 1 of the month. The window can spill into the following month.
- **Year** = arithmetic mean of the 12 monthly averages.

### 4.11 Tariffs

- A tariff is uniquely identified by (destination station, departure station, forwarder, fuel type, month, year).
- The operator must supply planned tariff, month, and year; FKs to stations / forwarder / fuel are optional.
- When a tariff is looked up for a (forwarder, intermediary group, year) and no exact-year match exists, the system falls back to the previous year, and so on.

### 4.12 Logistics ledger (ДТ-КТ)

- Saldo for one ledger row = opening balance + payment − shipped amount − fines − surcharge preliminary − OGEM − refund.
- The "shipped amount" is recomputed live from the shipment registry by summing all shipped tonnage amounts for that (forwarder, intermediary group, year).
- The saldo cell is colour-coded — red when negative, green when non-negative.

### 4.13 Applications

- The only required field at creation is the date.
- The "ordered" status is a simple yes/no flag.
- An application can be allocated to one or more deals; each link can carry an allocated volume.
- The list view supports a free-text search across application number, product name, consignee name, and fuel type name.

### 4.14 Activity logging (what gets recorded)

- Every change to a deal's payments leaves a record with old and new amounts and the currency.
- Every change to a deal's main fields — volumes, prices, quotations, discounts, dates, contracted amounts, supplier / buyer / factory / fuel / forwarder / manager / trader assignments, the archive flag — leaves a record in the activity feed with a human-readable label for any referenced entity.
- While a deal is in draft, **no** activity is recorded. Activity logging begins the moment the deal is saved (draft flag flipped off).
- The system-level audit log captures every change to money-relevant records with the full before/after state, excluding routine timestamp updates from the list of changed fields.

### 4.15 Archive

- A deal can be flipped to "archived" by an administrator at any time. The flip itself is logged.
- Once archived, only an administrator can edit the deal further.
- Years can be locked at the administrator level (declared an "archive year"). The lock is currently a flag on the year record; how it is enforced on individual record edits is not visible in the product surface today — see Open Questions.

### 4.16 Excel import — volume routing

- When a registry import file carries only a single "quantity" column, the operator chooses with a toggle whether to interpret it as shipment volume (отгрузка) or loading volume (налив).
- If the file carries explicit "shipment" and "loading" columns, those win and the toggle has no effect.

### 4.17 Other rules

- Each shipment can declare an "appendix" tag on the supplier and/or buyer side (e.g. "Приложение №1" to a contract). This tag also exists on pricing variants for the same purpose.
- The company chain on a deal supports up to six intermediary positions. Each position can override the deal's currency.
- A deal created on the new-deal page is in **draft** state from the first save. Drafts do not appear in the main deal list. When the operator saves the form ("Save deal"), the draft flag flips off and the deal becomes visible. Abandoned drafts are not auto-cleaned — they remain in the system until an administrator removes them.

---

## 5. Workflows & State Transitions

### 5.1 Deal lifecycle

A deal does not have a discrete status enum. Its position in the lifecycle is implied by two flags and the values of its fields.

```
                  (operator clicks "+ New deal")
                              │
                              ▼
                ┌──────── DRAFT ─────────┐
                │ Invisible in deal list │
                │ Activity logging off   │
                │ Form auto-saves        │
                └──────────┬─────────────┘
                           │ Operator clicks "Save deal"
                           ▼
                ┌──────── ACTIVE ────────┐
                │ Visible everywhere     │
                │ Activity logging on    │◀────────┐
                │ Full edit by writable  │         │
                │ roles                  │         │ Unarchive
                └──┬──────────────────┬──┘         │ (admin)
                   │ Archive          │            │
                   │ (admin only)     │            │
                   ▼                  │            │
                ┌──────── ARCHIVED ───┴────────────┘
                │ Read-only for non-admins         │
                │ Admin can still edit             │
                └──────────────────────────────────┘
```

There is no "Completed" or "Closed" state. A deal is considered fulfilled when shipped volume equals contracted volume and payment equals contracted amount on both sides, but the product does not mark it as such — the operator either leaves it active or archives it manually.

### 5.2 Pricing-variant stage

```
                  ┌──── preliminary ────┐    flip to final
                  │ price editable      │  ─────────────────▶
                  └──────┬──────────────┘
                         ▼
                  (system snapshots quotation/price
                   into "preliminary quotation" /
                   "preliminary price" and stamps time)
                         │
                         ▼
                  ┌────── final ────────┐
                  │ stage is now "final"│
                  │ operator can refire │
                  │ shipment pricing    │
                  └─────────────────────┘
```

Flipping back from final to preliminary is allowed; the preliminary snapshot fields keep their values.

### 5.3 Company-chain position stage

Each intermediary position in the company chain has its own preliminary/final flag, controlled purely by the operator. No automation.

### 5.4 Payment type

Each payment row carries a type chosen at insert time and editable later. Three values: payment / refund / offset. No transition logic — type is a property of the row, not a state.

### 5.5 Application status

An application is either "ordered" or "not ordered". A single toggle, no multi-step workflow.

### 5.6 Surcharge claim — implicit lifecycle

Although there is no explicit status field, the operator's workflow on a surcharge claim is:

1. **Issued** — operator fills claim number, issue date, claimed amount.
2. **Accepted** — accepted amount and approval status filled.
3. **Paid** — paid amount, payment date, remaining debt updated.

Then optionally:

4. **Re-invoiced** — re-invoice code, date, amount.
5. **Re-accepted** — re-invoice accepted amount, response date.
6. **Re-paid** — re-invoice paid amount, payment date.

In practice the operator only fills the first block in the form today.

### 5.7 Workflows the operator performs

**Creating a deal.** Operator selects deal type → the system issues a sequential number and pre-fills period (current year/quarter/month). Operator fills supplier section, buyer section, optional intermediary chain (up to six positions), logistics section. The form auto-saves into a draft. When the operator clicks "Save deal", the draft becomes visible to everyone and activity logging starts.

**Backfilling a missed day in quotations.** Operator opens the daily-entry view for the relevant product and month, clicks "+ день", picks the missing date in the native date picker, and the row appears in the correct position. Weekend days are allowed.

**Recording a shipment.** Operator opens the shipment registry, picks the registry type (KG / KZ), enters the row inline: date, waybill, wagons, volume, station, deal link, etc. The system auto-creates per-shipment supplier and buyer price rows, computes the railway-tariff amount (with CEIL), and refreshes the parent deal's shipped totals.

**Recording a payment.** Operator opens the deal detail, clicks the relevant payment cell, adds a payment row with side / amount / date / currency / type / description. The deal's running side payment total recomputes immediately.

**Linking an application to a deal.** Operator opens the application list, clicks "Link to deal" on a row, picks a deal, optionally enters allocated volume. The link is M:N — one application can be split across multiple deals.

**Closing a logistics year.** Administrator-driven: archive year is declared. Individual deals are archived one by one or in bulk by administrator.

**Exporting a deal passport.** Operator clicks "Excel" on the deal detail. The system generates a styled multi-sheet workbook with frozen headers and per-side colour banding.

**Importing a shipment register.** Operator opens the import wizard, picks the registry tab, uploads an `.xlsx`, previews the parsed rows, optionally toggles the single-quantity volume routing, then confirms. Imported rows behave exactly as if they had been entered by hand — they fire the same auto-pricing.

**Creating a new user.** Administrator opens settings → users, provides email, full name, role, initial password. The user can log in immediately.

**Copying a deal.** A "Скопировать сделку" action exists on the deal detail page; it creates a new deal with the same supplier, buyer, intermediary chain, supplier and buyer pricing variants, and a freshly issued deal number. (Note: this feature exists in the UI per project notes; confirm scope.)

---

## 6. External Touchpoints

### 6.1 Excel exports (out-bound)

- **Deal passport export.** A styled `.xlsx` with side-coloured bands (supplier amber, buyer blue, intermediary purple, logistics another), frozen headers, thousands grouping, a totals row. Generated on demand from the deal detail page.
- **Quotations export.** A workbook with one sheet per calendar month for the chosen product, a title row, header row, daily data, a per-column "Среднее" footer block, autofilter on the header. The operator chooses which columns to include via a checkbox dialog before export.
- **Logistics summary export ("Свод КОТ").** A wide-format matrix export of the quotations summary matrix.

### 6.2 Excel imports (in-bound)

Three wizards, each accepting `.xlsx`:

- **Shipment registry import.** Columns expected: quarter, month, date, waybill number, wagon number, shipment volume, shipment month, railway tariff, invoice number, comment, loading tonnes, additional month. A volume-routing toggle controls how a single quantity column is interpreted (see §4.16).
- **SNT import.** Columns: SNT number, date, supplier, receiver, goods, quantity, amount, wagon number, waybill number. Creates an SNT document **and** an auto-generated shipment register row from the same data.
- **ESF import.** Columns: ESF number, date, supplier, receiver, goods name, quantity, amount, VAT, total. Optionally linked to a deal before import. Creates an ESF document and a shipment register row.

Each wizard offers a "download template" button that produces a blank workbook with the expected column headers.

### 6.3 File uploads

Users can attach files to a deal (PDF, Office documents, etc.). Each attachment is tagged with a category (contract, appendix, СНТ, ЭСФ, waybill, act, invoice, quality certificate, reconciliation act, other) and a section (supplier, buyer, logistics, other). Files are downloadable by anyone with read access to the deal.

### 6.4 Realtime updates

Deal activity feeds and application chat threads update in real time across users — when one operator posts a comment or the system records a payment change, every other open viewer of the same deal sees the new entry without refreshing.

### 6.5 What the product does NOT integrate with

- No email or SMS notifications.
- No Slack / Telegram / messenger integration.
- No payment gateway / banking API.
- No direct integration to the company's 1C accounting system — SNT and ESF documents flow in via Excel uploads only.
- No external tax / regulatory reporting integration.
- No telemetry / analytics tracking of user actions.
- No scheduled / cron jobs visible to users.

---

## 7. Non-Functional Expectations

### 7.1 Scale

- **Deals**: low thousands total. Numbering up to `KZ/26/190` is documented as imported from a legacy system.
- **Shipment registry**: thousands of rows per deal type per year; the registry list is a high-traffic, frequently-scrolled view.
- **Tariffs**: in the low hundreds at any time.
- **Quotations**: ~22 trading days × ~16 products × 12 months ≈ a few thousand rows per year.
- **Deal activity feed**: capped at the most recent 200 entries when first loaded; older entries can be paged in.

### 7.2 Concurrency

- Multiple operators routinely work in the same deal simultaneously (one in logistics, one in finance). The product handles overlapping edits via realtime activity updates rather than locking.
- No edit locks, no "this record is being edited by X" indicator.

### 7.3 Audit & retention

- The audit log and the deal activity feed grow without bound — there is no automatic retention or archival policy.
- The audit log captures only money-relevant tables; reference-data changes (renaming a counterparty, adding a station) are deliberately not audited.
- Administrators can read the audit log; nobody can edit or delete it.

### 7.4 Confidentiality

- The product is single-tenant. Everything an authenticated user can see is the same as what every other authenticated user can see — there is no row-level visibility, no per-region scoping, no field-level redaction.
- Access control restricts **write** actions by role; **read** is uniform across all data.

### 7.5 Compliance markers

- Attachment categories explicitly cover the Kazakhstan documentary workflow: contract, appendix, СНТ, ЭСФ, waybill, act of completed works, invoice, quality certificate, reconciliation act.
- Application records carry Kazakhstan-specific tax/SNT fields (БИН, virtual warehouse, tax authority code).

### 7.6 Localisation

- All UI text and content is in Russian.
- Numbers in quotations use the Russian comma decimal separator (`896,500`).
- Dates use the Russian DD.MM.YYYY format.
- Currencies typically encountered: USD, KZT, KGS, RUB.

### 7.7 Performance expectations from user behavior

- Operators expect deal-list navigation to be near-instant; the system supports thousands of records via aggressive client-side caching of reference data.
- Filter changes on the registry and deal list are expected to take effect in well under a second.
- Excel exports are expected to complete within a few seconds for any single deal or month of quotations.

---

## 8. Areas of Past Requirement Change

These are the parts of the product where business rules have been rewritten more than once. A successor system should treat them as the most volatile areas and design for flexibility.

### 8.1 Currency model

The product started with a single deal-level currency. Cross-currency deals (buy in KZT, sell in USD) broke this assumption, leading to the current three-currency model (supplier, buyer, logistics) with the original deal currency retained as a mirror. Each payment, each shipment, and each intermediary chain position can also override the side currency. The new-deal form was patched to mirror the chosen currency into all three side currencies to avoid a "currency reset" bug.

### 8.2 Pricing model

The pricing layer has been rewritten across at least nine iterations:

- Baseline: a single price per side, copied to each shipment.
- Multi-variant pricing: a deal can have several pricing variants per side, each with its own quotation, discount, station.
- Line-aware propagation: when a variant's price changes, only the shipments tied to that variant are re-priced.
- Station-driven reassignment: a shipment's variant is auto-reselected when its station changes.
- Distinct loading vs shipment pricing paths.
- Monthly-average mode: the price comes from the monthly average of a quotation product type.
- Preliminary / final stage with snapshotting.
- Manual formula mode with a stored foreign-exchange rate.
- Wide-column choice ("price source"): the operator picks which column of the quotation row to read (Среднее vs CIF NWE vs FOB MED vs FOB Rotterdam vs historical "CIF NWE standalone").
- Per-line calculation mode (on-date vs averaged-month).

Earlier enum values that were once selectable are still in the data but no longer reachable from the UI (e.g. "avg to date", "manual in formula"). A previous "sub-quotation" data model was introduced and then fully rolled back.

### 8.3 Buyer debt sign

The buyer-debt formula was inverted at one point. Existing rows were re-derived in place. Any downstream report that relied on the old sign convention needs verification.

### 8.4 Permission scope

The set of roles has grown over time. The most recent change was the addition of "finance" and "trader". Trader was originally meant to be a writable role but has been reclassified as read-only — and there is an unresolved inconsistency between that stated rule and the technical enforcement (see Open Questions).

The right to delete a deal's child records (variants, payments, attachments) was widened from administrator-only to writable-roles after operators complained that managers couldn't fix their own mistakes.

### 8.5 Shipment rounding

The default rule "shipped amount = CEIL(volume) × tariff" required several patches: an override flag on the amount, an override flag on the rounding, a KZ-specific tariff basis toggle. Different forwarders apparently round differently.

### 8.6 Overlapping fields the operator now ignores

- The overage / surcharge re-invoicing block (~14 columns) sits behind the operator's current form.
- The link from a surcharge to a specific deal is now done via free-text "deal passport number" rather than a structured reference.
- Tariffs carry a "normative days" field whose use today is unclear.
- A cached "monthly averages" table for quotations exists but is no longer queried; live consumers recompute averages on the fly.
- A standalone "CIF NWE" quotation column was removed from the daily-entry form but remains in the data for historical deals that referenced it.

### 8.7 Draft cleanup

The product creates a draft deal the moment the operator opens the new-deal form. If the operator abandons the form, the draft persists indefinitely. There is no auto-cleanup.

### 8.8 Activity logging granularity

Deal-level field changes are logged, but changes to **pricing variants and intermediary chain positions** are not added to the activity feed (they are only in the system audit log). This was a deliberate scope decision but is a candidate for change as operators start asking "who changed this variant's price".

---

## 9. Open Questions & Ambiguities

These are unresolved or contradictory rules the product team should clarify before the next system is designed.

1. **Should "trader" be a writable or read-only role?** Internal documentation and intent point to read-only, but the enforcement layer still allows trader writes. The desired behaviour needs to be confirmed before migration.

2. **Should deals have an explicit "Closed" state?** Today fulfillment is implicit (volume shipped = volume contracted, payment = amount). Operators have to archive manually. A status enum (active / fulfilled / archived / cancelled) would replace the current is_draft + is_archived pair.

3. **What is the intended behaviour of the "trigger" pricing mode?** Currently it falls back to the variant's price; the desired formula (presumably "average over N days starting from a trigger event") is not wired.

4. **Cross-currency payments and rollups.** A payment in a currency different from the deal's side currency is silently excluded from the running total. Is this intended? Should the system convert via a stored FX rate instead?

5. **What is OGEM?** The OGEM fee column on the logistics ledger lacks a documented business definition.

6. **Are the surcharge re-invoicing fields still required?** The product holds 14 such fields but the operator does not fill them. Should they be removed or surfaced in the form?

7. **What enforces the year archive lock?** A year can be declared "locked" but it is unclear today whether attempting to edit a record from that year is actually blocked or whether the lock is purely informational.

8. **Application → deal binding.** The list view exposes a filter that suggests a direct reference from a deal to an application, but the relationship is only M:N through the link table. Confirm whether the filter is supposed to walk that link or has another semantic.

9. **What is "normative days" on a tariff?** The field is stored but not visibly consumed.

10. **Activity coverage scope.** Changes to pricing variants and intermediary chain positions are not logged in the activity feed today. Should they be?

11. **Multi-tenancy.** Nothing in the model scopes data by tenant or company. A future move to multi-tenant would require revisiting every "everyone sees everything" assumption.

12. **Abandoned drafts.** Should the system auto-clean drafts older than N days? Today it does not.

13. **Activity-feed write rights.** Any authenticated user can post a comment on any deal, including read-only viewers. Is this intentional, or should comment-posting be tied to write permissions?

14. **Service-account audit gap.** Operations performed by an administrator using the underlying service account leave no user attribution in the audit log. Compliance posture relies on key custody rather than on technical traceability.

15. **The standalone "CIF NWE" column on quotations.** No longer in the daily-entry form but still referenced by historical deals. Does it need to be brought back, or migrated into one of the existing bases?

16. **Deal copy.** The "Copy deal" action exists; the precise rules for which fields, variants, attachments, and child records are copied vs. reset need to be confirmed.

17. **Archive year vs archive deal.** Are these two locking mechanisms (a per-deal flag and a per-year flag) intended to interact, or is one of them obsolete?

18. **`logistics shipment month` override.** A deal can carry an override month for tariff lookups. Is this exposed to the operator in the UI today, or only used by import paths?

---

**End of product specification.**

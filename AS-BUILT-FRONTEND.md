# AS-BUILT-FRONTEND.md — Routes & Functional Coverage

**Last Updated:** 2026-06-22
**Status:** Production (v1.0)
**Language:** Russian (Cyrillic operator-facing UI)

---

## Application Overview

Singularity Trading CRM is a specialized petroleum product trading platform serving Central Asian operators (Kazakhstan, Kyrgyzstan). The application tracks multi-sided commodity deals, logistics, shipment registries, quotations, and financial settlement across two deal types: **KG** (export) and **KZ** (domestic).

**Shared Chrome:**
- Sidebar nav (9 primary + 2 admin-only routes)
- Top bar with user role indicator & workspace name
- Workspace tab bar (recent addition — persists recently visited routes)
- Real-time activity panels on detail pages
- Toaster notifications (top-right, sonner)
- Global refs cache (suppliers, buyers, factories, forwarders, fuel types, stations, company groups — preloaded on dashboard mount)

**Role System:**
- `admin` — full access, archiving, user management
- `manager`/`logistics`/`finance` — writable operational access
- `trader`/`accounting`/`readonly` — read-only
- Unauthenticated — redirected to `/login`

---

## Routes & Detailed Specifications

### `/` (Dashboard Home)

**File:** `/src/app/(dashboard)/page.tsx`
**Title (Russian):** Дашборд / Главная
**Purpose:** Executive overview of year-to-date deal volumes, shipments, payments, and variance by currency. Real-time KPI cards link to detail views for drill-down analysis.
**Visibility:** All authenticated users
**Editability:** Read-only (charts are analytics, no direct manipulation)
**Top-Level Layout:**
- Header: Title + Year filter (number input) + Deal type tabs (All / KG / KZ / OIL)
- KPI cards (4-column grid): Shipped (тонн), Remaining to ship, Deal count, Pending applications
- Financial summary table by currency (rows = USD, KZT, KGS, RUB; columns = Deal count, Shipped amount, Buyer payments, Supplier payments, Receivables, Payables)
- Three chart blocks: Monthly volumes (bar/line/pie toggle), Product type distribution (pie), Financial flow (contract→ship→paid)
- Deal type split (pie chart)

**Data Shown:**
- Year filter (currently selected year, default = current year)
- Deal type breakdown (KG/KZ counts)
- Total contracted volume (buyer side, in tons)
- Total shipped (buyer side, in tons)
- Remaining to ship = contracted − shipped
- Per-currency: shipped amount (in currency), buyer paid, supplier paid, buyer debt (negatives shown red), supplier balance due (negatives shown red)
- Monthly breakdown: contracted, shipped (line chart with toggle to bar/pie)
- Top 8 fuel types by volume (pie chart)
- Financial stages: supplier contracted, buyer contracted, total shipped, supplier payments, buyer payments

**Actions:**
- Click KPI cards to navigate to detail views: Shipped → /registry, Remaining → /deals, Deal count → /deals, Pending applications → /applications
- Chart type toggle (3 icons per chart: bar, line, pie)
- Year filter changes all visible data; tabs filter by deal type (client-side)
- No create/edit actions on dashboard itself

**Filters/Search:**
- Year filter (top-right, number input)
- Deal type tabs (All / KG / KZ / OIL) — state lives in component (no URL params)
- All filtering is client-side; server provides year's full dataset once

**Sub-routes:** None (dashboard is leaf)
**Dialogs/Modals:** None

---

### `/login`

**File:** `/src/app/(auth)/login/page.tsx`
**Title:** Вход в систему
**Purpose:** Supabase email + password authentication. On success, redirects to `/`.
**Visibility:** Unauthenticated users only (redirected to `/` if already logged in)
**Editability:** N/A
**Top-Level Layout:**
- Centered card on dark gradient background
- Logo icon (orange Fuel icon in rounded box)
- Title + subtitle ("Войдите в CRM систему")
- Email input
- Password input
- Login button (disabled while loading)
- Error message (if auth fails)

**Actions:**
- Submit form → POST to Supabase auth, then router.push("/") on success
- Error handling: "Неверный email или пароль"

---

### `/spravochnik` (Reference Data Hub)

**File:** `/src/app/(dashboard)/spravochnik/page.tsx`
**Title:** Справочник
**Purpose:** Landing page for reference data (counterparties, logistics, products). Links to 9 sub-routes.
**Visibility:** All authenticated users
**Editability:** Read-only; navigation to editable sub-pages
**Top-Level Layout:**
- Header: Title + subtitle
- 3×3 card grid, each card is a link to a sub-route

**Cards (Clickable Links):**
1. Поставщики (Suppliers) → /spravochnik/suppliers
2. Покупатели (Buyers) → /spravochnik/buyers
3. Заводы (Factories) → /spravochnik/factories
4. Экспедиторы (Forwarders) → /spravochnik/forwarders
5. Грузополучатели (Consignees) → /spravochnik/consignees
6. Станции (Stations) → /spravochnik/stations
7. Виды ГСМ (Fuel Types) → /spravochnik/fuel-types
8. Группы компании (Company Groups) → /spravochnik/company-groups
9. Коммерция (Managers/Employees) → /spravochnik/managers

**Sub-routes:**
- `/spravochnik/suppliers` — Read/create/edit suppliers (counterparty table, type='supplier')
- `/spravochnik/buyers` — Read/create/edit buyers (counterparty table, type='buyer')
- `/spravochnik/factories` — Read/create/edit factories
- `/spravochnik/forwarders` — Read/create/edit forwarders
- `/spravochnik/consignees` — Read/create/edit consignees (waybill recipients)
- `/spravochnik/stations` — Read/create/edit railway stations (departure/destination points)
- `/spravochnik/fuel-types` — Read/create/edit fuel types (color-tagged: diesel, gasoline, etc.)
- `/spravochnik/company-groups` — Read/create/edit company groups (trading chain participants)
- `/spravochnik/managers` — Read/create/edit employee profiles (admin-only edit)

---

### `/quotations`

**File:** `/src/app/(dashboard)/quotations/page.tsx`
**Title:** Котировки
**Purpose:** Daily price tracking for fuel products. Operator maintains a spreadsheet-like table per product type per month, matching the Excel source format exactly.
**Visibility:** All authenticated users
**Editability:** Writable if `isWritable` (role-based)
**Top-Level Layout:**
- Header: Title + Button "Тип котировки" (add product type) + Refresh button
- Two tabs: "Котировки" (products) | "Свод КОТ" (summary)
- Tab 1: Grid of product type cards (4-column responsive). Click a card to drill into its detail table.
- Detail view (replaces grid): Back button + Product name/sub-name + Excel export button + "+ день" button (date picker) + Month/year navigation

**Data Shown (Grid View):**
- Product type name (e.g., "ГАЗОЙЛЬ 0,1%")
- Sub-name (e.g., "CIF NWE/Basis ARA")
- Basis (e.g., "FOB Rotterdam")
- Tag pills showing column labels (first 5 columns truncated, formula columns highlighted in amber)

**Data Shown (Detail View):**
- Excel-parity table (max-content width, fixed cols 130px date + 110px per price col)
- Monospace date column: DD.MM.YYYY format
- Numeric columns: 3 decimals with Russian comma separator (e.g., "896,500")
- Weekly data only: Mon–Fri visible; weekends hidden unless data exists
- Footer: Per-formula-column average row
- Footer: Per-editable-column "Среднее {label}" rows (one per numeric column, average value parks in first numeric column only, matches Excel)

**Columns (Product-Specific):**
- Defined in `/lib/constants/quotation-columns.ts` per product name
- Each column: `{ key, label, editable, formula? }`
- formula="avg" columns: compute mean of their specified source columns or all editable columns

**Actions:**
- Click product card to drill into detail table
- Back button returns to product grid
- "+ день" button opens native date picker (constrained to current month)
- Excel export: dialog to select which columns to include, then downloads .xlsx
- Inline edit: click any numeric cell → input → blur to save
- Tab switch: "Котировки" ↔ "Свод КОТ"
- Month/year navigation: ← / → buttons
- Add product type: "Тип котировки" button → dialog (Name + Sub-name + Basis inputs)

**Sub-routes:** None (uses internal tab state)
**Dialogs/Modals:**
- Add product type dialog
- Excel export column picker

---

### `/deals`

**File:** `/src/app/(dashboard)/deals/page.tsx`
**Title:** Сделки
**Purpose:** Master list of all trading deals. Three view modes: "Все сделки" (flat list), "Паспорт KG" (export deals), "Паспорт KZ" (domestic deals).
**Visibility:** All authenticated users
**Editability:** Read-only list view; detail pages (`/deals/[id]`) handle edits
**Top-Level Layout:**
- Header: Title + Excel export button + "Новая сделка" button
- Tabs: "Все сделки" | "Паспорт KG" | "Паспорт KZ"
- Filter row 1: Year input + Search box + "Сбросить фильтры (N)" button + count badge
- Filter row 2: 10-column dropdown grid (suppliers, buyers, factories, fuel types, months, forwarders, company groups, group pos1, group pos2, applications)
- Main content: PassportTable (virtual scroll, sticky header, ~50-col table)

**Data Shown (PassportTable):**
- Columns: deal_code, year, month, factory, fuel type (color-coded), supplier, buyer, forwarder, various pricing tiers, volumes, company group chain, dates, status
- Every row is clickable → opens deal as a new workspace tab
- Color-coded deal type badges
- Fuel type badges: colored dot + name
- Numbers: 3 decimals, right-aligned, tabular font

**Actions:**
- Click row to open deal detail (as new tab — recent addition)
- Cmd/Ctrl+click → opens in background tab
- Tab click switches between list, KG passport, KZ passport
- Dropdown filters: pick supplier/buyer/factory/etc.
- Search box: substring match
- "Сбросить фильтры" button clears all filters
- Excel export: exports currently filtered rows
- "Новая сделка" button navigates to `/deals/new`

**Filters/Search:**
- All state persisted via nuqs (URL search params, history: "replace")
- Filtering: client-side on pre-loaded data

**Sub-routes:**
- `/deals/new` — Create new deal
- `/deals/[id]` — Edit existing deal
- `/deals/passport-kg` — Virtual sub-route (tab state)
- `/deals/passport-kz` — Virtual sub-route (tab state)

---

### `/deals/new`

**File:** `/src/app/(dashboard)/deals/new/page.tsx`
**Title:** Новая сделка
**Purpose:** Comprehensive multi-section form to create a deal with all pricing variants, logistics, company group chain, managers, and optional prepayment.
**Visibility:** All authenticated users
**Editability:** Writable (creates deal on submit)
**Top-Level Layout:**
- Back button + Title
- Multi-card form (accordion-like sections):
  1. Основные данные (Deal type, year, month, factory, fuel type, sulfur %, currency)
  2. Поставщик (Supplier, contract #, volume, pricing variants grid, station/delivery basis)
  3. Покупатель (Buyer, contract #, volume, pricing variants grid, station/delivery basis)
  4. Группы компании (Up to 6 company groups with quotation/discount/auto-price columns)
  5. Логистика (Forwarder, company group, shipment month override, planned tariff, preliminary tonnage)
  6. Ответственные (Supplier manager, buyer manager, trader)
  7. Оплата заранее (Optional: prepayment side, amount, date)
  8. Submit buttons: "Создать сделку" + "Отмена"

**Actions:**
- Submit form → generates deal number via RPC → inserts deal → inserts deal_supplier_lines / deal_buyer_lines variants → inserts deal_company_groups → inserts deal_payments (if prepay amount set) → toast success + redirect to `/deals`
- Auto-calc on company group rows: if user types quotation and discount, price fills automatically
- Tariff auto-lookup: depends on forwarder, destination station, fuel type, shipment month, year
- Cancel button → confirm dialog → delete draft deal → redirect to `/deals`
- Floating chat button (bottom-right) opens activity feed for the draft deal

---

### `/deals/[id]`

**File:** `/src/app/(dashboard)/deals/[id]/page.tsx`
**Title:** Деталь сделки (Deal Code)
**Purpose:** Full edit/view of a single deal. Displays all deal data, linked applications, deal-specific activity feed, and optional file attachments.
**Visibility:** All authenticated users
**Editability:** Writable if deal not archived (admin only for archived)
**Top-Level Layout:**
- Back button + deal code (e.g., "KZ/26/001") + deal status badge
- "Скопировать сделку" button (duplicate)
- "История" button (audit history)
- Multi-tab interface (rendered inline): Паспорт content, Активность panel on the right
- "Файлы" section
- Variants tables (supplier + buyer)

**Data Shown:**
- All fields from /deals/new (read-only display or inline editable inputs depending on role & archive status)
- Variants table (supplier side): Position, Is Default, Price, Price Condition, Delivery Basis, Station, Quotation, Discount, FX Rate, Appendix, Comments
- Variants table (buyer side): same structure
- Company groups chain (table): Position, Company Group, Quotation, Discount, Price, Contract Ref

**Actions:**
- Inline edit: click any field → text/number input → blur to save (if writable)
- Add variant: button at bottom of supplier/buyer variants table
- Remove variant: delete icon per row (if not is_default)
- Edit company group: inline select + number inputs
- Add company group: button (max 6 total)
- Скопировать сделку: button creates new deal copying current scalars + variants + chain
- File upload section: drag-drop / click to upload per category
- Activity feed: chat input + real-time updates from other users

---

### `/applications`

**File:** `/src/app/(dashboard)/applications/page.tsx`
**Title:** Заявки
**Purpose:** Buyer application/order requests. Tracks POs, quantities, receiving stations, carrier info. Links to deals for allocation.
**Visibility:** All authenticated users
**Editability:** Writable (create/edit/delete applications, toggle ordered status, link to deals)
**Top-Level Layout:**
- Header: Title + "Новая заявка" button
- Filter row: Search box (number/product/consignee) + count
- Table (9 columns): №, Дата, ГСМ, Тоннаж, Ст. назначения, Грузополучатель, Коммерция (manager), Статус (badge: Заявлено/Не заявлено), Actions

**Actions:**
- Click status badge to toggle is_ordered (boolean flip)
- Edit button → EditApplicationDialog
- Link to Deal button → LinkDealDialog
- Chat button → Inline dialog with ActivityFeed for this application
- Delete button → confirm → delete application + linked application_deals rows
- "Новая заявка" button → CreateApplicationDialog

**Dialogs/Modals:**
- CreateApplicationDialog
- EditApplicationDialog
- LinkDealDialog (dropdown: pick deal, input: allocated tonnage)
- Chat dialog (ActivityFeed for application)

---

### `/registry`

**File:** `/src/app/(dashboard)/registry/page.tsx` (1771 lines)
**Title:** Реестр отгрузки
**Purpose:** Shipment registry for KG (export) and KZ (domestic). Tracks every wagon/shipment with volumes, tariffs, rounded amounts, and company groups.
**Visibility:** All authenticated users
**Editability:** Writable (all cells inline-editable, bulk add via paste)
**Top-Level Layout:**
- Header: Title + "Добавить запись" / "Импорт" buttons
- Tabs: "KG (Экспорт)" | "KZ (Внутренний)"
- Filter row: Year + Search (forwarder/company group) + Reset
- Secondary filter grid: Forwarder dropdown | Company Group dropdown | Деал | Все месяцы | № вагона | № ЖД накладной
- Main content: Virtual-scrolled table, grouped by deal (collapsible)

**Table Layout (Registry):**
- Hierarchical: Deal group header (collapsed/expanded toggle) → Shipment records within group
- Deal group header: Deal code, Month, Fuel type, Factory, Supplier, Loading volume, Company group, Buyer, Forwarder, Stations, Tariff, Total volume, Total amount
- Shipment record columns (20+): Date, Month, мес. доп (defaults to deal month — recent), Fuel type, Factory, Supplier, Loading vol, Company group, Buyer, Forwarder, Wagon #, Waybill #, Shipment volume, Date, Railway tariff, Rounded volume, Amount (override), Currency, Stations, Appendix selector, Invoice #, Comments

**Actions:**
- Click any cell to inline-edit it
- Rounded volume toggle: flip round_volume boolean per row
- Amount override: click → edit field → blur with new value
- Clear amount override: click amount field, delete content, blur → reverts to auto-calc
- Delete row: trash icon
- "Добавить запись" button → AddDialog (bulk paste interface)
- Bulk add: deal selector → month/shipment month → all reference dropdowns → paste area → preview table → confirm import
- Group expansion persisted to URL via nuqs (recent fix)

**Sub-routes:**
- `/registry/kg` — Virtual (tab state)
- `/registry/kz` — Virtual (tab state)

**Dialogs/Modals:**
- AddDialog (bulk add)
- BulkAddDialog component

---

### `/dt-kt`

**File:** `/src/app/(dashboard)/dt-kt/page.tsx`
**Title:** ДТ-КТ Логистика
**Purpose:** Forwarder logistics accounting: opening balance + payments − shipments − fines − surcharges − other deductions = closing saldo.
**Visibility:** All authenticated users
**Editability:** Writable (all numeric fields inline-editable, can add/edit/delete payment records)
**Top-Level Layout:**
- Header: Title + "Добавить" button
- Filter row: Year + Search + "Только отриц. сальдо" checkbox + Reset
- Filter grid: Forwarder | Company Group
- Table (13 columns): Forwarder, Company Group, Year, Сальдо 1 янв, Оплата [expandable], Отгр. тонн (from registry), Отгр. сумма (from registry), Возврат, Штрафы, Сверхнорм., ОГЭМ, **Сальдо** (computed), Delete

**Computed Saldo:**
```
Saldo = opening_balance + sum(payments) − shipped_tonnage_amount − fines − surcharge_preliminary − ogem − refund
```
Color: Green (positive), Red (negative)

**Actions:**
- Inline edit numeric cells
- Click payment cell → expand sub-row with individual payment records
- Add payment per DT-KT row
- "Добавить" button → AddDtKtDialog
- Delete DT-KT row: trash icon → cascades to dt_kt_payments

---

### `/tariffs`

**File:** `/src/app/(dashboard)/tariffs/page.tsx`
**Title:** Тарифы
**Purpose:** Railway tariff matrix (forwarder × route × fuel × month × year). ~181 rows in production; virtualized table.
**Visibility:** All authenticated users
**Editability:** Writable (all cells inline-editable)
**Top-Level Layout:**
- Header: Title + "Добавить тариф" button
- Filter row: Year + "Сбросить (N)" button + count
- Filter grid (6 columns, searchable dropdowns): Ст. назначения | Ст. отправления | Экспедитор | ГСМ | Месяц | Завод
- Main content: Virtual-scrolled table

**Table:**
- Columns (9): Ст. назначения, Ст. отправления, Экспедитор, ГСМ, Месяц, Тариф, Завод, Норм. суток, Delete

**Actions:**
- Click any cell to edit
- Dropdown filters: select value → immediate client-side filter
- "Добавить тариф" button → AddTariffDialog
- Delete tariff: trash icon → confirm

---

### `/surcharges`

**File:** `/src/app/(dashboard)/surcharges/page.tsx`
**Title:** Сверхнормативы / Штрафы
**Purpose:** Track overcharge fees, penalties, and fines.
**Visibility:** All authenticated users
**Editability:** Writable (add records, delete records; no inline edit)
**Top-Level Layout:**
- Header: Title + "Добавить" button
- Filter row: Search box
- Table (8 columns): № сделки, Причина, Сумма, Период, Выставлена от, Выставлена на, Статус, Оплачено

**Actions:**
- Search box: case-insensitive substring match
- "Добавить" button → AddSurchargeDialog
- Delete row: trash icon → confirm

---

### `/import`

**File:** `/src/app/(dashboard)/import/page.tsx` + sub-routes
**Title:** Импорт
**Purpose:** Bulk import from external Excel files (СНТ, ЭСФ, Реестр отгрузки).
**Visibility:** All authenticated users
**Editability:** Writable (import only)
**Top-Level Layout:**
- Tabs (3): "СНТ" | "ЭСФ" | "Реестр отгрузки"
- Template download button ("Скачать шаблон")
- File upload component
- Volume target toggle: "Отгрузка" | "Налив"
- Preview table
- Import button

**Sub-routes:**
- `/import` — Hub
- `/import/snt` — СНТ import
- `/import/esf` — ЭСФ import
- `/import/registry` — Registry import

---

### `/archive`

**File:** `/src/app/(dashboard)/archive/page.tsx`
**Title:** Архив
**Purpose:** Year-end freeze: mark all deals in a year as read-only.
**Visibility:** All authenticated users (read); admin-only edit
**Editability:** Admin-only write
**Top-Level Layout:**
- Title
- Admin card (if isAdmin): "Архивировать год" with year input
- Year stats table

**Actions (Admin Only):**
- Year input + "Архивировать" button → updates deals + inserts archive_years row

---

### `/settings`

**File:** `/src/app/(dashboard)/settings/page.tsx`
**Title:** Настройки
**Purpose:** Settings hub.
**Visibility:** Admin-only
**Editability:** Admin-only
**Top-Level Layout:**
- Title
- 2-column grid of section cards

**Sections:**
1. Пользователи (Users) → links to `/settings/users`
2. Общие (General) — Placeholder, disabled/grayed out ("В разработке")

---

### `/settings/users`

**File:** `/src/app/(dashboard)/settings/users/page.tsx`
**Title:** Пользователи
**Purpose:** Manage CRM user accounts, roles, password resets.
**Visibility:** Admin-only
**Editability:** Admin-only
**Top-Level Layout:** Table of users, "Add user" button, per-user action menu

---

## Shared Component Chrome

### Layout Layer (`/src/components/layout`)

**Sidebar (Persistent)**
- Logo + app name (top)
- 9 primary nav items
- 2 admin-only items (Архив, Настройки)
- Icons (lucide-react)
- Current route highlight

**Top Bar**
- User profile pill (avatar + name, click for logout/menu)
- Workspace name / branding

**Workspace Tab Bar (Recent Addition)**
- Horizontal tab strip showing open contexts
- Click to switch, Cmd+click for background tab
- Persisted to localStorage
- Maximum 20 tabs

**Toaster (Notifications)**
- Position: top-right
- Rich colors

**Activity Feed**
- Real-time activity on detail pages
- Chat-like interface
- Powered by Supabase Realtime

---

## Reusable Components & Patterns

### SearchableSelect
- Custom dropdown with built-in search
- Used on: /deals filters, /registry add dialog, /tariffs filters, /import dialogs

### InlineEdit Cells
- Click → editable input → blur to save (or Enter)
- Variants:
  - EC (text), EN (number), ED (date), EM (month), ES (reference select)
  - ERound (rounded volume): toggle button + optional override
  - EAmount (amount with override): auto-calc or manual override

### Dialogs
- shadcn Dialog wrapper
- Modal overlays for: add entity, edit entity, link/associate, confirm action

### Virtualized Tables
- @tanstack/react-virtual for >100 rows
- Used on: /deals (PassportTable), /tariffs, /registry

---

## Data Fetching & State Patterns

### useQueryState (nuqs)
- URL-persisted component state
- Routes using: /deals (year, search, 10 filters), /registry (filters + expanded groups), /import
- Enables shareable URLs, back-button UX

### Custom Hooks
- useDeals, useApplications, useRegistry, useQuotations, useRole, useDealActivity, etc.
- Module-level caches with 60s TTL
- Realtime subscriptions on activity feeds

### useGlobalRefs
- Singleton cache of reference data
- Populated once on dashboard mount
- Shared across all pages via context

---

## Coverage Matrix

| Module | List View | Detail View | Create Form | Edit Inline | Excel Export | Excel Import | Activity Feed | Audit History |
|--------|-----------|-------------|-------------|-------------|--------------|--------------|---------------|---------------|
| Dashboard | — | Yes | — | — | Charts only | — | — | — |
| Quotations | Yes (products) | Yes (cells editable) | Yes (+type dialog) | Yes (inline cells) | Yes | — | — | — |
| Deals | Yes (50+ cols) | Yes (full form) | Yes (multi-section) | Yes (inline refs) | Yes | — | Yes | Yes (button) |
| Applications | Yes | — | Yes (modal) | Yes (modal) | — | — | Yes | — |
| Registry (KG/KZ) | Yes (grouped) | — | Yes (bulk paste) | Yes (all cells) | — | Yes | — | — |
| Tariffs | Yes (filtered) | — | Yes (modal) | Yes (inline) | — | — | — | — |
| DT-KT | Yes | — | Yes (modal) | Yes (inline) | — | — | — | — |
| Surcharges | Yes (searched) | — | Yes (modal) | — | — | — | — | — |
| Reference Data | Yes (each type) | — | Yes (dialogs) | Yes (modal) | — | — | — | — |
| Archive | Yes | — | — | — | — | — | — | — |
| Settings/Users | Yes | — | Admin only | Admin only | — | — | — | — |

---

## Routes That Are Stubs or Under Construction

1. **`/settings/general` (Общие)** — Placeholder card marked "В разработке". Grayed-out link on /settings.
2. **`/import/snt`, `/import/esf`, `/import/registry`** — Exist as tab states within `/import`; may not be distinct route files.
3. **`/quotations` — Summary tab (Свод КОТ)** — Tab exists but component is partial.
4. **Applications, Surcharges, SNT/ESF Documents** — Tables empty in production (0 rows). Features exist in code but not used operationally yet.

---

## Performance Optimizations

- **Dynamic imports**: recharts (dashboard), xlsx/exceljs (export)
- **Virtualization**: react-virtual on /deals, /tariffs, /registry
- **useMemo**: heavy client-side filters
- **useDeferredValue**: filter dropdowns
- **React.memo**: TariffRow, PassportRow
- **Global refs cache**: eliminates per-page round-trips
- **URL state (nuqs)**: filter state doesn't re-fetch

---

## Known Limitations

1. **Mixed-currency aggregates**: DT-KT saldo and dashboard totals sum values across currencies without conversion
2. **Audit trail**: Comprehensive at DB level (audit_log table) — accessible from /deals/[id] history button
3. **Workspace tab bar**: Recent addition; tabs persist via localStorage
4. **Archive unfreeze**: Once a year is locked, no UI to unfreeze
5. **Mobile responsiveness**: Optimized for desktop 1200px+

---

## File References (Key)

- **Entry points:** `/src/app/layout.tsx`, `/src/app/(dashboard)/layout.tsx`
- **Pages:** `/src/app/(dashboard)/{route}/page.tsx`
- **Components:** `/src/components/{feature}/*`
- **Hooks:** `/src/lib/hooks/use-*.ts`
- **Constants:** `/src/lib/constants/`
- **Utils:** `/src/lib/utils.ts`, `/src/lib/refs.ts`, `/lib/supabase/client.ts`, `/lib/exports/`
- **Types:** `/src/lib/types/database.ts`

---

## Summary

This CRM spans **~14 primary routes** across deal lifecycle (creation, quotations, shipments, logistics, finance), reference data management, and admin functions. The frontend leverages heavy client-side filtering + virtual scrolling to handle 500+ deals/tariffs without backend load. All state-heavy pages use URL params (nuqs) for shareable navigation. Inline editing (click-to-edit cells) is the dominant UX pattern.

**Total Complexity:** High. 50+ column passport tables, multi-variant deal pricing, complex saldo calculations (DT-KT), tariff auto-lookup, and Excel parity (quotations) make this a non-trivial rebuild target.

---

**Checklist for Rebuild (Mechanical Steps):**

1. Recreate all routes under dashboard with matching file structure
2. Implement sidebar nav + dashboard layout chrome + workspace tab bar
3. Build dashboard analytics (KPI cards, charts, currency table)
4. Replicate deals list + detail form (inline editing, variants, company group chain)
5. Build quotations table (Excel parity: date format, 3-decimal Russian numbers, footer averages)
6. Build registry (grouped by deal, inline cell edits, rounding + amount override, bulk paste)
7. Build tariffs (virtual scroll, inline edits, per-column search filters)
8. Build DT-KT (computed saldo, expandable payments, filters)
9. Build surcharges (simple CRUD table)
10. Build applications (create/link/toggle status, activity feed)
11. Build import (Excel upload, preview, bulk insert)
12. Build archive (admin-only year freeze)
13. Build settings (users page)
14. Implement inline-edit cell components
15. Wire up Auth + RLS equivalents
16. Add Realtime subscriptions for activity feeds
17. Test Excel export/import for all modules

# DELTA-SINCE-EXTRACTION.md — Asia Petrol CRM

**Coverage.** Everything that changed between the AS-BUILT baseline
(2026-06-22, migrations up to and including `00093_get_deal_bundle.sql`)
and 2026-07-11 (`main` at `c8774f3`).

**Scope.** 21 new DB migrations (00094–00115, with 00101 skipped) and
~103 application commits.

**Flags.** For every item:
- `(a)` — changes the **data dictionary** (new/altered column, new table,
  new type).
- `(b)` — changes a **computed formula** (trigger body, RPC body, rollup
  rule).
- `(c)` — **presentation only** (UI label, column order, number format,
  role visibility).

Same item may have several flags.

---

## 1. SCHEMA CHANGES

Every new/altered/dropped column since 00093. Ordered by table.

### `shipment_registry` — 3 new columns

| Column | Type | Migration | Purpose | Read/write on |
|--------|------|-----------|---------|---------------|
| `additional_expenses` | `NUMERIC(14, 4)` | `00112` → auto-computed from `00113` | «Сумма грузоотправителя» per shipment. Auto = `v_effective_base × manager_tariff`. Override supported. | `/registry` cell (writable roles); read by `deals.additional_expenses_amount` rollup. |
| `additional_expenses_override` | `BOOLEAN NOT NULL DEFAULT FALSE` | `00113` | Marks the row's `additional_expenses` as manual — bypasses auto-compute. Set to TRUE when operator edits the cell, cleared via explicit rule. | `/registry` cell. |
| `manager_tariff` | `NUMERIC(14, 4)` | `00113` | Second tariff (для «Сумма грузоотправителя»). UI shows for KZ tab only. | `/registry` cell (KZ only). |

**Flag:** `(a)` all three; `(b)` `additional_expenses` (auto-computed in trigger).

### `deals` — 2 new columns

| Column | Type | Migration | Purpose | Read/write on |
|--------|------|-----------|---------|---------------|
| `additional_expenses_amount` | `NUMERIC(14, 4) DEFAULT 0` | `00112` | Deal-level rollup — `SUM(shipment_registry.additional_expenses)` for the deal. Trigger-maintained. | Deal passport (Логистика section, read-only field «Сумма грузоотправителя»); passport-table column; passport export column. |
| `additional_expenses_in_price` | `BOOLEAN DEFAULT FALSE` | `00112` | Toggle «Грузоотправитель в цене» — when TRUE and `supplier_currency = logistics_currency`, adds `additional_expenses_amount` to `supplier_balance`. Mirror of `railway_in_price` (00063). | Deal passport toggle; read by `compute_deal_derived_fields`. |

**Flag:** `(a)` both; `(b)` both (participate in `supplier_balance` formula).

### `deal_supplier_lines` — 1 new column

| Column | Type | Migration | Purpose | Read/write on |
|--------|------|-----------|---------|---------------|
| `selected_date` | `DATE` | `00114` | Explicit quote date for `subtype='average_month'` when `calc_mode='on_date'`. NULL = use `avg_month_date`/`selected_month` fallback. | Deal lines editor + deal create form (both sides). |

**Flag:** `(a)`.

### `deal_buyer_lines` — 1 new column

| Column | Type | Migration | Purpose | Read/write on |
|--------|------|-----------|---------|---------------|
| `selected_date` | `DATE` | `00114` | Mirror of supplier column. | Same as above. |

**Flag:** `(a)`.

### No columns dropped. No tables dropped. No tables added.

Note: 00101 skipped (renumbered to 00102). No column renames were applied
at DB level — all rename events happened only in **UI labels and Excel
headers** (see §3, §4).

---

## 2. FORMULA & LOGIC CHANGES

The critical section. Every change to any computation. All flagged `(b)`.

### 2.1 `compute_registry_amount()` trigger — 5 rewrites in 5 days

This BEFORE-trigger on `shipment_registry` computes
`shipped_tonnage_amount` (and, from 00113, `additional_expenses`). It
went through 5 iterations between **2026-07-09** and **2026-07-10**.

**Baseline (before 00107) — from migration `00086_kz_tariff_basis_and_rounding_toggle.sql`.**
Semantics: if `shipped_tonnage_amount_override IS TRUE` → early return
(keep manual); else if any input NULL → **early return without clearing
the old value**; else compute from three-branch auto (rounded_override
× tariff / CEIL(base) × tariff / base × tariff).

**Bug:** clearing `railway_tariff` in the UI left a **fossilized
`shipped_tonnage_amount`** — value preserved from the previous compute.
Client screenshot 2026-07-09: KZ/26/087, row 21.03.2026 wagon 4, налив
125.3, `railway_tariff = NULL`, but `shipped_tonnage_amount = 2 988 745.20 ₸`
(= ⌈125.3⌉ × 23 720.2, the old cached tariff).

#### 00107 — «NULL amount on missing inputs» (2026-07-09 10:39)

- **Order:** (1) override wins; (2) if `tariff IS NULL OR (v_base IS NULL AND rounded_volume_override IS NULL)` → `shipped_tonnage_amount := NULL; RETURN NEW`; (3) auto.
- **Heal (data):** `UPDATE shipment_registry SET railway_tariff = railway_tariff WHERE COALESCE(shipped_tonnage_amount_override,FALSE)=FALSE AND railway_tariff IS NULL AND shipped_tonnage_amount IS NOT NULL` — a no-op self-UPDATE that fires the new trigger and clears stale sums.
- **Client reason:** KZ/26/087 stale sum (see baseline).

#### 00108 — «Strict base check BEFORE override» (2026-07-09 11:19)

- **Order flipped:** (1) NULL if `tariff IS NULL OR (v_base IS NULL AND rounded_volume_override IS NULL)`; (2) override wins; (3) auto.
- Same NULL condition as 00107, but check moved **above** the override branch — so old amounts are wiped **even on `override=true` rows** when inputs are missing.
- **Heal:** split KZ/KG; wipe both.
- **Client reason:** «сумма = тариф × Входящее СНТ» must be enforced strictly; KZ/26/022 still had sums with `loading_volume IS NULL`.

#### 00109 — «Require real base» (2026-07-09 12:21)

- **Order:** same as 00108.
- **NULL condition simplified:** `tariff IS NULL OR v_base IS NULL` — dropped the OR-clause on `rounded_volume_override`. `rounded_volume_override` no longer substitutes for a missing base.
- **Client reason:** rows with `loading_volume=NULL, rounded_volume_override=60, tariff=22 442.24` were still computing 60 × 22 442.24 — «мимо правила».

#### 00110 — «Manual wins» (2026-07-09 12:35)

- **Order reverted to 00107 semantics:** (1) override wins first; (2) NULL if `tariff IS NULL OR v_base IS NULL`; (3) auto.
- **Client clarification (verbatim):** «ручной ввод всегда приоритетнее автоматического расчета».
- **Heal:** wipes only non-override rows (`COALESCE(shipped_tonnage_amount_override,FALSE)=FALSE`). Rows that 00108/00109 wiped by mistake — client will re-enter manually.

#### 00113 — «Symmetric compute for two amounts» (2026-07-10 10:32)

Complete rewrite. Introduces a **shared effective base** for both money
outputs on the row:

```
v_base           := (registry_type = 'KZ') ? loading_volume : shipment_volume
v_effective_base := rounded_volume_override
                    IF NOT NULL
                    ELSE (v_base IS NULL ? NULL
                          : (round_volume ? CEIL(v_base) : v_base))
```

Then two symmetric computations:

- **`shipped_tonnage_amount`:**
  - If `shipped_tonnage_amount_override` → keep manual.
  - Else if `railway_tariff IS NULL OR v_base IS NULL` → `NULL`.
  - Else `v_effective_base × railway_tariff`.

- **`additional_expenses` (new — was manual since 00112):**
  - If `additional_expenses_override` → keep manual.
  - Else if `manager_tariff IS NULL OR v_base IS NULL` → `NULL`.
  - Else `v_effective_base × manager_tariff`.

Data write: `UPDATE shipment_registry SET railway_tariff = railway_tariff` — recomputes every row.

### 2.2 `compute_deal_derived_fields()` — `supplier_balance` extended (00112)

Deal-level rollup formula (BEFORE-trigger `trg_deals_derived` on
`deals`).

**Before (from `00063_railway_balance_flag.sql`):**
```
supplier_balance =  COALESCE(supplier_shipped_amount, 0)
                  − COALESCE(supplier_payment, 0)
                  + CASE
                      WHEN railway_in_price AND supplier_currency = logistics_currency
                      THEN COALESCE(invoice_amount, 0)
                      ELSE 0
                    END
```

**After (00112, 2026-07-09):**
```
supplier_balance =  COALESCE(supplier_shipped_amount, 0)
                  − COALESCE(supplier_payment, 0)
                  + CASE
                      WHEN railway_in_price AND supplier_currency = logistics_currency
                      THEN COALESCE(invoice_amount, 0)
                      ELSE 0
                    END
                  + CASE
                      WHEN additional_expenses_in_price AND supplier_currency = logistics_currency
                      THEN COALESCE(additional_expenses_amount, 0)
                      ELSE 0
                    END
```

**Client reason (verbatim):** «Галочка Грузоотправитель в цене не
плюсанула в баланс» (KZ/26/002, 2026-07-10). Same currency-match guard
as `railway_in_price`.

Unchanged in the same function: `supplier_contracted_amount =
supplier_contracted_volume × supplier_price`;
`buyer_contracted_amount = buyer_contracted_volume × buyer_price`;
`buyer_debt = buyer_payment − buyer_shipped_amount`;
`buyer_remaining = buyer_contracted_volume − buyer_ordered_volume`;
`preliminary_amount = planned_tariff × preliminary_tonnage`.

### 2.3 `update_deal_additional_expenses()` trigger — bug fix in 00115

**Before (00112):** trigger fired `AFTER INSERT OR UPDATE OF additional_expenses, deal_id OR DELETE`.

**Bug:** after 00113 turned `additional_expenses` into an auto-computed
column (set by the BEFORE-trigger inside UPDATEs of `manager_tariff` or
`loading_volume`), the AFTER-trigger's `UPDATE OF` clause **stopped
firing** — Postgres decides based on the SET-list, not on whether the
value actually changed via a BEFORE-trigger. Result: `deals.additional_expenses_amount`
stayed at 0 even when the shipment sum was 1 497 856.066.

**After (00115, 2026-07-10):** `AFTER INSERT OR UPDATE OR DELETE`
(no `OF` clause) — fires on any UPDATE of the row. Plus a full backfill:
```
UPDATE deals d
   SET additional_expenses_amount = COALESCE((
     SELECT SUM(additional_expenses)
       FROM shipment_registry
      WHERE deal_id = d.id
   ), 0);
UPDATE deals SET updated_at = now() WHERE id IS NOT NULL;  -- refires supplier_balance
```

### 2.4 Margin formula — `Buyer − Supplier − Tariff` (commit `9bb388b`)

**Before:** margin on deal card collapsed to «—» when currencies didn't
line up — company-group intermediate step was in the chain.

**After:** flat formula `Buyer − Supplier − Tariff` computed
unconditionally; company-group step dropped. Presentation change only —
underlying columns identical. Flag: `(b)` + `(c)`.

### 2.5 `deal_shipment_prices` cleanup (00098) — data-side formula recovery

Not a formula change but a **formula-consequence rollback**. Migration
00097 (loading-volume backfill) left autoprice triggers enabled, so
each self-UPDATE inserted a duplicate supplier-side row into
`deal_shipment_prices`. Net effect on formulas: `deals.supplier_shipped_amount`
roughly **doubled** on ~80 deals.

**Fix (00098, 2026-06-25):**
- Backup rows: `CREATE TABLE deal_shipment_prices_00098_backup AS SELECT ... FROM audit_log WHERE table_name='deal_shipment_prices' AND op='INSERT' AND user_id IS NULL AND changed_at ∈ [2026-06-24 16:23, 16:24)`.
- Delete the same rows from `deal_shipment_prices`.
- Rollup trigger `refresh_deal_price_totals` stays enabled → `supplier_shipped_amount` corrects itself.

Flag: `(b)` — restored intended `supplier_shipped_amount` values without
changing the formula body.

### 2.6 Activity-log trigger family (00096, 00100, 00102)

Not «formula» in the accounting sense but computed side effects
(`deal_activity` inserts). New AFTER triggers on: `shipment_registry`,
`deal_payments`, `deal_supplier_lines`, `deal_buyer_lines`,
`deal_company_groups`, `deal_attachments`. All use the same helper
`_activity_is_draft_deal(deal_id)` to skip draft-deal writes.

- `00100` — malformed-array-literal fix. Bare parenthesized strings
  reclassified as UNKNOWN by planner → array||array overload picked →
  runtime error. Fix: add `::TEXT` cast on every string literal in the
  five activity trigger functions.
- `00102` — `log_shipment_registry_change` extended to log
  `company_group_id` transitions: «группа комп. `<old>` → `<new>`»
  (resolved via `company_groups.name`).

Flag: `(b)` on 00096, 00100, 00102 — behavior of what gets logged; no
data-dictionary impact.

### 2.7 `is_writable_role()` — finance removed (00111)

**Before (from 00082):** `role IN ('admin', 'manager', 'logistics', 'finance')`.
**After (2026-07-09):** `role IN ('admin', 'manager', 'logistics')`.

Flag: `(b)` — changes computed authorization result server-side;
`(c)` — client-side visible via `role-context.tsx:31–34` matching the
same list.

---

## 3. EXPORT CHANGES

### 3.1 `src/lib/exports/passport-excel.ts` (deals passport → Excel)

Columns added / removed / renamed:

| Change | Detail | Commit |
|--------|--------|--------|
| Groups band: 1 «Цепочка» string column → per-position `Группа 1..Группа 6` + `Цена гр. (avg)` | Later reduced to 3 (`Группа 1..3`), client 2026-07-06 | `7e989e9`, then `30f67f3` |
| Supplier + Buyer bands: added `Котировка`, `Скидка` before `Цена предв.` / `Цена оконч.` | LIST_SELECT extended to `supplier_quotation` / `supplier_discount` / `buyer_quotation` / `buyer_discount` — previously blank cells | `b0d646a` |
| Buyer band: new `Остаток, т` column | Computed on-the-fly as `(buyer_shipped_volume ?? 0) − (buyer_ordered_volume ?? 0)` — line 152 | `b0d646a` |
| Logistics band: new `Сумма грузоотпр.` | `additional_expenses_amount` at line 165. Added to `TOTAL_KEYS` at line 358. | `c8774f3` |
| Group names — enrichment from refs cache | `LIST_SELECT` only carries `{id, position, company_group_id, price, price_kind}`; export patches `.company_group.name` from refs (lines 230–234) | `38549ae` |

Number formatting (all set in `passport-excel.ts` lines 30–32):

| Constant | Format | Previously | Commit |
|----------|--------|------------|--------|
| `NUM_FMT_AMOUNT` | `#,##0.00;[Red]-#,##0.00` | `#,##0.0000` | `e6f03dd`, `a5d62f5` |
| `NUM_FMT_VOLUME` | `#,##0.000;[Red]-#,##0.000` | same | `e6f03dd` |
| `NUM_FMT_PRICE` | `#,##0.00` | `#,##0.0000` | `a5d62f5` |

Row styling: uniform ГСМ-tint (α=0.12) blended into white per row via
`blendArgbWithFuel` helper (lines 50–68); replaces zebra alternation
(`b07a546`, `d4a6390`).

Flag: `(c)` throughout. Column additions are all presentation of
existing columns; no new persisted data.

### 3.2 `src/lib/exports/registry-excel.ts` — NEW FILE

Created 2026-06-24 (`f212d30 feat(registry): Excel export button —
«Выгрузка реестра отгрузок»`).

**Two variants** since `cb8b93a` (2026-07-06):

- `COLUMNS_PTS` (lines 69–95) — **25 columns**, layout matches
  expeditor PTC file. No `Входящее СНТ`. Stations right after
  wagon+waybill.
- `COLUMNS_FULL` (lines 101–133) — matches on-screen order. Includes
  `Входящее СНТ`, `Группа 1..3`, `Плательщик ж/д тарифа`.

Wired via `RegistryExportVariant = "pts" | "full"` (line 29) into
`ctx.variant`, filename (`registry-${type}-${variant}-${year}-${date}.xlsx`,
line 280) and sheet title suffix (` · полный` / ` · PTS`, line 169).

Column history:

| Change | Detail | Commit |
|--------|--------|--------|
| Removed column picker; columns fixed | Row-tint from fuel color added | `9f87457` |
| PTS: dropped `Входящее СНТ`, added `округл тоннаж от экспедитора` | `roundedTonnage` helper (lines 59–64): `rounded_volume_override → CEIL(base) if round_volume → base` | `9105936` |
| СНТ column order swapped: Входящее first, Исходящее second | Match on-screen convention | `0d4b4d8` |
| «Группа комп.» → «Плательщик ж/д тарифа» | Rename header only; DB column same | `cc3f9f3` |
| Added `Группа 1..3` in FULL between Покупатель and Плательщик | Sourced from `ctx.dealChains: Map<deal_id, [g1,g2,g3]>` | `30f67f3` |
| Added `Доп. расходы` (money per-row) | Later renamed | `4399d38` |
| Renamed `Тариф` → `Тариф (логисты)`; added `Тариф (менеджер)`; renamed `Доп. расходы` → `Сумма грузоотправителя` | Current PTS lines 87–91; FULL lines 122–125 | `7800d4a` |

Number formatting:

| Constant | Format | Was | Commit |
|----------|--------|-----|--------|
| `NUM_FMT_VOLUME` | `#,##0.000` | — | new file |
| `NUM_FMT_TARIFF` | `#,##0.00` | `#,##0.0000` | `a5d62f5` |
| `NUM_FMT_AMOUNT` | `#,##0.00` | — | new file |

Flag: `(c)` throughout.

### 3.3 `src/lib/exports/quotations-excel.ts`

- Column picker Dialog no longer reachable — pressing «Excel» downloads all columns immediately (`9f87457`).
- `NUM_FMT_PRICE` **reverted to `#,##0.000`** (3 decimals). Client 2026-07-09: «у котировок должно быть 3 знака» (`bfb808f`). Only quotations kept 3 decimals; everything else went to 2.

Flag: `(c)`.

---

## 4. UI FIELD CHANGES

### 4.1 `src/app/(dashboard)/deals/[id]/page.tsx` (deal passport / edit view)

New fields in **Логистика** section (lines ~1000–1030):

| Field label | DB column | Role that fills | R/O? | Validation |
|-------------|-----------|-----------------|------|-----------|
| «Сумма грузоотправителя» | `deals.additional_expenses_amount` | read-only rollup from `shipment_registry.additional_expenses` | R/O | — |
| Toggle «Грузоотправитель в цене» | `deals.additional_expenses_in_price` | admin/manager/logistics (via `RailwayInPriceToggle`-style guard) | writable | boolean |

Existing fields with new behavior:

| Field | Change | Commit |
|-------|--------|--------|
| «Тип котировки / Котировка значение / Скидка» | Now render unconditionally for every price tier (including `manual_formula`); previously hidden for that tier | `c913954` |
| «Подкотировка» (`price_source`) | Shown in the lines editor (edit view) too, not only in create form | `e2ebf77` |
| «Режим расчёта» (calc_mode: `avg_month`/`on_date`) | Now surfaces for `average_month` subtype; `on_date` shows a `<input type="date">` bound to `selected_date` (00114) | `c5c14b3` |
| «Окончательная» button on preliminary linkage | Recomputes `price` from current quotation (was leaving stale preliminary value) | `7891234` |
| Sections | Wrapped in `CollapsibleSection` — collapsed by default; colored header + accent border | `6efc09f`, `e23261a`, `c26518c`, `5836ba1` |
| «Назад» | Uses `router.back()` so /deals filters survive | `85b0de3` |

Flag: `(a)` on toggle + amount (new columns); `(b)` on calc_mode
behavior (feeds quotation lookup); `(c)` on section styling and price
visibility.

### 4.2 `src/app/(dashboard)/deals/new/page.tsx` (deal create form)

| Change | Detail | Commit |
|--------|--------|--------|
| New «Оплаты» section for BOTH sides | Component `deal-payments-draft.tsx` (imported line 20, used line 727); rows batched as INSERT after `createDeal` succeeds. Filled by whoever creates the deal (admin/manager). | `0ff8ef5` |
| Default `priceMode` `"fixed"` → `"manual"` | New deals land on «Фикс / Вручную» tier | `6efc09f` |
| «Режим расчёта» added for `average_month` subtype | Parity with edit view; feeds `selected_date` (00114) | `7991f55` |
| Sections | All wrapped in `CollapsibleSection` with brand headers (lines 458, 518, 562, 596, 664, 701, 726) | `6efc09f`+ |

Flag: `(c)` for sectioning; `(a)`+`(b)` for `selected_date` capture (new column + quotation-fetch logic).

### 4.3 `src/components/deals/passport-table.tsx` (deals list table)

New columns:

| Column | Source | R/O? | Commit |
|--------|--------|------|--------|
| «Тариф» (`planned_tariff`) | `deals.planned_tariff` — editable inline for writable roles | writable | `38549ae` |
| «Остаток» (`buyer_remaining`) | Computed `shipped − ordered` | R/O | `b0d646a` |
| «Сумма грузоотпр.» (`additional_expenses_amount`) | `deals.additional_expenses_amount` (rollup) | R/O | `c8774f3` |

Behavior:

| Change | Detail | Commit |
|--------|--------|--------|
| Money → 2 decimals; tonnage → 3 | `formatMoney`/`formatVolume` from `src/lib/format.ts` | `6c9142b`, `e6f03dd` |
| Totals row: no sums for `Объем / Сумма дог. / Цена` | Per-deal contract values, not summable | `d6cc905` |
| Cell font 11 → 12; section header 10 → 11 | Row heights pinned | `0d5d40e` |
| Excel-style multi-cell selection | Shift/Ctrl-click across 21 numeric cols; footer shows Ячеек/Сумма/Среднее/min/max | `e23261a` |
| Sticky header | `[&_th]:sticky [&_th]:top-0` (works in Safari; earlier `<tr>` variant didn't) | `1e259a5` (previous `f09d0dc` broken) |
| Comma decimal separator | `parseNum()` accepts `,` or `.`; `inputMode=decimal` | `b4a9c42` |
| Column-group header bands | Recoloured to client brand palette (`#b4c6e7`, `#fce3d6`, `#bcd7ee`, `#fff2cc`, `#d9d9d9`) | `6efc09f` |

Flag: `(c)` throughout except `additional_expenses_amount` column (`a`+`b` shared with §1/§2).

### 4.4 `src/app/(dashboard)/registry/page.tsx` (shipment registry)

Header renames:

| From | To | DB column | Commit |
|------|-----|-----------|--------|
| «Налив» | «Входящее СНТ» | `shipment_volume` (buyer-side) | `b5c4d3d` |
| «Отгрузка» | «Исходящее СНТ» | `loading_volume` (supplier-side) | `b5c4d3d`, `01654be`, `e6a9f87` |
| «Группа комп.» | «Плательщик ж/д тарифа» | `logistics_company_group_id` (unchanged); duplicate column removed | `cc3f9f3` |
| «Тариф» | «Тариф (логисты)» | `railway_tariff` | `7800d4a` |
| «Доп. расх.» | «Сумма грузоотправителя» | `additional_expenses` | `7800d4a` (earlier `4399d38` added it under old name) |

New columns:

| Column | Where | R/O? | Commit |
|--------|-------|------|--------|
| «Тариф (менеджер)» | KZ tab only (`tab === "kz"`, header line 2009, cell line 2120) | writable | `7800d4a` |
| «Сумма грузоотправителя» | Both tabs (header line 2011, cell line 2122); editable via `<EN>`; has `additional_expenses_override` boolean underneath | writable | `4399d38`+`7800d4a` |

Behavior:

| Change | Detail | Commit |
|--------|--------|--------|
| Mirror «группа комп.» cell | Was read-only span; now editable via `<ES>` and logged to activity feed (via `00102`) | `ff2ecba` |
| Deal code in group header | Now clickable link → `/deals/{id}` | `499c74d` |
| Excel export button | `DropdownMenu` with «Полный» / «PTS»; button size matches «Добавить» / «Импорт» | `cb8b93a`, `ae1b70c` |
| Group card header | Breadcrumb `июнь · ● Мазут · Завод: X · Пост.: A → Покуп.: B · Эксп.: F · Цепочка: G1 → G2 → G3` with explicit labels | `ae1b70c`, `30f67f3` |
| Editable-cell select-all on focus | `onFocus={(e) => e.currentTarget.select()}` — first keystroke overwrites | `9c2ec1e` |
| Clearing sum sets `override=true` | Client rule «удаление — это явный ноль»; prevents auto-recompute flicker | `ea6bf4e`, `a302a67`, `41a0441`, `98457cb`, `c2e43c9` |
| Manual override wins | UI reflects trigger semantics from 00110 | `a302a67` |
| Sticky column headers per group | `[&_th]:sticky` per group card | `f09d0dc`→`1e259a5` |
| KG/KZ tab persisted in URL | `nuqs` `useQueryState` | `c6e63fc` |
| Fuel-color row tint | α=0.12 default / 0.22 hover; inline CSS `--row-bg` / `--row-bg-hover`; amber selection wins | `9f87457` |
| Filter row uniform | Dropdowns + inputs `h-9 rounded-lg text-[12px]` | `b70a36e` |

Flag: `(a)` on `manager_tariff` / `additional_expenses` columns;
`(b)` on override-wins semantics; `(c)` throughout labels and styling.

---

## 5. NEW BEHAVIOR

### 5.1 Roles — finance is now read-only

- Client-side: `src/lib/role-context.tsx:31–34` — `isWritable` returns TRUE for `admin | manager | logistics` only. `finance | accounting | trader | readonly` = view + Excel-export.
- Server-side: migration `00111` mirrors the same list in `is_writable_role()`. Enforced via RLS policies.
- Commit `31418b2` (client 2026-07-09).

Flag: `(b)` + `(c)`.

### 5.2 Tariffs Excel import (new feature)

New button «Импорт из Excel» next to «Добавить тариф». Component
`src/components/tariffs/import-dialog.tsx`.

- Filename → `month/year`: e.g. «Ставки Singularity июль 2026.xlsx» (`e1bdd44`).
- Column mapping via `classifyHeader()` — anchored regex → `departure / destination / fuel / tariff / forwarder`. Noise columns ignored.
- Fuzzy value matching (`966e44c`): stations/fuel/forwarders resolved via `normalizeName` + Levenshtein fallback (similarity > 0.8, same digit fingerprint, length delta ≤ 2).
- «ст.» / «станция» prefix stripped in matcher (`1f8ed08`).
- Roman-numeral station names recognized (Latin `i` / Cyrillic `і` → 1); unmatched rows → inline `SearchableSelect` for manual pick (`56b377f`).
- Import button disabled while any row unresolved; label swaps to «Разберите N неразрешённых строк» (`25968e7`).
- UI relabels: «Товар (ГСМ)» → «Груз», «Тариф» → «Ставка, USD/тонна без НДС».

Flag: `(c)` — new UX; no schema change.

### 5.3 Activity log expansion

New AFTER triggers via `00096` on: `shipment_registry`, `deal_payments`,
`deal_supplier_lines`, `deal_buyer_lines`, `deal_company_groups`,
`deal_attachments` — each writes to `deal_activity`. All use
`_activity_is_draft_deal()` to skip draft-deal writes; default-line
INSERTs muted.

- `00100` — malformed-array-literal fix (cast bare strings to `::TEXT`).
- `00102` — `log_shipment_registry_change` logs `company_group_id` transitions «группа комп. `<old>` → `<new>`».
- `00094` — `log_deal_payment_change()` now captures `auth.uid()` (was omitted; operator screenshot 2026-06-22 showed authorless payment entries).

Flag: `(b)`.

### 5.4 Registry duplicates + bulk-add

**UI-side:**

- `«Продублировать отгрузку»` checkbox in single-deal `AddDialog` — writes both `shipment_volume` and `loading_volume` from the same parsed volume (`dcfa5f3`).
- Auto-tick when deal chain pos 1 AND 2 both match a 12-name whitelist (CAODL, Fuel Supply Company, Geowax, Kernel Trade GmbH, Singularity Trading GmbH, TENGRI WEY FZCO, АБ Линк, Бетта, Брент Трейдинг, Дот-Трейдинг, Ойл Ресурс Трейдинг, Ордо Мунай Импекс) — extended in `ce59389`.
- Also auto-dup when pos2 is empty and pos1 matches (`a166cda`).
- `BulkAddDialog` (multi-deal variant) got same rename + checkbox (`bb89561`).
- Bulk-add from deal passport: Logistics `CardHeader` gets «Массово» button (`499c74d`).
- Parser fixes: trailing empty cell no longer corrupts wagon/waybill (`d3f0657`); comma-separated wagons with trailing spaces glued (`6438174`); 3-column layout supported (`b4a9c42`).
- Bulk-add supports new (date → накладная → вагон → объём) layout (`7451c3a`).

**DB-side dedupe migrations:**

- `00097` — one-shot backfill of `loading_volume ← shipment_volume` for OsOO/Singularity historical rows.
- `00098` — revert 00097 side-effect: deletes 1216 duplicate supplier prices caused by autoprice trigger firing during 00097's self-UPDATE.
- `00099` — merge 1358 loading-only + shipment-only pairs into single rows for whitelist deals. Repoints `deal_shipment_prices.shipment_registry_id`; merges 25 columns via `COALESCE(keep, drop)`; deletes drops; per-deal `refresh_deal_shipment_totals()` + `refresh_deal_price_totals()`.
- `00104` — preview-only strict dedupe rule (Phase 2 commented). Key = `(deal_id, wagon, waybill, date)` + volume equality with a «full» row (both loading + shipment NOT NULL) in the group.
- `00105` — Phase-2 DELETE that 00104 skipped: deletes partial rows where volume matches a full row in the same key group.
- `00106` — preview-only cleanup of `parseBulkWagons`-corrupt rows (`wagon_number ~ '[,\.]'` + both volumes NULL). Phase 2 commented; awaits confirmation.
- `00095` — realign `deal_sequences.last_number` to `MAX(deal_number)` after Supabase outage sequence drift; delete abandoned drafts > 1 hour.
- `00103` — one-off rename `KG/26/454 → KG/26/445` after the same outage (sequence jumped 10 steps).

Flag: `(b)` on all of these — data changes without schema changes.

### 5.5 Cache invalidation / write freshness

- `src/lib/hooks/*` — per-cache pub-sub with optimistic patch on all data hooks: `useDeals`, `useDeal`, `useDealBundle`, `useApplications`, `useRegistry`, `useDealSupplierLines`, `useDealBuyerLines` (`4b9d517`). Operators no longer need to F5.
- Swallow transient «Lock broken by 'steal'» from Supabase JS Web-Locks (`69badbc`).
- `DealShipments` refetches on `subscribeRegistry` (`b4a9c42`).
- Deal shipment-prices table refreshes on line-level price edits (`2425122`).

Flag: `(c)`.

### 5.6 Number formatting canon (client 2026-07-07 → 2026-07-09)

New file `src/lib/format.ts` with `formatMoney` / `formatVolume` /
`formatCount` / `formatPercent` + `*OrBlank` variants (`e6f03dd`).
Canonical rules:

- Money (including quotations in line-context, prices $/т, tariff, FX, discount): **2/2 decimals**.
- Volume/tonnage: **3/3**.
- Integer counts (`trigger_days`, `norm_days`): **0**.
- Quotations page + `quotations-excel`: **3 decimals** (`bfb808f`).
- `trigger_days`: `decimals={0}` (`1ae94a3`).
- Money in deal-lines editor: 4 → 2 (`c9c4475`).
- Passport money 3 → 2, tonnage stays 3 (`6c9142b`).
- `deal-company-chain.tsx`, `registry EN`, deal `Field` non-volume: all 2/2 (`a5d62f5`).
- Comma decimal separator accepted (`b4a9c42`) via `parseNum` helper + `inputMode=decimal`.

Flag: `(c)`.

### 5.7 Tabs / URL / navigation

- Sidebar collapsible: 56px collapsed ↔ 240px expanded. Toggle via header/footer button or `⌘/Ctrl+B`; state persisted in `localStorage` (`17b6c61`). Label-wrap fix during transition (`7454e95`).
- Registry KG/KZ tab persisted in URL (`c6e63fc`).
- Amber underline (`border-b-4 border-amber-500`) marks active tab on /deals and /registry (`f32c2ee`).
- KG tab: dark emerald; KZ tab: dark blue (`4b920f1`, `6937caa`).
- Workspace tab race fixed: `nuqs throttleMs=0` on every URL filter (`d8348d2`); `openTab` also captures live URL before leaving (`dbdc882`); URL-sync effect no longer depends on `activeId` (`548a71c`).

Flag: `(c)`.

### 5.8 Scrollbars / sticky (client 2026-07-07)

- Double horizontal scrollbar (top + bottom, synced) for wide tables via `DoubleScrollX` and `SyncedTopScrollbar` (`bb1195b`).
- Force-visible thin scrollbar `.dsx-scroll` (`1aefc47`); always shown on macOS (`e141d0c`).
- Custom DOM scrollbars — macOS Chromium ignores `::-webkit-scrollbar` styling on overlay bars; drawn as DOM elements (`341577b`, `965c653`).
- `.dsx-hide-native-h` vs `.dsx-hide-native-all` split so `/deals` vertical native scroll survives (`d7ba434`).
- `PairedSyncedScrollbars` shares dim between top+bottom bars via `useScrollDim` (`953de3e`).
- `PassportTable` early-return-before-hooks crash fixed (`6401569`) — searching `<` or `>` used to hit React error #300.

Flag: `(c)`.

### 5.9 Deal detail computed behavior

- Additional-expenses-in-price toggle sums `SUM(additional_expenses)` to `supplier_balance` when currencies align — mirrors `railway_in_price` (`4399d38`, `7800d4a`; DB 00112, 00113, 00115). Full formula in §2.2.
- Manager-tariff (KZ only) computes `additional_expenses = v_effective_base × manager_tariff` symmetrically to `railway_tariff`'s effect on `shipped_tonnage_amount` (§2.1, 00113).
- Margin `Buyer − Supplier − Tariff` no longer collapses on currency mismatch (`9bb388b`).

Flag: `(b)`.

### 5.10 Surcharges edit + delete

- Universal `SurchargeDialog` with `editing` prop; row click opens edit mode; delete button in edit mode (`774c943`).

Flag: `(c)`.

### 5.11 Typography

- DM Sans + JetBrains Mono replaced by Carlito (Calibri-equivalent) — both `--font-sans` and `--font-mono` point at Carlito; slashed-zero rule removed (`39ab1d7`). Client 2026-06-23 round 3: users complained about 0/8 collision in previous font.

Flag: `(c)`.

---

## File paths referenced (absolute)

- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/lib/exports/passport-excel.ts`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/lib/exports/registry-excel.ts`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/lib/exports/quotations-excel.ts`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/app/(dashboard)/deals/[id]/page.tsx`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/app/(dashboard)/deals/new/page.tsx`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/app/(dashboard)/registry/page.tsx`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/components/deals/passport-table.tsx`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/components/deals/deal-payments-draft.tsx`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/components/deals/collapsible-section.tsx`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/components/registry/bulk-add-dialog.tsx`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/components/tariffs/import-dialog.tsx`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/lib/role-context.tsx`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/lib/format.ts`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/src/lib/hooks/use-registry.ts`
- `/Users/shynggysislam/Desktop/projects/asia petrol/asia-petrol-crm/supabase/migrations/00094…00115_*.sql`

_Generated 2026-07-11. Regenerate by rerunning inventory scripts + git-log walk since the last AS-BUILT date._

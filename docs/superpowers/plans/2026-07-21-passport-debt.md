# «Паспорт (долги)» + условия оплаты — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить экспорт «Паспорт (долги)» (detail-формат + 6 колонок отсрочки/плановых дат оплаты с подсветкой просрочки) и ввод условий оплаты (отсрочка) на сделке.

**Architecture:** 8 полей отсрочки на `deals` (по стороне: дни, режим, заметка, ручная плановая дата). Плановая дата считается в экспортере (не хранится): режим `shipment` → дата СНТ + дни; `other` → ручная дата. Debt-экспорт реализован как **вариант** существующего detail-экспортера (`variant: "debt"`) — те же fetch'и и построение строк + 6 колонок в новом бэнде + красный шрифт на просроченных плановых датах.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase/Postgres, ExcelJS, Tailwind.

## Global Constraints

- Миграции применяет ПОЛЬЗОВАТЕЛЬ в Supabase SQL Editor. Задачи с миграцией завершаются чекпоинтом «применил + probe».
- Тестируем на production Vercel (push в main). НЕ `npm run dev`.
- После КАЖДОГО изменения — запись в `CHANGELOG-SINCE-EXTRACTION.md`.
- Оптимистичный UI: правка применяется сразу (`updateDeal`), ошибка → откат + toast.
- Следующая свободная миграция — **00125** (последняя 00124).
- Названия сторон: `supplier` = продавец/поставщик, `buyer` = покупатель.
- `supplier_balance = supplier_shipped_amount − supplier_payment` → `> 0` = не оплачено (мы должны поставщику). `buyer_debt > 0` = покупатель должен нам. Просрочка использует `> 0`.
- Строка сделки в отчёте ОСТАЁТСЯ (коммент шаблона «не нужна» игнорируем); колонки отсрочки 56–61 пустые на главной строке, заполнены на под-строках-отгрузках.
- Плановая дата Прод. считается по `loading_date` (вход. СНТ), Покуп. — по `date` (исход. СНТ).

---

### Task 1: Миграция 00125 — поля отсрочки на deals

**Files:**
- Create: `supabase/migrations/00125_payment_deferral.sql`
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Produces: 8 nullable колонок на `deals`: `supplier_deferral_days INT`, `supplier_deferral_mode TEXT`, `supplier_deferral_note TEXT`, `supplier_planned_pay_date DATE`, и аналогичные `buyer_*`.

- [ ] **Step 1: Написать миграцию**

```sql
-- 00125_payment_deferral.sql
-- Условия оплаты (отсрочка) для отчёта «Паспорт (долги)». Клиент 2026-07-21:
-- отсрочка задаётся на сделке по стороне (2 приложения — продавец/покупатель).
-- Режим 'shipment' = «с даты отгрузки» (плановая дата = дата СНТ + дни,
-- считается в экспортере); 'other' = «прочее» (ручная плановая дата + заметка).
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_deferral_days    INT,
  ADD COLUMN IF NOT EXISTS supplier_deferral_mode    TEXT,
  ADD COLUMN IF NOT EXISTS supplier_deferral_note    TEXT,
  ADD COLUMN IF NOT EXISTS supplier_planned_pay_date DATE,
  ADD COLUMN IF NOT EXISTS buyer_deferral_days       INT,
  ADD COLUMN IF NOT EXISTS buyer_deferral_mode       TEXT,
  ADD COLUMN IF NOT EXISTS buyer_deferral_note       TEXT,
  ADD COLUMN IF NOT EXISTS buyer_planned_pay_date    DATE;

ALTER TABLE deals
  ADD CONSTRAINT deals_supplier_deferral_mode_chk
    CHECK (supplier_deferral_mode IS NULL OR supplier_deferral_mode IN ('shipment','other')),
  ADD CONSTRAINT deals_buyer_deferral_mode_chk
    CHECK (buyer_deferral_mode IS NULL OR buyer_deferral_mode IN ('shipment','other'));
```

- [ ] **Step 2: Changelog + commit**

Запись `[SCHEMA] 00125 — поля отсрочки платежа на deals (условия оплаты для debt-отчёта)`.
```bash
git add supabase/migrations/00125_payment_deferral.sql CHANGELOG-SINCE-EXTRACTION.md
git commit -m "feat(debt): миграция 00125 — поля отсрочки платежа на deals"
```

- [ ] **Step 3: ЧЕКПОИНТ — пользователь применяет 00125**

Probe после применения: `SELECT supplier_deferral_days, buyer_deferral_mode FROM deals LIMIT 1;` → колонки существуют, ошибок нет.

---

### Task 2: use-deals.ts — Deal type + LIST_SELECT

**Files:**
- Modify: `src/lib/hooks/use-deals.ts`
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Consumes: колонки из Task 1.
- Produces: `Deal` type содержит 8 полей отсрочки; `LIST_SELECT` их выбирает — значит они доступны в списке сделок и в экспортерах (которые работают с `filtered` deals).

- [ ] **Step 1: Добавить поля в `Deal` type**

В `type Deal = {...}` (рядом с `buyer_debt` / логистикой) добавить:
```ts
  supplier_deferral_days: number | null;
  supplier_deferral_mode: "shipment" | "other" | null;
  supplier_deferral_note: string | null;
  supplier_planned_pay_date: string | null;
  buyer_deferral_days: number | null;
  buyer_deferral_mode: "shipment" | "other" | null;
  buyer_deferral_note: string | null;
  buyer_planned_pay_date: string | null;
```

- [ ] **Step 2: Добавить поля в `LIST_SELECT`**

В строке `const LIST_SELECT = \`...\`` добавить (напр. после `logistics_currency, currency, ...` — до `deal_company_groups(...)`):
```
  supplier_deferral_days, supplier_deferral_mode, supplier_deferral_note, supplier_planned_pay_date,
  buyer_deferral_days, buyer_deferral_mode, buyer_deferral_note, buyer_planned_pay_date,
```

- [ ] **Step 3: tsc + changelog + commit**

Run: `npx tsc --noEmit` (ожидание: чисто; `updateDeal`-патчи типизируются `Partial<Deal>`).
Запись `[BEHAVIOR] Deal type + LIST_SELECT — поля отсрочки`.
```bash
git add src/lib/hooks/use-deals.ts CHANGELOG-SINCE-EXTRACTION.md
git commit -m "feat(debt): поля отсрочки в Deal type + LIST_SELECT"
```

> ЧЕКПОИНТ-зависимость: до применения 00125 (Task 1) запрос списка вернёт ошибку «column does not exist». Поэтому прод-проверка этой задачи — после Task 1 применён.

---

### Task 3: Блок «Условия оплаты» на странице сделки

**Files:**
- Modify: `src/app/(dashboard)/deals/[id]/page.tsx`
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Consumes: `Deal` поля (Task 2); `updateDeal` (существующий); `Field` (существующий, поддерживает `inputType` text|number|date, оптимистичный).
- Produces: UI-блок для ввода отсрочки по обеим сторонам.

- [ ] **Step 1: Добавить мини-компонент выбора режима**

Рядом с `Field` (после его определения) добавить:
```tsx
function ModeSelect({ label, value, field, dealId, editing }: {
  label: string;
  value: "shipment" | "other" | null | undefined;
  field: string; dealId: string; editing?: boolean;
}) {
  const human = value === "shipment" ? "с даты отгрузки" : value === "other" ? "прочее" : "—";
  if (!editing) {
    return (
      <div>
        <span className="text-[11px] text-stone-400 block">{label}</span>
        <span className="text-[13px] text-stone-700">{human}</span>
      </div>
    );
  }
  return (
    <div>
      <span className="text-[11px] text-stone-400 block">{label}</span>
      <select
        className="h-7 rounded border border-stone-200 bg-white px-1 text-[13px] focus:border-amber-400 focus:outline-none"
        value={value ?? ""}
        onChange={(e) => updateDeal(dealId, { [field]: (e.target.value || null) as never })}
      >
        <option value="">—</option>
        <option value="shipment">с даты отгрузки</option>
        <option value="other">прочее</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Добавить блок «Условия оплаты»**

Вставить новый раздел (по образцу существующих `<h3>`-секций, напр. рядом с блоком оплат/логистики). Для каждой стороны — дни, режим, и при режиме «прочее» — заметка + ручная плановая дата:
```tsx
{/* Условия оплаты (отсрочка) */}
<div className="space-y-2">
  <h3 className="text-[14px] font-medium text-stone-800">Условия оплаты</h3>
  <div className="grid grid-cols-2 gap-4">
    <div className="space-y-1.5">
      <div className="text-[12px] font-medium text-stone-500">Поставщик</div>
      <Field label="Отсрочка, дн." value={deal.supplier_deferral_days} inputType="number" editing={editing} field="supplier_deferral_days" dealId={deal.id} />
      <ModeSelect label="Режим" value={deal.supplier_deferral_mode} field="supplier_deferral_mode" dealId={deal.id} editing={editing} />
      {deal.supplier_deferral_mode === "other" && (
        <>
          <Field label="Заметка" value={deal.supplier_deferral_note} inputType="text" editing={editing} field="supplier_deferral_note" dealId={deal.id} />
          <Field label="Плановая дата (ручная)" value={deal.supplier_planned_pay_date} inputType="date" editing={editing} field="supplier_planned_pay_date" dealId={deal.id} />
        </>
      )}
    </div>
    <div className="space-y-1.5">
      <div className="text-[12px] font-medium text-stone-500">Покупатель</div>
      <Field label="Отсрочка, дн." value={deal.buyer_deferral_days} inputType="number" editing={editing} field="buyer_deferral_days" dealId={deal.id} />
      <ModeSelect label="Режим" value={deal.buyer_deferral_mode} field="buyer_deferral_mode" dealId={deal.id} editing={editing} />
      {deal.buyer_deferral_mode === "other" && (
        <>
          <Field label="Заметка" value={deal.buyer_deferral_note} inputType="text" editing={editing} field="buyer_deferral_note" dealId={deal.id} />
          <Field label="Плановая дата (ручная)" value={deal.buyer_planned_pay_date} inputType="date" editing={editing} field="buyer_planned_pay_date" dealId={deal.id} />
        </>
      )}
    </div>
  </div>
</div>
```

> `editing` — существующая переменная страницы (режим редактирования), `deal` — текущая сделка. Подставить в существующую разметку раздела, не ломая соседние блоки.

- [ ] **Step 3: tsc + build + changelog + commit**

Run: `npx tsc --noEmit && npm run build`
Запись `[UI-FIELD] Блок «Условия оплаты» на сделке (отсрочка: дни/режим/заметка/ручная дата)`.
```bash
git add "src/app/(dashboard)/deals/[id]/page.tsx" CHANGELOG-SINCE-EXTRACTION.md
git commit -m "feat(debt): блок «Условия оплаты» на странице сделки"
```

---

### Task 4: Debt-экспорт (вариант detail) + опция дропдауна

**Files:**
- Modify: `src/lib/exports/passport-detail-excel.ts`
- Modify: `src/app/(dashboard)/deals/page.tsx`
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Consumes: `Deal` поля отсрочки (Task 2), `SubRow`/`DetailShipment` (в файле; `s.ship.loading_date`/`s.ship.date` есть), `supplier_balance`/`buyer_debt` (в Deal), `fmtDate` (в файле).
- Produces: `exportPassportDetailToExcel(deals, ctx, opts?: { variant?: "detail" | "debt" })`; опция дропдауна «Паспорт (долги)».

- [ ] **Step 1: Расширить `Column` type и `BAND_STYLE`**

В `type Column = {...}` добавить:
```ts
  redIf?: (deal: Deal, s: SubRow) => boolean;
```
В band-union `band: "deal" | "supplier" | "groups" | "buyer" | "logistics"` добавить `| "debt"`.
В `BAND_STYLE` добавить запись:
```ts
  debt: { label: "Отсрочка / плановая оплата", bg: "FFFDF2F2", text: "FF991B1B" },
```

- [ ] **Step 2: Добавить helpers планов. даты + просрочки и `DEBT_COLUMNS`**

Перед `export async function exportPassportDetailToExcel`:
```ts
function addDaysISO(dateStr: string | null | undefined, days: number | null | undefined): string | null {
  if (!dateStr || days == null) return null;
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function supplierPlanned(d: Deal, s: SubRow): string | null {
  if (d.supplier_deferral_mode === "shipment") return addDaysISO(s.ship?.loading_date ?? null, d.supplier_deferral_days);
  if (d.supplier_deferral_mode === "other") return d.supplier_planned_pay_date ?? null;
  return null;
}
function buyerPlanned(d: Deal, s: SubRow): string | null {
  if (d.buyer_deferral_mode === "shipment") return addDaysISO(s.ship?.date ?? null, d.buyer_deferral_days);
  if (d.buyer_deferral_mode === "other") return d.buyer_planned_pay_date ?? null;
  return null;
}
const DEBT_TODAY = new Date().toISOString().slice(0, 10);
const supplierOverdue = (d: Deal, s: SubRow) => { const p = supplierPlanned(d, s); return !!p && p < DEBT_TODAY && (d.supplier_balance ?? 0) > 0; };
const buyerOverdue = (d: Deal, s: SubRow) => { const p = buyerPlanned(d, s); return !!p && p < DEBT_TODAY && (d.buyer_debt ?? 0) > 0; };

const DEBT_COLUMNS: Column[] = [
  { key: "sup_defer_days", header: "Отсрочка платежа Прод., дн.", width: 14, band: "debt", read: () => "", readShip: (d) => d.supplier_deferral_days ?? "" },
  { key: "sup_defer_basis", header: "Дата начала отсрочки (Прод.)", width: 16, band: "debt", read: () => "",
    readShip: (d) => d.supplier_deferral_mode === "shipment" ? "с даты отгрузки" : d.supplier_deferral_mode === "other" ? (d.supplier_deferral_note ?? "прочее") : "" },
  { key: "sup_planned", header: "Плановая дата оплаты Прод.", width: 14, band: "debt", read: () => "",
    readShip: (d, s) => { const p = supplierPlanned(d, s); return p ? fmtDate(p) : ""; }, redIf: (d, s) => supplierOverdue(d, s) },
  { key: "buy_defer_days", header: "Отсрочка платежа Покуп., дн.", width: 14, band: "debt", read: () => "", readShip: (d) => d.buyer_deferral_days ?? "" },
  { key: "buy_defer_basis", header: "Дата начала отсрочки (Покуп.)", width: 16, band: "debt", read: () => "",
    readShip: (d) => d.buyer_deferral_mode === "shipment" ? "с даты отгрузки" : d.buyer_deferral_mode === "other" ? (d.buyer_deferral_note ?? "прочее") : "" },
  { key: "buy_planned", header: "Плановая дата оплаты Покуп.", width: 14, band: "debt", read: () => "",
    readShip: (d, s) => { const p = buyerPlanned(d, s); return p ? fmtDate(p) : ""; }, redIf: (d, s) => buyerOverdue(d, s) },
];
```

- [ ] **Step 3: Сделать экспортер variant-aware**

Изменить сигнатуру и построить эффективный список колонок:
```ts
export async function exportPassportDetailToExcel(
  deals: Deal[],
  ctx: ExportContext,
  opts?: { variant?: "detail" | "debt" },
): Promise<void> {
  const isDebt = opts?.variant === "debt";
  const columns = isDebt ? [...COLUMNS, ...DEBT_COLUMNS] : COLUMNS;
  // ...
```
Затем **заменить все `COLUMNS` в теле функции на `columns`** (циклы шапки, бэнд-строки, строки-сделки, под-строки; `BAND_STYLE[COLUMNS[i].band]` → `BAND_STYLE[columns[i].band]`). Имя листа/заголовок для debt:
```ts
  const sheetName = isDebt
    ? (ctx.dealType === "KG" ? "Паспорт (долги) KG" : ctx.dealType === "KZ" ? "Паспорт (долги) KZ" : "Паспорт (долги)")
    : (/* существующее detail-имя */);
```

- [ ] **Step 4: Красный шрифт на просроченных плановых датах**

В цикле записи **под-строк** (там, где `const v = col.readShip ? col.readShip(deal, sub) : null;` и задаётся `cell.font`), после установки шрифта добавить:
```ts
        if (col.redIf && col.redIf(deal, sub)) {
          cell.font = { ...cell.font, bold: true, color: { argb: "FFB91C1C" } };
        }
```

- [ ] **Step 5: Включить опцию «Паспорт (долги)» в дропдауне**

В `src/app/(dashboard)/deals/page.tsx`:
- расширить сигнатуру `handleExport(variant: "passport" | "detail" | "debt")`;
- в теле: `if (variant === "debt") { const { exportPassportDetailToExcel } = await import("@/lib/exports/passport-detail-excel"); await exportPassportDetailToExcel(filtered, ctx, { variant: "debt" }); return; }` (или ветку рядом с detail);
- заменить задизейбленный 3-й `DropdownMenuItem` на активный: `onClick={() => handleExport("debt")} disabled={exporting}` с подписью «Паспорт (долги)».

- [ ] **Step 6: tsc + build + changelog + commit**

Run: `npx tsc --noEmit && npm run build`
Запись `[EXPORT] «Паспорт (долги)» — detail + 6 колонок отсрочки/плановых дат, красный на просрочке; опция дропдауна включена`.
```bash
git add src/lib/exports/passport-detail-excel.ts "src/app/(dashboard)/deals/page.tsx" CHANGELOG-SINCE-EXTRACTION.md
git commit -m "feat(debt): экспорт «Паспорт (долги)» + опция дропдауна"
```

---

### Task 5: Деплой + E2E-проверка на проде

**Files:** —

- [ ] **Step 1: Полный прогон + сборка**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: без ошибок; пред-существующий `bulk-wagons.test.ts` может падать (не в счёт).

- [ ] **Step 2: Push + деплой**

```bash
git push origin main
```

- [ ] **Step 3: ЧЕКПОИНТ — данные + E2E**

После применённой миграции 00125: завести условия оплаты на тест-сделке (напр. KG/26/500: Поставщик 30 дн «с даты отгрузки»; Покупатель 45 дн «с даты отгрузки»; и одну сделку с режимом «прочее» + ручной датой).
E2E на проде (playwright): логин → /deals → дропдаун Excel → «Паспорт (долги)» → перехват download → распарсить xlsx и проверить:
- 61 колонка; бэнд «Отсрочка / плановая оплата» в конце;
- под-строки: дни/режим заполнены, плановая дата = дата СНТ + дни (Прод. по вход. СНТ, Покуп. по исход. СНТ);
- сделка с режимом «прочее»: колонка режима = заметка, плановая дата = ручная;
- просроченная плановая дата (напр. дни малые → дата в прошлом, сторона не закрыта) — **красным**;
- «Паспорт» и «Паспорт (детальный)» не изменились.

- [ ] **Step 4: Финальная запись в changelog**

`[FEATURE] «Паспорт (долги)»: условия оплаты (отсрочка) + debt-экспорт с плановыми датами и подсветкой просрочки.`

---

## Self-Review (выполнено при написании плана)

**Покрытие спеки:**
- Компонент 1 (схема) → Task 1. ✓
- Компонент 2 (плановая дата, формула) → Task 4 helpers. ✓
- Компонент 3 (просрочка красным) → Task 4 Step 4 + redIf. ✓
- Компонент 4 (ввод в UI) → Task 3. ✓
- Компонент 5 (экспорт + дропдаун) → Task 4. ✓
- Deal type + LIST_SELECT (для доступности полей в экспорте) → Task 2. ✓

**Типы согласованы:** `Column.redIf`, `SubRow`, `Deal`-поля отсрочки, `supplierPlanned`/`buyerPlanned` используют одинаковые имена в Task 2/4. `exportPassportDetailToExcel` третий параметр `opts.variant` совпадает между Task 4 (сигнатура) и Task 4 Step 5 (вызов из дропдауна).

**Плейсхолдеров нет:** SQL, helpers, JSX, изменения дропдауна приведены целиком. «Заменить все COLUMNS на columns» — механический шаг с явным перечнем мест.

**Решение по DRY:** debt = вариант detail-экспортера (а не отдельный файл-дубль, как предполагала спека) — переиспользует fetch'и (пагинированные) и построение строк; спека допускает `passport-debt-excel.ts`, но вариант чище и без дублирования.

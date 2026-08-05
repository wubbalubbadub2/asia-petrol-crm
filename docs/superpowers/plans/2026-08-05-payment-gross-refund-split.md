# Разделение оплат на «Оплата» и «Возврат/Перезачет» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать в паспорте сделок, карточке, Excel-выгрузках и отчёте «Сборность» две раздельные величины — «Оплата» (только `payment_type='payment'`) и «Возврат/Перезачет» (`refund`+`offset`) — сохранив баланс численно неизменным.

**Architecture:** PostgreSQL остаётся источником истины: `refresh_deal_payment_totals()` дополнительно материализует брутто и возвраты в четыре новые колонки `deals`, а нетто-колонки `supplier_payment`/`buyer_payment` (их читают триггеры баланса) сохраняют прежнюю формулу `брутто − возвраты`. Вся клиентская арифметика знака съезжает в один чистый модуль `src/lib/payments/totals.ts`, который используют паспорт, детальная выгрузка и отчёт.

**Tech Stack:** Next.js (App Router) + React, TypeScript, Supabase/PostgreSQL (plain SQL миграции, append-only), ExcelJS, vitest, PL/pgSQL DO-block тесты.

**Спека:** `docs/superpowers/specs/2026-08-05-payment-gross-refund-split-design.md`

## Global Constraints

- Миграции append-only. Уже закоммиченные файлы в `supabase/migrations/` не редактировать; следующий свободный номер — **00137** (последний занятый — `00136_delivery_bases.sql`).
- `deal_payments.amount` хранится **плюсом**; знак задаёт `payment_type`. `refund` и `offset` минусуют (00062). Эта конвенция не меняется.
- Формулы баланса не трогаем: `supplier_balance = приход − supplier_payment (+ жд/ЭСФ по галочкам)`, `buyer_debt` по 00060. Читают они **нетто**-колонки.
- Валютный guard rollup сохраняется дословно: платёж учитывается, только если `p.currency IS NULL OR p.currency = <валюта стороны>`.
- Возвраты показываются **положительным** числом во всех местах.
- Тип новых колонок — `DECIMAL(14,4) DEFAULT 0`, как у существующих rollup-полей (`00003_deals.sql:43`).
- Язык интерфейса — русский. Точные подписи: колонка/поле — **«Возврат/Перезачет»**; кнопки в попапе — **«+ Возврат»** и **«+ Перезачёт»**.
- Плотная таблица, моноширинные числа с выравниванием вправо (`.claude/rules/ui.md`). Новые ячейки повторяют классы соседней «Оплаты».
- Финальная проверка — `npm run verify` (`lint && test && typecheck && build`).

---

### Task 1: Чистый модуль расчёта итогов оплат

Вся арифметика знака сейчас продублирована в трёх местах (`passport-table.tsx:268`, `deal-events.ts:93`, `passport-detail-excel.ts:338`). Выносим её в один модуль — дальше все задачи опираются на него.

**Files:**
- Create: `src/lib/payments/totals.ts`
- Test: `src/__tests__/payment-totals.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `isRefundKind(t: string | null | undefined): boolean`
  - `signedAmount(p: { amount: number | null; payment_type: string | null | undefined }): number`
  - `type PaymentTotals = { gross: number; refund: number; net: number }`
  - `splitPaymentTotals(items: readonly { amount: number | null; payment_type: string | null | undefined }[]): PaymentTotals`

- [ ] **Step 1: Написать падающий тест**

Создать `src/__tests__/payment-totals.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isRefundKind, signedAmount, splitPaymentTotals } from "@/lib/payments/totals";

describe("isRefundKind", () => {
  it("возврат и перезачёт минусуют, обычная оплата — нет", () => {
    expect(isRefundKind("refund")).toBe(true);
    expect(isRefundKind("offset")).toBe(true);
    expect(isRefundKind("payment")).toBe(false);
  });

  it("null/undefined трактуется как обычная оплата (старые строки до 00051)", () => {
    expect(isRefundKind(null)).toBe(false);
    expect(isRefundKind(undefined)).toBe(false);
  });
});

describe("signedAmount", () => {
  it("возврат уходит в минус, оплата остаётся плюсом", () => {
    expect(signedAmount({ amount: 100, payment_type: "payment" })).toBe(100);
    expect(signedAmount({ amount: 100, payment_type: "refund" })).toBe(-100);
    expect(signedAmount({ amount: 100, payment_type: "offset" })).toBe(-100);
  });

  it("null-сумма считается нулём", () => {
    expect(signedAmount({ amount: null, payment_type: "refund" })).toBe(0);
  });
});

describe("splitPaymentTotals", () => {
  it("норма: две оплаты, возврат и перезачёт", () => {
    expect(
      splitPaymentTotals([
        { amount: 100, payment_type: "payment" },
        { amount: 200, payment_type: "payment" },
        { amount: 30, payment_type: "refund" },
        { amount: 20, payment_type: "offset" },
      ]),
    ).toEqual({ gross: 300, refund: 50, net: 250 });
  });

  it("граница: только возвраты — брутто ноль, нетто отрицательное", () => {
    expect(splitPaymentTotals([{ amount: 40, payment_type: "refund" }])).toEqual({
      gross: 0,
      refund: 40,
      net: -40,
    });
  });

  it("пустой список — все нули", () => {
    expect(splitPaymentTotals([])).toEqual({ gross: 0, refund: 0, net: 0 });
  });

  it("возвраты всегда положительны, знак живёт только в net", () => {
    const t = splitPaymentTotals([
      { amount: 500, payment_type: "payment" },
      { amount: 120, payment_type: "offset" },
    ]);
    expect(t.refund).toBeGreaterThan(0);
    expect(t.net).toBe(t.gross - t.refund);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

```bash
npm test -- src/__tests__/payment-totals.test.ts
```

Ожидание: FAIL — `Failed to resolve import "@/lib/payments/totals"`.

- [ ] **Step 3: Написать модуль**

Создать `src/lib/payments/totals.ts`:

```ts
/**
 * Разделение оплат сделки на брутто и возвраты/перезачёты.
 *
 * В deal_payments.amount сумма лежит ВСЕГДА плюсом, знак задаёт
 * payment_type: 'refund' и 'offset' минусуют (миграция 00062).
 * Нетто-итог = брутто − возвраты; именно нетто читают триггеры
 * баланса (00021/00052/00060/00112), поэтому вся арифметика знака
 * живёт здесь, а не размазана по компонентам и выгрузкам.
 */
export type PaymentTypeish = string | null | undefined;

type PaymentLike = { amount: number | null; payment_type: PaymentTypeish };

/** Возврат и перезачёт численно идентичны — различается только подпись (00062). */
export function isRefundKind(t: PaymentTypeish): boolean {
  return t === "refund" || t === "offset";
}

/** Вклад строки в НЕТТО-итог: возврат/перезачёт уходит в минус. */
export function signedAmount(p: PaymentLike): number {
  return (p.amount ?? 0) * (isRefundKind(p.payment_type) ? -1 : 1);
}

export type PaymentTotals = {
  /** Только payment_type='payment'. Колонка «Оплата». */
  gross: number;
  /** refund + offset, ПОЛОЖИТЕЛЬНОЕ. Колонка «Возврат/Перезачет». */
  refund: number;
  /** gross − refund. То, что читают формулы баланса. */
  net: number;
};

export function splitPaymentTotals(items: readonly PaymentLike[]): PaymentTotals {
  let gross = 0;
  let refund = 0;
  for (const p of items) {
    if (isRefundKind(p.payment_type)) refund += p.amount ?? 0;
    else gross += p.amount ?? 0;
  }
  return { gross, refund, net: gross - refund };
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

```bash
npm test -- src/__tests__/payment-totals.test.ts
```

Ожидание: PASS, 8 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/payments/totals.ts src/__tests__/payment-totals.test.ts
git commit -m "feat(payments): чистый модуль разделения оплат на брутто и возвраты"
```

---

### Task 2: Миграция 00137 — четыре rollup-колонки и обновлённый пересчёт

**Files:**
- Create: `supabase/migrations/00137_payment_gross_refund_split.sql`
- Test: `supabase/tests/07_payment_gross_refund.test.sql`

**Interfaces:**
- Consumes: ничего.
- Produces: колонки `deals.supplier_payment_gross`, `deals.supplier_refund_total`, `deals.buyer_payment_gross`, `deals.buyer_refund_total` (`DECIMAL(14,4) DEFAULT 0`); обновлённая `refresh_deal_payment_totals(p_deal_id UUID) RETURNS VOID`.

**Локальная БД для тестов.** Нужен Postgres со всеми применёнными миграциями. Рецепт повторяет CI-job `db` из `.github/workflows/test.yml`:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" > /dev/null || break
done
```

- [ ] **Step 1: Написать падающий DB-тест**

Создать `supabase/tests/07_payment_gross_refund.test.sql`:

```sql
-- Test: refresh_deal_payment_totals (миграция 00137)
-- «Оплата» = брутто (payment_type='payment'), «Возврат/Перезачет» =
-- refund+offset ПОЛОЖИТЕЛЬНЫМ числом, нетто = брутто − возвраты.
-- Баланс читает нетто и численно не меняется относительно 00062.

BEGIN;

INSERT INTO counterparties (id, type, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000701', 'supplier', 'T7-Supplier'),
  ('00000000-0000-0000-0000-000000000702', 'buyer',    'T7-Buyer');

-- ── Случай 1: норма — 2 оплаты + возврат + перезачёт ──────────────
DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  INSERT INTO deals (
    id, deal_type, deal_number, year, month,
    supplier_id, supplier_shipped_amount, supplier_currency,
    buyer_id, buyer_shipped_amount, buyer_currency
  ) VALUES (
    v_deal_id, 'KG', 9701, 2099, 'январь',
    '00000000-0000-0000-0000-000000000701', 1000, 'USD',
    '00000000-0000-0000-0000-000000000702', 2000, 'USD'
  );

  INSERT INTO deal_payments (deal_id, side, amount, payment_date, payment_type) VALUES
    (v_deal_id, 'supplier', 100, '2099-01-10', 'payment'),
    (v_deal_id, 'supplier', 200, '2099-01-11', 'payment'),
    (v_deal_id, 'supplier',  30, '2099-01-12', 'refund'),
    (v_deal_id, 'supplier',  20, '2099-01-13', 'offset');

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;

  IF v_row.supplier_payment_gross <> 300 THEN
    RAISE EXCEPTION 'supplier_payment_gross expected 300, got %', v_row.supplier_payment_gross;
  END IF;
  IF v_row.supplier_refund_total <> 50 THEN
    RAISE EXCEPTION 'supplier_refund_total expected 50 (положительное), got %', v_row.supplier_refund_total;
  END IF;
  IF v_row.supplier_payment <> 250 THEN
    RAISE EXCEPTION 'supplier_payment (нетто) expected 250, got %', v_row.supplier_payment;
  END IF;
  -- Баланс = приход − нетто. Ровно то же число, что давал 00062.
  IF v_row.supplier_balance <> 1000 - 250 THEN
    RAISE EXCEPTION 'supplier_balance expected 750, got %', v_row.supplier_balance;
  END IF;

  -- ── Случай 3: реверс — удаляем возврат 30 ──────────────────────
  DELETE FROM deal_payments
   WHERE deal_id = v_deal_id AND payment_type = 'refund';
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.supplier_payment_gross <> 300 OR v_row.supplier_refund_total <> 20
     OR v_row.supplier_payment <> 280 THEN
    RAISE EXCEPTION 'после удаления возврата ожидалось 300/20/280, got %/%/%',
      v_row.supplier_payment_gross, v_row.supplier_refund_total, v_row.supplier_payment;
  END IF;

  -- ── Случай 4: смена типа payment → refund у строки на 200 ──────
  UPDATE deal_payments SET payment_type = 'refund'
   WHERE deal_id = v_deal_id AND amount = 200;
  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.supplier_payment_gross <> 100 OR v_row.supplier_refund_total <> 220
     OR v_row.supplier_payment <> -120 THEN
    RAISE EXCEPTION 'после смены типа ожидалось 100/220/-120, got %/%/%',
      v_row.supplier_payment_gross, v_row.supplier_refund_total, v_row.supplier_payment;
  END IF;
END $$;

-- ── Случай 2: граница — только возврат, оплат нет ─────────────────
DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  INSERT INTO deals (
    id, deal_type, deal_number, year, month,
    supplier_id, supplier_shipped_amount, supplier_currency
  ) VALUES (
    v_deal_id, 'KG', 9702, 2099, 'январь',
    '00000000-0000-0000-0000-000000000701', 1000, 'USD'
  );

  INSERT INTO deal_payments (deal_id, side, amount, payment_date, payment_type)
  VALUES (v_deal_id, 'supplier', 40, '2099-01-10', 'refund');

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.supplier_payment_gross <> 0 THEN
    RAISE EXCEPTION 'только возврат: gross expected 0, got %', v_row.supplier_payment_gross;
  END IF;
  IF v_row.supplier_refund_total <> 40 THEN
    RAISE EXCEPTION 'только возврат: refund expected 40, got %', v_row.supplier_refund_total;
  END IF;
  IF v_row.supplier_payment <> -40 THEN
    RAISE EXCEPTION 'только возврат: нетто expected -40, got %', v_row.supplier_payment;
  END IF;
  IF v_row.supplier_balance <> 1000 + 40 THEN
    RAISE EXCEPTION 'только возврат: баланс expected 1040, got %', v_row.supplier_balance;
  END IF;
END $$;

-- ── Случай 5: валюта платежа ≠ валюты стороны — не учитывается ────
DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  INSERT INTO deals (
    id, deal_type, deal_number, year, month,
    supplier_id, supplier_shipped_amount, supplier_currency
  ) VALUES (
    v_deal_id, 'KG', 9703, 2099, 'январь',
    '00000000-0000-0000-0000-000000000701', 1000, 'USD'
  );

  INSERT INTO deal_payments (deal_id, side, amount, payment_date, payment_type, currency) VALUES
    (v_deal_id, 'supplier', 700, '2099-01-10', 'payment', 'KZT'),
    (v_deal_id, 'supplier',  90, '2099-01-11', 'refund',  'KZT');

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF v_row.supplier_payment_gross <> 0 OR v_row.supplier_refund_total <> 0
     OR v_row.supplier_payment <> 0 THEN
    RAISE EXCEPTION 'чужая валюта не должна попасть ни в одну колонку, got %/%/%',
      v_row.supplier_payment_gross, v_row.supplier_refund_total, v_row.supplier_payment;
  END IF;
END $$;

-- ── Случай 6: сделка без оплат — все шесть колонок нули ───────────
DO $$
DECLARE
  v_deal_id UUID := gen_random_uuid();
  v_row     deals%ROWTYPE;
BEGIN
  INSERT INTO deals (
    id, deal_type, deal_number, year, month,
    supplier_id, supplier_currency, buyer_id, buyer_currency
  ) VALUES (
    v_deal_id, 'KG', 9704, 2099, 'январь',
    '00000000-0000-0000-0000-000000000701', 'USD',
    '00000000-0000-0000-0000-000000000702', 'USD'
  );

  -- Строка появилась и сразу удалена: rollup обязан вернуть нули,
  -- а не оставить прошлые значения (ветка IF NOT FOUND).
  INSERT INTO deal_payments (deal_id, side, amount, payment_date, payment_type)
  VALUES (v_deal_id, 'buyer', 500, '2099-01-10', 'payment');
  DELETE FROM deal_payments WHERE deal_id = v_deal_id;

  SELECT * INTO v_row FROM deals WHERE id = v_deal_id;
  IF COALESCE(v_row.supplier_payment_gross, -1) <> 0
     OR COALESCE(v_row.supplier_refund_total, -1) <> 0
     OR COALESCE(v_row.supplier_payment, -1) <> 0
     OR COALESCE(v_row.buyer_payment_gross, -1) <> 0
     OR COALESCE(v_row.buyer_refund_total, -1) <> 0
     OR COALESCE(v_row.buyer_payment, -1) <> 0 THEN
    RAISE EXCEPTION 'сделка без оплат: ожидались нули, got %/%/% и %/%/%',
      v_row.supplier_payment_gross, v_row.supplier_refund_total, v_row.supplier_payment,
      v_row.buyer_payment_gross, v_row.buyer_refund_total, v_row.buyer_payment;
  END IF;
END $$;

ROLLBACK;
```

- [ ] **Step 2: Запустить DB-тесты — убедиться, что новый падает**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres" ./supabase/tests/run.sh
```

Ожидание: `✗ 07_payment_gross_refund.test.sql FAILED` — `column "supplier_payment_gross" does not exist`. Тесты 01–06 проходят.

- [ ] **Step 3: Написать миграцию**

Создать `supabase/migrations/00137_payment_gross_refund_split.sql`:

```sql
-- 00137_payment_gross_refund_split.sql
--
-- Клиент 2026-08-05: «в таблицу сделок попадает агрегированные данные
-- всех оплат. Нужно вывести два поля: Оплата, Возврат/Перерасчет».
--
-- До этой миграции у сделки было одно число на сторону —
-- deals.supplier_payment / buyer_payment — и в нём уже сидело
-- НЕТТО: payment − refund − offset (00051, 00062). Возвраты и
-- перезачёты вычитались, но увидеть их отдельной величиной было
-- негде: сумма в паспорте молча «худела».
--
-- Теперь rollup материализует три числа на сторону:
--     gross   = Σ amount WHERE payment_type = 'payment'
--     refund  = Σ amount WHERE payment_type IN ('refund','offset')
--     payment = gross − refund        -- ровно то же, что и раньше
--
-- refund хранится ПОЛОЖИТЕЛЬНЫМ: это отдельная колонка «Возврат/
-- Перезачет», а не слагаемое со знаком. Знак живёт только в нетто.
--
-- Баланс НЕ МЕНЯЕТСЯ. compute_deal_derived_fields (00021 → 00052 →
-- 00060 → 00112) продолжает читать нетто-колонки, формула, валюта,
-- единицы, округление и дата-основа те же. Ни одно историческое
-- значение баланса не сдвигается.
--
-- Валютный guard из 00043/00051/00062 сохранён дословно: платёж в
-- валюте, отличной от валюты стороны, не попадает НИ В ОДНУ из трёх
-- сумм.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_payment_gross DECIMAL(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_refund_total  DECIMAL(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_payment_gross    DECIMAL(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_refund_total     DECIMAL(14,4) DEFAULT 0;

COMMENT ON COLUMN deals.supplier_payment_gross IS
  'Оплаты поставщику, только payment_type=''payment''. Колонка «Оплата» в паспорте.';
COMMENT ON COLUMN deals.supplier_refund_total IS
  'Возвраты и перезачёты по стороне поставщика (refund+offset), ПОЛОЖИТЕЛЬНОЕ. Колонка «Возврат/Перезачет».';
COMMENT ON COLUMN deals.buyer_payment_gross IS
  'Оплаты покупателя, только payment_type=''payment''. Колонка «Оплата» в паспорте.';
COMMENT ON COLUMN deals.buyer_refund_total IS
  'Возвраты и перезачёты по стороне покупателя (refund+offset), ПОЛОЖИТЕЛЬНОЕ. Колонка «Возврат/Перезачет».';
COMMENT ON COLUMN deals.supplier_payment IS
  'НЕТТО оплат поставщику = supplier_payment_gross − supplier_refund_total. Именно это число читает формула баланса.';
COMMENT ON COLUMN deals.buyer_payment IS
  'НЕТТО оплат покупателя = buyer_payment_gross − buyer_refund_total. Именно это число читает формула долга.';

CREATE OR REPLACE FUNCTION refresh_deal_payment_totals(p_deal_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE deals d SET
    supplier_payment_gross = COALESCE(sub.sup_gross, 0),
    supplier_refund_total  = COALESCE(sub.sup_refund, 0),
    supplier_payment       = COALESCE(sub.sup_gross, 0) - COALESCE(sub.sup_refund, 0),
    buyer_payment_gross    = COALESCE(sub.buy_gross, 0),
    buyer_refund_total     = COALESCE(sub.buy_refund, 0),
    buyer_payment          = COALESCE(sub.buy_gross, 0) - COALESCE(sub.buy_refund, 0)
  FROM (
    SELECT
      p.deal_id,
      SUM(CASE
            WHEN p.side = 'supplier'
             AND (p.currency IS NULL OR p.currency = d2.supplier_currency)
             AND p.payment_type = 'payment'
            THEN p.amount ELSE 0
          END) AS sup_gross,
      SUM(CASE
            WHEN p.side = 'supplier'
             AND (p.currency IS NULL OR p.currency = d2.supplier_currency)
             AND p.payment_type IN ('refund','offset')
            THEN p.amount ELSE 0
          END) AS sup_refund,
      SUM(CASE
            WHEN p.side = 'buyer'
             AND (p.currency IS NULL OR p.currency = d2.buyer_currency)
             AND p.payment_type = 'payment'
            THEN p.amount ELSE 0
          END) AS buy_gross,
      SUM(CASE
            WHEN p.side = 'buyer'
             AND (p.currency IS NULL OR p.currency = d2.buyer_currency)
             AND p.payment_type IN ('refund','offset')
            THEN p.amount ELSE 0
          END) AS buy_refund
    FROM deal_payments p
    JOIN deals d2 ON d2.id = p.deal_id
    WHERE p.deal_id = p_deal_id
    GROUP BY p.deal_id
  ) sub
  WHERE d.id = sub.deal_id;

  -- Ни одной строки оплат — обнуляем все шесть колонок (иначе после
  -- удаления последней оплаты в сделке остались бы прошлые итоги).
  IF NOT FOUND THEN
    UPDATE deals SET
      supplier_payment = 0, supplier_payment_gross = 0, supplier_refund_total = 0,
      buyer_payment    = 0, buyer_payment_gross    = 0, buyer_refund_total    = 0
    WHERE id = p_deal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── Бэкфилл ──────────────────────────────────────────────────────
-- Прогон по сделкам, у которых есть оплаты. У остальных остаются
-- нули из DEFAULT.
--
-- Нетто пересчитывается в ТЕ ЖЕ значения (формула не изменилась) —
-- кроме сделок с активным ручным переопределением итога («Изменить
-- итог» в паспорте пишет прямо в deals.supplier_payment и живёт до
-- следующего срабатывания rollup). Там нетто вернётся к сумме строк,
-- и триггер 00094 запишет в ленту сделки строку «Оплата ...: Δ».
-- Это тот же эффект, что дало бы любое редактирование оплаты, просто
-- случившийся в момент миграции.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_payments LOOP
    PERFORM refresh_deal_payment_totals(r.deal_id);
  END LOOP;
END $$;
```

- [ ] **Step 4: Применить миграцию и прогнать DB-тесты**

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/00137_payment_gross_refund_split.sql
./supabase/tests/run.sh
```

Ожидание: `All DB tests passed.` — все семь файлов, включая `07_payment_gross_refund.test.sql`.

- [ ] **Step 5: Коммит**

```bash
git add supabase/migrations/00137_payment_gross_refund_split.sql supabase/tests/07_payment_gross_refund.test.sql
git commit -m "feat(db): разделение оплат на брутто и возвраты/перезачёты (00137)"
```

---

### Task 3: Типы и загрузка новых колонок

Без этого шага новые поля не доедут до клиента: `LIST_SELECT` — явный список колонок. `DEAL_SELECT` использует `*`, ему правки не нужны.

**Files:**
- Modify: `src/lib/types/database.ts` (три блока `deals`: `Row` ~1090–1170, `Insert` ~1175–1250, `Update` ~1258–1330)
- Modify: `src/lib/hooks/use-deals.ts:37-60` (тип `Deal`), `src/lib/hooks/use-deals.ts:337-362` (`LIST_SELECT`)

**Interfaces:**
- Consumes: колонки из Task 2.
- Produces: поля `supplier_payment_gross`, `supplier_refund_total`, `buyer_payment_gross`, `buyer_refund_total` типа `number | null` на типе `Deal`; те же поля в выборке списка сделок.

- [ ] **Step 1: Добавить колонки в сгенерированные типы**

`src/lib/types/database.ts` — файл генерируется `npm run types:db` из удалённого проекта, где миграции 00137 ещё нет, поэтому правим вручную (так же поступили с `*_contract_number` из 00135). Ключи внутри каждого блока идут по алфавиту — вставлять строго в позицию.

В блоке **`Row`** (типы `number | null`):
- после `buyer_payment_date: string | null` → `buyer_payment_gross: number | null`
- после `buyer_quotation_comment: string | null` → `buyer_refund_total: number | null`
- после `supplier_payment_date: string | null` → `supplier_payment_gross: number | null`
- после `supplier_quotation_comment: string | null` → `supplier_refund_total: number | null`

В блоках **`Insert`** и **`Update`** — те же четыре ключа в тех же позициях, но с `?`:
`buyer_payment_gross?: number | null`, `buyer_refund_total?: number | null`,
`supplier_payment_gross?: number | null`, `supplier_refund_total?: number | null`.

- [ ] **Step 2: Расширить тип `Deal` и выборку списка**

В `src/lib/hooks/use-deals.ts` после строки `supplier_payment: number | null;` (строка 37) добавить:

```ts
  // 00137: «Оплата» в паспорте — это брутто, возвраты и перезачёты
  // живут отдельной колонкой. supplier_payment остаётся НЕТТО
  // (= gross − refund) и кормит формулу баланса.
  supplier_payment_gross: number | null;
  supplier_refund_total: number | null;
```

После `buyer_payment: number | null;` (строка 58) добавить:

```ts
  buyer_payment_gross: number | null;
  buyer_refund_total: number | null;
```

В `LIST_SELECT` заменить строку

```
  supplier_payment, supplier_payment_date, supplier_balance,
```

на

```
  supplier_payment, supplier_payment_gross, supplier_refund_total,
  supplier_payment_date, supplier_balance,
```

и строку

```
  buyer_payment, buyer_payment_date, buyer_debt,
```

на

```
  buyer_payment, buyer_payment_gross, buyer_refund_total,
  buyer_payment_date, buyer_debt,
```

- [ ] **Step 3: Проверить типы**

```bash
npm run typecheck
```

Ожидание: PASS (новые поля обязательны в `Deal`, но `Deal` собирается из выборки — ошибок быть не должно). Если всплывут места, конструирующие `Deal`-литерал вручную, — дописать туда `supplier_payment_gross: null` и остальные три поля.

- [ ] **Step 4: Коммит**

```bash
git add src/lib/types/database.ts src/lib/hooks/use-deals.ts
git commit -m "feat(types): брутто-оплата и возвраты в типах и выборке сделок"
```

---

### Task 4: Ячейка оплат в паспорте — два режима

Переводим `PaymentBreakdownCell` на работу в двух режимах (`kind`) до того, как добавим сами колонки: так таблица ни на одном шаге не остаётся в нерабочем состоянии.

**Files:**
- Modify: `src/components/deals/passport-table.tsx:265-270` (`signedAmount` — удалить, взять из модуля), `:333-527` (`PaymentBreakdownCell`)

**Interfaces:**
- Consumes: `splitPaymentTotals`, `isRefundKind` из `@/lib/payments/totals` (Task 1); поля `Deal` из Task 3.
- Produces: `PaymentBreakdownCell` с пропсами `{ dealId, gross, refund, balance, side, kind, currency, className, dataCol, dataValue }`, где `kind: "payment" | "refund"`.

- [ ] **Step 1: Убрать локальный `signedAmount`, подключить общий модуль**

В шапке файла добавить импорт:

```ts
import { splitPaymentTotals, isRefundKind } from "@/lib/payments/totals";
```

Удалить локальную функцию (строки 265–270):

```ts
function signedAmount(p: PaymentSnap): number {
  const sign = p.payment_type === "refund" || p.payment_type === "offset" ? -1 : 1;
  return (p.amount ?? 0) * sign;
}
```

и обновить комментарий над `PaymentEditRow`, заменив последнее предложение на:
`// Знак вклада оплаты в НЕТТО-итог живёт в @/lib/payments/totals (00062, 00137).`

- [ ] **Step 2: Переписать сигнатуру и состояние `PaymentBreakdownCell`**

Заменить блок пропсов (строки 333–356) на:

```tsx
function PaymentBreakdownCell({
  dealId, gross, refund, balance, side, kind, currency, className, dataCol, dataValue,
}: {
  dealId: string;
  // Обе величины стороны нужны КАЖДОЙ ячейке: нетто (= gross − refund)
  // кормит баланс, поэтому правка возвратов двигает баланс ровно так
  // же, как правка оплат.
  gross: number | null | undefined;
  refund: number | null | undefined;
  // Текущий Баланс (supplier) / Долг (buyer) — для мгновенного локального
  // пересчёта: Δбаланса = ∓Δнетто.
  balance: number | null | undefined;
  side: "supplier" | "buyer";
  // Какую половину показывает ячейка: «Оплата» или «Возврат/Перезачет».
  kind: "payment" | "refund";
  currency: string;
  className?: string;
  dataCol?: string;
  dataValue?: number | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const isRefundCell = kind === "refund";
  // Показываем свою половину; в состоянии держим ПОЛНЫЙ список стороны
  // (кэш общий на сторону) и фильтруем на рендере — так пересчёт обеих
  // колонок делается одним splitPaymentTotals.
  const shown = isRefundCell ? refund : gross;
  const [payments, setPayments] = useState<PaymentSnap[] | null>(null);
  const visible = useMemo(
    () => (payments ?? []).filter((p) => isRefundKind(p.payment_type) === isRefundCell),
    [payments, isRefundCell],
  );
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
```

(`useMemo` уже импортирован в файле — строка 3.)

- [ ] **Step 3: Переписать оптимистичный пересчёт**

Заменить `applyOptimistic` и `revertOptimistic` (строки ~404–431) на:

```tsx
  // Клиент 2026-07-16: «на фронте мы всегда меняем сразу — как в
  // Excel». Обе колонки оплат + баланс патчатся в кэш синхронно.
  // Формулы триггеров: supplier_balance = приход − нетто + …
  // → Δбаланса = −Δнетто; buyer_debt = нетто − отгружено
  // → Δдолга = +Δнетто.
  function applyOptimistic(nextAll: PaymentSnap[]) {
    setPayments(nextAll);
    const t = splitPaymentTotals(nextAll);
    const deltaNet = t.net - ((gross ?? 0) - (refund ?? 0));
    if (side === "supplier") {
      applyDealPatch(dealId, {
        supplier_payment_gross: t.gross,
        supplier_refund_total: t.refund,
        supplier_payment: t.net,
        supplier_balance: (balance ?? 0) - deltaNet,
      });
    } else {
      applyDealPatch(dealId, {
        buyer_payment_gross: t.gross,
        buyer_refund_total: t.refund,
        buyer_payment: t.net,
        buyer_debt: (balance ?? 0) + deltaNet,
      });
    }
  }

  function revertOptimistic(
    prev: PaymentSnap[] | null,
    prevGross: number | null | undefined,
    prevRefund: number | null | undefined,
    prevBalance: number | null | undefined,
    message: string,
  ) {
    setPayments(prev);
    const net = (prevGross ?? 0) - (prevRefund ?? 0);
    if (side === "supplier") {
      applyDealPatch(dealId, {
        supplier_payment_gross: prevGross ?? 0,
        supplier_refund_total: prevRefund ?? 0,
        supplier_payment: net,
        supplier_balance: prevBalance ?? 0,
      });
    } else {
      applyDealPatch(dealId, {
        buyer_payment_gross: prevGross ?? 0,
        buyer_refund_total: prevRefund ?? 0,
        buyer_payment: net,
        buyer_debt: prevBalance ?? 0,
      });
    }
    toast.error(`${isRefundCell ? "Возврат" : "Оплата"}: ${message}`);
  }
```

- [ ] **Step 4: Обновить CRUD-обработчики под новый снимок состояния**

Заменить `patchPayment`, `deletePayment`, `addPayment` (строки ~437–487) на:

```tsx
  async function patchPayment(id: string, patch: { amount?: number; payment_date?: string }) {
    const prev = payments; const prevGross = gross; const prevRefund = refund; const prevBalance = balance;
    applyOptimistic((prev ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)));
    const sb = createClient();
    const { error } = await sb.from("deal_payments").update(patch).eq("id", id);
    if (error) { revertOptimistic(prev, prevGross, prevRefund, prevBalance, error.message); return; }
    syncCachesInBackground();
  }

  async function deletePayment(id: string) {
    if (!confirm(isRefundCell ? "Удалить возврат/перезачёт?" : "Удалить оплату?")) return;
    const prev = payments; const prevGross = gross; const prevRefund = refund; const prevBalance = balance;
    applyOptimistic((prev ?? []).filter((p) => p.id !== id));
    const sb = createClient();
    const { error } = await sb.from("deal_payments").delete().eq("id", id);
    if (error) { revertOptimistic(prev, prevGross, prevRefund, prevBalance, error.message); return; }
    syncCachesInBackground();
  }

  // Тип строки задаёт ячейка: «Оплата» создаёт payment, «Возврат/
  // Перезачет» — refund или offset (до 00137 создать их из паспорта
  // было нельзя вообще).
  async function addPayment(paymentType: "payment" | "refund" | "offset") {
    // id генерируем на клиенте — строка появляется мгновенно и сразу
    // редактируема, без ожидания серверного id.
    const id = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const prev = payments; const prevGross = gross; const prevRefund = refund; const prevBalance = balance;
    applyOptimistic([
      ...(prev ?? []),
      { id, payment_date: today, amount: 0, currency: null, description: null, payment_type: paymentType },
    ]);
    const sb = createClient();
    const { error } = await sb.from("deal_payments").insert({
      id,
      deal_id: dealId,
      side,
      amount: 0,
      payment_date: today,
      payment_type: paymentType,
    });
    if (error) { revertOptimistic(prev, prevGross, prevRefund, prevBalance, error.message); return; }
    syncCachesInBackground();
  }
```

- [ ] **Step 5: Переписать `commitEdit` на брутто-переопределение**

Заменить `commitEdit` (строки ~495–518) на:

```tsx
  // «Изменить итог» есть только у ячейки «Оплата» и задаёт БРУТТО.
  // Нетто пересобирается как X − возвраты, баланс едет за нетто.
  // Как и до 00137, переопределение живёт до первого изменения любой
  // строки оплат: тогда триггер пересчитает итоги из строк.
  function commitEdit() {
    setEditing(false);
    const num = parseNum(localVal);
    if (num === gross) return;
    const prevGross = gross; const prevBalance = balance;
    const newGross = num ?? 0;
    const newNet = newGross - (refund ?? 0);
    const deltaNet = newNet - ((gross ?? 0) - (refund ?? 0));
    if (side === "supplier") {
      applyDealPatch(dealId, {
        supplier_payment_gross: newGross,
        supplier_payment: newNet,
        supplier_balance: (balance ?? 0) - deltaNet,
      });
    } else {
      applyDealPatch(dealId, {
        buyer_payment_gross: newGross,
        buyer_payment: newNet,
        buyer_debt: (balance ?? 0) + deltaNet,
      });
    }
    const grossField = side === "supplier" ? "supplier_payment_gross" : "buyer_payment_gross";
    const netField = side === "supplier" ? "supplier_payment" : "buyer_payment";
    updateDeal(dealId, { [grossField]: newGross, [netField]: newNet }).catch(() => {
      if (side === "supplier") {
        applyDealPatch(dealId, {
          supplier_payment_gross: prevGross ?? 0,
          supplier_payment: (prevGross ?? 0) - (refund ?? 0),
          supplier_balance: prevBalance ?? 0,
        });
      } else {
        applyDealPatch(dealId, {
          buyer_payment_gross: prevGross ?? 0,
          buyer_payment: (prevGross ?? 0) - (refund ?? 0),
          buyer_debt: prevBalance ?? 0,
        });
      }
    });
  }
```

В `startEdit` заменить `setLocalVal(shown?.toString() ?? "")` — оставить как есть, `shown` для payment-ячейки уже равен брутто.

- [ ] **Step 6: Обновить рендер попапа**

В теле попапа (строки ~540–570) заменить блок списка и кнопок на:

```tsx
              <div className="mb-1 font-medium">
                {visible.length === 0
                  ? (isRefundCell ? "Нет возвратов" : "Нет оплат")
                  : pluralizePayments(visible.length)}
              </div>
              {visible
                .slice()
                .sort((a, b) => (a.payment_date ?? "").localeCompare(b.payment_date ?? ""))
                .map((p) => (
                  <div key={p.id}>
                    <PaymentEditRow p={p} fallbackCurrency={currency} onPatch={patchPayment} onDelete={deletePayment} />
                    {p.description ? <div className="pl-1 text-[10px] text-stone-400">{p.description}</div> : null}
                  </div>
                ))}
              {isRefundCell ? (
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); addPayment("refund"); }}
                    className="flex-1 rounded border border-stone-600 px-2 py-0.5 text-[10px] text-stone-300 hover:bg-stone-700 focus:outline-none"
                  >
                    + Возврат
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); addPayment("offset"); }}
                    className="flex-1 rounded border border-stone-600 px-2 py-0.5 text-[10px] text-stone-300 hover:bg-stone-700 focus:outline-none"
                  >
                    + Перезачёт
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); addPayment("payment"); }}
                  className="mt-1 w-full rounded border border-stone-600 px-2 py-0.5 text-[10px] text-stone-300 hover:bg-stone-700 focus:outline-none"
                >
                  + Оплата
                </button>
              )}
```

Кнопку «Изменить итог» (сразу после блока со списком) обернуть так, чтобы она рисовалась только у payment-ячейки:

```tsx
          {!isRefundCell && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); startEdit(); }}
              className="mt-2 w-full rounded bg-amber-500/90 px-2 py-1 text-[10px] font-medium text-stone-900 hover:bg-amber-400 focus:outline-none"
            >
              Изменить итог
            </button>
          )}
```

`pluralizePayments` (строки 254–261) склоняет слово «оплата». Для ячейки возвратов заголовок будет читаться как «3 оплаты», что неверно — заменить вызов на локальный хелпер, добавив рядом с `pluralizePayments`:

```tsx
// «возврат / возврата / возвратов» — те же три формы, что у «оплаты».
function pluralizeRefunds(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} возвратов`;
  if (mod10 === 1) return `${n} возврат`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} возврата`;
  return `${n} возвратов`;
}
```

и в заголовке попапа использовать `(isRefundCell ? pluralizeRefunds : pluralizePayments)(visible.length)`.

- [ ] **Step 7: Проверить типы**

```bash
npm run typecheck
```

Ожидание: FAIL ровно в двух местах — вызовы `<PaymentBreakdownCell>` в строках ~1007 и ~1107 передают старый проп `value`. Это чинится в Task 5.

- [ ] **Step 8: Коммит**

```bash
git add src/components/deals/passport-table.tsx
git commit -m "feat(passport): ячейка оплат работает в режимах «Оплата» и «Возврат/Перезачет»"
```

---

### Task 5: Две новые колонки в паспорте

**Files:**
- Modify: `src/components/deals/passport-table.tsx` — `:1007-1016` и `:1107-1116` (ячейки строки), `:1229-1244` (скелет), `:1264-1288` (`NUMERIC_COLS`), `:1708` и `:1724` (шапка), `:1815-1870` (`PT_UNITS`, `TOTAL_COLS`), `:2044-2095` (итоговая строка)

**Interfaces:**
- Consumes: `PaymentBreakdownCell` из Task 4; поля `Deal` из Task 3.
- Produces: ключи колонок `supplier_refund` и `buyer_refund` в `PT_UNITS` и `NUMERIC_COLS` (эти ключи персистятся в `user_prefs.passport_columns`, менять их потом нельзя).

- [ ] **Step 1: Вставить ячейки в строку данных**

Строки 1007–1016 (поставщик) заменить на:

```tsx
      <PaymentBreakdownCell
        dealId={deal.id}
        gross={deal.supplier_payment_gross}
        refund={deal.supplier_refund_total}
        balance={deal.supplier_balance}
        side="supplier"
        kind="payment"
        currency={deal.supplier_currency ?? ""}
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-700"
        dataCol="supplier_payment_gross"
        dataValue={deal.supplier_payment_gross}
      />
      <PaymentBreakdownCell
        dealId={deal.id}
        gross={deal.supplier_payment_gross}
        refund={deal.supplier_refund_total}
        balance={deal.supplier_balance}
        side="supplier"
        kind="refund"
        currency={deal.supplier_currency ?? ""}
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10 text-stone-700"
        dataCol="supplier_refund_total"
        dataValue={deal.supplier_refund_total}
      />
```

Строки 1107–1116 (покупатель) — аналогично:

```tsx
      <PaymentBreakdownCell
        dealId={deal.id}
        gross={deal.buyer_payment_gross}
        refund={deal.buyer_refund_total}
        balance={deal.buyer_debt}
        side="buyer"
        kind="payment"
        currency={deal.buyer_currency ?? ""}
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-700"
        dataCol="buyer_payment_gross"
        dataValue={deal.buyer_payment_gross}
      />
      <PaymentBreakdownCell
        dealId={deal.id}
        gross={deal.buyer_payment_gross}
        refund={deal.buyer_refund_total}
        balance={deal.buyer_debt}
        side="buyer"
        kind="refund"
        currency={deal.buyer_currency ?? ""}
        className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10 text-stone-700"
        dataCol="buyer_refund_total"
        dataValue={deal.buyer_refund_total}
      />
```

- [ ] **Step 2: Вставить заголовки**

В строке заголовков `tr.pt-cols` есть два `<th>…>Оплата</th>` — различаются фоном полосы. Сразу после того, у которого `bg-[#fce3d6]` (поставщик, между «Приход, тонн» и «Баланс»), добавить:

```tsx
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[85px] bg-[#fce3d6]" title="Возвраты и перезачёты (refund + offset). Вычитаются из оплаты при расчёте баланса.">Возврат/Перезачет</th>
```

Сразу после второго — с `bg-[#fff2cc]` (покупатель, между «Отгр. сумма» и «Долг») — добавить:

```tsx
              <th className="sticky top-7 z-20 border-r px-2 py-1.5 text-right font-medium text-stone-700 min-w-[85px] bg-[#fff2cc]" title="Возвраты и перезачёты (refund + offset). Вычитаются из оплаты при расчёте долга.">Возврат/Перезачет</th>
```

- [ ] **Step 3: Пересчитать реестр колонок `PT_UNITS`**

Вставить две записи и сдвинуть `h`/`body` у всех последующих на +1 (после поставщика) и ещё +1 (после покупателя). Итоговый блок от `supplier_payment` до конца:

```ts
  { key: "supplier_payment", label: "Оплата", band: "supplier", h: [14], body: 14 },
  { key: "supplier_refund", label: "Возврат/Перезачет", band: "supplier", h: [15], body: 15 },
  { key: "supplier_balance", label: "Баланс", band: "supplier", h: [16], body: 16 },
  { key: "groups", label: "Группы компании", band: "groups", h: [17, 18], body: 17 },
  { key: "buyer", label: "Покупатель", band: "buyer", h: [19], body: 18 },
  { key: "buyer_contract", label: "Номер приложения", band: "buyer", h: [20], body: 19 },
  { key: "buyer_basis", label: "Базис", band: "buyer", h: [21], body: 20 },
  { key: "buyer_volume", label: "Объем", band: "buyer", h: [22], body: 21 },
  { key: "buyer_amount", label: "Сумма дог.", band: "buyer", h: [23], body: 22 },
  { key: "buyer_price", label: "Цена", band: "buyer", h: [24], body: 23 },
  { key: "buyer_ordered", label: "Заявлено", band: "buyer", h: [25], body: 24 },
  { key: "buyer_remainder", label: "Остаток", band: "buyer", h: [26], body: 25 },
  { key: "buyer_shipped_volume", label: "Отгр. тонн", band: "buyer", h: [27], body: 26 },
  { key: "buyer_shipped_amount", label: "Отгр. сумма", band: "buyer", h: [28], body: 27 },
  { key: "buyer_payment", label: "Оплата", band: "buyer", h: [29], body: 28 },
  { key: "buyer_refund", label: "Возврат/Перезачет", band: "buyer", h: [30], body: 29 },
  { key: "buyer_debt", label: "Долг", band: "buyer", h: [31], body: 30 },
  { key: "forwarder", label: "Экспедитор", band: "logistics", h: [32], body: 31 },
  { key: "logistics_group", label: "Группа комп.", band: "logistics", h: [33], body: 32 },
  { key: "planned_tariff", label: "Тариф", band: "logistics", h: [34], body: 33 },
  { key: "preliminary_tonnage", label: "Объем план", band: "logistics", h: [35], body: 34 },
  { key: "preliminary_amount", label: "Предв. сумма", band: "logistics", h: [36], body: 35 },
  { key: "actual_tariff", label: "Тариф факт", band: "logistics", h: [37], body: 36 },
  { key: "actual_volume", label: "Факт объем", band: "logistics", h: [38], body: 37 },
  { key: "invoice_amount", label: "Сумма", band: "logistics", h: [39], body: 38 },
  { key: "shipper_tariff", label: "Тариф менеджер", band: "logistics", h: [40], body: 39 },
  { key: "additional_expenses", label: "ЭСФ грузоотправление", band: "logistics", h: [41], body: 40 },
  { key: "manager", label: "Коммерция", band: "logistics", h: [42], body: 41 },
```

Записи до `supplier_payment` (`month` … `supplier_shipped_volume`) не меняются.

В комментарии над `PT_UNITS` (строки ~1822–1823) исправить: `«№» (h1) и колонка удаления (h43) не скрываются…` (было `h41`).

Ниже, в том же блоке, `const TOTAL_COLS = 36;` → `const TOTAL_COLS = 38;`.

- [ ] **Step 4: Обновить скелет и комментарий о геометрии**

В `PassportSkeletonRow` (строки 1229–1244) заменить `length: 38` на `length: 40` и обновить комментарий:

```tsx
  // 40 visible columns: 5 identity + 11 supplier (+ Возврат/Перезачет,
  // 00137) + 2 company-groups (merged via colSpan=2 in real rows) +
  // 13 buyer (+ Возврат/Перезачет) + 9 logistics.
```

В комментарии над `VirtualizedRows` (строки ~1806–1811) заменить `The total visible column count is 36 (5 Сделка + 10 Поставщик + 2 Группы компании + 11 Покупатель + 8 Логистика); the spacer rows use colSpan=36` на `… is 38 (5 Сделка + 11 Поставщик + 2 Группы компании + 12 Покупатель + 8 Логистика); the spacer rows use colSpan=38`.

- [ ] **Step 5: Добавить колонки в выделение с суммой**

В `NUMERIC_COLS` заменить строку `supplier_payment: { label: "Оплата (Поставщик)", decimals: 2 },` на:

```ts
  supplier_payment_gross:     { label: "Оплата (Поставщик)",         decimals: 2 },
  supplier_refund_total:      { label: "Возврат/Перезачет (Поставщик)", decimals: 2 },
```

и `buyer_payment: { label: "Оплата (Покупатель)", decimals: 2 },` на:

```ts
  buyer_payment_gross:        { label: "Оплата (Покупатель)",         decimals: 2 },
  buyer_refund_total:         { label: "Возврат/Перезачет (Покупатель)", decimals: 2 },
```

(Ключи здесь — значения `data-col`, выставленные в Step 1.)

- [ ] **Step 6: Добавить итоги**

В `PassportTotalsRow` заменить строку `{num("amber", sum((d) => d.supplier_payment))}` на:

```tsx
      {num("amber", sum((d) => d.supplier_payment_gross))}
      {num("amber", sum((d) => d.supplier_refund_total))}
```

и `{num("blue", sum((d) => d.buyer_payment))}` на:

```tsx
      {num("blue", sum((d) => d.buyer_payment_gross))}
      {num("blue", sum((d) => d.buyer_refund_total))}
```

В комментарии над полосой покупателя (`Покупатель (12 cols)`) поправить число на `13 cols`, над полосой поставщика (`Поставщик (10 cols)`) — на `11 cols`.

- [ ] **Step 7: Проверить типы и сборку**

```bash
npm run typecheck && npm run lint
```

Ожидание: PASS обоих.

- [ ] **Step 8: Проверить в браузере**

```bash
npm run dev
```

Открыть `/deals`, вкладка «Паспорт KG». Проверить на сделке с возвратом:
- колонки идут `Оплата │ Возврат/Перезачет │ Баланс` и `… │ Оплата │ Возврат/Перезачет │ Долг`;
- заголовки не разъезжаются с телом, закрепление колонок (шестерёнка → «Закрепить до») работает;
- клик по «Возврат/Перезачет» открывает попап только с возвратами и перезачётами, кнопки «+ Возврат» / «+ Перезачёт» создают строку, число в ячейке и баланс меняются мгновенно;
- клик по «Оплата» показывает только обычные оплаты, «Изменить итог» на месте;
- строка «Итого» суммирует обе новые колонки.

- [ ] **Step 9: Коммит**

```bash
git add src/components/deals/passport-table.tsx
git commit -m "feat(passport): колонки «Возврат/Перезачет» по обеим сторонам"
```

---

### Task 6: Карточка сделки

**Files:**
- Modify: `src/app/(dashboard)/deals/[id]/page.tsx:948` (блок поставщика), `:1022` (блок покупателя)

**Interfaces:**
- Consumes: поля `Deal` из Task 3 (`DEAL_SELECT` использует `*`, правок в выборке не нужно).
- Produces: ничего для последующих задач.

- [ ] **Step 1: Разделить поле у поставщика**

Строку 948 заменить на:

```tsx
          <Field label="Оплата" value={deal.supplier_payment_gross} suffix={`${supplierCurrencySymbol} (оплаты)`} />
          <Field label="Возврат/Перезачет" value={deal.supplier_refund_total} suffix={`${supplierCurrencySymbol} (минусует)`} />
```

- [ ] **Step 2: Разделить поле у покупателя**

Строку 1022 заменить на:

```tsx
          <Field label="Оплата" value={deal.buyer_payment_gross} suffix={`${buyerCurrencySymbol} (оплаты)`} />
          <Field label="Возврат/Перезачет" value={deal.buyer_refund_total} suffix={`${buyerCurrencySymbol} (минусует)`} />
```

- [ ] **Step 3: Проверить типы и вид**

```bash
npm run typecheck
```

Ожидание: PASS. Затем на `/deals/<id>` сделки с возвратом убедиться, что в блоках «Поставщик» и «Покупатель» появилось поле «Возврат/Перезачет», а «Баланс»/«Долг» не изменились по величине.

- [ ] **Step 4: Коммит**

```bash
git add "src/app/(dashboard)/deals/[id]/page.tsx"
git commit -m "feat(deal-card): поле «Возврат/Перезачет» рядом с оплатой"
```

---

### Task 7: Выгрузка «Паспорт» (Excel)

**Files:**
- Modify: `src/lib/exports/passport-excel.ts:124` и `:155` (колонки), `:352-359` (`TOTAL_KEYS`)
- Test: `src/__tests__/payment-split-columns.test.ts` (создать)

**Interfaces:**
- Consumes: поля `Deal` из Task 3.
- Produces: колонки с ключами `supplier_refund` и `buyer_refund` в экспортируемом `PASSPORT_COLUMNS`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/__tests__/payment-split-columns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PASSPORT_COLUMNS } from "@/lib/exports/passport-excel";

/**
 * Клиент 2026-08-05: «нужно вывести в таблицу два поле: Оплата,
 * Возврат/Перерасчет». В выгрузке паспорта «Оплата» — БРУТТО
 * (payment_type='payment'), возвраты и перезачёты идут отдельной
 * колонкой положительным числом (миграция 00137).
 */
type AnyCol = { key: string; header: string; read?: (d: never) => unknown };

const COLS = PASSPORT_COLUMNS as unknown as AnyCol[];

describe("Паспорт (Excel): оплата отдельно от возвратов", () => {
  it("колонка возвратов есть по обеим сторонам", () => {
    for (const key of ["supplier_refund", "buyer_refund"]) {
      const col = COLS.find((c) => c.key === key);
      expect(col, `нет колонки ${key}`).toBeDefined();
      expect(col!.header).toBe("Возврат/Перезачет");
    }
  });

  it("возврат стоит сразу после оплаты своей стороны", () => {
    for (const [pay, refund] of [
      ["supplier_payment", "supplier_refund"],
      ["buyer_payment", "buyer_refund"],
    ]) {
      const i = COLS.findIndex((c) => c.key === pay);
      const j = COLS.findIndex((c) => c.key === refund);
      expect(j).toBe(i + 1);
    }
  });

  it("«Оплата» читает брутто, а не нетто", () => {
    const sup = COLS.find((c) => c.key === "supplier_payment")!;
    const buy = COLS.find((c) => c.key === "buyer_payment")!;
    expect(String(sup.read)).toContain("supplier_payment_gross");
    expect(String(buy.read)).toContain("buyer_payment_gross");
  });

  it("«Возврат/Перезачет» читает свою rollup-колонку", () => {
    expect(String(COLS.find((c) => c.key === "supplier_refund")!.read)).toContain("supplier_refund_total");
    expect(String(COLS.find((c) => c.key === "buyer_refund")!.read)).toContain("buyer_refund_total");
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

```bash
npm test -- src/__tests__/payment-split-columns.test.ts
```

Ожидание: FAIL — `нет колонки supplier_refund`.

- [ ] **Step 3: Добавить колонки**

Строку 124 заменить на:

```ts
  { key: "supplier_payment", header: "Оплата", width: 13, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_payment_gross },
  { key: "supplier_refund", header: "Возврат/Перезачет", width: 16, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_refund_total },
```

Строку 155 заменить на:

```ts
  { key: "buyer_payment", header: "Оплата", width: 13, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_payment_gross },
  { key: "buyer_refund", header: "Возврат/Перезачет", width: 16, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_refund_total },
```

В `TOTAL_KEYS` (строки 352–359) добавить `"supplier_refund"` после `"supplier_payment"` и `"buyer_refund"` после `"buyer_payment"`.

- [ ] **Step 4: Запустить тесты**

```bash
npm test -- src/__tests__/payment-split-columns.test.ts src/__tests__/contract-vs-appendix-columns.test.ts
```

Ожидание: PASS обоих файлов (второй — регрессия на состав колонок паспорта).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/exports/passport-excel.ts src/__tests__/payment-split-columns.test.ts
git commit -m "feat(export): колонка «Возврат/Перезачет» в паспорте"
```

---

### Task 8: Выгрузка «Паспорт (детальный)» (Excel)

Здесь меняется не только строка сделки, но и под-строки: возврат перестаёт идти минусом в «Оплата» и уходит плюсом в свою колонку.

**Files:**
- Modify: `src/lib/exports/passport-detail-excel.ts:69-77` (`PaymentLite`), `:196-197` и `:229-230` (колонки), `:336-341` (загрузка оплат), `:568-579` (fx-режим), `:744-751` (`TOTAL_KEYS`)
- Test: `src/__tests__/payment-split-columns.test.ts` (дополнить)

**Interfaces:**
- Consumes: `isRefundKind` из `@/lib/payments/totals` (Task 1); `FxDealRow.supplierPaymentGross` / `supplierRefund` / `buyerPaymentGross` / `buyerRefund` из Task 9 — **fx-часть (Step 4) выполняется после Task 9**, остальные шаги от неё не зависят.
- Produces: колонки `supplier_refund` / `buyer_refund` в `DETAIL_COLUMNS`; `PaymentLite` с полем `payment_type`.

- [ ] **Step 1: Дополнить тест колонок**

В `src/__tests__/payment-split-columns.test.ts` добавить импорт и второй блок:

```ts
import { DETAIL_COLUMNS } from "@/lib/exports/passport-detail-excel";

const DETAIL = DETAIL_COLUMNS as unknown as Array<{
  key: string; header: string; read?: (d: never) => unknown; readShip?: (d: never, s: never) => unknown;
}>;

describe("Паспорт детальный (Excel): оплата отдельно от возвратов", () => {
  it("колонка возвратов есть по обеим сторонам и стоит после оплаты", () => {
    for (const [pay, refund] of [
      ["supplier_payment", "supplier_refund"],
      ["buyer_payment", "buyer_refund"],
    ]) {
      const i = DETAIL.findIndex((c) => c.key === pay);
      const j = DETAIL.findIndex((c) => c.key === refund);
      expect(j, `нет колонки ${refund}`).toBeGreaterThan(-1);
      expect(j).toBe(i + 1);
      expect(DETAIL[j].header).toBe("Возврат/Перезачет");
    }
  });

  it("под-строки маршрутизируются по типу платежа, а не по знаку", () => {
    for (const key of ["supplier_payment", "supplier_refund", "buyer_payment", "buyer_refund"]) {
      expect(String(DETAIL.find((c) => c.key === key)!.readShip)).toContain("isRefundKind");
    }
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

```bash
npm test -- src/__tests__/payment-split-columns.test.ts
```

Ожидание: FAIL во втором блоке — `нет колонки supplier_refund`.

- [ ] **Step 3: Перевести под-строки на тип платежа**

Добавить импорт в шапку `src/lib/exports/passport-detail-excel.ts`:

```ts
import { isRefundKind } from "@/lib/payments/totals";
```

Заменить комментарий и тип `PaymentLite` (строки 69–77) на:

```ts
// Одна оплата (deal_payments) для под-строки. amount — сумма КАК В БД,
// то есть всегда плюсом; куда она попадёт, решает payment_type:
// 'payment' → колонка «Оплата», 'refund'/'offset' → «Возврат/
// Перезачет» (00137). До этого возврат шёл минусом в «Оплата».
// currency — валюта САМОГО платежа (deal_payments.currency, 00034),
// может отличаться от валюты сделки; в fx-режиме конвертируем по ней
// с фолбэком на валюту сделки/стороны.
type PaymentLite = {
  amount: number | null;
  payment_date: string | null;
  currency?: string | null;
  payment_type: string | null;
};
```

В `fetchPaymentsByDeals` заменить тело цикла (строки 336–341) на:

```ts
    for (const row of res.data) {
      const entry = out.get(row.deal_id) ?? { supplier: [], buyer: [] };
      // Знак больше не применяем: маршрутизацию по колонкам делает
      // payment_type на рендере под-строки.
      entry[row.side].push({
        amount: row.amount,
        payment_date: row.payment_date,
        currency: row.currency,
        payment_type: row.payment_type,
      });
      out.set(row.deal_id, entry);
    }
```

- [ ] **Step 4: Добавить колонки**

Строки 196–197 заменить на:

```ts
  { key: "supplier_payment", header: "Оплата", width: 13, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_payment_gross, readShip: (_, s) => (s.supPay && !isRefundKind(s.supPay.payment_type) ? s.supPay.amount : null) },
  { key: "supplier_refund", header: "Возврат/Перезачет", width: 16, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_refund_total, readShip: (_, s) => (s.supPay && isRefundKind(s.supPay.payment_type) ? s.supPay.amount : null) },
  { key: "supplier_payment_date", header: "Дата оплаты", width: 12, band: "supplier", numFmt: NUM_FMT_DATE, read: () => "", readShip: (_, s) => (s.supPay?.payment_date ? excelDate(s.supPay.payment_date) : "") },
```

Строки 229–230 заменить на:

```ts
  { key: "buyer_payment", header: "Оплата", width: 13, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_payment_gross, readShip: (_, s) => (s.buyPay && !isRefundKind(s.buyPay.payment_type) ? s.buyPay.amount : null) },
  { key: "buyer_refund", header: "Возврат/Перезачет", width: 16, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_refund_total, readShip: (_, s) => (s.buyPay && isRefundKind(s.buyPay.payment_type) ? s.buyPay.amount : null) },
  { key: "buyer_payment_date", header: "Дата оплаты", width: 12, band: "buyer", numFmt: NUM_FMT_DATE, read: () => "", readShip: (_, s) => (s.buyPay?.payment_date ? excelDate(s.buyPay.payment_date) : "") },
```

В `TOTAL_KEYS` (строки 744–751) добавить `"supplier_refund"` после `"supplier_payment"` и `"buyer_refund"` после `"buyer_payment"`.

- [ ] **Step 5: Обновить fx-режим (выполнять ПОСЛЕ Task 9)**

В блоке `if (opts?.fx)` заменить строки 573 и 577 так, чтобы обе новые колонки тоже конвертировались:

```ts
        supplier_payment: agg.supplierPayment,
        supplier_payment_gross: agg.supplierPaymentGross,
        supplier_refund_total: agg.supplierRefund,
```

```ts
        buyer_payment: agg.buyerPayment,
        buyer_payment_gross: agg.buyerPaymentGross,
        buyer_refund_total: agg.buyerRefund,
```

- [ ] **Step 6: Запустить тесты**

```bash
npm test -- src/__tests__/payment-split-columns.test.ts src/__tests__/export-date-cells.test.ts src/__tests__/contract-vs-appendix-columns.test.ts
```

Ожидание: PASS всех трёх (второй — регрессия на позиции колонок дат, которые сдвинулись).

- [ ] **Step 7: Коммит**

```bash
git add src/lib/exports/passport-detail-excel.ts src/__tests__/payment-split-columns.test.ts
git commit -m "feat(export): «Возврат/Перезачет» в детальном паспорте, под-строки по типу платежа"
```

---

### Task 9: Отчёт «Сборность»

Отчёт целиком клиентский: суммы пересобираются из строк `deal_payments` с курсом на дату каждого события.

**Files:**
- Modify: `src/lib/data/deal-events.ts:58`, `:90-99`
- Modify: `src/lib/fx/convert-deal.ts:33-39` (`PaymentRow`), `:56-85` (`FxDealRow`), `:148-155` и `:173-198` (расчёт), `:200-228` (возврат)
- Modify: `src/components/reports/collection-table.tsx:59-60`, `:72-73`
- Test: `src/__tests__/fx-convert-deal.test.ts`

**Interfaces:**
- Consumes: `isRefundKind` из Task 1.
- Produces: `FxDealRow` с полями `supplierPaymentGross`, `supplierRefund`, `buyerPaymentGross`, `buyerRefund` (в дополнение к существующим `supplierPayment` / `buyerPayment`, которые остаются НЕТТО); `PaymentRow` с полем `payment_type` и НЕподписанным `amount`.

- [ ] **Step 1: Написать падающий тест**

В `src/__tests__/fx-convert-deal.test.ts` добавить блок. Фикстуры файла: `makeDeal(over?)` — фабрика сделки, `fx` — модульная константа курсов.

```ts
describe("convertDeal — брутто и возвраты раздельно", () => {
  it("оплата 600 и возврат 100: брутто 600, возврат 100, нетто 500", () => {
    const deal = makeDeal();
    const events: DealEvents = {
      prices: [{ deal_id: "d1", side: "supplier", amount: 1000, shipment_date: "2026-01-10" }],
      payments: [
        { deal_id: "d1", side: "supplier", amount: 600, payment_date: "2026-01-10", currency: null, payment_type: "payment" },
        { deal_id: "d1", side: "supplier", amount: 100, payment_date: "2026-01-10", currency: null, payment_type: "refund" },
      ],
      logistics: [],
    };
    const row = convertDeal(deal, events, fx, "USD");
    expect(row.supplierPaymentGross).toBe(600);
    expect(row.supplierRefund).toBe(100);
    expect(row.supplierPayment).toBe(500);
    // Баланс читает нетто — паритет с паспортом.
    expect(row.supplierBalance).toBe(1000 - 500);
  });

  it("перезачёт считается вместе с возвратом", () => {
    const deal = makeDeal();
    const events: DealEvents = {
      prices: [],
      payments: [
        { deal_id: "d1", side: "buyer", amount: 30, payment_date: "2026-01-10", currency: null, payment_type: "refund" },
        { deal_id: "d1", side: "buyer", amount: 20, payment_date: "2026-01-10", currency: null, payment_type: "offset" },
      ],
      logistics: [],
    };
    const row = convertDeal(deal, events, fx, "USD");
    expect(row.buyerRefund).toBe(50);
    expect(row.buyerPaymentGross).toBe(0);
    expect(row.buyerPayment).toBe(-50);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

```bash
npm test -- src/__tests__/fx-convert-deal.test.ts
```

Ожидание: FAIL — `payment_type` не существует в типе `PaymentRow`, `supplierPaymentGross` не существует в `FxDealRow`.

- [ ] **Step 3: Перестать схлопывать знак при загрузке**

В `src/lib/data/deal-events.ts` удалить строку 58 (`type RawPayment = PaymentRow & { payment_type: string | null };`), заменить дженерик `fetchByDealIds<RawPayment>` на `fetchByDealIds<PaymentRow>` и заменить цикл (строки 90–99) на:

```ts
  // Знак НЕ применяем: отчёт показывает оплату и возвраты разными
  // колонками, а нетто собирает convertDeal (00137).
  for (const p of payments) bucket(p.deal_id).payments.push(p);
```

- [ ] **Step 4: Разделить суммы в `convert-deal.ts`**

Добавить импорт:

```ts
import { isRefundKind } from "@/lib/payments/totals";
```

Заменить `PaymentRow` (строки 33–39) на:

```ts
export type PaymentRow = {
  deal_id: string;
  side: "supplier" | "buyer";
  amount: number | null;      // как в БД — всегда плюсом
  payment_date: string | null;
  currency: string | null;
  payment_type: string | null; // знак и колонку задаёт тип (00062, 00137)
};
```

В `FxDealRow` после `supplierPayment: number | null;` добавить:

```ts
  /** Только payment_type='payment'. Колонка «Оплата». */
  supplierPaymentGross: number | null;
  /** refund + offset, положительное. Колонка «Возврат/Перезачет». */
  supplierRefund: number | null;
```

и после `buyerPayment: number | null;`:

```ts
  buyerPaymentGross: number | null;
  buyerRefund: number | null;
```

Заменить расчёт оплат (строки 148–155) на:

```ts
  // Оплата и возвраты — разные колонки отчёта; нетто (= брутто −
  // возвраты) собирается ниже и кормит Баланс/Долг, как в паспорте.
  const supplierPaymentGross = sumConverted(
    supplierPays.filter((p) => !isRefundKind(p.payment_type)), (p) => p.amount, (p) => p.payment_date,
    (p) => p.currency ?? deal.supplier_currency, fx, target, fallback,
  );
  const supplierRefund = sumConverted(
    supplierPays.filter((p) => isRefundKind(p.payment_type)), (p) => p.amount, (p) => p.payment_date,
    (p) => p.currency ?? deal.supplier_currency, fx, target, fallback,
  );
  const supplierPayment = supplierPaymentGross == null || supplierRefund == null
    ? null
    : supplierPaymentGross - supplierRefund;
  const buyerPaymentGross = sumConverted(
    buyerPays.filter((p) => !isRefundKind(p.payment_type)), (p) => p.amount, (p) => p.payment_date,
    (p) => p.currency ?? deal.buyer_currency, fx, target, fallback,
  );
  const buyerRefund = sumConverted(
    buyerPays.filter((p) => isRefundKind(p.payment_type)), (p) => p.amount, (p) => p.payment_date,
    (p) => p.currency ?? deal.buyer_currency, fx, target, fallback,
  );
  const buyerPayment = buyerPaymentGross == null || buyerRefund == null
    ? null
    : buyerPaymentGross - buyerRefund;
```

В строке 197 расширить список проверки полноты:

```ts
  const money = [supplierAmount, buyerAmount, supplierPayment, buyerPayment, supplierRefund, buyerRefund, railAmount, shipperAmount];
```

В возвращаемом объекте после `supplierPayment,` добавить `supplierPaymentGross,` и `supplierRefund,`; после `buyerPayment,` — `buyerPaymentGross,` и `buyerRefund,`.

Две существующие фикстуры оплат в `fx-convert-deal.test.ts` (строки 53–54) не имеют `payment_type` и после изменения типа перестанут компилироваться — дописать в обе `payment_type: "payment"`. Суммы там положительные, переписывать знаки не нужно.

- [ ] **Step 5: Добавить колонки в отчёт**

В `src/components/reports/collection-table.tsx` заменить строки 59–60 на:

```tsx
  { key: "sup_payment", header: "Оплата", band: "supplier", align: "right",
    cell: (r) => money(r.supplierPaymentGross), total: (rows) => money(sum(rows, (r) => r.supplierPaymentGross)) },
  { key: "sup_refund", header: "Возврат/Перезачет", band: "supplier", align: "right",
    cell: (r) => money(r.supplierRefund), total: (rows) => money(sum(rows, (r) => r.supplierRefund)) },
```

и строки 72–73 на:

```tsx
  { key: "buy_payment", header: "Оплата", band: "buyer", align: "right",
    cell: (r) => money(r.buyerPaymentGross), total: (rows) => money(sum(rows, (r) => r.buyerPaymentGross)) },
  { key: "buy_refund", header: "Возврат/Перезачет", band: "buyer", align: "right",
    cell: (r) => money(r.buyerRefund), total: (rows) => money(sum(rows, (r) => r.buyerRefund)) },
```

- [ ] **Step 6: Запустить тесты**

```bash
npm test -- src/__tests__/fx-convert-deal.test.ts && npm run typecheck
```

Ожидание: PASS обоих. Если `typecheck` укажет на `passport-detail-excel.ts` — вернуться к Task 8 Step 5 и выполнить его сейчас.

- [ ] **Step 7: Коммит**

```bash
git add src/lib/data/deal-events.ts src/lib/fx/convert-deal.ts src/components/reports/collection-table.tsx src/__tests__/fx-convert-deal.test.ts
git commit -m "feat(reports): «Сборность» показывает оплату и возвраты раздельно"
```

---

### Task 10: Документация и полная проверка

**Files:**
- Modify: `CHANGELOG-SINCE-EXTRACTION.md`

**Interfaces:**
- Consumes: результаты Tasks 1–9.
- Produces: ничего.

- [ ] **Step 1: Записать изменение в журнал**

Добавить запись в `CHANGELOG-SINCE-EXTRACTION.md` в том формате, что уже используется в файле (посмотреть верхнюю запись и повторить структуру), с содержанием:

- миграция `00137_payment_gross_refund_split.sql`: четыре новые rollup-колонки `deals.*_payment_gross` / `deals.*_refund_total`, обновлённая `refresh_deal_payment_totals`, бэкфилл;
- `deals.supplier_payment` / `buyer_payment` остаются НЕТТО и продолжают кормить формулы баланса — численно баланс не изменился;
- в паспорте, карточке, обеих Excel-выгрузках и отчёте «Сборность» «Оплата» теперь брутто, возвраты и перезачёты вынесены в колонку «Возврат/Перезачет» положительным числом;
- в детальной выгрузке под-строка возврата больше не идёт минусом в «Оплата»;
- из паспорта теперь можно создать возврат и перезачёт («+ Возврат» / «+ Перезачёт»), раньше кнопка создавала только обычную оплату.

- [ ] **Step 2: Проверить объём диффа**

```bash
git diff main --stat
```

Ожидание: только файлы из Tasks 1–10, никаких посторонних правок.

- [ ] **Step 3: Прогнать полную проверку**

```bash
npm run verify
```

Ожидание: PASS всех четырёх шагов (`lint`, `test`, `typecheck`, `build`).

- [ ] **Step 4: Прогнать DB-тесты**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres" ./supabase/tests/run.sh
```

Ожидание: `All DB tests passed.`

- [ ] **Step 5: Коммит**

```bash
git add CHANGELOG-SINCE-EXTRACTION.md
git commit -m "docs: журнал изменений — разделение оплат и возвратов (00137)"
```

---

## Порядок и зависимости

```
Task 1 (модуль totals)
   ├─→ Task 4 (ячейка) ─→ Task 5 (колонки паспорта)
   ├─→ Task 8 (детальная выгрузка, шаги 1–4, 6–7)
   └─→ Task 9 (отчёт) ─→ Task 8 Step 5 (fx-режим)
Task 2 (миграция) ─→ Task 3 (типы) ─→ Tasks 4–9
Task 7 (паспорт Excel) — зависит только от Task 3
Task 10 — последняя
```

Единственная перекрёстная зависимость: **Task 8 Step 5** (fx-режим детальной выгрузки) выполняется после Task 9, потому что использует новые поля `FxDealRow`.

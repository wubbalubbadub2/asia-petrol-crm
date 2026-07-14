# FX conversion inventory

**Цель.** Каждая сумма в БД записана в **native-валюте** (USD или KZT).
Чтобы выгружать отчёты в «USD-эквиваленте» и «KZT-эквиваленте» на любую дату,
нужно знать для каждой money-колонки:

1. **Native-валюту** (из какой currency-колонки взять).
2. **Date-контекст** — дату, на которую брать курс НБ РК USD/KZT.
3. **Классификацию** — SOURCE (native, конвертируем напрямую), DERIVED
   (аггрегат — не конвертируем, а пересчитываем из уже конвертированных
   источников) или RATE (цена за единицу — тот же курс, что у объёма).

Всего в БД **83 money-колонок** (тип DECIMAL/NUMERIC).
Из них SOURCE — **48**, DERIVED — **19**, RATE — **12**, FX-METADATA — **4**.

---

## 1. Currency-source: откуда брать native-валюту

| Table                        | Currency column              | По умолчанию | Применяется к                                          |
|------------------------------|------------------------------|--------------|--------------------------------------------------------|
| `deals.supplier_currency`    | TEXT NOT NULL, default `USD` | USD          | все `supplier_*` money-поля на `deals`; `deal_supplier_lines.*` |
| `deals.buyer_currency`       | TEXT NOT NULL, default `USD` | USD          | все `buyer_*` money-поля на `deals`; `deal_buyer_lines.*` |
| `deals.logistics_currency`   | TEXT NOT NULL, default `USD` | USD          | `deals.invoice_amount`, `preliminary_amount`, `actual_tariff`, `planned_tariff`, `additional_expenses_amount`, `surcharge_amount` |
| `shipment_registry.currency` | TEXT (nullable → fallback на `deals.logistics_currency`) | inherit | все money-поля `shipment_registry` |
| `deal_payments.currency`     | TEXT (nullable → fallback на `deals.supplier_currency` или `buyer_currency` по `direction`) | inherit | `deal_payments.amount` |
| `dt_kt_payments.currency`    | TEXT                         | KZT          | `dt_kt_payments.amount`                                |
| `deal_company_groups.currency` | TEXT (nullable → parent `deals` currency) | inherit | `deal_company_groups.price`, `quotation`, `discount` |
| `surcharges` — нет колонки   | наследует `deals.logistics_currency` | KZT (де-факто) | все money-поля `surcharges` |
| `esf_documents`, `snt_documents` — нет колонки | всегда KZT (гос. документы РК) | KZT | `total_with_tax`, `total_without_tax`, `tax_amount`, `price_per_unit`, `total_amount` |
| `dt_kt_logistics`, `tariffs` — нет колонки | всегда KZT (жд-тарифы) | KZT | все money-поля |
| `applications`, `application_deals` — нет колонки | наследует `deals` | — | `application_deals.allocated_volume` (volume, не money) |
| `quotations`, `quotation_monthly_averages`, `quotation_values` — нет колонки | всегда USD (котировки Platts / MOPS) | USD | все price/avg-колонки |

---

## 2. Уже существующие FX-поля

Частично FX-конвертация уже смоделирована в **линиях**:

| Table                    | Column               | Тип           | Смысл                                                     |
|--------------------------|----------------------|---------------|-----------------------------------------------------------|
| `deal_supplier_lines`    | `fx_rate`            | NUMERIC(14,6) | Курс USD/KZT (или другой пары), зафиксированный на строке |
| `deal_supplier_lines`    | `preliminary_fx_rate`| NUMERIC(14,6) | Тот же, но снэпшот на момент preliminary-стадии           |
| `deal_buyer_lines`       | `fx_rate`            | NUMERIC(14,6) | Аналогично, для покупателя                                |
| `deal_buyer_lines`       | `preliminary_fx_rate`| NUMERIC(14,6) | Аналогично                                                |

**Вывод:** для линий FX уже частично реализован (миграция `00071_price_manual_formula.sql`) — но только как ручной ввод, без справочника курсов. Остальные 79 money-колонок FX не имеют.

---

## 3. Date-контексты — из каких date/text-колонок брать дату для курса

Для каждой таблицы это своя «дата экономической даты события»:

| Table                | Date-column                              | Тип        | Смысл (для FX)                                       |
|----------------------|------------------------------------------|------------|------------------------------------------------------|
| `deals`              | `avg_month_date`                         | DATE       | Якорь для avg_month цены (00085)                     |
| `deals`              | `year INT` + `month TEXT`                | INT+TEXT   | Месяц сделки — fallback если нет `avg_month_date`    |
| `deals`              | `logistics_shipment_month`               | TEXT (YYYY-MM) | Месяц отгрузки в контексте логистики           |
| `deals`              | `created_at`                             | TIMESTAMPTZ| Дата создания сделки — fallback для contracted amounts |
| `deals`              | `supplier_payment_date`, `buyer_payment_date`, `buyer_ship_date` | TEXT | Планируемые даты (текст! не парсятся автоматом)     |
| `deal_supplier_lines`| `selected_date`                          | DATE       | Дата котировки (при calc_mode=on_date)               |
| `deal_supplier_lines`| `preliminary_set_at`                     | TIMESTAMPTZ| Момент фиксации preliminary                          |
| `deal_buyer_lines`   | `selected_date`                          | DATE       | То же                                                |
| `deal_buyer_lines`   | `preliminary_set_at`                     | TIMESTAMPTZ| То же                                                |
| `shipment_registry`  | `date`                                   | DATE       | Дата отгрузки                                        |
| `shipment_registry`  | `shipment_month` (TEXT) → fallback `deals.month` | TEXT | Месяц отгрузки — для avg-month формулы            |
| `deal_payments`      | `payment_date`                           | DATE       | Дата платежа                                         |
| `dt_kt_payments`     | `payment_date`                           | DATE       | То же                                                |
| `esf_documents`      | `issue_date`, `turnover_date`            | DATE       | Дата ЭСФ                                             |
| `snt_documents`      | `shipment_date`, `registration_datetime` | DATE/TSTZ  | Дата СНТ                                             |
| `surcharges`         | `issue_date`, `payment_date`, `reinvoice_date`, `reinvoice_payment_date`, `reinvoice_response_date` | DATE | Разные даты для разных сумм |
| `quotations`         | `date`                                   | DATE       | Дата котировки Platts                                |
| `quotation_values`   | `date`                                   | DATE       | То же                                                |
| `quotation_monthly_averages` | (нет DATE — ключ = `year INT + month INT`) | — | Месячное среднее                       |
| `applications`       | `date`                                   | DATE       | Дата заявки                                          |
| `deal_shipment_prices` | `shipment_date`, `border_crossing_date`, `trigger_start_date` | DATE | Даты в контексте отгрузки |

---

## 4. Полная инвентаризация money-колонок

**Легенда:**
- **SRC** = source (native amount, требует FX-конвертации).
- **DER** = derived (аггрегат других колонок — не конвертируется, пересчитывается из источников).
- **RATE** = money-per-unit (тариф, цена) — конвертируется тем же курсом, что и volume, на ту же дату.
- **META** = FX-метаданные (сам курс) — не конвертируется.

### `deals` (27 колонок)

| Column                        | Cls  | Currency-source        | Date-context                                     | Notes |
|-------------------------------|------|------------------------|--------------------------------------------------|-------|
| `supplier_contracted_amount`  | SRC  | `supplier_currency`    | `avg_month_date` → fallback `created_at`         | Плановая сумма контракта |
| `supplier_contracted_volume`  | —    | (volume, tonnes)       | —                                                | Не money |
| `supplier_price`              | RATE | `supplier_currency`    | `avg_month_date` (avg_month) или из line          | Цена контракта |
| `supplier_quotation`          | RATE | USD                    | `avg_month_date`                                 | Котировка Platts (всегда USD) |
| `supplier_discount`           | RATE | `supplier_currency`    | `avg_month_date`                                 | Скидка |
| `supplier_shipped_amount`     | DER  | `supplier_currency`    | ← SUM по `shipment_registry.date`                | Аггрегат отгрузок |
| `supplier_payment`            | DER  | `supplier_currency`    | ← SUM по `deal_payments.payment_date`            | Аггрегат платежей |
| `supplier_balance`            | DER  | `supplier_currency`    | ← computed                                       | shipped − payment ± flags |
| `buyer_contracted_amount`     | SRC  | `buyer_currency`       | `avg_month_date` → fallback `created_at`         | То же для buyer |
| `buyer_contracted_volume`     | —    | (volume)               | —                                                |       |
| `buyer_price`                 | RATE | `buyer_currency`       | `avg_month_date`                                 |       |
| `buyer_quotation`             | RATE | USD                    | `avg_month_date`                                 |       |
| `buyer_discount`              | RATE | `buyer_currency`       | `avg_month_date`                                 |       |
| `buyer_ordered_volume`        | —    | (volume)               | —                                                |       |
| `buyer_shipped_volume`        | —    | (volume)               | —                                                |       |
| `buyer_shipped_amount`        | DER  | `buyer_currency`       | ← SUM по `shipment_registry.date`                |       |
| `buyer_payment`               | DER  | `buyer_currency`       | ← SUM по `deal_payments.payment_date`            |       |
| `buyer_debt`                  | DER  | `buyer_currency`       | ← computed                                       | shipped − payment |
| `buyer_remaining`             | DER  | `buyer_currency`       | ← computed                                       | contracted − shipped |
| `preliminary_tonnage`         | —    | (volume)               | —                                                |       |
| `preliminary_amount`          | SRC  | `logistics_currency`   | `avg_month_date` → fallback `created_at`         | Плановая сумма логистики |
| `actual_shipped_volume`       | —    | (volume)               | —                                                |       |
| `invoice_amount`              | DER  | `logistics_currency`   | ← SUM по `shipment_registry.date`                | Аггрегат из реестра |
| `invoice_volume`              | —    | (volume)               | —                                                |       |
| `planned_tariff`              | RATE | `logistics_currency`   | `created_at` или `logistics_shipment_month`      | Плановый тариф |
| `actual_tariff`               | RATE | `logistics_currency`   | ← из shipment_registry                           | Средневзвешенный |
| `additional_expenses_amount`  | DER  | `logistics_currency`   | ← SUM по `shipment_registry.date`                | Rollup грузоотправителя |
| `surcharge_amount`            | SRC  | `logistics_currency`   | `created_at` или связанной `surcharges.issue_date` | Ручной ввод |

### `deal_supplier_lines` (7 колонок)

| Column                | Cls  | Currency-source          | Date-context                                    | Notes |
|-----------------------|------|--------------------------|-------------------------------------------------|-------|
| `price`               | RATE | `deals.supplier_currency`| `selected_date` (on_date) или avg-month          | Финальная цена |
| `preliminary_price`   | RATE | `deals.supplier_currency`| `preliminary_set_at`                             | Snapshot |
| `quotation`           | RATE | USD                      | `selected_date` или avg-month                    | Котировка Platts |
| `preliminary_quotation`| RATE| USD                      | `preliminary_set_at`                             | Snapshot |
| `discount`            | RATE | `deals.supplier_currency`| `selected_date` или avg-month                    |       |
| `fx_rate`             | META | (USD/KZT)                | `selected_date`                                  | ⭐ Уже FX-поле |
| `preliminary_fx_rate` | META | (USD/KZT)                | `preliminary_set_at`                             | ⭐ Уже FX-поле |

### `deal_buyer_lines` (7 колонок) — симметрично supplier_lines

Тот же набор с `buyer_currency`.

### `deal_company_groups` (3 колонки)

| Column     | Cls  | Currency-source | Date-context                | Notes |
|------------|------|-----------------|-----------------------------|-------|
| `price`    | RATE | `currency` (или parent deal) | `deals.avg_month_date` | Цена для группы компании |
| `quotation`| RATE | USD             | `deals.avg_month_date`      |       |
| `discount` | RATE | `currency`      | `deals.avg_month_date`      |       |

### `shipment_registry` (4 колонки)

| Column                          | Cls | Currency-source              | Date-context                          | Notes |
|---------------------------------|-----|------------------------------|---------------------------------------|-------|
| `shipment_volume`               | —   | (volume)                     | —                                     |       |
| `rounded_tonnage_from_forwarder`| —   | (volume)                     | —                                     |       |
| `shipped_tonnage_amount`        | SRC | `currency` → `deals.logistics_currency` | `date` (дата отгрузки) | Сумма отгрузки |
| `railway_tariff`                | RATE| KZT (тариф всегда KZT)       | `date`                                | Тариф жд |
| `manager_tariff`                | RATE| KZT                          | `date`                                | Manager tariff (00113) |
| `additional_expenses`           | SRC | `currency` → `logistics_currency`| `date`                            | Сумма грузоотправителя |

### `deal_payments` (1 колонка)

| Column   | Cls | Currency-source | Date-context   | Notes |
|----------|-----|-----------------|----------------|-------|
| `amount` | SRC | `currency`      | `payment_date` | Платёж |

### `dt_kt_payments` (1 колонка)

| Column   | Cls | Currency-source | Date-context   | Notes |
|----------|-----|-----------------|----------------|-------|
| `amount` | SRC | `currency` (KZT)| `payment_date` | Платёж по DT/KT |

### `dt_kt_logistics` (6 колонок) — все SRC в KZT

| Column                 | Cls | Currency | Date-context               | Notes |
|------------------------|-----|----------|----------------------------|-------|
| `opening_balance`      | SRC | KZT      | (аккаунт-начало периода)   | Не FX-переводим — уже KZT |
| `ogem`                 | SRC | KZT      | `created_at` или month     |       |
| `surcharge_preliminary`| SRC | KZT      | `created_at`               |       |
| `fines`                | SRC | KZT      | `created_at`               |       |
| `payment`              | SRC | KZT      | `created_at`               |       |
| `refund`               | SRC | KZT      | `created_at`               |       |

Для отчёта «в USD» нужен обратный курс KZT→USD на соответствующую дату.

### `tariffs` (1 колонка)

| Column          | Cls | Currency | Date-context      | Notes |
|-----------------|-----|----------|-------------------|-------|
| `planned_tariff`| RATE| KZT      | `month INT+year INT` | Плановый тариф справочника |

### `surcharges` (11 колонок, все SRC в logistics_currency ≈ KZT)

| Column                       | Cls | Date-context             | Notes |
|------------------------------|-----|--------------------------|-------|
| `shipped_volume`             | —   | (volume)                 |       |
| `amount`                     | SRC | `issue_date`             | Начисленная сумма |
| `accepted_amount`            | SRC | `issue_date`             |       |
| `claimed_amount`             | SRC | `issue_date`             |       |
| `paid_amount`                | SRC | `payment_date`           | По оплате |
| `remaining_debt`             | DER | ← computed               | amount − paid |
| `accounted_amount_quarter`   | SRC | `issue_date` (квартал)   |       |
| `reinvoice_amount`           | SRC | `reinvoice_date`         | Перевыставленная |
| `reinvoice_accepted_amount`  | SRC | `reinvoice_response_date`|       |
| `reinvoice_paid_amount`      | SRC | `reinvoice_payment_date` |       |
| `reinvoice_remaining_debt`   | DER | ← computed               |       |

### `esf_documents` (5 колонок, всегда KZT)

| Column             | Cls  | Date-context | Notes |
|--------------------|------|--------------|-------|
| `quantity`         | —    | (volume)     |       |
| `price_per_unit`   | RATE | `issue_date` |       |
| `total_without_tax`| SRC  | `issue_date` |       |
| `tax_amount`       | SRC  | `issue_date` |       |
| `total_with_tax`   | SRC  | `issue_date` |       |

### `snt_documents` (3 колонки, всегда KZT)

| Column           | Cls  | Date-context    | Notes |
|------------------|------|-----------------|-------|
| `quantity`       | —    | (volume)        |       |
| `price_per_unit` | RATE | `shipment_date` |       |
| `total_amount`   | SRC  | `shipment_date` |       |

### `deal_shipment_prices` (5 колонок)

| Column           | Cls  | Currency-source        | Date-context                | Notes |
|------------------|------|------------------------|-----------------------------|-------|
| `volume`         | —    | (volume)               | —                           |       |
| `quotation_avg`  | RATE | USD                    | `shipment_date` / `trigger_start_date` |       |
| `discount`       | RATE | `deals.buyer_currency` | `shipment_date`             |       |
| `calculated_price`| RATE| `deals.buyer_currency` | `shipment_date`             | Формульная цена |
| `amount`         | SRC  | `deals.buyer_currency` | `shipment_date`             | Итог |

### `quotations`, `quotation_values`, `quotation_monthly_averages`

Все USD, конвертация нужна только для отчётов «в KZT».

| Table                      | Column           | Cls  | Date-context                | Notes |
|----------------------------|------------------|------|-----------------------------|-------|
| `quotations`               | `price`          | RATE | `date`                      |       |
| `quotations`               | `price_cif_nwe`  | RATE | `date`                      |       |
| `quotations`               | `price_fob_med`  | RATE | `date`                      |       |
| `quotations`               | `price_fob_rotterdam` | RATE | `date`                 |       |
| `quotation_values`         | `value`          | RATE | `date`                      |       |
| `quotation_monthly_averages`| `avg_price`     | RATE | `year+month` (месяц)        |       |
| `quotation_monthly_averages`| `avg_cif_nwe`   | RATE | `year+month`                |       |
| `quotation_monthly_averages`| `avg_fob_med`   | RATE | `year+month`                |       |
| `quotation_monthly_averages`| `avg_fob_rotterdam`| RATE | `year+month`             |       |
| `quotation_monthly_averages`| `avg_combined`  | RATE | `year+month`                |       |

### `applications` (1 колонка)

| Column    | Cls | Date-context | Notes |
|-----------|-----|--------------|-------|
| `tonnage` | —   | (volume)     | Не money |

### `application_deals` (1 колонка)

| Column            | Cls | Date-context | Notes |
|-------------------|-----|--------------|-------|
| `allocated_volume`| —   | (volume)     | Не money |

---

## 5. Что понадобится для реализации USD/KZT конвертации

### 5.1. Новая таблица `fx_rates`

```sql
CREATE TABLE fx_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  base_currency TEXT NOT NULL,   -- 'USD'
  quote_currency TEXT NOT NULL,  -- 'KZT'
  rate NUMERIC(14,6) NOT NULL,   -- 1 USD = <rate> KZT
  source TEXT NOT NULL,          -- 'nbrk' (НБ РК) | 'manual'
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, base_currency, quote_currency)
);
```

- Источник: [nationalbank.kz](https://www.nationalbank.kz/rates/) — публичный XML.
- Ежедневный cron (Supabase Edge Function или GitHub Action).
- Для дат, где нет курса (выходные), используется последний доступный (`LOOKUP LAST rate WHERE date <= X`).

### 5.2. RPC для конвертации

```sql
CREATE FUNCTION fx_convert(
  p_amount NUMERIC,
  p_from TEXT,
  p_to TEXT,
  p_date DATE
) RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE v_rate NUMERIC(14,6);
BEGIN
  IF p_from = p_to OR p_amount IS NULL THEN RETURN p_amount; END IF;
  SELECT rate INTO v_rate
    FROM fx_rates
   WHERE base_currency = 'USD' AND quote_currency = 'KZT'
     AND date <= p_date
   ORDER BY date DESC LIMIT 1;
  IF v_rate IS NULL THEN RETURN NULL; END IF;
  IF p_from = 'USD' AND p_to = 'KZT' THEN RETURN p_amount * v_rate; END IF;
  IF p_from = 'KZT' AND p_to = 'USD' THEN RETURN p_amount / v_rate; END IF;
  RAISE EXCEPTION 'Unsupported FX pair: % → %', p_from, p_to;
END $$;
```

### 5.3. Порядок вывода в отчётах

Никаких новых колонок в БД **не нужно** — все SRC-суммы уже есть.
На стороне отчётов (`registry-excel.ts`, `passport-excel.ts`) добавляется
вычисляемая колонка:

```ts
const usdAmount = row.currency === "USD"
  ? row.amount
  : await fxConvert(row.amount, row.currency, "USD", row.date);
```

Для DER-колонок (`supplier_balance`, `buyer_debt` и т.п.) отчёт считает
эквивалент из SRC-компонентов, а не переводит агрегат — иначе получим
искажённый курс из-за смешения дат.

---

## 6. Обзор: что НЕ покрыто и требует уточнения у клиента

| Вопрос | Варианты |
|--------|----------|
| Для `supplier_contracted_amount` какая дата курса — момент подписания или `avg_month_date`? | Уточнить: обычно ЦБ РК на дату подписания. |
| Для `supplier_balance` и `buyer_debt` — брать курс на «сегодня» или на самую свежую компоненту? | Компонентная переоценка (recomputed). |
| Нужны ли исторические срезы («баланс на 30 июня в KZT»)? | Если да — курс на дату среза. |
| Нужен ли отдельный `manual_fx_rate` на сделке для «полу-фиксации» контрактного курса? | Возможно, для внутренних отчётов bookkeeping. |

---

_Собрано автоматически из `supabase/migrations/*.sql` — актуально на дату
последнего коммита в `main`. При добавлении новых money-колонок
перегенерировать: `python3 scratchpad/collect-numeric-cols.py`._

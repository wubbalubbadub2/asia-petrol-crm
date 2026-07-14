# CHANGELOG-SINCE-EXTRACTION.md

Running log of every change made to this repo after the DELTA snapshot.

**Baseline:** `DELTA-SINCE-EXTRACTION.md` covers everything from the AS-BUILT
extraction (2026-06-22, migrations ≤ 00093) through 2026-07-11 (`main` at
`c8774f3`, migrations ≤ 00115). Entries below start AFTER that point.

**Rule:** after EVERY change — before finishing the task — append one entry.
No commit without its changelog entry. FORMULA changes must always include
Before → After.

Entry template:

```
### YYYY-MM-DD — <short title>
- **What changed:** file(s), migration number(s), column(s), function(s)
- **Type:** [FORMULA] | [SCHEMA] | [EXPORT] | [UI-FIELD] | [BEHAVIOR] | [PRESENTATION]
- **Before → After:** for FORMULA/SCHEMA show the old and new logic exactly
- **Client reason:** one sentence, if known
- **Rebuild impact:** DATA-MODEL / PRICING / ACCEPTANCE-SCENARIOS /
  FIELD-OWNERSHIP — name the doc(s), or "presentation only"
```

---

<!-- Entries below, newest first -->

### 2026-07-16 — 00116: WHEN-guards на rollup-триггеры реестра (statement timeout)
- **What changed:** migration `00116_registry_rollup_when_guards.sql` — функции `refresh_deal_shipment_totals`, `update_deal_additional_expenses`; триггеры `trg_shipment_refresh_deal` и `trg_update_deal_additional_expenses` разбиты на `*_ins_del` (безусловные) + `*_upd` (с WHEN).
- **Type:** [FORMULA] (тела rollup-функций) + [BEHAVIOR] (условия срабатывания триггеров)
- **Before → After:**
  - `trg_shipment_refresh_deal`: AFTER INSERT OR UPDATE OR DELETE безусловно → UPDATE-ветка срабатывает только `WHEN (OLD.loading_volume|shipment_volume|shipped_tonnage_amount|deal_id IS DISTINCT FROM NEW.*)`; INSERT/DELETE без изменений.
  - `trg_update_deal_additional_expenses`: AFTER INSERT OR UPDATE OR DELETE безусловно (00115) → UPDATE-ветка только `WHEN (OLD.additional_expenses|deal_id IS DISTINCT FROM NEW.*)`. WHEN сравнивает значения, а не SET-list — auto-compute из BEFORE-триггера 00113 ловится, баг 00112 не возвращается.
  - `refresh_deal_shipment_totals()`: `UPDATE deals ... FROM (SELECT SUM ...)` + ветка `IF NOT FOUND → нули` → SUM в переменные + один UPDATE с guard'ом `AND (<поле> IS DISTINCT FROM <значение>)`; пустой реестр даёт нули через COALESCE (семантика сохранена). Сами формулы сумм НЕ менялись: `supplier_shipped_volume=SUM(loading)`, `buyer_shipped_volume=actual_shipped_volume=SUM(shipment)`, `invoice_amount=SUM(shipped_tonnage_amount)`.
  - `update_deal_additional_expenses()`: `UPDATE deals SET additional_expenses_amount = v_sum` безусловно → `... AND additional_expenses_amount IS DISTINCT FROM v_sum`. Формула `SUM(additional_expenses)` не менялась.
- **Client reason:** «canceling statement due to statement timeout» при быстром вводе № СФ (12:57 Алматы, 15–18 правок/мин по audit_log) — каждая правка любой ячейки реестра дважды безусловно переписывала строку deals; параллельные правки одной сделки сериализовались на её блокировке, хвост очереди превышал 8-секундный лимит Supabase и правка терялась.
- **Rebuild impact:** DATA-MODEL/PRICING — правило для rebuild: rollup-триггеры реестра должны быть guarded (fire-on-change), иначе конкурентный ввод упирается в блокировку строки deals.

### 2026-07-16 — Detail-экспорт: дата СНТ только при своём тоннаже
- **What changed:** `src/lib/exports/passport-detail-excel.ts` — колонки «Дата вход. СНТ» / «Дата исход. СНТ» на под-строках.
- **Type:** [EXPORT]
- **Before → After:** обе даты = `registry.date` безусловно → «Дата вход. СНТ» только если заполнено `loading_volume` (Входящее СНТ), «Дата исход. СНТ» только если заполнено `shipment_volume` (Исходящее СНТ). Пустой тоннаж = пустая дата.
- **Client reason:** KG/26/487 — «дата отгрузки» в реестре одна на строку и относится к той стороне, чей тоннаж внесён; в экспорте она разводится на две колонки, и дата без тоннажа читалась как «нулевая отгрузка с датой» (2026-07-16).
- **Rebuild impact:** presentation only (EXPORT-LAYOUTS).

### 2026-07-16 — Валюта логистики: fallback в реестре + дефолт формы создания
- **What changed:** `src/lib/hooks/use-registry.ts` (REG_SELECT deal-embed + тип), `src/app/(dashboard)/registry/page.tsx` (4 места fallback), `src/lib/exports/registry-excel.ts` (колонка «Валюта» в обоих вариантах), `src/app/(dashboard)/deals/new/page.tsx` (дефолт валюты).
- **Type:** [BEHAVIOR] + [PRESENTATION]
- **Before → After:**
  - Валюта строки реестра: `row.currency ?? deals.currency (legacy) ?? дефолт таба` → `row.currency ?? deals.logistics_currency ?? deals.currency ?? дефолт таба`. Смена валюты в разделе Логистика сделки теперь сразу видна в реестре (для строк без явной валюты — их 95%).
  - Форма создания сделки: валюта по умолчанию `USD` всегда → `DEAL_TYPE_CURRENCY[тип]` (KZ → KZT, KG → USD), автоследование за сменой типа, пока валюта не выбрана вручную.
- **Client reason:** «Когда мы заводим сделку… в разделе логистика почему-то не дублирует валюту. Стоит по умолчанию другая» + «При изменении валюты в разделе логистика автоматом менялось в реестре» (2026-07-16).
- **Rebuild impact:** FIELD-OWNERSHIP/DATA-MODEL: fallback-цепочка валюты реестра — правило для rebuild-доков; схема БД не менялась.

### 2026-07-16 — Detail-экспорт: «Дата оплаты» из deal_payments
- **What changed:** `src/lib/exports/passport-detail-excel.ts` — новый батч-фетч `fetchPaymentDatesByDeals()`; колонки «Дата оплаты» (пост./покуп.) на главной строке сделки.
- **Type:** [EXPORT]
- **Before → After:** читали `deals.supplier_payment_date` / `buyer_payment_date` (ручной TEXT, заполнен у 7 и 1 сделки из 792) → список реальных дат из `deal_payments.payment_date` по стороне (`side`), формат dd.mm.yyyy через запятую, по возрастанию; TEXT-поле осталось как fallback при отсутствии платежей.
- **Client reason:** «даты оплат не прогрузились в detail excel» (2026-07-16).
- **Rebuild impact:** presentation only (EXPORT-LAYOUTS); схема и формулы БД не менялись.

### 2026-07-14 — Экспорт паспорта: 3 варианта + новый «Паспорт (детальный)»
- **What changed:**
  - NEW `src/lib/exports/passport-detail-excel.ts` — `exportPassportDetailToExcel()`: 63-колоночный формат по клиентскому файлу `passport-detail-2026-07-09.xlsx`; под каждой сделкой — под-строка на каждую строку `shipment_registry` (outlineLevel=1, сворачиваемые).
  - `src/app/(dashboard)/deals/page.tsx` — кнопка Excel заменена на DropdownMenu: «Паспорт» (прежний формат, без изменений), «Паспорт (детальный)», «Паспорт (долги)» (disabled, «Скоро»).
  - `src/lib/hooks/use-deals.ts` — `fetchDealLinesForExport` теперь тянет `quotation_type:quotation_product_types(basis)`; `DealLineSnapshot` расширен полем `quotation_type`.
  - `src/lib/exports/registry-excel.ts` — `roundedTonnage()` экспортирована (структурный параметр) для реюза в detail-экспорте.
- **Type:** [EXPORT]
- **Before → After:**
  - Кнопка Excel: одиночная (только «Паспорт») → выпадающее меню с 3 вариантами.
  - «Остаток, т» в detail-варианте: `shipped − ordered` (как в обычном паспорте) → `ordered − shipped` (положительный; клиентская аннотация «остаток сделать плюсовой»). Обычный «Паспорт» НЕ изменён.
  - Detail-layout vs обычный: +«Биржа» (пост./покуп., из `quotation_product_types.basis` через линии), +«Дата вход./исход. СНТ» (на под-строках), +«Дата оплаты» (обе стороны, из `deals.*_payment_date`), группы получили блок «Биржа (пусто)|Котировка|Скидка|Цена предв.|Цена финальная» (из `deal_company_groups`), −«Цена гр. (avg)», −«Сумма грузоотпр.», логистика: «жд тариф план/Плановая сумма жд/Объем по счету-фактуре/жд тариф факт/Сумма жд по счету-фактуре» + «Менеджер по покупке»/«Менеджер по продаже» (buyer_manager ранее в экспорт не выводился).
  - Под-строки несут только значения вагона: тоннажи (`loading_volume`/`shipment_volume`), даты, `Отгр. сумма = цена сделки × тоннаж вагона` (клиентская формула `O$4*P5`), приложения (`supplier_appendix`/`buyer_appendix` с fallback на договор сделки), жд-данные (`railway_tariff`, `shipped_tonnage_amount`, rounded tonnage). Агрегаты сделки (Оплата/Баланс/Заявлено/Остаток/Долг/группы-числа) — только на главной строке (иначе SUM задваивается).
- **Client reason:** клиент прислал размеченный шаблон (`files/Паспорт/`) — нужна детальная выгрузка с расшифровкой по отгрузкам; формат «долги» ждёт утверждения.
- **Rebuild impact:** EXPORT-LAYOUTS (новый вариант выгрузки); FIELD-OWNERSHIP не затронут (новых DB-полей нет); PRICING не затронут (формулы в БД не менялись — расчёт `цена × тоннаж` только в файле экспорта).

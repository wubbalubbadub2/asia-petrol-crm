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

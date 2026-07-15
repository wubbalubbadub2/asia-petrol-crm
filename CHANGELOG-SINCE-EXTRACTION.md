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

### 2026-07-15 — Итоги в реестре: sticky-бар внизу экрана + полные суммы в Excel
- **What changed:** `registry/page.tsx` (`grandTotals` useMemo + sticky-бар внизу страницы), `registry-excel.ts` (TOTAL_KEYS).
- **Type:** [PRESENTATION]
- **Before → After:**
  - Экран: итогов внизу не было (только в шапке каждой группы) → sticky-бар внизу вьюпорта с суммами по всей отфильтрованной выборке: Входящее СНТ, Исходящее СНТ, Округл (та же логика, что ячейка: override → CEIL при round_volume → raw, база по табу), Сумма и Сумма грузоотправителя — деньги группируются по валюте («1 234,00 $ · 567,00 ₸» при смешанной выборке).
  - Excel «Итого»: суммировались только исходящее СНТ/округл/сумма → добавлены Входящее СНТ (`loading_volume`) и Сумма грузоотправителя (`additional_expenses`). Тарифы не суммируются (ставки).
- **Client reason:** «итоги не появились внизу в реестре» (2026-07-15).
- **Rebuild impact:** presentation only.

### 2026-07-15 — 00120: два фактических тарифа (авто из реестра) + автоподстановка «Объем план»
- **What changed:** migration `00120_actual_tariffs.sql` (колонки `deals.actual_tariff_override`, `deals.shipper_actual_tariff`, `deals.shipper_actual_tariff_override`; `compute_deal_derived_fields` расширена; backfill-пересчёт всех сделок); `use-deals.ts` (тип + LIST_SELECT); `passport-table.tsx` (2 новые колонки, EditableNumCell с override, totals); `deals/[id]/page.tsx` (Field с extraPatch, «Тариф факт» с override + новое поле «Тариф факт (грузоотпр.)»); `deals/new/page.tsx` («Объем план» преинициализируется объемом поставщика).
- **Type:** [FORMULA] + [SCHEMA] + [UI-FIELD]
- **Before → After:**
  - `deals.actual_tariff`: ручное поле → авто-расчёт в `compute_deal_derived_fields`: `invoice_amount ÷ базовый объем СНТ` (KZ → `supplier_shipped_volume` = SUM входящего, KG/прочие → `actual_shipped_volume` = SUM исходящего); NULL если суммы/объема нет. Ручная правка ставит `actual_tariff_override = TRUE` — авто-расчёт поле не трогает. ⚠ Прошлые ручные значения перетёрты backfill'ом (у них override=FALSE; правило клиента «факт всегда с реестра»).
  - Новое `deals.shipper_actual_tariff` («Тариф факт грузоотпр.»): `additional_expenses_amount ÷ supplier_shipped_volume` (входящее СНТ), тот же override-паттерн.
  - Паспорт: колонка «Тариф факт» между «Предв. сумма» и «Факт объем»; колонка «Тариф факт (грузоотпр.)» между «Сумма» и «Сумма грузоотпр.». Обе editable-with-override (курсив+amber при ручном вводе), в Итого — пусто (ставки не суммируются).
  - Сделка (Логистика): «Тариф факт» теперь авто с override; новое поле «Тариф факт (грузоотпр.)».
  - Форма создания: «Объем план» подставляется из «Объем, т» поставщика, пока логист не ввёл своё (вариант «б», подтверждён).
  - Detail-экспорт «жд тариф факт» автоматически стал расчётным (читал `actual_tariff`).
- **Client reason:** «Тариф фактический берётся с реестра: итоговая сумма делённая на объем входящего/исходящего СНТ… считается автоматом и может меняться вручную… в сделке в разделе логистика нужно добавить второй тариф факт… Объем план исходит от объема поставщика по договору» (2026-07-15).
- **Rebuild impact:** PRICING (новая формула фактических тарифов), DATA-MODEL (3 новые колонки), FIELD-OWNERSHIP (actual_tariff: авто до override; preliminary_tonnage: prefill от supplier volume).

### 2026-07-15 — 00119: раздельные даты входящего и исходящего СНТ в реестре
- **What changed:** migration `00119_loading_date.sql` — колонка `shipment_registry.loading_date DATE` + backfill; `use-registry.ts` (тип, REG_SELECT, RegistryInsert/Update); `registry/page.tsx` (новая колонка «дата вход. СНТ» после «Входящее СНТ», «дата отгр.» переименована в «дата исход. СНТ», оба диалога добавления пишут loading_date при записи налива); `bulk-add-dialog.tsx` (то же); `registry-excel.ts` (FULL: +«Дата вход. СНТ», «Дата отгр.» → «Дата исход. СНТ»; PTS не тронут — фикс. формат экспедитора); `passport-detail-excel.ts` («Дата вход. СНТ» теперь из loading_date).
- **Type:** [SCHEMA] + [UI-FIELD] + [EXPORT]
- **Before → After:**
  - Была одна дата на строку (`date`, «дата отгр.») → теперь `date` = дата исходящего СНТ (semantics не менялась — на ней resolve_shipment_year_month, autoprice, сортировка), `loading_date` = дата входящего СНТ.
  - Backfill: `loading_date = date` там, где заполнен налив (`loading_volume IS NOT NULL`) — ровно то, что detail-экспорт уже показывал как «Дата вход. СНТ». Audit/activity триггеры заглушены на время backfill.
  - Вставка строк (одиночная + оба «Массово»): `loading_date` наследует дату строки, когда пишется налив (`volumeTarget=load` или «Продублировать отгрузку»).
- **Client reason:** «давай в реестре разделим даты входящего и исходящего СНТ. У каждого будет своя колонка с датой» (2026-07-15).
- **Rebuild impact:** DATA-MODEL (новая колонка + правило: date=исходящее, loading_date=входящее); EXPORT-LAYOUTS.

### 2026-07-19 — Паспорт: редактирование оплат прямо в попапе колонки «Оплата»
- **What changed:** `src/components/deals/passport-table.tsx` — `PaymentBreakdownCell`: статичный текстовый список оплат заменён на редактируемые строки (новый компонент `PaymentEditRow`), добавлены `patchPayment` / `deletePayment` / `addPayment`.
- **Type:** [UI-FIELD]
- **Before → After:** попап показывал оплаты read-only, менять можно было только «итог» (перезапись rollup-колонки deals) или идти в сделку → теперь в попапе каждая оплата редактируется inline (дата + сумма), удаляется («×», с подтверждением), добавляется («+ Оплата», сегодняшняя дата, сумма 0, тип «Оплата»). Записи идут напрямую в `deal_payments`; rollup `deals.supplier_payment`/`buyer_payment` пересчитывает существующий DB-триггер; кэши (`invalidateDealPayments` + `invalidateDeal`) будят список без F5. Кнопка «Изменить итог» сохранена. Пустая сумма = 0 (`amount NOT NULL` в БД).
- **Client reason:** «когда нажимаем на колонку оплата… можем ли сделать так, чтобы оплаты и даты можно сразу в модалке менять, не проваливаясь в сделку» (2026-07-19).
- **Rebuild impact:** presentation only — схема и формулы не менялись; для rebuild-доков: оплаты редактируются из двух мест (страница сделки + попап паспорта), оба пишут в `deal_payments`.

### 2026-07-18 — 00118: станции сделки дозаполняют реестр + fallback в «Массово»
- **What changed:** migration `00118_station_propagation.sql` (функция `propagate_deal_stations_to_registry`, триггер `trg_propagate_deal_stations` на deals, catch-up станций + повтор tariff catch-up); `use-registry.ts` (deal-embed + станции сделки), `registry/page.tsx` (fallback станций в bulk-контексте).
- **Type:** [BEHAVIOR]
- **Before → After:**
  - Раньше: станция копировалась в строку реестра только в момент вставки; если у сделки в тот момент станции не было — строки оставались с NULL навсегда (KG/26/275: 24 строки без станции, batch 12:53 до заполнения станции на сделке, batch 12:55 — после).
  - Теперь: появление/смена `supplier_departure_station_id` / `buyer_destination_station_id` на сделке дозаполняет строки реестра этой сделки, где станция NULL. Явно выбранные станции не перетираются.
  - Catch-up: разово дозаполнены NULL-станции по всей базе из сделок; затем повторён tariff catch-up 00117 — строки без станций раньше не могли сматчиться со справочником тарифов.
  - «Массово» с /registry: станции контекста теперь fallback'ятся на поля сделки, когда первая строка группы без станций.
- **Client reason:** «в некоторых отгрузках KG/26/275 отсутствует ст. отправления» (2026-07-18).
- **Rebuild impact:** FIELD-OWNERSHIP (станция строки реестра: сделка дозаполняет NULL, ручной выбор неприкосновенен); DATA-MODEL — новое propagation-правило.

### 2026-07-18 — Сумма грузоотправителя: ручной ввод без тарифа менеджера
- **What changed:** `registry/page.tsx` — ячейка «Сумма грузоотправителя» (`additional_expenses`) теперь коммитит `additional_expenses_override = true` при ручной правке (EN получил параметры titleManual/titleAuto).
- **Type:** [UI-FIELD]
- **Before → After:** ячейка писала только `additional_expenses`; BEFORE-триггер 00113 при `additional_expenses_override = FALSE` и `manager_tariff IS NULL` немедленно затирал введённое значение в NULL («ей всегда нужен тариф») → теперь ручной ввод (включая очистку) ставит override, триггер значение не трогает — семантика идентична ручной сумме `shipped_tonnage_amount` и тарифу 00117. Отображение: курсив + amber + tooltip. Формулы БД не менялись — колонка override существовала с 00113, UI её не использовал.
- **Client reason:** «В реестре KZ в столбце сумма грузоотправления не можем вставить вручную сумму… Ей всегда нужен тариф, без тарифа сумма не вносится, а нужно чтобы вносилась» (2026-07-14).
- **Rebuild impact:** FIELD-OWNERSHIP (additional_expenses: авто до ручного override); presentation в остальном.

### 2026-07-18 — 00117: тариф из справочника автоматически обновляет реестр
- **What changed:** migration `00117_tariff_propagation.sql` — колонка `shipment_registry.railway_tariff_override BOOLEAN NOT NULL DEFAULT FALSE`, функция `propagate_tariff_to_registry()`, триггеры `trg_propagate_tariff_ins/upd` на `tariffs`, catch-up по всем тарифам; frontend `registry/page.tsx` (EN-ячейка «Тариф (логисты)» ставит override при ручной правке, курсив при override), `use-registry.ts` (тип + REG_SELECT + RegistryUpdate).
- **Type:** [SCHEMA] + [BEHAVIOR] + [UI-FIELD]
- **Before → After:**
  - Раньше: lookup тарифа только при вставке строки реестра (UI) и разовыми backfill'ами (00047); изменение ставки в справочнике Тарифы реестр не трогало.
  - Теперь: INSERT тарифа или изменение `planned_tariff` → UPDATE всех строк реестра c совпадением по ключу 00047 (departure + destination + fuel + forwarder + month с fallback'ом на поля сделки + год сделки), КРОМЕ строк с `railway_tariff_override = TRUE`. Обнуление ставки в справочнике реестр не трогает (защита от массового стирания).
  - Ручная правка ячейки «Тариф (логисты)» в реестре (включая очистку) ставит `railway_tariff_override = TRUE` — строка выходит из-под propagation (семантика как у `shipped_tonnage_amount_override`: «ручной ввод всегда приоритетнее»). Отображение: курсив + amber, tooltip.
  - Пересчёт сумм — существующей цепочкой (compute_registry_amount + guarded rollups 00116).
  - Catch-up в миграции выравнивает уже разъехавшиеся строки (пример клиента: KG/26/270 держал 78.71 при 76.00 в справочнике).
- **Client reason:** «when users change the тариф, in the registry тариф (логисты) does not change, but it should always get the updated тариф, unless it wasn't updated manually in registry» (2026-07-18).
- **Rebuild impact:** DATA-MODEL (новая колонка + правило propagation), PRICING (тариф → суммы строк пересчитываются), FIELD-OWNERSHIP (тариф строки: справочник владеет до ручного override). ⚠ У строк с ручным тарифом, введённым ДО миграции, флага нет — catch-up выровнял их по справочнику (отличить задним числом невозможно, правило клиента — справочник главный).

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

-- 00161_align_registry_tariff_with_reference.sql
--
-- Клиент 2026-09-18: «в реестре тариф (логисты) не подтягивается из
-- Тарифа», скриншот КГ/26/541 — в справочнике ст. Темир → ст. Карабалта,
-- PTC - Operator, Мазут, август = 64,80, а в строках реестра 63,45
-- (июльская ставка), при том что «мес. отгр.» у строк — август.
--
-- ЧТО ПОКАЗАЛИ ДАННЫЕ (18.09.2026, боевая база):
--   • ключ строки сейчас разрешается правильно: подбор по
--     (Темир, Карабалта, Мазут, PTC - Operator, август, 2026) даёт 64,80;
--   • audit_log по строке: ровно ОДНА запись — INSERT 07.08.2026 11:10,
--     уже с shipment_month = «август» и railway_tariff = 63,4500. Больше
--     строку не трогали, ключ не менялся;
--   • августовская ставка заведена 03.08, то есть ДО появления строк,
--     поэтому пропагация из справочника (00117, AFTER INSERT на tariffs)
--     до них дойти не могла;
--   • подбор при вставке строки появился только в 00148 (после 12.08) —
--     на 07.08 импорт писал свой тариф, и переписать его было некому;
--   • бэкфилл из 00148 брал ТОЛЬКО строки с пустым тарифом, а здесь
--     стояло 63,45, поэтому строки остались со старым значением.
--
-- То есть механизм подбора исправен, а это — исторический осадок: строки,
-- вставленные со своим тарифом до 00148. Новые строки такого больше не
-- дают: BEFORE INSERT триггер 00148 перезаписывает пришедшее значение
-- ставкой из справочника.
--
-- МАСШТАБ (та же выгрузка, 2026 год, 11 007 строк реестра):
--   • 0 строк с пустым тарифом, для которых ставка в справочнике есть;
--   • 20 строк, где тариф стоит, расходится со справочником и НЕ помечен
--     ручным (railway_tariff_override = FALSE) — все 20 это КГ/26/541,
--     один импорт 07.08.2026 11:10;
--   • 170 строк с ручным override — их не трогаем;
--   • 4 298 строк без тарифа, на ключ которых ставки в справочнике нет.
--
-- ДЕНЬГИ. У КГ/26/541 Сумма 1 (логисты) 80 898,75 → 82 620,00 USD
-- (+1 721,25). Баланс поставщика не меняется: railway_in_price = FALSE.
-- «Тариф факт» пересчитается сам (00120), «Сумма ЖД (поставщик)» и
-- «Сумма грузоотправления» не затрагиваются — у них свои тарифы.
--
-- ЧЕГО МИГРАЦИЯ НЕ ДЕЛАЕТ:
--   • не меняет ни одной функции и ни одного триггера — только данные;
--   • не трогает строки с railway_tariff_override = TRUE (ручная ставка
--     остаётся ручной) и строки, для которых ставки в справочнике нет;
--   • не заводит новых ставок в справочнике: чего там нет, того здесь не
--     появится.
--
-- ROLLBACK: значения до правки печатаются в NOTICE построчно (id, было,
-- стало). Вернуть — UPDATE shipment_registry SET railway_tariff = <было>
-- WHERE id = <id>; суммы пересчитает тот же триггер.

DO $$
DECLARE
  r            RECORD;
  v_rows       INT := 0;
  v_amount_before NUMERIC := 0;
  v_amount_after  NUMERIC := 0;
BEGIN
  -- ── 1. Разбор: что именно разойдётся, с печатью до правки ──────────
  FOR r IN
    SELECT sr.id, d.deal_code, sr.wagon_number,
           COALESCE(sr.shipment_month, d.month) AS mon,
           sr.railway_tariff AS old_tariff,
           (SELECT t.planned_tariff
              FROM tariffs t
             WHERE t.departure_station_id   = COALESCE(sr.departure_station_id,   d.supplier_departure_station_id)
               AND t.destination_station_id = COALESCE(sr.destination_station_id, d.buyer_destination_station_id)
               AND t.fuel_type_id           = COALESCE(sr.fuel_type_id,           d.fuel_type_id)
               AND t.forwarder_id           = COALESCE(sr.forwarder_id,           d.forwarder_id)
               AND t.month                  = COALESCE(sr.shipment_month,         d.month)
               AND t.year                   = d.year
               AND t.planned_tariff IS NOT NULL
             ORDER BY t.planned_tariff
             LIMIT 1) AS ref_tariff
      FROM shipment_registry sr
      JOIN deals d ON d.id = sr.deal_id
     WHERE COALESCE(sr.railway_tariff_override, FALSE) = FALSE
  LOOP
    CONTINUE WHEN r.ref_tariff IS NULL;
    CONTINUE WHEN r.old_tariff IS NOT DISTINCT FROM r.ref_tariff;

    RAISE NOTICE '% вагон % (% ): тариф % → % [id %]',
      r.deal_code, COALESCE(r.wagon_number, '—'), r.mon, COALESCE(r.old_tariff, 0), r.ref_tariff, r.id;

    -- Сумма 1 до и после — считаем по той же базе, что compute_registry_amount
    -- (KG — исходящее СНТ, KZ — входящее; округление по round_volume /
    -- rounded_volume_override).
    SELECT v_amount_before + COALESCE(sr.shipped_tonnage_amount, 0),
           v_amount_after + COALESCE(
             CASE
               WHEN sr.rounded_volume_override IS NOT NULL THEN sr.rounded_volume_override
               WHEN sr.round_volume THEN CEIL(CASE WHEN sr.registry_type = 'KZ' THEN sr.loading_volume ELSE sr.shipment_volume END)
               ELSE CASE WHEN sr.registry_type = 'KZ' THEN sr.loading_volume ELSE sr.shipment_volume END
             END * r.ref_tariff, 0)
      INTO v_amount_before, v_amount_after
      FROM shipment_registry sr WHERE sr.id = r.id;

    UPDATE shipment_registry SET railway_tariff = r.ref_tariff WHERE id = r.id;
    v_rows := v_rows + 1;
  END LOOP;

  RAISE NOTICE 'выровнено строк: %; Сумма 1 по ним: % → % (дельта %)',
    v_rows, v_amount_before, v_amount_after, v_amount_after - v_amount_before;

  -- ── 2. Сверка: расхождений без ручной пометки не осталось ──────────
  PERFORM 1
    FROM shipment_registry sr
    JOIN deals d ON d.id = sr.deal_id
   WHERE COALESCE(sr.railway_tariff_override, FALSE) = FALSE
     AND sr.railway_tariff IS DISTINCT FROM (
       SELECT t.planned_tariff FROM tariffs t
        WHERE t.departure_station_id   = COALESCE(sr.departure_station_id,   d.supplier_departure_station_id)
          AND t.destination_station_id = COALESCE(sr.destination_station_id, d.buyer_destination_station_id)
          AND t.fuel_type_id           = COALESCE(sr.fuel_type_id,           d.fuel_type_id)
          AND t.forwarder_id           = COALESCE(sr.forwarder_id,           d.forwarder_id)
          AND t.month                  = COALESCE(sr.shipment_month,         d.month)
          AND t.year                   = d.year
          AND t.planned_tariff IS NOT NULL
        ORDER BY t.planned_tariff LIMIT 1)
     AND EXISTS (
       SELECT 1 FROM tariffs t
        WHERE t.departure_station_id   = COALESCE(sr.departure_station_id,   d.supplier_departure_station_id)
          AND t.destination_station_id = COALESCE(sr.destination_station_id, d.buyer_destination_station_id)
          AND t.fuel_type_id           = COALESCE(sr.fuel_type_id,           d.fuel_type_id)
          AND t.forwarder_id           = COALESCE(sr.forwarder_id,           d.forwarder_id)
          AND t.month                  = COALESCE(sr.shipment_month,         d.month)
          AND t.year                   = d.year
          AND t.planned_tariff IS NOT NULL);

  IF FOUND THEN
    RAISE EXCEPTION 'после выравнивания остались строки, расходящиеся со справочником — миграция отменена';
  END IF;
END $$;

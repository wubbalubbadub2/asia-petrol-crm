-- 00131_reheal_shipment_price_totals.sql
--
-- Клиент 2026-07-30 (KG/26/191, покупатель Zhongda): «сумма отгрузки
-- 404 010,50 — откуда? 870,901 × 500 ≠ 404 010,50».
--
-- Диагностика:
--   • Вариант-строка и сумма всех 14 строк deal_shipment_prices (side=buyer)
--     дают верные 435 450,50 = 870,901 × 500.
--   • Но deals.buyer_shipped_amount застряло на 404 010,50 — ровно на одну
--     отгрузку меньше (строка 62,880 т = 31 440,00 от 09.06.26). При этом
--     buyer_shipped_volume (роллап из shipment_registry) включает все 14
--     отгрузок → рассинхрон amount-роллапа с volume-роллапом.
--   • Из-за заниженной суммы отгрузки buyer_debt показывал 31 440 переплату
--     вместо 0 (оплата 435 450,50 = отгрузка 435 450,50).
--
-- Масштаб: ровно 1 сделка из 871 (buyer), supplier-сторона консистентна.
-- Это единичный застрявший роллап (deal_shipment_prices для этой сделки
-- пересобрались 29.07 одним пакетом; роллап на deals не подхватил полный
-- набор — разовый рассинхрон, не дефект логики: функция 00030 суммирует
-- amount без WHEN-гардов).
--
-- Фикс: пере-прогнать существующий проверенный роллап refresh_deal_price_totals
-- по всем сделкам с ценами (точно как backfill в 00030). Идемпотентно:
-- выставляет supplier/buyer_shipped_amount = SUM(deal_shipment_prices.amount)
-- — для 870 сделок это no-op, для KG/26/191 чинит 404 010,50 → 435 450,50.
-- Обновление deals пере-считает buyer_debt через BEFORE-триггер derived-fields
-- (→ 0 для этой сделки).
--
-- Rollback: значения производные (SUM из deal_shipment_prices), потери данных
-- нет; повторный прогон роллапа восстанавливает любое состояние из источника.

DO $$
DECLARE
  r RECORD;
  v_before NUMERIC;
  v_after NUMERIC;
BEGIN
  FOR r IN SELECT DISTINCT deal_id FROM deal_shipment_prices LOOP
    PERFORM refresh_deal_price_totals(r.deal_id);
  END LOOP;

  SELECT buyer_shipped_amount INTO v_after FROM deals WHERE deal_code = 'KG/26/191';
  RAISE NOTICE 'KG/26/191 buyer_shipped_amount после ре-роллапа = % (ожидается 435450.50)', v_after;
END $$;

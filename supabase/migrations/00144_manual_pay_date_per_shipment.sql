-- 00144_manual_pay_date_per_shipment.sql
--
-- Клиент 2026-08-11: «Если отсчёт срока выбрали "Дата вручную" — дата
-- должна появиться в разделе логистика на каждую отгрузку».
--
-- В 00142 ручная дата была одна на приложение. Теперь её ставят по
-- каждой отгрузке — в блоке «Логистика» карточки сделки, в таблице
-- «Отгрузки по датам». Логика та же, что у остальных полей реестра:
-- значение принадлежит отгрузке.
--
-- Стороны раздельны: приложение поставщика может считать срок от даты
-- отгрузки, а приложение покупателя — по ручной дате, и наоборот.
-- Поэтому две колонки, а не одна.
--
-- Прежние уровни не удаляем и не переносим: они остаются запасными
-- значениями, если где-то уже проставлены. Порядок разрешения для
-- ручного режима:
--   1) дата на отгрузке (00144)          — то, что вводит менеджер;
--   2) дата на приложении (00142)        — если осталась с прошлой версии;
--   3) дата на сделке (00125, режим 'other').

ALTER TABLE shipment_registry
  ADD COLUMN IF NOT EXISTS supplier_planned_pay_date DATE,
  ADD COLUMN IF NOT EXISTS buyer_planned_pay_date    DATE;

COMMENT ON COLUMN shipment_registry.supplier_planned_pay_date IS
  'Плановая дата оплаты поставщику по этой отгрузке. Работает, когда у приложения поставщика deferral_date_basis = manual.';
COMMENT ON COLUMN shipment_registry.buyer_planned_pay_date IS
  'Плановая дата оплаты покупателем по этой отгрузке. Работает, когда у приложения покупателя deferral_date_basis = manual.';

-- =====================================================================
-- Пересборка расчёта
-- =====================================================================
-- Состав и порядок колонок не меняются — CREATE OR REPLACE не ломает
-- зависящие deal_payment_terms_report и deal_payment_terms_summary.

CREATE OR REPLACE VIEW deal_payment_terms
WITH (security_invoker = true) AS
WITH sides AS (
  SELECT unnest(ARRAY['supplier','buyer']) AS side
),
base AS (
  SELECT
    sr.id      AS shipment_id,
    sr.deal_id,
    s.side,
    sr.wagon_number,
    sr.loading_date,
    sr.date    AS shipment_date,
    CASE s.side WHEN 'supplier' THEN sr.supplier_line_id ELSE sr.buyer_line_id END AS line_id,
    CASE s.side WHEN 'supplier' THEN COALESCE(sr.supplier_appendix, sl.appendix)
                ELSE COALESCE(sr.buyer_appendix,  bl.appendix) END AS appendix,
    CASE s.side WHEN 'supplier' THEN COALESCE(sl.deferral_days, d.supplier_deferral_days)
                ELSE COALESCE(bl.deferral_days, d.buyer_deferral_days) END AS deferral_days,
    CASE s.side WHEN 'supplier'
         THEN COALESCE(sl.deferral_date_basis, d.supplier_deferral_date_basis, 'auto')
         ELSE COALESCE(bl.deferral_date_basis, d.buyer_deferral_date_basis,   'auto') END AS date_basis,
    CASE s.side WHEN 'supplier' THEN d.supplier_deferral_mode ELSE d.buyer_deferral_mode END AS deferral_mode,
    CASE s.side WHEN 'supplier' THEN d.supplier_planned_pay_date ELSE d.buyer_planned_pay_date END AS manual_pay_date,
    CASE s.side WHEN 'supplier' THEN sl.deferral_planned_date ELSE bl.deferral_planned_date END AS line_manual_date,
    -- Ручная дата самой отгрузки (00144) — то, что вводит менеджер.
    CASE s.side WHEN 'supplier' THEN sr.supplier_planned_pay_date ELSE sr.buyer_planned_pay_date END AS ship_manual_date,
    dsp.volume,
    dsp.amount
  FROM shipment_registry sr
  CROSS JOIN sides s
  JOIN deals d ON d.id = sr.deal_id
  LEFT JOIN deal_supplier_lines  sl  ON s.side = 'supplier' AND sl.id = sr.supplier_line_id
  LEFT JOIN deal_buyer_lines     bl  ON s.side = 'buyer'    AND bl.id = sr.buyer_line_id
  LEFT JOIN deal_shipment_prices dsp ON dsp.shipment_registry_id = sr.id AND dsp.side = s.side
),
with_basis AS (
  SELECT b.*,
         CASE b.side WHEN 'supplier' THEN b.loading_date ELSE b.shipment_date END AS basis_date
  FROM base b
),
with_planned AS (
  SELECT w.*,
         CASE
           WHEN w.date_basis = 'manual'
             THEN COALESCE(w.ship_manual_date, w.line_manual_date, w.manual_pay_date)
           WHEN w.deferral_mode = 'other'  THEN w.manual_pay_date
           WHEN w.basis_date IS NULL OR w.deferral_days IS NULL THEN NULL
           ELSE w.basis_date + w.deferral_days
         END AS planned_pay_date
  FROM with_basis w
)
SELECT
  p.shipment_id,
  p.deal_id,
  p.side,
  p.wagon_number,
  p.appendix,
  p.line_id,
  CASE WHEN p.date_basis = 'manual' THEN NULL ELSE p.deferral_days END AS deferral_days,
  p.date_basis,
  p.deferral_mode,
  p.basis_date,
  p.planned_pay_date,
  CASE WHEN p.planned_pay_date IS NULL THEN NULL
       ELSE p.planned_pay_date - CURRENT_DATE END AS days_to_pay,
  p.volume,
  p.amount
FROM with_planned p;
